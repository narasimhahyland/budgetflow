import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { BudgetDetail } from '@bf/contracts';
import { Money } from '@bf/web/ui';
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

interface Segment {
  key: string;
  label: string;
  minor: number;
  className: string;
}

/** Stacked bar of where the authorized amount sits: children, held, pending, committed, actual, available. */
@Component({
  selector: 'bf-spectrum',
  imports: [Money],
  template: `
    <div class="bf-spectrum__bar" role="img" [attr.aria-label]="summary()">
      @for (s of segments(); track s.key) {
        @if (s.minor > 0) {
          <span
            class="bf-spectrum__seg"
            [class]="s.className"
            [style.flex-grow]="s.minor"
            [attr.data-segment]="s.key"
          ></span>
        }
      }
    </div>
    <ul class="bf-spectrum__legend">
      @for (s of segments(); track s.key) {
        <li>
          <span class="bf-spectrum__dot" [class]="s.className"></span>
          <span class="bf-spectrum__label">{{ s.label }}</span>
          <bf-money [amountMinor]="s.minor" [currency]="currency()" />
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
    }
    .bf-spectrum__bar {
      display: flex;
      height: 14px;
      overflow: hidden;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-highest);
    }
    .bf-spectrum__seg {
      min-width: 3px;
    }
    .bf-spectrum__legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 20px;
      margin: 12px 0 0;
      padding: 0;
      list-style: none;
      font: var(--mat-sys-body-small);
    }
    .bf-spectrum__legend li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .bf-spectrum__label {
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-spectrum__dot {
      width: 10px;
      height: 10px;
      border-radius: var(--mat-sys-corner-extra-small);
    }
    .children {
      background: var(--mat-sys-primary-container);
    }
    .held {
      background: var(--mat-sys-outline);
    }
    .pending {
      background: var(--mat-sys-secondary);
    }
    .encumbered {
      background: var(--mat-sys-primary);
    }
    .actual {
      background: var(--mat-sys-tertiary);
    }
    .available {
      background: var(--sat-sys-success-icon);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Spectrum {
  readonly budget = input.required<BudgetDetail>();
  protected readonly currency = computed(() => this.budget().currency);
  protected readonly segments = computed((): Segment[] => {
    const b = balancesOf(this.budget());
    return [
      {
        key: 'children',
        label: 'Allocated to children',
        minor: b.allocatedOut,
        className: 'children',
      },
      { key: 'held', label: 'Held', minor: b.held, className: 'held' },
      { key: 'pending', label: 'Pending requests', minor: b.preEncumbered, className: 'pending' },
      { key: 'encumbered', label: 'Encumbered', minor: b.encumbered, className: 'encumbered' },
      { key: 'actual', label: 'Actual', minor: b.actual, className: 'actual' },
      {
        key: 'available',
        label: 'Available',
        minor: Math.max(b.available, 0),
        className: 'available',
      },
    ];
  });
  protected readonly summary = computed(() =>
    this.segments()
      .filter((s) => s.minor > 0)
      .map((s) => s.label)
      .join(', '),
  );
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
