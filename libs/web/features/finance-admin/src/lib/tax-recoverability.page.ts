import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import type { TaxBreakdown, TaxRuleInput, TaxRuleSetView, TaxRuleView } from '@bf/contracts';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';

const ATTENDEE_LABEL: Record<TaxRuleView['attendeeType'], string> = {
  employees: 'Employees',
  clients: 'Clients present',
  mixed: 'Mixed attendees',
  any: 'Any attendees',
};

const STATUS_LABEL: Record<TaxRuleSetView['status'], string> = {
  draft: 'Draft',
  pending_approval: 'Waiting for the tax approver',
  returned: 'Returned',
  published: 'Published',
  superseded: 'Superseded',
};

/** An editable copy of a draft rule (share in percent for the form). */
interface EditRule {
  legalEntityId: string;
  categoryCode: string;
  attendeeType: TaxRuleView['attendeeType'];
  taxCode: string;
  sharePct: number | null;
  proportional: boolean;
  notes: string | null;
}

/**
 * Screen 080g: tax recoverability rules by legal entity, spend category and attendee type. Recoverable
 * GST/VAT never uses budget; the non-recoverable part does. Finance drafts, the tax approver publishes
 * with an effective date; published versions never change past commitments or actuals. Built from the
 * written spec (no approved Stitch design yet, decision D2).
 */
