import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { BenefitLedgerRow, BenefitThresholdView } from '@bf/contracts';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { map } from 'rxjs';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';

type Status = BenefitLedgerRow['status'];

const STATUS: Record<Status, { label: string; tag: 'neutral' | 'warning' | 'important' }> = {
  under: { label: 'Under', tag: 'neutral' },
  approaching: { label: 'Approaching', tag: 'warning' },
  over: { label: 'Over', tag: 'important' },
};

const VERSION_LABEL: Record<BenefitThresholdView['status'], string> = {
  draft: 'Draft',
  pending_approval: 'Waiting for the tax approver',
  returned: 'Returned',
  published: 'Published',
  superseded: 'Superseded',
};

const EXCEEDED_LABEL: Record<BenefitThresholdView['exceeded'], string> = {
  whole: 'Whole amount becomes reportable',
  excess: 'Only the excess is reportable',
  not_reportable: 'Company cap (not reportable)',
};

/**
 * Screen 080h: the employee benefit ledger. Each person's share of event costs, gifts and recognition
 * against the benefit-in-kind thresholds of their country (each in its own tax year) and the company's
 * per-employee cap. The ledger never moves budget money. Payroll exports arrive with the finance
 * exports package; this screen shows the reportable amounts. Built from the written spec (decision D2).
 */
