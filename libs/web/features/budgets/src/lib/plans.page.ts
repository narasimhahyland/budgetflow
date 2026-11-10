import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import type { PlanImportResult } from '@bf/contracts';
import { Money, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';

type Kind = 'original' | 'current' | 'forecast';
const FIELDS = [
  { key: 'code', label: 'Program code', required: true },
  { key: 'name', label: 'Program name', required: true },
  { key: 'amount', label: 'Amount (USD)', required: true },
  { key: 'legalEntity', label: 'Legal entity code', required: false },
  { key: 'costCenter', label: 'Cost center code', required: false },
  { key: 'ownerEmail', label: 'Owner email', required: false },
  { key: 'category', label: 'Category', required: false },
] as const;
type FieldKey = (typeof FIELDS)[number]['key'];

/** Plan versions (original, current, forecast) with the root tie-out, and screen 20a: plan spreadsheet import. */
@Component({
  selector: 'bf-plans-page',
  imports: [
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  styleUrl: './page.scss',
  styles: `
    .bf-plans {
      display: grid;
      grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 1000px) {
      .bf-plans {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .bf-pv-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 12px;
      list-style: none;
    }
    .bf-pv {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      text-align: start;
      cursor: pointer;
    }
    .bf-pv--selected {
      border: 2px solid var(--mat-sys-primary);
    }
    .bf-pv__head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font: var(--mat-sys-title-small);
    }
    .bf-pv__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .bf-issue {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .bf-card__hint.bf-map-hint {
      margin: 12px 0;
    }
    .bf-import-summary {
      display: block;
      margin: 12px 0;
    }
    .bf-bad {
      color: var(--mat-sys-error);
    }
    .bf-tie {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 24px;
      padding: 16px 20px;
    }
    .bf-tie__figure {
      display: flex;
      flex-direction: column;
    }
    .bf-tie__figure span:first-child {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-tie__figure span:last-child {
      font: var(--mat-sys-title-medium);
    }
    .bf-field {
      width: 100%;
    }
    .bf-mapping {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 4px 16px;
    }
    .bf-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 20px 16px;
    }
    .bf-steps {
      display: flex;
      gap: 16px;
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
    }
    .bf-steps .bf-current {
      color: var(--mat-sys-primary);
    }
  `,
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Plans and versions</h1>
        <p class="bf-page__subtitle">
          Root budgets tie to the controlling plan version of their year (original, current;
          forecast is for comparison).
        </p>
      </div>
      <div class="bf-page__actions">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Fiscal year</mat-label>
          <mat-select
            [ngModel]="fy()"
            (ngModelChange)="fy.set($event); selectedId.set(null)"
            data-testid="plan-fy"
          >
            @for (y of years(); track y.id) {
              <mat-option [value]="y.id">{{ y.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <button
          mat-flat-button
          type="button"
          (click)="importing.set(!importing())"
          data-testid="import-plan"
        >
          <mat-icon svgIcon="upload" aria-hidden="true" />Import plan
        </button>
      </div>
    </header>

    @if (valueOf(tie); as t) {
      <section class="bf-card" aria-label="Root tie-out" data-testid="tie-out">
        <div class="bf-tie">
          <sat-status-tag [status]="t.tiedOut ? 'success' : 'important'">{{
            t.tiedOut ? 'Roots tie out' : 'Roots do not tie out'
          }}</sat-status-tag>
          <span class="bf-tie__figure"
            ><span>Controlling version</span
            ><span>{{ t.planVersionLabel ?? 'None yet' }}</span></span
          >
          <span class="bf-tie__figure"
            ><span>Plan total</span
            ><span><bf-money [amountMinor]="t.planTotalMinor" [currency]="t.currency" /></span
          ></span>
          <span class="bf-tie__figure"
            ><span>Root authorized</span
            ><span><bf-money [amountMinor]="t.rootAuthorizedMinor" [currency]="t.currency" /></span
          ></span>
          <span class="bf-tie__figure"
            ><span>Returned to savings</span
            ><span><bf-money [amountMinor]="t.savingsMinor" [currency]="t.currency" /></span
          ></span>
          <span class="bf-tie__figure"
            ><span>Difference</span
            ><span [class.bf-bad]="t.differenceMinor !== 0"
              ><bf-money [amountMinor]="t.differenceMinor" [currency]="t.currency" /></span
          ></span>
        </div>
      </section>
    }

    @if (importing()) {
      <section class="bf-card" aria-labelledby="import-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="import-title">Budget-plan spreadsheet import</h2>
          <div class="bf-actions" style="padding: 0">
            <button
              mat-stroked-button
              type="button"
              (click)="runImport(true)"
              [disabled]="busy() || !ready()"
              data-testid="validate-import"
            >
              Validate
            </button>
            <button
              mat-flat-button
              type="button"
              (click)="runImport(false)"
              [disabled]="busy() || !result()?.valid"
              data-testid="create-version"
            >
              Create draft version
            </button>
            <button mat-button type="button" (click)="importing.set(false)">Close</button>
          </div>
        </div>
        <div class="bf-card__body">
          <ol class="bf-steps">
            <li [class.bf-current]="!result()">1 · Paste and map columns</li>
            <li [class.bf-current]="!!result() && !result()!.planVersion">2 · Review rows</li>
            <li [class.bf-current]="!!result()?.planVersion">3 · Draft version created</li>
          </ol>
          <div class="bf-form" style="padding: 0">
            <mat-form-field
              ><mat-label>Version label</mat-label
              ><input matInput [(ngModel)]="label" data-testid="import-label"
            /></mat-form-field>
            <mat-form-field
              ><mat-label>Kind</mat-label>
              <mat-select [(ngModel)]="kind">
                <mat-option value="original">Original</mat-option>
                <mat-option value="current">Current (revision)</mat-option>
                <mat-option value="forecast">Forecast</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <mat-form-field class="bf-field">
            <mat-label>Spreadsheet rows (CSV, or paste from Excel), header first</mat-label>
            <textarea
              matInput
              rows="6"
              [ngModel]="csv()"
              (ngModelChange)="setCsv($event)"
              data-testid="import-csv"
            ></textarea>
          </mat-form-field>
          @if (headers().length) {
            <p class="bf-card__hint bf-map-hint">Map each field to a column</p>
            <div class="bf-mapping">
              @for (f of fields; track f.key) {
                <mat-form-field subscriptSizing="dynamic"
                  ><mat-label>{{ f.label }}{{ f.required ? ' *' : '' }}</mat-label>
                  <mat-select
                    [ngModel]="mapping()[f.key] ?? ''"
                    (ngModelChange)="map(f.key, $event)"
                    [attr.data-testid]="'map-' + f.key"
                  >
                    <mat-option value="">Not in the file</mat-option>
                    @for (h of headers(); track h) {
                      <mat-option [value]="h">{{ h }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }
            </div>
          }
          @if (result(); as r) {
            <p class="bf-card__hint" style="margin-top: 12px">
              {{ r.rows.length }} row(s) · total
              <bf-money [amountMinor]="r.totalMinor" [currency]="r.currency" /> ·
              {{ r.valid ? 'ready to import' : 'fix the errors below' }}
            </p>
            @if (errorRows(r.rows); as n) {
              <sat-banner variant="important" [border]="true" class="bf-import-summary"
                ><sat-banner-message
                  ><strong>Fix {{ n }} {{ n === 1 ? 'row' : 'rows' }}</strong> before you create the
                  draft version.</sat-banner-message
                ></sat-banner
              >
            }
            <div class="bf-table-scroll">
              <table class="bf-lines bf-split-table" data-testid="import-rows">
                <thead>
                  <tr>
                    <th scope="col" class="bf-num">Line</th>
                    <th scope="col">Program</th>
                    <th scope="col" class="bf-num">Amount</th>
                    <th scope="col">Existing root</th>
                    <th scope="col">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of r.rows; track row.line) {
                    <tr [class.bf-row--important]="row.errors.length">
                      <td class="bf-num">{{ row.line }}</td>
                      <td>
                        <span class="bf-cell__name"
                          ><span class="bf-cell__code">{{ row.code }}</span
                          >{{ row.name }}</span
                        >
                      </td>
                      <td class="bf-num">
                        @if (row.amountMinor !== null) {
                          <bf-money [amountMinor]="row.amountMinor" [currency]="r.currency" />
                        }
                      </td>
                      <td>{{ row.existingBudgetId ? 'Yes' : 'New' }}</td>
                      <td>
                        @if (row.errors.length) {
                          <span class="bf-issue"
                            ><sat-status-tag status="important">Error</sat-status-tag
                            >{{ row.errors.join(' ') }}</span
                          >
                        } @else {
                          <sat-status-tag status="success">Ready</sat-status-tag>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (failure()) {
            <sat-banner variant="important"
              ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
            >
          }
        </div>
      </section>
    }

    <div class="bf-plans">
      <section class="bf-card" aria-label="Plan versions">
        <div class="bf-card__header"><h2 class="bf-card__title">Versions</h2></div>
        <bf-load-state
          [loading]="versions.isLoading()"
          [error]="versions.error()"
          what="plan versions"
          (retry)="versions.reload()"
        />
        <ul class="bf-pv-list">
          @for (v of items(); track v.id) {
            <li>
              <button
                type="button"
                class="bf-pv"
                [class.bf-pv--selected]="v.id === selected()?.id"
                (click)="selectedId.set(v.id)"
                [attr.data-testid]="'version-' + v.label"
              >
                <span class="bf-pv__head"
                  ><span>{{ v.label }}</span
                  ><bf-money [amountMinor]="v.totalMinor" [currency]="v.currency"
                /></span>
                <span class="bf-pv__meta">
                  <sat-category-tag category="gray">{{ v.kind }}</sat-category-tag>
                  <sat-status-tag
                    [status]="
                      v.status === 'approved'
                        ? 'success'
                        : v.status === 'draft'
                          ? 'neutral'
                          : 'neutral-quiet'
                    "
                    >{{ v.status }}</sat-status-tag
                  >
                  @if (v.controlling) {
                    <sat-status-tag status="info">Controlling</sat-status-tag>
                  }
                  <span class="bf-card__hint">{{ v.lineCount }} line(s) · {{ v.source }}</span>
                </span>
              </button>
            </li>
          }
        </ul>
      </section>
      <section class="bf-card" aria-label="Version lines">
        @if (detail.isLoading()) {
          <bf-load-state [loading]="true" what="the version" />
        }
        @if (valueOf(detail); as d) {
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title">{{ d.label }}</h2>
              <p class="bf-card__hint">
                {{ d.kind }} · {{ d.status
                }}{{
                  d.approvedAt
                    ? ' · approved ' +
                      (d.approvedAt | date: 'd MMM y') +
                      ' by ' +
                      (d.approvedByName ?? '')
                    : ''
                }}{{ d.appliedAt ? ' · applied ' + (d.appliedAt | date: 'd MMM y') : '' }}
              </p>
            </div>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-lines bf-split-table" data-testid="version-lines">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Program</th>
                  <th scope="col" class="bf-num">Plan</th>
                  <th scope="col" class="bf-num">Root authorized</th>
                  <th scope="col" class="bf-num">Savings</th>
                  <th scope="col" class="bf-num">Difference</th>
                </tr>
              </thead>
              <tbody>
                @for (l of d.lines; track l.lineNo) {
                  <tr>
                    <td>
                      <span class="bf-cell__code">{{ l.code }}</span>
                    </td>
                    <td>
                      @if (l.budgetId) {
                        <a [routerLink]="['/budgets', l.budgetId]">{{ l.name }}</a>
                      } @else {
                        {{ l.name }}
                      }
                    </td>
                    <td class="bf-num">
                      <bf-money [amountMinor]="l.amountMinor" [currency]="d.currency" />
                    </td>
                    <td class="bf-num">
                      @if (l.rootAuthorizedMinor !== null) {
                        <bf-money [amountMinor]="l.rootAuthorizedMinor" [currency]="d.currency" />
                      } @else {
                        not created
                      }
                    </td>
                    <td class="bf-num">
                      @if (l.savingsMinor !== null) {
                        <bf-money [amountMinor]="l.savingsMinor" [currency]="d.currency" />
                      }
                    </td>
                    <td class="bf-num" [class.bf-bad]="(l.differenceMinor ?? 0) !== 0">
                      @if (l.differenceMinor !== null) {
                        <bf-money [amountMinor]="l.differenceMinor" [currency]="d.currency" />
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (actionFailure()) {
            <div class="bf-card__body">
              <sat-banner variant="important"
                ><sat-banner-message>{{ actionFailure() }}</sat-banner-message></sat-banner
              >
            </div>
          }
          @if (notice()) {
            <div class="bf-card__body">
              <sat-banner variant="success"
                ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
              >
            </div>
          }
          <div class="bf-actions">
            @if (d.status === 'draft') {
              <button
                mat-flat-button
                type="button"
                (click)="act('approve', d.id)"
                [disabled]="busy()"
                data-testid="approve-version"
              >
                Approve
              </button>
            }
            @if (d.status === 'approved' && !d.controlling && d.kind !== 'forecast') {
              <button
                mat-flat-button
                type="button"
                (click)="act('apply', d.id)"
                [disabled]="busy()"
                data-testid="apply-version"
              >
                Apply: make controlling
              </button>
            }
            <button mat-stroked-button type="button" (click)="copy(d.id)" [disabled]="busy()">
              Copy as a new current version
            </button>
          </div>
        } @else if (!detail.isLoading()) {
          <div class="bf-card__body"><p class="bf-card__hint">Choose a version.</p></div>
        }
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlansPage {
  private readonly api = injectApi();
  protected readonly valueOf = valueOf;
  protected readonly fields = FIELDS;
  protected readonly fy = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly importing = signal(false);
  protected readonly csv = signal('');
  protected readonly mapping = signal<Partial<Record<FieldKey, string>>>({});
  protected readonly result = signal<PlanImportResult | null>(null);
  protected errorRows(rows: readonly { errors: readonly string[] }[]): number {
    return rows.filter((r) => r.errors.length > 0).length;
  }
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly actionFailure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected label = 'Imported plan';
  protected kind: Kind = 'forecast';
  private readonly calendars = resource({
    loader: async () => (await data(this.api.listFiscalCalendars({}))).items,
  });
  protected readonly years = computed(
    () => (valueOf(this.calendars) ?? []).find((c) => !c.groupCalendarId)?.years ?? [],
  );
  protected readonly versions = resource({
    params: () => (this.fy() ? { fiscalYearId: this.fy()! } : undefined),
    loader: async ({ params }) => (await data(this.api.listPlanVersions({ query: params }))).items,
  });
  protected readonly items = computed(() => valueOf(this.versions) ?? []);
  protected readonly selected = computed(
    () =>
      this.items().find((v) => v.id === this.selectedId()) ??
      this.items().find((v) => v.controlling) ??
      this.items()[0],
  );
  protected readonly detail = resource({
    params: () =>
      this.selected()
        ? { id: this.selected()!.id, t: this.selected()!.appliedAt ?? this.selected()!.status }
        : undefined,
    loader: ({ params }) => data(this.api.getPlanVersion({ params: { planVersionId: params.id } })),
  });
  protected readonly tie = resource({
    params: () => (this.fy() ? { fiscalYearId: this.fy()!, n: this.items().length } : undefined),
    loader: ({ params }) =>
      data(this.api.planTieOut({ query: { fiscalYearId: params.fiscalYearId } })),
  });
  protected readonly headers = computed(() => {
    const first =
      this.csv()
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)[0] ?? '';
    if (!first.trim()) return [];
    return first
      .split(first.includes('\t') ? '\t' : ',')
      .map((h) => h.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  });
  protected readonly ready = computed(
    () => !!this.mapping().code && !!this.mapping().name && !!this.mapping().amount,
  );

  constructor() {
    effect(() => {
      const ys = this.years();
      if (this.fy() || !ys.length) return;
      const today = new Date().toISOString().slice(0, 10);
      this.fy.set((ys.find((y) => y.startDate <= today && y.endDate >= today) ?? ys[0]).id);
    });
  }

  protected setCsv(text: string): void {
    this.csv.set(text);
    this.result.set(null);
    const guess: Partial<Record<FieldKey, string>> = {};
    for (const h of this.headers()) {
      const k = h.toLowerCase();
      if (!guess.code && k.includes('code') && !k.includes('cost') && !k.includes('entity'))
        guess.code = h;
      else if (!guess.amount && (k.includes('amount') || k.includes('budget') || k.includes('usd')))
        guess.amount = h;
      else if (!guess.name && (k.includes('name') || k.includes('program'))) guess.name = h;
      else if (!guess.legalEntity && k.includes('entity')) guess.legalEntity = h;
      else if (!guess.costCenter && k.includes('cost')) guess.costCenter = h;
      else if (!guess.ownerEmail && (k.includes('owner') || k.includes('email')))
        guess.ownerEmail = h;
      else if (!guess.category && k.includes('category')) guess.category = h;
    }
    this.mapping.set(guess);
  }

  protected map(key: FieldKey, header: string): void {
    this.mapping.update((m) => ({ ...m, [key]: header || undefined }));
    this.result.set(null);
  }

  protected async runImport(dryRun: boolean): Promise<void> {
    const fy = this.fy();
    if (!fy) return;
    this.busy.set(true);
    this.failure.set(null);
    const m = this.mapping();
    try {
      const r = await data(
        this.api.importPlan({
          body: {
            fiscalYearId: fy,
            kind: this.kind,
            label: this.label.trim(),
            csv: this.csv(),
            mapping: {
              code: m.code!,
              name: m.name!,
              amount: m.amount!,
              ...(m.legalEntity ? { legalEntity: m.legalEntity } : {}),
              ...(m.costCenter ? { costCenter: m.costCenter } : {}),
              ...(m.ownerEmail ? { ownerEmail: m.ownerEmail } : {}),
              ...(m.category ? { category: m.category } : {}),
            },
            dryRun,
          },
        }),
      );
      this.result.set(r);
      if (!dryRun && r.planVersion) {
        this.versions.reload();
        this.selectedId.set(r.planVersion.id);
        this.notice.set(`Draft version "${r.planVersion.label}" created from the spreadsheet.`);
      }
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async act(kind: 'approve' | 'apply', id: string): Promise<void> {
    this.busy.set(true);
    this.actionFailure.set(null);
    this.notice.set(null);
    try {
      if (kind === 'approve')
        await data(this.api.approvePlanVersion({ params: { planVersionId: id } }));
      else {
        const r = await data(this.api.applyPlanVersion({ params: { planVersionId: id } }));
        this.notice.set(
          `Applied: ${r.createdBudgetIds.length} root(s) created, ${r.adjustedBudgetIds.length} adjusted.`,
        );
      }
      this.versions.reload();
      this.detail.reload();
      this.tie.reload();
    } catch (e) {
      this.actionFailure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(id: string): Promise<void> {
    const fy = this.fy();
    if (!fy) return;
    this.busy.set(true);
    this.actionFailure.set(null);
    try {
      const v = await data(
        this.api.createPlanVersion({
          body: {
            fiscalYearId: fy,
            kind: 'current',
            label: `Revision ${new Date().toISOString().slice(0, 10)}`,
            copyFromId: id,
          },
        }),
      );
      this.versions.reload();
      this.selectedId.set(v.id);
    } catch (e) {
      this.actionFailure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
