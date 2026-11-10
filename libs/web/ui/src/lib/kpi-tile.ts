import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Money } from './money';

/** How a tile's figure and meter read: the budget-safety tone of the amount it carries. */
export type KpiTone = 'neutral' | 'success' | 'warning' | 'error';

/** A small delta pill under the amount (for example the pacing of Actual against the year). */
export interface KpiDelta {
  text: string;
  tone: KpiTone;
  /** Satori sprite icon name, e.g. `trending_down`; omit for no icon. */
  icon?: string;
}

/**
 * One budget figure as the design system's KPI metric card (section 9): the amount with its
 * currency code and a header icon, then a bordered footer that carries the denominator — a
 * sub-label, the share as a bold toned percentage, and a thin progress bar — so the number is
 * judgeable rather than bare. An optional delta pill carries pacing.
 */
@Component({
  selector: 'bf-kpi-tile',
  imports: [MatIconModule, Money],
  template: `
    <div class="bf-kpi__head">
      <span class="bf-kpi__label">{{ label() }}</span>
      @if (icon()) {
        <mat-icon
          class="bf-kpi__icon"
          [class]="toneClass()"
          [svgIcon]="icon()!"
          aria-hidden="true"
        />
      }
    </div>
    <p class="bf-kpi__amount" [class.bf-kpi__amount--hero]="hero()">
      <bf-money [amountMinor]="amountMinor()" [currency]="currency()" />
    </p>
    @if (delta(); as d) {
      <span class="bf-kpi__delta" [class]="'bf-kpi--' + d.tone">
        @if (d.icon) {
          <mat-icon [svgIcon]="d.icon" aria-hidden="true" />
        }
        {{ d.text }}
      </span>
    }
    @if (shareBps() !== null) {
      <div class="bf-kpi__foot">
        <div class="bf-kpi__foot-row">
          <span class="bf-kpi__sub" [title]="subTitle() || null">{{ shareOfLabel() }}</span>
          <span class="bf-kpi__pct" [class]="toneClass()">{{ shareText() }}</span>
        </div>
        <span
          class="bf-kpi__track"
          role="img"
          [attr.aria-label]="shareText() + ' — ' + shareOfLabel()"
        >
          <span class="bf-kpi__fill" [class]="toneClass()" [style.width.%]="fillPct()"></span>
        </span>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      padding: 20px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-lowest);
    }
    .bf-kpi__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .bf-kpi__label {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .bf-kpi__icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
    }
    .bf-kpi__amount {
      margin: 8px 0 0;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-headline-small);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .bf-kpi__amount--hero {
      color: var(--sat-sys-on-success-container);
    }
    .bf-kpi__delta {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      align-self: flex-start;
      margin-top: 8px;
      padding: 2px 8px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-kpi__delta mat-icon {
      width: 14px;
      height: 14px;
      font-size: 14px;
    }
    .bf-kpi__delta.bf-kpi--warning {
      background: var(--sat-sys-warning-container);
      color: var(--sat-sys-on-warning-container);
    }
    .bf-kpi__delta.bf-kpi--success {
      background: var(--sat-sys-success-container);
      color: var(--sat-sys-on-success-container);
    }
    .bf-kpi__delta.bf-kpi--error {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .bf-kpi__foot {
      /* Push the footer to the card's bottom so every tile's bar aligns across the row. */
      margin-top: auto;
      padding-top: 12px;
      border-top: 1px solid var(--mat-sys-surface-container-high);
    }
    .bf-kpi__foot-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .bf-kpi__sub {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-kpi__pct {
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-label-large);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    /* Tone: text (icon, percent) and the bar fill. */
    .bf-kpi__icon.bf-kpi--neutral {
      color: var(--mat-sys-primary);
    }
    .bf-kpi__icon.bf-kpi--warning,
    .bf-kpi__pct.bf-kpi--warning {
      color: var(--sat-sys-on-warning-container);
    }
    .bf-kpi__icon.bf-kpi--success,
    .bf-kpi__pct.bf-kpi--success {
      color: var(--sat-sys-on-success-container);
    }
    .bf-kpi__icon.bf-kpi--error,
    .bf-kpi__pct.bf-kpi--error {
      color: var(--mat-sys-error);
    }
    .bf-kpi__icon.bf-kpi--tertiary {
      color: var(--mat-sys-tertiary);
    }
    .bf-kpi__track {
      display: block;
      height: 6px;
      overflow: hidden;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-high);
    }
    .bf-kpi__fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--mat-sys-primary);
    }
    .bf-kpi__fill.bf-kpi--warning {
      background: var(--sat-sys-warning-icon);
    }
    .bf-kpi__fill.bf-kpi--success {
      background: var(--sat-sys-success-icon);
    }
    .bf-kpi__fill.bf-kpi--error {
      background: var(--mat-sys-error);
    }
    .bf-kpi__fill.bf-kpi--tertiary {
      background: var(--mat-sys-tertiary);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiTile {
  readonly label = input.required<string>();
  readonly amountMinor = input.required<number>();
  readonly currency = input.required<string>();
  /** Satori sprite icon in the header; omit for none. */
  readonly icon = input<string>();
  /** Share of the whole in basis points, or null for a figure with no denominator. */
  readonly shareBps = input<number | null>(null);
  /** What the share is a share of, e.g. "Encumbered + pre-encumbered + held". */
  readonly shareOfLabel = input('of authorized');
  /** Longer explanation, shown as the sub-label's tooltip. */
  readonly subTitle = input<string | null>(null);
  /** The amount's budget-safety tone (also the icon, percent and bar). */
  readonly tone = input<KpiTone | 'tertiary'>('neutral');
  /** Draws the amount in the success colour (the Available hero card). */
  readonly hero = input(false);
  readonly delta = input<KpiDelta | null>(null);

  protected readonly toneClass = computed(() => `bf-kpi--${this.tone()}`);
  protected readonly fillPct = computed(() =>
    Math.max(0, Math.min((this.shareBps() ?? 0) / 100, 100)),
  );
  protected readonly shareText = computed(() => {
    const bps = this.shareBps();
    if (bps === null) return '';
    // One decimal below 10% so a small but non-zero share does not read as 0%.
    const pct = bps / 100;
    return `${pct > 0 && pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  });
}