@Component({
  selector: 'bf-tax-recoverability-page',
  host: { class: 'bf-page-layout' },
  imports: [
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    Money,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Tax recoverability</h1>
        <p class="bf-page__subtitle">
          Tax the legal entity can recover (input GST or VAT) does not use budget; tax it cannot
          recover does. Commitments and actuals take the rules in force on their accounting date,
          and a new version never changes what was already posted.
        </p>
      </div>
      @if (valueOf(view); as v) {
        <div class="bf-page__actions">
          @if (v.current; as c) {
            <sat-status-tag status="success" data-testid="tax-version"
              >v{{ c.version }} Published, effective
              {{ c.effectiveFrom | date: 'd MMM y' : 'UTC' }}</sat-status-tag
            >
          }
          @if (v.canEdit && !v.draft) {
            <button mat-stroked-button type="button" (click)="newDraft()" [disabled]="busy()">
              New draft
            </button>
          }
        </div>
      }
    </header>

    <bf-load-state
      [loading]="view.isLoading() && !view.hasValue()"
      [error]="view.error()"
      what="the tax rules"
      (retry)="view.reload()"
    />
    @if (failure()) {
      <sat-banner variant="important" class="bf-banner" data-testid="tax-error"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }

    @if (valueOf(view); as v) {
      @if (v.upcoming; as u) {
        <sat-banner variant="info" class="bf-banner">
          <sat-banner-message
            >Version {{ u.version }} takes effect on
            {{ u.effectiveFrom | date: 'd MMM y' : 'UTC' }}; version {{ v.current?.version }} still
            applies until then.</sat-banner-message
          >
        </sat-banner>
      }
      @if (v.draft; as d) {
        <section class="bf-card" aria-labelledby="tax-draft-title" data-testid="tax-draft">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="tax-draft-title">
                Version {{ d.version }}: {{ statusLabel[d.status] }}
              </h2>
              <p class="bf-card__hint">
                Changes are highlighted against the version in force. The tax approver publishes;
                nobody publishes a version they submitted.
              </p>
            </div>
          </div>
          @if (d.status === 'pending_approval') {
            <sat-banner variant="warning" class="bf-banner">
              <sat-banner-message
                >Waiting for the tax approver since
                {{ d.submittedAt | date: 'd MMM' : 'UTC' }} (submitted by {{ d.submittedByName }});
                edits are locked.</sat-banner-message
              >
            </sat-banner>
          }
          @if (d.status === 'returned' && d.comment) {
            <sat-banner variant="warning" class="bf-banner">
              <sat-banner-message
                >Returned by {{ d.decidedByName }}: {{ d.comment }}</sat-banner-message
              >
            </sat-banner>
          }
          @if (editable(); as rules) {
            <div class="bf-table-scroll">
              <table class="bf-table" aria-label="Draft rules">
                <thead>
                  <tr>
                    <th>Entity</th>
                    <th>Category</th>
                    <th>Attendees</th>
                    <th>Tax code</th>
                    <th class="bf-num">Recoverable %</th>
                    <th>Proportional</th>
                    <th><span class="bf-sr">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of rules; track $index; let i = $index) {
                    <tr [class.bf-tax-changed]="changed(r)">
                      <td>{{ entityCode(r.legalEntityId) }}</td>
                      <td>{{ categoryName(r.categoryCode) }}</td>
                      <td>{{ attendeeLabel[r.attendeeType] }}</td>
                      <td>{{ r.taxCode }}</td>
                      <td class="bf-num">
                        <input
                          class="bf-tax-share"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          [attr.aria-label]="
                            'Recoverable share for ' +
                            entityCode(r.legalEntityId) +
                            ' ' +
                            categoryName(r.categoryCode) +
                            ' ' +
                            attendeeLabel[r.attendeeType]
                          "
                          [disabled]="r.proportional || !canEditDraft()"
                          [ngModel]="r.sharePct"
                          (ngModelChange)="setShare(i, $event)"
                        />
                      </td>
                      <td>
                        <mat-checkbox
                          [checked]="r.proportional"
                          [disabled]="!canEditDraft()"
                          (change)="setProportional(i, $event.checked)"
                          [aria-label]="
                            'Proportional to employees present for ' +
                            entityCode(r.legalEntityId) +
                            ' ' +
                            categoryName(r.categoryCode)
                          "
                        />
                      </td>
                      <td>
                        @if (canEditDraft()) {
                          <button mat-button type="button" (click)="remove(i)">Remove</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (canEditDraft()) {
              <form class="bf-form" (ngSubmit)="add()" aria-label="Add a rule">
                <mat-form-field appearance="outline">
                  <mat-label>Legal entity</mat-label>
                  <mat-select name="ne" [(ngModel)]="newRule.legalEntityId">
                    @for (e of v.entities; track e.id) {
                      <mat-option [value]="e.id">{{ e.code }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Category</mat-label>
                  <mat-select name="nc" [(ngModel)]="newRule.categoryCode">
                    <mat-option value="*">All categories</mat-option>
                    @for (c of v.categories; track c.code) {
                      <mat-option [value]="c.code">{{ c.name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Attendees</mat-label>
                  <mat-select name="na" [(ngModel)]="newRule.attendeeType">
                    @for (a of attendeeTypes; track a) {
                      <mat-option [value]="a">{{ attendeeLabel[a] }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Tax code</mat-label>
                  <input matInput name="nt" [(ngModel)]="newRule.taxCode" />
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Recoverable %</mat-label>
                  <input
                    matInput
                    type="number"
                    min="0"
                    max="100"
                    name="ns"
                    [(ngModel)]="newRule.sharePct"
                  />
                </mat-form-field>
                <div class="bf-form__actions">
                  <button
                    mat-stroked-button
                    type="submit"
                    [disabled]="!newRule.legalEntityId || !newRule.taxCode"
                  >
                    Add rule
                  </button>
                </div>
              </form>
            }
          }
          <div class="bf-tax-actions">
            @if (canEditDraft()) {
              <button mat-stroked-button type="button" (click)="save(d)" [disabled]="busy()">
                Save draft
              </button>
              <button mat-flat-button type="button" (click)="submit(d)" [disabled]="busy()">
                Submit to tax approver
              </button>
            }
            @if (v.canPublish && d.status === 'pending_approval') {
              <mat-form-field appearance="outline" class="bf-tax-date">
                <mat-label>Effective from</mat-label>
                <input
                  matInput
                  type="date"
                  [ngModel]="effectiveFrom || v.asOf"
                  (ngModelChange)="effectiveFrom = $event"
                  name="ef"
                />
              </mat-form-field>
              <button
                satImportantButton
                mat-flat-button
                type="button"
                (click)="publish(d)"
                [disabled]="busy()"
              >
                Publish
              </button>
              <mat-form-field appearance="outline" class="bf-tax-comment">
                <mat-label>Comments for finance</mat-label>
                <input matInput [(ngModel)]="returnComment" name="rc" />
              </mat-form-field>
              <button
                mat-stroked-button
                type="button"
                (click)="returnDraft(d)"
                [disabled]="busy() || !returnComment.trim()"
              >
                Return with comments
              </button>
            }
          </div>
        </section>
      }

      <div class="bf-tax-layout">
        <section class="bf-card" aria-labelledby="tax-rules-title">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="tax-rules-title">Rules in force</h2>
              <p class="bf-card__hint">
                Defaults are placeholders for review by the tax approver; they are not tax advice.
              </p>
            </div>
          </div>
          @if (!v.current) {
            <p class="bf-empty">No published rules yet: all tax uses budget.</p>
          }
          @for (g of groups(); track g.code) {
            <div class="bf-table-scroll">
              <table
                class="bf-table bf-table--stack bf-tax-rules"
                [attr.aria-label]="g.code + ' rules'"
              >
                <caption class="bf-tax-caption">
                  {{
                    g.code
                  }}{{
                    g.jurisdiction ? ' · ' + g.jurisdiction : ''
                  }}
                </caption>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Attendees</th>
                    <th>Tax</th>
                    <th class="bf-num">Recoverable</th>
                    <th>Effect on budget</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of g.rules; track r.id) {
                    <tr>
                      <td class="bf-cell--full">{{ r.categoryName }}</td>
                      <td data-label="Attendees">{{ attendeeLabel[r.attendeeType] }}</td>
                      <td data-label="Tax" class="bf-tax-code">{{ r.taxCode }}</td>
                      <td class="bf-num" data-label="Recoverable">
                        {{ r.proportional ? 'In proportion to employees' : pct(r.recoverableBps) }}
                      </td>
                      <td data-label="Effect on budget">{{ r.effect }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section class="bf-card bf-tax-calc" aria-labelledby="tax-calc-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="tax-calc-title">Preview calculator</h2>
          </div>
          <form class="bf-form" (ngSubmit)="preview()" aria-label="Preview a tax split">
            <mat-form-field appearance="outline">
              <mat-label>Legal entity</mat-label>
              <mat-select
                name="ce"
                [ngModel]="calcEntity()"
                (ngModelChange)="calc.legalEntityId = $event"
                data-testid="calc-entity"
              >
                @for (e of v.entities; track e.id) {
                  <mat-option [value]="e.id">{{ e.code }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Category</mat-label>
              <mat-select name="cc" [(ngModel)]="calc.categoryCode" data-testid="calc-category">
                @for (c of v.categories; track c.code) {
                  <mat-option [value]="c.code">{{ c.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Employees present</mat-label>
              <input matInput type="number" min="0" name="cemp" [(ngModel)]="calc.employees" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Clients or guests</mat-label>
              <input matInput type="number" min="0" name="coth" [(ngModel)]="calc.others" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Amount without tax</mat-label>
              <input
                matInput
                type="number"
                min="0"
                step="0.01"
                name="camt"
                [(ngModel)]="calc.amount"
              />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Tax amount</mat-label>
              <input
                matInput
                type="number"
                min="0"
                step="0.01"
                name="ctax"
                [(ngModel)]="calc.tax"
              />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Currency</mat-label>
              <mat-select name="cccy" [(ngModel)]="calc.currency">
                @for (c of ['USD', 'GBP', 'EUR', 'INR']; track c) {
                  <mat-option [value]="c">{{ c }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <div class="bf-form__actions">
              <button mat-flat-button type="submit" [disabled]="busy() || !calcEntity()">
                Preview
              </button>
            </div>
          </form>
          @if (result(); as b) {
            <dl class="bf-facts" aria-live="polite" data-testid="calc-result">
              <div>
                <dt>Net</dt>
                <dd><bf-money [amountMinor]="b.net.amountMinor" [currency]="b.net.currency" /></dd>
              </div>
              <div>
                <dt>Recoverable tax ({{ pct(b.recoverableShareBps) }})</dt>
                <dd>
                  <bf-money
                    [amountMinor]="b.recoverable.amountMinor"
                    [currency]="b.recoverable.currency"
                  />
                  · not charged to the budget
                </dd>
              </div>
              <div>
                <dt>Non-recoverable tax</dt>
                <dd>
                  <bf-money
                    [amountMinor]="b.nonRecoverable.amountMinor"
                    [currency]="b.nonRecoverable.currency"
                  />
                </dd>
              </div>
              <div>
                <dt>Uses budget</dt>
                <dd>
                  <strong
                    ><bf-money
                      [amountMinor]="b.usesBudget.amountMinor"
                      [currency]="b.usesBudget.currency"
                  /></strong>
                  =
                  <bf-money
                    [amountMinor]="b.usesBudgetReporting.amountMinor"
                    [currency]="b.usesBudgetReporting.currency"
                  />
                  at the locked plan rate
                </dd>
              </div>
              <div>
                <dt>Rule</dt>
                <dd>
                  {{
                    b.ruleId
                      ? b.taxCode + ' · version ' + b.ruleVersion
                      : 'No rule: all tax uses budget'
                  }}
                </dd>
              </div>
            </dl>
          }
        </section>
      </div>
    }
  `,
  styles: `
    .bf-tax-layout {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
      gap: 16px;
      align-items: start;
    }
    @media (width < 1100px) {
      .bf-tax-layout {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .bf-tax-rules th,
    .bf-tax-rules td {
      padding-inline: 8px 16px;
    }
    .bf-tax-code {
      white-space: nowrap;
    }
    .bf-tax-caption {
      display: table-caption;
      min-width: 12em;
      caption-side: top;
      text-align: start;
      padding: 12px 0 4px;
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-on-surface);
    }
    .bf-tax-changed {
      background: var(--sat-sys-info-container);
    }
    .bf-tax-share {
      width: 6em;
      font: var(--mat-sys-body-medium);
      text-align: end;
    }
    .bf-tax-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding-top: 12px;
    }
    .bf-tax-date,
    .bf-tax-comment {
      margin-bottom: -1.25em;
    }
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxRecoverabilityPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  protected readonly attendeeLabel = ATTENDEE_LABEL;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly attendeeTypes = Object.keys(ATTENDEE_LABEL) as TaxRuleView['attendeeType'][];
  protected readonly view = resource({ loader: () => data(this.api.getTaxRules({})) });
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly result = signal<TaxBreakdown | null>(null);
  private readonly edits = signal<EditRule[] | null>(null);
  /** Empty means the server's today (the API clock), shown as the default. */
  protected effectiveFrom = '';
  protected returnComment = '';
  protected newRule: EditRule = this.blankRule();
  protected calc = {
    legalEntityId: '',
    categoryCode: 'employee_events',
    employees: 8,
    others: 2,
    amount: 600,
    tax: 120,
    currency: 'GBP',
  };

  protected readonly groups = computed(() => {
    const v = valueOf(this.view);
    const byCode = new Map<
      string,
      { code: string; jurisdiction: string | null; rules: TaxRuleView[] }
    >();
    for (const r of v?.current?.rules ?? []) {
      const g = byCode.get(r.legalEntityCode) ?? {
        code: r.legalEntityCode,
        jurisdiction: r.taxJurisdiction,
        rules: [],
      };
      g.rules.push(r);
      byCode.set(r.legalEntityCode, g);
    }
    return [...byCode.values()];
  });

  /** The draft's rules as edited on screen (the saved draft until something changes). */
  protected readonly editable = computed(() => {
    const local = this.edits();
    if (local) return local;
    const d = valueOf(this.view)?.draft;
    return d ? d.rules.map((r) => this.toEdit(r)) : null;
  });

  protected readonly canEditDraft = computed(() => {
    const v = valueOf(this.view);
    return Boolean(
      v?.canEdit && v.draft && (v.draft.status === 'draft' || v.draft.status === 'returned'),
    );
  });

  private blankRule(): EditRule {
    return {
      legalEntityId: '',
      categoryCode: '*',
      attendeeType: 'any',
      taxCode: '',
      sharePct: 0,
      proportional: false,
      notes: null,
    };
  }

  private toEdit(r: TaxRuleView): EditRule {
    return {
      legalEntityId: r.legalEntityId,
      categoryCode: r.categoryCode,
      attendeeType: r.attendeeType,
      taxCode: r.taxCode,
      sharePct: r.recoverableBps === null ? null : r.recoverableBps / 100,
      proportional: r.proportional,
      notes: r.notes,
    };
  }

  /** The calculator's entity: the one chosen, else the first entity (so Preview works at once). */
  protected calcEntity(): string {
    return this.calc.legalEntityId || (valueOf(this.view)?.entities[0]?.id ?? '');
  }

  protected pct(bps: number | null): string {
    return bps === null
      ? '–'
      : `${(bps / 100).toLocaleString('en', { maximumFractionDigits: 2 })}%`;
  }

  protected entityCode(id: string): string {
    return valueOf(this.view)?.entities.find((e) => e.id === id)?.code ?? '';
  }

  protected categoryName(code: string): string {
    if (code === '*') return 'All categories';
    return valueOf(this.view)?.categories.find((c) => c.code === code)?.name ?? code;
  }

  /** Highlights a rule that differs from (or is missing in) the version in force. */
  protected changed(r: EditRule): boolean {
    const cur = valueOf(this.view)?.current?.rules ?? [];
    const p = cur.find(
      (c) =>
        c.legalEntityId === r.legalEntityId &&
        c.categoryCode === r.categoryCode &&
        c.attendeeType === r.attendeeType,
    );
    if (!p) return true;
    const bps = r.proportional || r.sharePct === null ? null : Math.round(r.sharePct * 100);
    return p.proportional !== r.proportional || p.recoverableBps !== bps || p.taxCode !== r.taxCode;
  }

  private mutateRules(fn: (rules: EditRule[]) => EditRule[]): void {
    this.edits.set(fn([...(this.editable() ?? [])]));
  }

  protected setShare(i: number, v: number | null): void {
    this.mutateRules((rs) => rs.map((r, k) => (k === i ? { ...r, sharePct: v } : r)));
  }

  protected setProportional(i: number, on: boolean): void {
    this.mutateRules((rs) =>
      rs.map((r, k) => (k === i ? { ...r, proportional: on, sharePct: on ? null : 0 } : r)),
    );
  }

  protected remove(i: number): void {
    this.mutateRules((rs) => rs.filter((_, k) => k !== i));
  }

  protected add(): void {
    this.mutateRules((rs) => [...rs, { ...this.newRule }]);
    this.newRule = this.blankRule();
  }

  private toInput(r: EditRule): TaxRuleInput {
    return {
      legalEntityId: r.legalEntityId,
      categoryCode: r.categoryCode,
      attendeeType: r.attendeeType,
      taxCode: r.taxCode,
      recoverableBps:
        r.proportional || r.sharePct === null ? null : Math.round(Number(r.sharePct) * 100),
      proportional: r.proportional,
      notes: r.notes,
    };
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await fn();
      this.edits.set(null);
      this.view.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected newDraft(): Promise<void> {
    return this.run(() => data(this.api.createTaxRuleDraft({ body: {} })));
  }

  protected save(d: TaxRuleSetView): Promise<void> {
    return this.run(() =>
      data(
        this.api.saveTaxRuleDraft({
          params: { ruleSetId: d.id },
          body: { rules: (this.editable() ?? []).map((r) => this.toInput(r)) },
        }),
      ),
    );
  }

  protected submit(d: TaxRuleSetView): Promise<void> {
    return this.run(async () => {
      if (this.edits())
        await data(
          this.api.saveTaxRuleDraft({
            params: { ruleSetId: d.id },
            body: { rules: (this.editable() ?? []).map((r) => this.toInput(r)) },
          }),
        );
      await data(this.api.submitTaxRuleDraft({ params: { ruleSetId: d.id }, body: {} }));
    });
  }

  protected publish(d: TaxRuleSetView): Promise<void> {
    return this.run(() =>
      data(
        this.api.publishTaxRuleSet({
          params: { ruleSetId: d.id },
          body: { effectiveFrom: this.effectiveFrom || valueOf(this.view)!.asOf },
        }),
      ),
    );
  }

  protected returnDraft(d: TaxRuleSetView): Promise<void> {
    return this.run(async () => {
      await data(
        this.api.returnTaxRuleSet({
          params: { ruleSetId: d.id },
          body: { comment: this.returnComment.trim() },
        }),
      );
      this.returnComment = '';
    });
  }

  protected async preview(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      // USD, GBP, EUR and INR all have two minor-unit digits.
      this.result.set(
        await data(
          this.api.previewTaxSplit({
            query: {
              legalEntityId: this.calcEntity(),
              categoryCode: this.calc.categoryCode,
              employees: Number(this.calc.employees) || 0,
              others: Number(this.calc.others) || 0,
              amountMinor: Math.round(Number(this.calc.amount) * 100),
              taxMinor: Math.round(Number(this.calc.tax) * 100),
              currency: this.calc.currency,
            },
          }),
        ),
      );
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
