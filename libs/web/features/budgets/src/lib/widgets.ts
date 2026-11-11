import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { BudgetDetail } from '@bf/contracts';
import { BudgetBar, type BudgetBarSegment, Money } from '@bf/web/ui';
import { SAT_RICH_TOOLTIP_IMPORTS } from '@hylandsoftware/satori-ui/rich-tooltip';
import { balancesOf, pct } from './api';

/** Utilization bar: (encumbered + actual) / authorized, warning at the first alert threshold, error at 100%. */
@Component({
  selector: 'bf-usage-bar',
  template: `
    <span class="bf-usage" [attr.aria-label]="label()">
      <span class="bf-usage__track">
        <span class="bf-usage__fill" [class]="tone()" [style.width.%]="width()"></span>
      </span>
      <span class="bf-usage__pct" [class]="tone()">{{ text() }}</span>
    </span>
  `,
  styles: `
    .bf-usage {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 96px;
    }
    .bf-usage__track {
      flex: 1;
      height: 6px;
      overflow: hidden;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-highest);
    }
    .bf-usage__fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--mat-sys-primary);
    }
    .bf-usage__fill.warning {
      background: var(--sat-sys-warning-icon);
    }
    .bf-usage__fill.error {
      background: var(--mat-sys-error);
    }
    .bf-usage__pct {
      min-width: 36px;
      text-align: end;
      font: var(--mat-sys-label-medium);
      font-variant-numeric: tabular-nums;
    }
    .bf-usage__pct.error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsageBar {
  readonly bps = input.required<number>();
  readonly thresholds = input<readonly number[]>([80, 100]);
  protected readonly width = computed(() => Math.min(this.bps() / 100, 100));
  protected readonly text = computed(() => pct(this.bps()));
  protected readonly label = computed(() => `${this.text()} used`);
  protected readonly tone = computed(() => {
    const p = this.bps() / 100;
    if (p >= 100) return 'error';
    const warn =
      this.thresholds()
        .filter((t) => t < 100)
        .at(-1) ?? 80;
    return p >= warn ? 'warning' : 'ok';
  });
}

/**
 * Where the authorized amount sits, in the section 10 bucket colours (the shared budget bar):
 * allocated out, held, pending, committed, actual, accrued and available. Available is the API's
 * figure under this budget's rules; it is drawn only when it fits under authorized, since under a
 * soft or track control basis it is not the remainder of the other buckets.
 */
@Component({
  selector: 'bf-spectrum',
  imports: [BudgetBar],
  template: `<bf-budget-bar
    [label]="budget().name + ' budget'"
    [segments]="segments()"
    [totalMinor]="total()"
    [currency]="budget().currency"
  />`,
  styles: `
    :host {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Spectrum {
  readonly budget = input.required<BudgetDetail>();
  protected readonly total = computed(() => balancesOf(this.budget()).authorized);
  protected readonly segments = computed((): BudgetBarSegment[] => {
    const b = balancesOf(this.budget());
    const parts: BudgetBarSegment[] = [
      { bucket: 'allocatedOut', amountMinor: b.allocatedOut, label: 'Allocated to children' },
      { bucket: 'held', amountMinor: b.held },
      { bucket: 'preEncumbered', amountMinor: b.preEncumbered, label: 'Pending requests' },
      { bucket: 'encumbered', amountMinor: b.encumbered, label: 'Committed' },
      { bucket: 'actual', amountMinor: b.actual },
    ];
    let used = parts.reduce((n, p) => n + Math.max(p.amountMinor, 0), 0);
    if (b.accrued > 0 && used + b.accrued <= b.authorized) {
      parts.push({ bucket: 'accrued', amountMinor: b.accrued });
      used += b.accrued;
    }
    if (b.available > 0 && used + b.available <= b.authorized)
      parts.push({ bucket: 'available', amountMinor: b.available });
    return parts;
  });
}

const REASON_TEXT: Record<string, string> = {
  allocated_to_children:
    'Money allocated to child budgets counts as used here; company-wide it stays available until a child commits or spends it.',
  children_spend: 'Commitments and actuals in child budgets reduce the company-wide figure.',
  held: 'Held amounts (earmarked contributions and reserves) count as used under this budget’s rules.',
  basis_excludes:
    'This budget’s control basis leaves some buckets out, so its rules allow more than the company-wide figure.',
};

/** "Available under this budget's rules" with a rich tooltip explaining any difference from company-wide Available. */
@Component({
  selector: 'bf-available-tip',
  imports: [MatIconModule, Money, SAT_RICH_TOOLTIP_IMPORTS],
  template: `
    <button
      type="button"
      class="bf-tip"
      [satRichTooltipTriggerFor]="tip"
      aria-label="How Available is calculated"
    >
      <mat-icon svgIcon="info" aria-hidden="true" />
    </button>
    <sat-rich-tooltip #tip="satRichTooltip">
      <sat-rich-tooltip-title>Available under this budget’s rules</sat-rich-tooltip-title>
      <sat-rich-tooltip-content>
        <p class="bf-tip__line">
          Under this budget’s rules:
          <bf-money
            [amountMinor]="b().available.underRules.amountMinor"
            [currency]="b().available.underRules.currency"
          />
        </p>
        <p class="bf-tip__line">
          Company-wide (dashboards):
          <bf-money
            [amountMinor]="b().available.companyWide.amountMinor"
            [currency]="b().available.companyWide.currency"
          />
        </p>
        @if (b().available.reasons.length === 0) {
          <p>Both figures are the same for this budget.</p>
        } @else {
          <ul class="bf-tip__reasons">
            @for (r of b().available.reasons; track r.kind) {
              <li>
                <bf-money
                  [amountMinor]="r.amountMinor"
                  [currency]="b().available.difference.currency"
                />
                — {{ text(r.kind) }}
              </li>
            }
          </ul>
        }
        <p class="bf-tip__basis">Control: {{ b().control.mode }} mode, counting {{ basis() }}.</p>
      </sat-rich-tooltip-content>
    </sat-rich-tooltip>
  `,
  styles: `
    .bf-tip {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: var(--mat-sys-corner-full);
      background: transparent;
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
    }
    .bf-tip mat-icon {
      width: 18px;
      height: 18px;
    }
    .bf-tip__line {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 4px;
    }
    .bf-tip__reasons {
      margin: 8px 0;
      padding-inline-start: 16px;
    }
    .bf-tip__basis {
      margin: 8px 0 0;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvailableTip {
  readonly budget = input.required<BudgetDetail>();
  protected readonly b = this.budget;
  protected readonly basis = computed(() =>
    this.budget()
      .control.basis.map((x) => x.replace(/_/g, ' '))
      .join(', '),
  );
  protected text(kind: string): string {
    return REASON_TEXT[kind] ?? kind;
  }
}
