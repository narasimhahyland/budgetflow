import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { BudgetImpact as Impact } from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { formatMoney, Money } from './money';

const pct = (part: number, whole: number) =>
  whole <= 0 ? 0 : Math.max(0, Math.min(100, (part * 100) / whole));

/**
 * The budget-impact card (approval inbox, request details, request form, co-funding decision): what the
 * budget has available under its own rules before and after, the requested amount, the ledger buckets
 * as a bar (actual, approved, pending, this request, earmarks), soft warning versus hard block, run rate,
 * and the company-wide Available with a tooltip explaining the difference.
 */
@Component({
  selector: 'bf-budget-impact',
  imports: [Money, MatIconModule, MatTooltipModule, SAT_BANNER_IMPORTS],
  template: `
    @let i = impact();
    <section class="bf-impact" [attr.aria-label]="title()">
      <header class="bf-impact__header">
        <h3 class="bf-impact__title">{{ title() }}</h3>
        <span class="bf-impact__budget">{{ i.budgetName }}</span>
      </header>
      <div class="bf-impact__figures">
        <div>
          <span class="bf-impact__label">
            Available under this budget's rules
            <mat-icon
              svgIcon="info"
              class="bf-impact__info"
              [matTooltip]="rulesTooltip()"
              aria-label="How available under this budget's rules is worked out"
              tabindex="0"
            />
          </span>
          <bf-money
            class="bf-impact__value"
            [amountMinor]="i.availableBefore.amountMinor"
            [currency]="i.availableBefore.currency"
          />
        </div>
        <div>
          <span class="bf-impact__label">{{ requestLabel() }}</span>
          <bf-money
            class="bf-impact__value bf-impact__value--pending"
            [amountMinor]="-i.thisRequest.amountMinor"
            [currency]="i.thisRequest.currency"
          />
        </div>
        <div>
          <span class="bf-impact__label">Available after approval</span>
          <bf-money
            class="bf-impact__value"
            [class.bf-impact__value--negative]="i.availableAfter.amountMinor < 0"
            [amountMinor]="i.availableAfter.amountMinor"
            [currency]="i.availableAfter.currency"
          />
        </div>
      </div>
      @if (i.blocked) {
        <sat-banner variant="important" class="bf-impact__banner" data-testid="impact-blocked">
          <sat-banner-message>{{ i.blocked }}</sat-banner-message>
        </sat-banner>
      } @else if (i.warning) {
        <sat-banner variant="warning" class="bf-impact__banner" data-testid="impact-warning">
          <sat-banner-message>{{ i.warning }}</sat-banner-message>
        </sat-banner>
      }
      <div class="bf-impact__bar" role="img" [attr.aria-label]="barLabel()">
        <span class="bf-impact__seg bf-impact__seg--actual" [style.width.%]="bars().actual"></span>
        <span
          class="bf-impact__seg bf-impact__seg--encumbered"
          [style.width.%]="bars().encumbered"
        ></span>
        <span class="bf-impact__seg bf-impact__seg--held" [style.width.%]="bars().held"></span>
        <span
          class="bf-impact__seg bf-impact__seg--pending"
          [style.width.%]="bars().pending"
        ></span>
      </div>
      <ul class="bf-impact__legend">
        <li>
          <span class="bf-impact__dot bf-impact__seg--actual"></span>Actual
          <bf-money [amountMinor]="i.actual.amountMinor" [currency]="i.actual.currency" />
        </li>
        <li>
          <span class="bf-impact__dot bf-impact__seg--encumbered"></span>Approved
          <bf-money
            [amountMinor]="i.approvedCommitments.amountMinor"
            [currency]="i.approvedCommitments.currency"
          />
        </li>
        <li>
          <span class="bf-impact__dot bf-impact__seg--held"></span>Earmarked
          <bf-money [amountMinor]="i.held.amountMinor" [currency]="i.held.currency" />
        </li>
        <li>
          <span class="bf-impact__dot bf-impact__seg--pending"></span>Pending
          <bf-money [amountMinor]="i.pending.amountMinor" [currency]="i.pending.currency" />
        </li>
      </ul>
      <dl class="bf-impact__facts">
        <div>
          <dt>
            Company-wide Available
            <mat-icon
              svgIcon="info"
              class="bf-impact__info"
              [matTooltip]="companyTooltip"
              aria-label="About company-wide Available"
              tabindex="0"
            />
          </dt>
          <dd>
            <bf-money
              [amountMinor]="i.companyWideAvailable.amountMinor"
              [currency]="i.companyWideAvailable.currency"
            />
          </dd>
        </div>
        <div>
          <dt>Run rate</dt>
          <dd>
            <bf-money
              [amountMinor]="i.runRateMonthly.amountMinor"
              [currency]="i.runRateMonthly.currency"
            />
            a month
          </dd>
        </div>
        <div>
          <dt>Used after approval</dt>
          <dd>{{ i.utilizationAfterPct }}% of authorized</dd>
        </div>
      </dl>
    </section>
  `,
  styles: `
    .bf-impact {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-impact__header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      align-items: baseline;
    }
    .bf-impact__title {
      margin: 0;
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-on-surface);
    }
    .bf-impact__budget {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-impact__figures {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      padding: 12px;
      background: var(--mat-sys-surface-container-lowest);
    }
    .bf-impact__figures > div {
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-items: center;
      text-align: center;
    }
    .bf-impact__label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-impact__value {
      font: var(--mat-sys-title-medium);
    }
    .bf-impact__value--pending {
      color: var(--sat-sys-warning);
    }
    .bf-impact__value--negative {
      color: var(--mat-sys-error);
    }
    .bf-impact__info {
      width: 16px;
      height: 16px;
      cursor: help;
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-impact__bar {
      display: flex;
      height: 10px;
      border-radius: var(--mat-sys-corner-full);
      overflow: hidden;
      background: var(--mat-sys-surface-container-high);
    }
    .bf-impact__seg {
      display: block;
      height: 100%;
    }
    .bf-impact__seg--actual {
      background: var(--mat-sys-on-surface-variant);
    }
    .bf-impact__seg--encumbered {
      background: var(--mat-sys-primary);
    }
    .bf-impact__seg--held {
      background: var(--mat-sys-tertiary);
    }
    .bf-impact__seg--pending {
      background: var(--sat-sys-warning);
    }
    .bf-impact__legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-impact__legend li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .bf-impact__dot {
      width: 8px;
      height: 8px;
      border-radius: var(--mat-sys-corner-full);
    }
    .bf-impact__facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 8px;
      margin: 0;
    }
    .bf-impact__facts dt {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-impact__facts dd {
      margin: 2px 0 0;
      font: var(--mat-sys-body-medium);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetImpactCard {
  readonly impact = input.required<Impact>();
  readonly title = input('Budget ledger impact');
  readonly requestLabel = input('This request');

  protected readonly companyTooltip =
    'Company-wide Available = authorized − pending − approved − actual (the definition on dashboards). Available under this budget’s rules also deducts earmarks and follows the budget’s control basis.';

  protected readonly rulesTooltip = computed(() => {
    const i = this.impact();
    return `Authorized ${formatMoney(i.authorized.amountMinor, i.authorized.currency)} minus what this budget's ${i.controlMode} control counts: earmarks, pending, approved and actual spend.`;
  });

  protected readonly bars = computed(() => {
    const i = this.impact();
    const a = Math.max(i.authorized.amountMinor, 1);
    const pendingOthers = Math.max(i.pending.amountMinor, i.thisRequest.amountMinor);
    return {
      actual: pct(i.actual.amountMinor, a),
      encumbered: pct(i.approvedCommitments.amountMinor, a),
      held: pct(i.held.amountMinor, a),
      pending: pct(pendingOthers, a),
    };
  });

  protected readonly barLabel = computed(() => {
    const i = this.impact();
    return `${i.utilizationAfterPct}% of ${formatMoney(i.authorized.amountMinor, i.authorized.currency)} used after approval`;
  });
}
