import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { ReportCell, ReportReconciliation, ReportResult, ReportRow } from '@bf/contracts';
import { BudgetStatus, DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';

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
    BudgetStatus,
    DateTimePipe,
    DecimalPipe,
    MatButtonModule,
    Money,
    NgTemplateOutlet,
    SatStatusTag,
  ],
  template: `
    <div class="bf-table-scroll">
      <table class="bf-split-table" [attr.aria-label]="caption()">
        <thead>
          <tr>
            @for (c of columns(); track c.key) {
              <th [class.bf-num]="c.align === 'end'" [attr.title]="c.hint">{{ c.label }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.key) {
            <tr>
              @for (c of columns(); track c.key) {
                <td [class.bf-num]="c.align === 'end'">
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
                </td>
              }
            </tr>
          }
          @if (totals(); as t) {
            <tr class="bf-total">
              @for (c of columns(); track c.key) {
                <td [class.bf-num]="c.align === 'end'">
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
              <bf-budget-status [status]="cell.text" />
            }
          }
          @case ('date') {
            @if (cell.text) {
              <span data-testid="relative-time">{{ cell.text | bfDateTime: timezone() }}</span>
            }
          }
          @default {
            @if (cell.tone && cell.tone !== 'neutral') {
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportTable {
  readonly columns = input.required<readonly ReportColumn[]>();
  readonly rows = input.required<readonly ReportRow[]>();
  readonly totals = input<ReportRow | null>(null);
  readonly caption = input('Report');
  readonly timezone = input('UTC');
  readonly drill = output<DrillRequest>();
  protected readonly percentOf = percentOf;

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

/** Chart series with the table always available as the text alternative below it. */
@Component({
  selector: 'bf-report-chart',
  imports: [DecimalPipe, Money],
  template: `
    @for (s of series(); track s.key) {
      <figure class="bf-chart">
        <figcaption class="bf-chart__title">{{ s.label }}</figcaption>
        <ul class="bf-chart__bars">
          @for (p of s.points; track p.key) {
            <li class="bf-chart__bar">
              <span class="bf-chart__label">{{ p.label }}</span>
              <span class="bf-chart__track">
                <span class="bf-chart__fill" [style.width.%]="width(s.key, p.value)"></span>
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
    .bf-chart {
      margin: 0 0 16px;
    }
    .bf-chart__title {
      margin-bottom: 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-large);
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
      grid-template-columns: minmax(96px, 20%) minmax(0, 1fr) auto;
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
      height: 10px;
      overflow: hidden;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-high);
    }
    .bf-chart__fill {
      display: block;
      height: 100%;
      background: var(--categorical-data-viz-1, var(--mat-sys-primary));
    }
    .bf-chart__value {
      font-variant-numeric: tabular-nums;
    }
    @media (width < 600px) {
      .bf-chart__bar {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .bf-chart__track {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportChart {
  readonly series = input.required<readonly ReportSeries[]>();
  readonly currency = input('USD');
  private readonly maxima = computed(
    () =>
      new Map(
        this.series().map((s) => [s.key, Math.max(1, ...s.points.map((p) => Math.abs(p.value)))]),
      ),
  );

  protected width(seriesKey: string, value: number): number {
    return (Math.abs(value) / (this.maxima().get(seriesKey) ?? 1)) * 100;
  }
}
