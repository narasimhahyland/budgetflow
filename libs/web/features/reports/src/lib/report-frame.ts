import { DatePipe, DecimalPipe, DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { ReportCell, ReportReconciliation, ReportResult, ReportRow } from '@bf/contracts';
import {
  BudgetBar,
  type BudgetBarSegment,
  type BudgetBucket,
  DateTimePipe,
  findBudgetStatus,
  Money,
  spendStatus,
  type SpendStatusKind,
  type StatusView,
} from '@bf/web/ui';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';

// Report cells carry a status as the API wrote it: an enum key or its label, for a budget, event,
// commitment or contribution. The first kind that knows the word gives the section 5 tone and icon.
const STATUS_KINDS: readonly SpendStatusKind[] = [
  'event',
  'commitment',
  'contribution',
  'request',
  'recharge',
];
const OUTCOMES: Record<string, StatusView> = {
  ties: { label: 'Ties', tone: 'success', icon: 'circle_check' },
  does_not_tie: { label: 'Does not tie', tone: 'important', icon: 'error' },
};

/** The section 5 view of a status word in a report cell or tag, or null when it is not a status. */
export function reportStatus(text: string): StatusView | null {
  const budget = findBudgetStatus(text);
  if (budget) return budget;
  const key = text
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (OUTCOMES[key]) return OUTCOMES[key];
  const generic = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
  for (const kind of STATUS_KINDS) {
    const v = spendStatus(kind, key);
    if (!(v.tone === 'neutral' && v.icon === 'circle_minus' && v.label === generic)) return v;
  }
  return null;
}

/** "Priya Raman" → "PR", for the owner avatar. */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/** A percentage arriving from the API in basis points (10,000 = 100%). */
export const percentOf = (bps: number): number => bps / 100;

/** `libs/contracts` exports the column schema but not its inferred type; take it from the result. */
export type ReportColumn = ReportResult['columns'][number];
export type ReportKpi = ReportResult['kpis'][number];
export type ReportSeries = ReportResult['series'][number];

/** The drillable figure a reader asked to see the ledger lines behind. */
export interface DrillRequest {
  budgetId: string;
  bucket: string;
  rowLabel: string;
  columnLabel: string;
}

/**
 * The scope line every report and the health overview carry. `note` is written by the API and is
 * shown exactly as it arrives when the viewer sees only part of the company.
 */
@Component({
  selector: 'bf-scope-note',
  imports: [SAT_BANNER_IMPORTS],
  template: `
    @if (note()) {
      <sat-banner class="bf-banner" variant="info" data-testid="report-scope-note">
        <sat-banner-message
          ><strong>{{ note() }}</strong> {{ label() }} · {{ budgetIds() }}
          {{ budgetIds() === 1 ? 'budget' : 'budgets' }} in scope.</sat-banner-message
        >
      </sat-banner>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScopeNote {
  readonly note = input<string | null>(null);
  readonly label = input('');
  readonly budgetIds = input(0);
}

/**
 * The plain-English statements the server attaches to a run, for example "No accepted forecast yet;
 * showing system run-rate forecasts". The wording is the API's, so a report never has to invent an
 * explanation of its own data.
 */
@Component({
  selector: 'bf-report-notes',
  imports: [SAT_BANNER_IMPORTS],
  template: `
    @if (notes().length) {
      <sat-banner class="bf-banner" variant="info" data-testid="report-notes">
        <sat-banner-message>
          @for (note of notes(); track note; let last = $last) {
            {{ note }}{{ last ? '' : ' ' }}
          }
        </sat-banner-message>
      </sat-banner>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportNotes {
  readonly notes = input<readonly string[]>([]);
}

/**
 * Proof that the figures came from the ledger. When the server could not tie a total back to the
 * ledger buckets this says so, with the difference, instead of quietly showing a number nobody can
 * verify.
 */
@Component({
  selector: 'bf-reconciliation',
  imports: [Money, SAT_BANNER_IMPORTS],
  template: `
    @if (reconciliation(); as r) {
      @if (r.ties) {
        <p class="bf-reconcile" data-testid="reconciliation-ties">
          Figures tie to the ledger across {{ r.budgetsCounted }}
          {{ r.budgetsCounted === 1 ? 'budget' : 'budgets' }}. Authorized
          <bf-money [amountMinor]="r.authorized.amountMinor" [currency]="r.authorized.currency" />,
          available
          <bf-money [amountMinor]="r.available.amountMinor" [currency]="r.available.currency" />.
        </p>
      } @else {
        <sat-banner class="bf-banner" variant="important" data-testid="reconciliation-broken">
          <sat-banner-message>
            <strong>These figures do not tie to the ledger.</strong> The table disagrees with the
            ledger buckets for {{ r.differences.length }} figure{{
              r.differences.length === 1 ? '' : 's'
            }}. Treat the report as unverified and tell finance before you use it.
          </sat-banner-message>
        </sat-banner>
        <table class="bf-split-table" aria-label="Figures that do not tie to the ledger">
          <thead>
            <tr>
              <th>Figure</th>
              <th class="bf-num">Ledger says</th>
              <th class="bf-num">Report says</th>
              <th class="bf-num">Difference</th>
            </tr>
          </thead>
          <tbody>
            @for (d of r.differences; track d.key) {
              <tr>
                <td>{{ d.key }}</td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="d.expected.amountMinor"
                    [currency]="d.expected.currency"
                  />
                </td>
                <td class="bf-num">
                  <bf-money [amountMinor]="d.actual.amountMinor" [currency]="d.actual.currency" />
                </td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="d.actual.amountMinor - d.expected.amountMinor"
                    [currency]="d.actual.currency"
                  />
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    }
  `,
  styles: `
    .bf-reconcile {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 0;
      padding: 0 20px 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reconciliation {
  readonly reconciliation = input<ReportReconciliation | null>(null);
}

/**
 * The shared report table: every column and cell is rendered exactly as the server typed it. Money
 * is never recomputed here — a figure the browser worked out could not be reconciled against the
 * ledger, so each one arrives already summed in the reporting currency.
 */
@Component({
  selector: 'bf-report-table',
  imports: [
    DatePipe,
    DateTimePipe,
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    Money,
    NgTemplateOutlet,
    SatAvatar,
    SatStatusTag,
  ],
  template: `
    <div class="bf-table-scroll">
      <table class="bf-split-table" [attr.aria-label]="caption()">
        <thead>
          <tr>
            @for (c of columns(); track c.key) {
              <th
                [class.bf-num]="c.align === 'end'"
                [class.bf-cell--forecast]="isForecast(c)"
                [class.bf-cell--prose]="isProse(c)"
                [attr.title]="c.hint"
              >
                {{ c.label }}
                @if (isForecast(c)) {
                  <span class="bf-forecast-mark">Forecast, not actual</span>
                }
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.key) {
            <tr [class]="rowClass(row)">
              @for (c of columns(); track c.key) {
                <td
                  [class.bf-num]="c.align === 'end'"
                  [class.bf-cell--forecast]="isForecast(c)"
                  [class.bf-cell--prose]="isProse(c)"
                  [attr.data-testid]="isForecast(c) ? 'forecast-cell' : null"
                >
                  @let cell = cellFor(row, c);
                  @let request = drillRequest(row, c);
                  @if (request) {
                    <button
                      class="bf-drill"
                      type="button"
                      data-testid="report-drill"
                      [attr.aria-label]="'Ledger lines behind ' + c.label + ' for ' + row.label"
                      (click)="drill.emit(request)"
                    >
                      <ng-container
                        [ngTemplateOutlet]="value"
                        [ngTemplateOutletContext]="{ $implicit: cell, column: c }"
                      />
                    </button>
                  } @else {
                    <ng-container
                      [ngTemplateOutlet]="value"
                      [ngTemplateOutletContext]="{ $implicit: cell, column: c }"
                    />
                  }
                  @if (c.key === 'label' && showRowTags()) {
                    @for (tag of row.tags; track tag) {
                      @let v = tagView(tag);
                      <sat-status-tag class="bf-row-tag" [status]="v.tone"
                        ><mat-icon [svgIcon]="v.icon" aria-hidden="true" />{{
                          v.label
                        }}</sat-status-tag
                      >
                    }
                  }
                </td>
              }
            </tr>
          }
          @if (totals(); as t) {
            <tr class="bf-total">
              @for (c of columns(); track c.key) {
                <td [class.bf-num]="c.align === 'end'" [class.bf-cell--forecast]="isForecast(c)">
                  <ng-container
                    [ngTemplateOutlet]="value"
                    [ngTemplateOutletContext]="{ $implicit: cellFor(t, c), column: c }"
                  />
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>

    <ng-template #value let-cell let-column="column">
      @if (cell) {
        @switch (column.type) {
          @case ('money') {
            @if (cell.money) {
              <bf-money
                [class]="toneClass(cell)"
                [amountMinor]="cell.money.amountMinor"
                [currency]="cell.money.currency"
              />
            }
          }
          @case ('percent') {
            @if (cell.bps !== null && cell.bps !== undefined) {
              <span class="bf-pct" [class]="toneClass(cell)"
                >{{ percentOf(cell.bps) | number: '1.1-1' }}%</span
              >
            }
          }
          @case ('number') {
            @if (cell.number !== null && cell.number !== undefined) {
              <span [class]="toneClass(cell)">{{ cell.number | number }}</span>
            }
          }
          @case ('status') {
            @if (cell.text) {
              @let s = reportStatus(cell.text);
              @if (s) {
                <sat-status-tag [status]="s.tone"
                  ><mat-icon [svgIcon]="s.icon" aria-hidden="true" />{{ s.label }}</sat-status-tag
                >
              } @else {
                <span>{{ cell.text }}</span>
              }
            }
          }
          @case ('date') {
            @if (cell.text) {
              <!-- A calendar date (service end, period start) is not a moment: never shift it by timezone. -->
              @if (isDateOnly(cell.text)) {
                <span data-testid="relative-time">{{ cell.text | date: 'd MMM y' }}</span>
              } @else {
                <span data-testid="relative-time">{{ cell.text | bfDateTime: timezone() }}</span>
              }
            }
          }
          @default {
            @if (column.key === 'owner' && cell.text) {
              <span class="bf-cell__owner"
                ><sat-avatar size="28" [initials]="initials(cell.text)" aria-hidden="true" />{{
                  cell.text
                }}</span
              >
            } @else if (cell.tone && cell.tone !== 'neutral') {
              <sat-status-tag [status]="tag(cell)">{{ cell.text }}</sat-status-tag>
            } @else {
              <span>{{ cell.text }}</span>
            }
          }
        }
      }
    </ng-template>
  `,
  styles: `
    .bf-drill {
      padding: 0;
      border: 0;
      border-bottom: 1px dashed var(--mat-sys-outline);
      background: none;
      color: inherit;
      cursor: pointer;
      font: inherit;
    }
    .bf-drill:hover,
    .bf-drill:focus-visible {
      border-bottom-color: var(--mat-sys-primary);
      color: var(--mat-sys-primary);
    }
    .bf-pct {
      font-variant-numeric: tabular-nums;
    }
    .bf-tone--warning {
      color: var(--sat-sys-on-warning-container);
    }
    .bf-tone--error {
      color: var(--sat-sys-on-important-container);
    }
    .bf-tone--success {
      color: var(--sat-sys-on-success-container);
    }
    /* A forecast is a projection: hatched, so it never reads like committed or actual money. */
    .bf-cell--forecast {
      background: repeating-linear-gradient(
        135deg,
        transparent 0 5px,
        var(--mat-sys-surface-container-high) 5px 7px
      );
    }
    .bf-forecast-mark {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
      text-transform: none;
    }
    .bf-row-tag {
      margin-inline-start: 8px;
    }
    /* A column holding a sentence needs room for it; the table scrolls sideways instead. */
    .bf-cell--prose {
      min-width: 220px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportTable {
  readonly columns = input.required<readonly ReportColumn[]>();
  readonly rows = input.required<readonly ReportRow[]>();
  readonly totals = input<ReportRow | null>(null);
  readonly caption = input('Report');
  readonly timezone = input('UTC');
  /** Column keys holding a projection rather than money the ledger moved. */
  readonly forecastColumns = input<readonly string[]>([]);
  /** Column keys whose cells hold a sentence, not a label, and so need room to read. */
  readonly proseColumns = input<readonly string[]>([]);
  /**
   * Whether to show the API's row tags beside the row label. Off by default: every report carries
   * tags, and turning them on everywhere is a change to screens 080-086 and 015a/015b that belongs
   * in its own pass with their baselines.
   */
  readonly showRowTags = input(false);
  readonly drill = output<DrillRequest>();
  protected readonly percentOf = percentOf;
  protected readonly reportStatus = reportStatus;
  protected readonly initials = initials;

  protected isDateOnly(text: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(text);
  }

  /** Section 6 row state: a frozen or set-to-zero budget gets the info or important stripe. */
  protected rowClass(row: ReportRow): string {
    const words = [
      ...row.tags,
      ...Object.values(row.cells)
        .map((c) => c?.text)
        .filter((x): x is string => !!x),
    ];
    const states = words.map((w) => findBudgetStatus(w)?.label);
    if (states.includes('Set to zero')) return 'bf-row--important';
    if (states.includes('Frozen')) return 'bf-row--info';
    return '';
  }

  protected isForecast(c: ReportColumn): boolean {
    return this.forecastColumns().includes(c.key);
  }

  protected isProse(c: ReportColumn): boolean {
    return this.proseColumns().includes(c.key);
  }

  /**
   * Row tags are written by the API. A tag naming a budget state (Frozen, Set to zero) takes that
   * state's section 5 tone and icon, so the two never look alike; "Commentary due" asks for action.
   */
  protected tagView(tag: string): StatusView {
    const state = reportStatus(tag);
    if (state) return { ...state, label: tag };
    return tag.toLowerCase().includes('commentary')
      ? { label: tag, tone: 'warning', icon: 'note_edit' }
      : { label: tag, tone: 'info', icon: 'info' };
  }

  /** The `label` column names the row and is carried on the row itself, not among its cells. */
  protected cellFor(row: ReportRow, c: ReportColumn): ReportCell | undefined {
    return row.cells[c.key] ?? (c.key === 'label' ? { text: row.label } : undefined);
  }

  /** A drill-down needs a budget to read the ledger for and the bucket the figure came from. */
  protected drillRequest(row: ReportRow, c: ReportColumn): DrillRequest | null {
    const cell = this.cellFor(row, c);
    if (!c.drillable || !cell?.money || !cell.bucket || !row.budgetId) return null;
    return {
      budgetId: row.budgetId,
      bucket: cell.bucket,
      rowLabel: row.label,
      columnLabel: c.label,
    };
  }

  protected toneClass(cell: ReportCell): string {
    return cell.tone && cell.tone !== 'neutral' ? `bf-tone--${cell.tone}` : '';
  }

  protected tag(cell: ReportCell): 'info' | 'success' | 'warning' | 'important' | 'neutral' {
    switch (cell.tone) {
      case 'success':
        return 'success';
      case 'warning':
        return 'warning';
      case 'error':
        return 'important';
      case 'info':
        return 'info';
      default:
        return 'neutral';
    }
  }
}

// Section 9 header icon per KPI key the report API writes; anything else gets the chart icon.
const KPI_ICON: Record<string, string> = {
  authorized: 'currency_dollar',
  budget: 'currency_dollar',
  budgets: 'currency_dollar',
  allocatedOut: 'graph_branch',
  unallocated: 'graph_radial',
  available: 'graph_radial',
  share: 'graph_radial',
  committed: 'shield_lock',
  pending: 'clock',
  held: 'bookmark',
  actual: 'check_double',
  forecast: 'trending_up',
  forecastUnused: 'timer_off',
  variance: 'compare',
  variancePct: 'compare',
  utilization: 'speed',
  spendPerHead: 'user',
  budgetPerHead: 'user',
  costPerAttendee: 'user',
  reach: 'users',
  reached: 'users',
  eligible: 'users',
  eventsPerParticipant: 'calendar',
  events: 'calendar',
  funded: 'circle_check',
  surplusReturned: 'redo',
  daysLeft: 'timer',
  requests: 'inbox',
};

const KPI_FOOT: Record<string, string> = {
  utilization: 'Of authorized',
  variancePct: 'Of authorized',
  reach: 'Of eligible people',
  share: 'Of the total',
};

/**
 * The report API's KPIs as section 9 metric cards: uppercase label with an icon, the bold tabular
 * figure, and for a percentage KPI the footer with its toned value and a thin bar. The API's tone
 * colours the icon and figure (never the whole card); forecasts get the dashed forecast card.
 */
@Component({
  selector: 'bf-report-kpis',
  imports: [DecimalPipe, MatIconModule, Money],
  template: `
    <div class="bf-kpis bf-report-kpis">
      @for (kpi of kpis(); track kpi.key) {
        <div class="bf-kpi" [class]="cardClass(kpi)">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">{{ kpi.label }}</p>
            <mat-icon class="bf-kpi__icon" [svgIcon]="icon(kpi)" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value" [class]="valueClass(kpi)">
            @if (kpi.money) {
              <bf-money [amountMinor]="kpi.money.amountMinor" [currency]="kpi.money.currency" />
            } @else if (kpi.bps !== null && kpi.bps !== undefined) {
              {{ percentOf(kpi.bps) | number: '1.1-1' }}%
            } @else if (kpi.number !== null && kpi.number !== undefined) {
              {{ kpi.number | number }}
            } @else {
              —
            }
          </p>
          @if (kpi.bps !== null && kpi.bps !== undefined) {
            <div class="bf-kpi__foot">
              <span>{{ kpi.hint ?? footLabel(kpi) }}</span>
              <span class="bf-kpi__pct">{{ percentOf(kpi.bps) | number: '1.1-1' }}%</span>
              <span class="bf-kpi__track"
                ><span class="bf-kpi__fill" [style.width.%]="barOf(kpi.bps)"></span
              ></span>
            </div>
          } @else if (kpi.hint) {
            <p class="bf-kpi__delta">{{ kpi.hint }}</p>
          }
        </div>
      }
    </div>
  `,
  styles: `
    /* Wide enough for "USD 143,678.75" at the section 9 size: bf-money never wraps. */
    .bf-report-kpis {
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportKpis {
  readonly kpis = input.required<readonly ReportKpi[]>();
  protected readonly percentOf = percentOf;

  protected icon(kpi: ReportKpi): string {
    return KPI_ICON[kpi.key] ?? 'bar_chart';
  }

  protected footLabel(kpi: ReportKpi): string {
    return KPI_FOOT[kpi.key] ?? 'Share';
  }

  /** Section 9 tones Available in success when the API has not said otherwise. */
  private toneOf(kpi: ReportKpi): ReportKpi['tone'] {
    if (kpi.tone && kpi.tone !== 'neutral') return kpi.tone;
    return (kpi.key === 'available' || kpi.key === 'unallocated') &&
      (kpi.money?.amountMinor ?? 0) > 0
      ? 'success'
      : kpi.tone;
  }

  protected barOf(bps: number): number {
    return Math.max(0, Math.min(100, percentOf(bps)));
  }

  protected cardClass(kpi: ReportKpi): string {
    const forecast = /forecast/i.test(kpi.key) ? ' bf-kpi--forecast' : '';
    const t = this.toneOf(kpi);
    const tone = t && t !== 'neutral' ? `bf-kpi--${t}` : '';
    return `${tone}${forecast}`;
  }

  protected valueClass(kpi: ReportKpi): string {
    const t = this.toneOf(kpi);
    return t === 'success' || t === 'warning' || t === 'error' ? `bf-kpi__value--${t}` : '';
  }
}

// Report cell keys that carry a ledger bucket, in section 10 order.
const BUCKET_CELLS: readonly [BudgetBucket, string][] = [
  ['allocatedOut', 'allocatedOut'],
  ['held', 'held'],
  ['preEncumbered', 'pending'],
  ['encumbered', 'committed'],
  ['actual', 'actual'],
  ['accrued', 'accrued'],
  ['available', 'available'],
];

/**
 * One section 10 budget bar per report row, sized against the row's authorized amount, from the
 * bucket cells the API already sent (nothing is summed here). The total row carries the legend.
 */
@Component({
  selector: 'bf-report-bucket-bars',
  imports: [BudgetBar],
  template: `
    @if (bars().length) {
      <ul class="bf-bucket-bars" aria-label="Where the money sits">
        @for (b of bars(); track b.key) {
          <li class="bf-bucket-bars__row" [class.bf-bucket-bars__row--total]="b.legend">
            <span class="bf-bucket-bars__label">{{ b.label }}</span>
            <bf-budget-bar
              [label]="b.label"
              [segments]="b.segments"
              [totalMinor]="b.total"
              [currency]="currency()"
              [legend]="b.legend"
            />
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .bf-bucket-bars {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
    }
    .bf-bucket-bars__row {
      display: grid;
      grid-template-columns: minmax(96px, 20%) minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    .bf-bucket-bars__row--total {
      padding-bottom: 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .bf-bucket-bars__label {
      overflow: hidden;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bf-bucket-bars__row--total .bf-bucket-bars__label {
      color: var(--mat-sys-on-surface);
      font-weight: 600;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportBucketBars {
  readonly rows = input.required<readonly ReportRow[]>();
  readonly totals = input<ReportRow | null>(null);
  readonly currency = input('USD');

  protected readonly bars = computed(() => {
    const build = (row: ReportRow, label: string, legend: boolean) => {
      const total = row.cells['authorized']?.money?.amountMinor;
      if (total === undefined) return null;
      const segments: BudgetBarSegment[] = BUCKET_CELLS.flatMap(([bucket, key]) => {
        const m = row.cells[key]?.money;
        return m ? [{ bucket, amountMinor: m.amountMinor }] : [];
      });
      return segments.length >= 2 ? { key: row.key, label, total, segments, legend } : null;
    };
    const t = this.totals();
    const all = [
      ...(t ? [build(t, 'Total', true)] : []),
      ...this.rows().map((r, i) => build(r, r.label, !t && i === 0)),
    ];
    return all.filter((b): b is NonNullable<typeof b> => b !== null);
  });
}

/**
 * Chart series with the table always available as the text alternative (section 13): one data-viz
 * colour per series, every series of the same unit on one scale so actual and planned compare, and
 * forecast series as a dashed outline so a projection never reads like money the ledger moved.
 */
@Component({
  selector: 'bf-report-chart',
  imports: [DecimalPipe, MatButtonModule, MatIconModule, Money],
  template: `
    @if (tableId()) {
      <button mat-button type="button" class="bf-chart__table-link" (click)="showTable()">
        <mat-icon svgIcon="table" aria-hidden="true" />View as table
      </button>
    }
    @for (s of series(); track s.key; let i = $index) {
      <figure
        class="bf-chart"
        [class.bf-chart--forecast]="isForecast(s)"
        [style.--bf-series-colour]="colour(i)"
      >
        <figcaption class="bf-chart__title">
          <span class="bf-chart__swatch" aria-hidden="true"></span>{{ s.label }}
          @if (isForecast(s)) {
            <span class="bf-chart__note">Forecast, not actual</span>
          }
        </figcaption>
        <ul class="bf-chart__bars">
          @for (p of s.points; track p.key) {
            <li class="bf-chart__bar">
              <span class="bf-chart__label">{{ p.label }}</span>
              <span class="bf-chart__track">
                <span class="bf-chart__fill" [style.width.%]="width(s, p.value)"></span>
              </span>
              <span class="bf-chart__value">
                @switch (s.unit) {
                  @case ('money') {
                    <bf-money [amountMinor]="p.value" [currency]="currency()" />
                  }
                  @case ('percent') {
                    {{ p.value / 100 | number: '1.1-1' }}%
                  }
                  @default {
                    {{ p.value | number }}
                  }
                }
              </span>
            </li>
          }
        </ul>
      </figure>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .bf-chart__table-link {
      margin: 0 0 8px;
    }
    .bf-chart {
      margin: 0 0 16px;
    }
    .bf-chart__title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-large);
    }
    .bf-chart__swatch {
      width: 12px;
      height: 12px;
      border-radius: var(--mat-sys-corner-extra-small);
      background: var(--bf-series-colour);
    }
    .bf-chart--forecast .bf-chart__swatch {
      box-sizing: border-box;
      border: 2px dashed var(--bf-series-colour);
      background: transparent;
    }
    .bf-chart__note {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
    }
    .bf-chart__bars {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bf-chart__bar {
      display: grid;
      grid-template-columns: minmax(96px, 20%) minmax(0, 1fr) 9rem;
      gap: 12px;
      align-items: center;
      font: var(--mat-sys-body-small);
    }
    .bf-chart__label {
      overflow: hidden;
      color: var(--mat-sys-on-surface-variant);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bf-chart__track {
      height: 12px;
      overflow: hidden;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container);
    }
    .bf-chart__fill {
      display: block;
      box-sizing: border-box;
      height: 100%;
      border-radius: var(--mat-sys-corner-full);
      background: var(--bf-series-colour);
    }
    .bf-chart--forecast .bf-chart__fill {
      border: 2px dashed var(--bf-series-colour);
      background: transparent;
    }
    .bf-chart__value {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }
    /* Below 600px the table is the chart: one list, not two. */
    @media (width < 600px) {
      :host {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportChart {
  readonly series = input.required<readonly ReportSeries[]>();
  readonly currency = input('USD');
  /** Id of the table that carries the same figures; shown as "View as table". */
  readonly tableId = input<string | null>(null);
  private readonly document = inject(DOCUMENT);

  /** One maximum per unit, so two money series share a scale and their bars compare. */
  private readonly maxima = computed(() => {
    const max = new Map<string, number>();
    for (const s of this.series())
      for (const p of s.points) max.set(s.unit, Math.max(max.get(s.unit) ?? 1, Math.abs(p.value)));
    return max;
  });

  protected width(s: ReportSeries, value: number): number {
    return (Math.abs(value) / (this.maxima().get(s.unit) ?? 1)) * 100;
  }

  protected colour(index: number): string {
    return `var(--categorical-data-viz-${(index % 8) + 1})`;
  }

  protected isForecast(s: ReportSeries): boolean {
    return /forecast/i.test(s.key) || /forecast/i.test(s.label);
  }

  protected showTable(): void {
    const el = this.document.getElementById(this.tableId() ?? '');
    el?.scrollIntoView({ block: 'start' });
    el?.focus({ preventScroll: true });
  }
}