@Component({
  selector: 'bf-employee-benefits-page',
  host: { class: 'bf-page-layout' },
  imports: [
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Employee benefits</h1>
        <p class="bf-page__subtitle">
          Benefits people receive through BudgetFlow, compared with the tax thresholds of their
          country and the company's per-employee cap. Amounts are shown in local currency with the
          reporting currency at the locked plan rate; the ledger never moves budget money.
        </p>
      </div>
    </header>
    <sat-navigation-tabs aria-label="Employee benefits">
      <a satNavigationTab routerLink="." [queryParams]="{}" [active]="tab() === 'ledger'">Ledger</a>
      <a
        satNavigationTab
        routerLink="."
        [queryParams]="{ tab: 'thresholds' }"
        [active]="tab() === 'thresholds'"
        >Thresholds</a
      >
    </sat-navigation-tabs>
    @if (failure()) {
      <sat-banner variant="important" class="bf-banner"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }

    @if (tab() === 'ledger') {
      <section class="bf-card" aria-labelledby="benefits-ledger-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="benefits-ledger-title">Ledger</h2>
            <p class="bf-card__hint">
              Approaching from 80% of a limit; exactly at the limit is not over.
            </p>
          </div>
        </div>
        <div class="bf-form" role="search" aria-label="Filter the ledger">
          <mat-form-field appearance="outline">
            <mat-label>Legal entity</mat-label>
            <mat-select [ngModel]="entity()" (ngModelChange)="entity.set($event)" name="fe">
              <mat-option [value]="''">All entities</mat-option>
              @for (e of entities(); track e.id) {
                <mat-option [value]="e.id">{{ e.code }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Status</mat-label>
            <mat-select [ngModel]="status()" (ngModelChange)="status.set($event)" name="fs">
              <mat-option [value]="''">Any status</mat-option>
              @for (s of statuses; track s) {
                <mat-option [value]="s">{{ statusInfo[s].label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Benefit type</mat-label>
            <mat-select
              [ngModel]="benefitType()"
              (ngModelChange)="benefitType.set($event)"
              name="ft"
            >
              <mat-option [value]="''">Any type</mat-option>
              @for (t of valueOf(ledger)?.benefitTypes ?? []; track t) {
                <mat-option [value]="t">{{ typeLabel(t) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
        <bf-load-state
          [loading]="ledger.isLoading() && !ledger.hasValue()"
          [error]="ledger.error()"
          what="the benefit ledger"
          (retry)="ledger.reload()"
        />
        @if (valueOf(ledger); as l) {
          @if (l.items.length === 0) {
            <sat-empty-state>
              <h3 satEmptyStateHeadline>No benefits recorded yet</h3>
              <p satEmptyStateDescription>Entries appear when events close.</p>
            </sat-empty-state>
          } @else {
            <div class="bf-table-scroll">
              <table class="bf-table bf-table--stack" aria-labelledby="benefits-ledger-title">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Entity</th>
                    <th>Location</th>
                    <th>Rule (tax year)</th>
                    <th class="bf-num">Counted</th>
                    <th class="bf-num">Limit</th>
                    <th>Status</th>
                    <th class="bf-num">Reportable</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of l.items; track r.personId + r.thresholdId) {
                    <tr>
                      <td class="bf-cell--full">
                        <button
                          mat-button
                          type="button"
                          class="bf-benefit-person"
                          (click)="open(r.personId)"
                        >
                          {{ r.personName }}
                        </button>
                      </td>
                      <td data-label="Entity">{{ r.legalEntityCode }}</td>
                      <td data-label="Location">{{ r.locationName ?? '–' }}</td>
                      <td data-label="Rule (tax year)">
                        {{ r.thresholdName }}
                        <span class="bf-cell__secondary"
                          >{{ r.window.fromDate | date: 'd MMM y' : 'UTC' }} –
                          {{ r.window.toDate | date: 'd MMM y' : 'UTC' }}</span
                        >
                      </td>
                      <td class="bf-num" data-label="Counted">
                        <bf-money
                          [amountMinor]="r.counted.amountMinor"
                          [currency]="r.counted.currency"
                        />
                      </td>
                      <td class="bf-num" data-label="Limit">
                        <bf-money
                          [amountMinor]="r.limit.amountMinor"
                          [currency]="r.limit.currency"
                        />
                        {{ r.basis === 'per_event' ? 'per event' : 'per head' }}
                      </td>
                      <td data-label="Status">
                        <sat-status-tag [status]="statusInfo[r.status].tag">{{
                          statusInfo[r.status].label
                        }}</sat-status-tag>
                      </td>
                      <td class="bf-num" data-label="Reportable">
                        @if (r.reportable; as rep) {
                          <bf-money [amountMinor]="rep.amountMinor" [currency]="rep.currency" />
                          @if (r.status === 'over' && r.exceeded === 'whole') {
                            <span class="bf-cell__secondary">whole amount</span>
                          }
                        } @else {
                          –
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @for (t of l.templates; track t.thresholdId) {
            <p class="bf-card__hint bf-benefit-note" data-testid="benefit-template">{{ t.note }}</p>
          }
        }
      </section>

      @if (selected(); as id) {
        <section
          class="bf-card"
          aria-labelledby="benefit-person-title"
          data-testid="benefit-person"
        >
          <bf-load-state
            [loading]="person.isLoading() && !person.hasValue()"
            [error]="person.error()"
            what="the person's benefits"
            (retry)="person.reload()"
          />
          @if (valueOf(person); as p) {
            <div class="bf-card__header">
              <div>
                <h2 class="bf-card__title" id="benefit-person-title">{{ p.personName }}</h2>
                <p class="bf-card__hint">
                  {{ p.legalEntityCode }} · as of {{ p.asOf | date: 'd MMM y' : 'UTC' }}
                </p>
              </div>
              <button mat-button type="button" (click)="selected.set(null)">Close</button>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-table bf-table--stack" aria-label="Benefit entries">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Event or item</th>
                    <th>Type</th>
                    <th class="bf-num">Amount</th>
                    <th class="bf-num">Reporting</th>
                    <th>Counts toward</th>
                    @if (canEdit()) {
                      <th><span class="bf-sr">Actions</span></th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (e of p.entries; track e.id) {
                    <tr>
                      <td class="bf-cell--full">{{ e.entryDate | date: 'd MMM y' : 'UTC' }}</td>
                      <td data-label="Event or item">
                        {{ e.description ?? e.source.label }}
                        <span class="bf-cell__secondary">{{ e.source.label }}</span>
                      </td>
                      <td data-label="Type">{{ typeLabel(e.benefitType) }}</td>
                      <td class="bf-num" data-label="Amount">
                        <bf-money
                          [amountMinor]="e.amount.amountMinor"
                          [currency]="e.amount.currency"
                        />
                      </td>
                      <td class="bf-num" data-label="Reporting">
                        <bf-money
                          [amountMinor]="e.reporting.amountMinor"
                          [currency]="e.reporting.currency"
                        />
                      </td>
                      <td data-label="Counts toward">
                        {{ e.countedToward.length ? e.countedToward.join(', ') : '–' }}
                        @if (e.reversalOfId) {
                          <sat-status-tag status="neutral">Reversal</sat-status-tag>
                        }
                        @if (e.reversedById) {
                          <sat-status-tag status="neutral">Reversed</sat-status-tag>
                        }
                      </td>
                      @if (canEdit()) {
                        <td>
                          @if (!e.reversalOfId && !e.reversedById) {
                            <button
                              mat-button
                              type="button"
                              (click)="reverse(e.id)"
                              [disabled]="busy()"
                            >
                              Reverse
                            </button>
                          }
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (p.totals.length) {
              <dl class="bf-facts">
                @for (t of p.totals; track t.thresholdId) {
                  <div>
                    <dt>{{ t.thresholdName }}</dt>
                    <dd>
                      <bf-money
                        [amountMinor]="t.counted.amountMinor"
                        [currency]="t.counted.currency"
                      />
                      of
                      <bf-money [amountMinor]="t.limit.amountMinor" [currency]="t.limit.currency" />
                      · {{ statusInfo[t.status].label }}
                      @if (t.exceeded === 'whole') {
                        · counts the whole amount once exceeded
                      }
                    </dd>
                  </div>
                }
              </dl>
            }
          }
        </section>
      }
    } @else {
      <section class="bf-card" aria-labelledby="thresholds-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="thresholds-title">Thresholds by jurisdiction</h2>
            <p class="bf-card__hint">
              Defaults are placeholders for review by the tax approver; they are not tax advice.
              Drafts go to the tax approver, who publishes them with an effective date.
            </p>
          </div>
        </div>
        <bf-load-state
          [loading]="thresholds.isLoading() && !thresholds.hasValue()"
          [error]="thresholds.error()"
          what="the thresholds"
          (retry)="thresholds.reload()"
        />
        @if (valueOf(thresholds); as t) {
          <div class="bf-table-scroll">
            <table
              class="bf-table bf-table--stack bf-thresholds"
              aria-labelledby="thresholds-title"
            >
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Legal entities</th>
                  <th>Counts</th>
                  <th class="bf-num">Limit</th>
                  <th>Basis</th>
                  <th>Tax year starts</th>
                  <th>When exceeded</th>
                  <th>Status</th>
                  <th><span class="bf-sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                @for (x of t.items; track x.id) {
                  <tr>
                    <td class="bf-cell--full">
                      {{ x.name }}
                      <span class="bf-cell__secondary bf-benefit-code"
                        >{{ x.code }} · v{{ x.version }}</span
                      >
                    </td>
                    <td data-label="Legal entities">
                      {{
                        x.template ? 'No legal entity in scope yet' : x.legalEntityCodes.join(', ')
                      }}
                    </td>
                    <td data-label="Counts">{{ typeLabels(x.benefitTypes) }}</td>
                    <td class="bf-num" data-label="Limit">
                      <bf-money [amountMinor]="x.limit.amountMinor" [currency]="x.limit.currency" />
                    </td>
                    <td data-label="Basis">
                      {{ x.basis === 'per_event' ? 'Per event' : 'Per year'
                      }}{{ x.maxOccasions ? ', ' + x.maxOccasions + ' events a year' : '' }}
                    </td>
                    <td data-label="Tax year starts">
                      {{ monthDay(x.periodStartMonth, x.periodStartDay) }}
                    </td>
                    <td data-label="When exceeded">{{ exceededLabel[x.exceeded] }}</td>
                    <td data-label="Status">
                      @if (x.template && x.status === 'published') {
                        <sat-status-tag status="neutral">Template</sat-status-tag>
                      } @else {
                        <sat-status-tag
                          [status]="
                            x.status === 'published'
                              ? 'success'
                              : x.status === 'superseded'
                                ? 'neutral'
                                : 'warning'
                          "
                          >{{ versionLabel[x.status] }}</sat-status-tag
                        >
                      }
                      @if (x.effectiveFrom) {
                        <span class="bf-cell__secondary"
                          >from {{ x.effectiveFrom | date: 'd MMM y' : 'UTC' }}</span
                        >
                      }
                      @if (x.status === 'returned' && x.comment) {
                        <span class="bf-cell__secondary">Returned: {{ x.comment }}</span>
                      }
                    </td>
                    <td>
                      <div class="bf-row-actions">
                        @if (t.canEdit && (x.status === 'draft' || x.status === 'returned')) {
                          <button
                            mat-stroked-button
                            type="button"
                            (click)="decide(x, 'submit')"
                            [disabled]="busy()"
                          >
                            Submit to tax approver
                          </button>
                        }
                        @if (t.canPublish && x.status === 'pending_approval') {
                          <button
                            satImportantButton
                            mat-flat-button
                            type="button"
                            (click)="decide(x, 'publish')"
                            [disabled]="busy()"
                          >
                            Publish
                          </button>
                          <button
                            mat-stroked-button
                            type="button"
                            (click)="decide(x, 'return')"
                            [disabled]="busy()"
                          >
                            Return
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .bf-benefit-note {
      padding: 12px 20px 0;
    }
    // Wide enough to read on tablet (the scroll container scrolls); phones stack the rows instead.
    @media (width >= 600px) {
      .bf-thresholds {
        min-width: 1080px;
      }
    }
    .bf-benefit-code {
      white-space: nowrap;
    }
    .bf-benefit-person {
      padding-inline: 0;
      min-width: 0;
    }
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeBenefitsPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  protected readonly statusInfo = STATUS;
  protected readonly statuses = Object.keys(STATUS) as Status[];
  protected readonly versionLabel = VERSION_LABEL;
  protected readonly exceededLabel = EXCEEDED_LABEL;
  protected readonly tab = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((q) => (q.get('tab') === 'thresholds' ? 'thresholds' : 'ledger')),
    ),
    { initialValue: 'ledger' as 'ledger' | 'thresholds' },
  );
  protected readonly entity = signal('');
  protected readonly status = signal<Status | ''>('');
  protected readonly benefitType = signal('');
  protected readonly selected = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected readonly ledger = resource({
    params: () => ({ e: this.entity(), s: this.status(), t: this.benefitType() }),
    loader: ({ params }) =>
      data(
        this.api.getBenefitLedger({
          query: {
            ...(params.e ? { legalEntityId: params.e } : {}),
            ...(params.s ? { status: params.s } : {}),
            ...(params.t ? { benefitType: params.t } : {}),
          },
        }),
      ),
  });
  protected readonly person = resource({
    params: () => this.selected() ?? undefined,
    loader: ({ params }) => data(this.api.getBenefitPerson({ params: { personId: params } })),
  });
  protected readonly thresholds = resource({
    loader: () => data(this.api.listBenefitThresholds({})),
  });
  protected readonly canEdit = computed(() => valueOf(this.thresholds)?.canEdit ?? false);
  private readonly allRows = resource({
    loader: () => data(this.api.getBenefitLedger({ query: {} })),
  });

  protected readonly entities = computed(() => {
    const seen = new Map<string, string>();
    for (const r of valueOf(this.allRows)?.items ?? [])
      seen.set(r.legalEntityId, r.legalEntityCode);
    return [...seen.entries()]
      .map(([id, code]) => ({ id, code }))
      .sort((a, b) => a.code.localeCompare(b.code));
  });

  /** `employee_events` → `Employee events`. */
  protected typeLabel(code: string): string {
    const words = code.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  protected typeLabels(codes: readonly string[]): string {
    return codes.map((c) => this.typeLabel(c)).join(', ');
  }

  protected monthDay(m: number, d: number): string {
    return new Date(Date.UTC(2001, m - 1, d)).toLocaleDateString('en', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
  }

  protected open(personId: string): void {
    this.selected.set(personId);
  }

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await fn();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected reverse(entryId: string): Promise<void> {
    return this.run(async () => {
      await data(
        this.api.reverseBenefitEntry({
          params: { entryId },
          body: { reason: 'Reversed by finance from the benefit ledger' },
        }),
      );
      this.person.reload();
      this.ledger.reload();
    });
  }

  protected decide(x: BenefitThresholdView, verb: 'submit' | 'publish' | 'return'): Promise<void> {
    return this.run(async () => {
      const params = { thresholdId: x.id };
      if (verb === 'submit') await data(this.api.submitBenefitThreshold({ params, body: {} }));
      else if (verb === 'publish')
        await data(
          this.api.publishBenefitThreshold({
            params,
            body: { effectiveFrom: valueOf(this.ledger)?.asOf ?? todayIso() },
          }),
        );
      else
        await data(
          this.api.returnBenefitThreshold({
            params,
            body: { comment: 'Returned for changes by the tax approver' },
          }),
        );
      this.thresholds.reload();
      this.ledger.reload();
    });
  }
}
