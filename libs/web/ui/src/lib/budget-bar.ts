import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatMoney, Money } from './money';

/** The ledger buckets of section 10 of the design system sheet, plus the request being decided. */
export type BudgetBucket =
  | 'allocatedOut'
  | 'held'
  | 'preEncumbered'
  | 'thisRequest'
  | 'encumbered'
  | 'actual'
  | 'accrued'
  | 'available';

export interface BudgetBarSegment {
  bucket: BudgetBucket;
  amountMinor: number;
  /** Plain-English legend label; defaults to the bucket's own name. */
  label?: string;
}

const LABEL: Record<BudgetBucket, string> = {
  allocatedOut: 'Allocated out',
  held: 'Held',
  preEncumbered: 'Pending',
  thisRequest: 'This request',
  encumbered: 'Committed',
  actual: 'Actual',
  accrued: 'Accrued',
  available: 'Available',
};

/**
 * The section 10 budget-safety bar: one colour per bucket, used everywhere a budget's money is
 * drawn so a bucket always reads the same. Amounts come from the API; the bar only sizes them
 * against `totalMinor` (the 100% line, normally authorized). When the parts exceed the total the
 * bar scales to the parts, marks the 100% line and turns its outline to the error tone.
 */
@Component({
  selector: 'bf-budget-bar',
  imports: [Money],
  template: `
    <div
      class="bf-bbar"
      [class.bf-bbar--thin]="size() === 'thin'"
      [class.bf-bbar--over]="view().over"
      role="img"
      [attr.aria-label]="ariaLabel()"
    >
      @for (s of view().segs; track s.bucket) {
        @if (s.pct > 0) {
          <span class="bf-bbar__seg bf-bbar__seg--{{ s.bucket }}" [style.width.%]="s.pct"></span>
        }
      }
      @if (view().over) {
        <span class="bf-bbar__limit" [style.inset-inline-start.%]="view().limitPct"></span>
      }
      @if (view().forecastPct !== null) {
        <span class="bf-bbar__forecast" [style.width.%]="view().forecastPct"></span>
      }
    </div>
    @if (legend()) {
      <ul class="bf-bbar__legend">
        @for (s of view().segs; track s.bucket) {
          <li>
            <span class="bf-bbar__swatch bf-bbar__seg--{{ s.bucket }}" aria-hidden="true"></span>
            <span class="bf-bbar__name">{{ s.label }}</span>
            <bf-money [amountMinor]="s.amountMinor" [currency]="currency()" />
          </li>
        }
        @let forecast = forecastMinor();
        @if (forecast !== null) {
          <li>
            <span class="bf-bbar__swatch bf-bbar__swatch--forecast" aria-hidden="true"></span>
            <span class="bf-bbar__name">Forecast</span>
            <bf-money [amountMinor]="forecast" [currency]="currency()" />
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bf-bbar {
      position: relative;
      display: flex;
      height: 12px;
      overflow: hidden;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-high);
    }
    .bf-bbar--thin {
      height: 6px;
      border: 0;
    }
    .bf-bbar--over {
      border-color: var(--mat-sys-error);
    }
    .bf-bbar__seg {
      display: block;
      flex: none;
      height: 100%;
    }
    .bf-bbar__seg--allocatedOut {
      background: var(--sat-sys-primary-loud);
    }
    .bf-bbar__seg--held {
      background: var(--mat-sys-outline);
    }
    .bf-bbar__seg--preEncumbered {
      background: var(--sat-sys-info-icon);
    }
    .bf-bbar__seg--thisRequest {
      background: repeating-linear-gradient(
        135deg,
        var(--sat-sys-info-icon) 0 4px,
        var(--sat-sys-info-container) 4px 7px
      );
    }
    .bf-bbar__seg--encumbered {
      background: var(--sat-sys-warning-icon);
    }
    .bf-bbar__seg--actual {
      background: var(--mat-sys-tertiary);
    }
    .bf-bbar__seg--accrued {
      background: var(--mat-sys-secondary);
    }
    .bf-bbar__seg--available {
      background: var(--sat-sys-success-icon);
    }
    .bf-bbar__limit {
      position: absolute;
      inset-block: 0;
      width: 2px;
      background: var(--mat-sys-error);
    }
    .bf-bbar__forecast {
      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;
      box-sizing: border-box;
      border: 2px dashed var(--mat-sys-primary);
      border-radius: var(--mat-sys-corner-full);
    }
    .bf-bbar__legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-bbar__legend li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .bf-bbar__name {
      color: var(--mat-sys-on-surface);
    }
    .bf-bbar__swatch {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: var(--mat-sys-corner-extra-small);
    }
    .bf-bbar__swatch--forecast {
      box-sizing: border-box;
      border: 2px dashed var(--mat-sys-primary);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetBar {
  readonly segments = input.required<readonly BudgetBarSegment[]>();
  /** The 100% line, in minor units of `currency` (normally authorized). */
  readonly totalMinor = input.required<number>();
  readonly currency = input.required<string>();
  readonly forecastMinor = input<number | null>(null);
  /** What the bar shows, read first by screen readers ("Bengaluru Events budget"). */
  readonly label = input.required<string>();
  readonly legend = input(true);
  readonly size = input<'regular' | 'thin'>('regular');

  protected readonly view = computed(() => {
    const parts = this.segments().map((s) => ({ ...s, amountMinor: Math.max(0, s.amountMinor) }));
    const sum = parts.reduce((n, s) => n + s.amountMinor, 0);
    const total = Math.max(this.totalMinor(), 0);
    const base = Math.max(total, sum, 1);
    const pct = (v: number) => Math.min(100, (v * 100) / base);
    const forecast = this.forecastMinor();
    return {
      segs: parts.map((s) => ({
        ...s,
        label: s.label ?? LABEL[s.bucket],
        pct: pct(s.amountMinor),
      })),
      over: sum > total,
      limitPct: pct(total),
      forecastPct: forecast === null ? null : pct(Math.max(forecast, 0)),
    };
  });

  protected readonly ariaLabel = computed(() => {
    const c = this.currency();
    const parts = this.view().segs.map((s) => `${s.label} ${formatMoney(s.amountMinor, c)}`);
    const over = this.view().over ? ', more than the total' : '';
    return `${this.label()}: ${parts.join(', ')} of ${formatMoney(this.totalMinor(), c)}${over}`;
  });
}
