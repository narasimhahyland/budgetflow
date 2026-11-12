import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { BudgetStatus, LoadState, Money, type StatusView } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import {
  approverList,
  codeList,
  POLICY_SECTIONS,
  sentenceCase,
  type PolicySectionKey,
} from './labels';
import { RuleEffectTag } from './rule-tags';
import { RulesTabs } from './rules-tabs';

const SECTION_INTROS: Record<PolicySectionKey, string> = {
  limits:
    'How much can be spent per person, per event and per year. Limits are held in USD and shown next to the local amount people actually see.',
  categories:
    'What can be bought, who can ask for it, when a receipt is needed and which GL account it lands on.',
  gifts:
    'Caps for gifts, client entertainment and alcohol. Cash and gift cards count as pay and are never allowed.',
  locations:
    'Per-person limits and receipt rules by office. A location setting overrides the company default for that office only.',
  vendors:
    'Preferred, approved and blocked vendors. Blocking a vendor stops new requests but lets commitments already made finish.',
  'over-budget':
    'What happens when a request would go past what is left: how much tolerance is allowed and who has to approve it.',
  freeze:
    'Who can freeze a budget, reduce it or set it to zero, and what happens to requests that are already in flight.',
  sla: 'How long each approval step has, when reminders go out and who is told about what.',
};

/** Not allowed is a hard block (as a block rule); with approval waits for someone (as an approval). */
const CATEGORY_LOOKS: Record<string, StatusView> = {
  allowed: { label: 'Allowed', tone: 'success', icon: 'circle_check' },
  allowed_with_approval: { label: 'With approval', tone: 'warning', icon: 'clock' },
  not_allowed: { label: 'Not allowed', tone: 'important-loud', icon: 'block' },
};

/** Screens 071-076: the policy settings behind the generated rules, one section at a time. */
@Component({
  selector: 'bf-policies-page',
  imports: [
    BudgetStatus,
    DecimalPipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    Money,
    RouterLink,
    RuleEffectTag,
    RulesTabs,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Policy settings</h1>
        <p class="bf-page__subtitle">{{ intro() }}</p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/admin/rules/thresholds">Approval thresholds</a>
      </div>
    </header>
    <bf-rules-tabs current="policies" />
    <sat-navigation-tabs class="bf-tabs" aria-label="Policy sections">
      @for (s of sections; track s.key) {
        <a
          satNavigationTab
          [active]="s.key === policySection()"
          (click)="go(s.key)"
          (keydown.enter)="go(s.key)"
          tabindex="0"
          >{{ s.label }}</a
        >
      }
    </sat-navigation-tabs>
    <bf-load-state
      [loading]="view.isLoading() && !view.hasValue()"
      [error]="view.error()"
      what="policy settings"
      shape="table"
      (retry)="view.reload()"
    />
    @if (valueOf(view); as v) {
      @switch (policySection()) {
        @case ('limits') {
          <section class="bf-card" aria-labelledby="limits-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="limits-title">Spending limits</h2>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table bf-table--stack" aria-label="Spending limits">
                <thead>
                  <tr>
                    <th scope="col">Limit</th>
                    <th scope="col">Applies to</th>
                    <th scope="col">Measured</th>
                    <th scope="col">Location</th>
                    <th scope="col" class="bf-num">Amount</th>
                    <th scope="col">Over the limit</th>
                  </tr>
                </thead>
                <tbody>
                  @for (l of v.spendingLimits.items; track l.id) {
                    <tr>
                      <td class="bf-cell__primary">{{ l.name }}</td>
                      <td data-label="Applies to">{{ sentenceCase(l.appliesTo) }}</td>
                      <td data-label="Measured">{{ measure(l.measure) }}</td>
                      <td data-label="Location">{{ l.location }}</td>
                      <td class="bf-num" data-label="Amount">
                        <bf-money [amountMinor]="l.amountUsdMinor" currency="USD" />
                        @if (l.referenceLocal && l.referenceLocal.currency !== 'USD') {
                          <span class="bf-cell__secondary">
                            <bf-money
                              [amountMinor]="l.referenceLocal.amountMinor"
                              [currency]="l.referenceLocal.currency"
                            />
                            for reference
                          </span>
                        }
                      </td>
                      <td data-label="Over the limit"><bf-rule-effect [effect]="l.outcome" /></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
          <section class="bf-card" aria-labelledby="cap-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="cap-title">Yearly limit per employee</h2>
            </div>
            <div class="bf-card__body">
              <dl class="bf-facts">
                <div>
                  <dt>Limit a year</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="v.spendingLimits.employeeCap.annualCapUsdMinor"
                      currency="USD"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Counts towards it</dt>
                  <dd>{{ codeList(v.spendingLimits.employeeCap.includedCategories) }}</dd>
                </div>
                <div>
                  <dt>Warn at</dt>
                  <dd>{{ v.spendingLimits.employeeCap.warnAtPct }}%</dd>
                </div>
                <div>
                  <dt>Block at</dt>
                  <dd>{{ v.spendingLimits.employeeCap.blockAtPct }}%</dd>
                </div>
              </dl>
            </div>
            <div class="bf-table-scroll">
              <table
                class="bf-split-table bf-table--stack"
                aria-label="People closest to the yearly limit"
              >
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Location</th>
                    <th scope="col" class="bf-num">Used</th>
                    <th scope="col" class="bf-num">Left</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of v.spendingLimits.employeeCap.employeesNearestCap; track p.personId) {
                    <tr>
                      <td>{{ p.displayName }}</td>
                      <td data-label="Location">{{ p.location }}</td>
                      <td class="bf-num" data-label="Used">
                        <bf-money [amountMinor]="p.usedMinor" currency="USD" />
                      </td>
                      <td class="bf-num" data-label="Left">
                        <bf-money [amountMinor]="p.leftMinor" currency="USD" />
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="4">No one has used any of their yearly limit this year.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
        @case ('categories') {
          <section class="bf-card" aria-labelledby="cat-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="cat-title">What can be bought</h2>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table bf-table--stack" aria-label="Category policy">
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Allowed</th>
                    <th scope="col">Who can ask</th>
                    <th scope="col" class="bf-num">Receipt above</th>
                    <th scope="col">GL account</th>
                    <th scope="col">Rules</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of v.categories; track c.categoryCode) {
                    <tr>
                      <td>
                        <span class="bf-cell__primary">{{ c.categoryName }}</span>
                        <span class="bf-cell__secondary">{{ c.explanation }}</span>
                      </td>
                      <td class="bf-nowrap" data-label="Allowed">
                        @let look = categoryLook(c.status);
                        <sat-status-tag [status]="look.tone"
                          ><mat-icon [svgIcon]="look.icon" aria-hidden="true" />{{
                            look.label
                          }}</sat-status-tag
                        >
                      </td>
                      <td data-label="Who can ask">{{ codeList(c.requesterGroups) }}</td>
                      <td class="bf-num" data-label="Receipt above">
                        <bf-money [amountMinor]="c.receiptAboveUsdMinor" currency="USD" />
                      </td>
                      <td class="bf-nowrap" data-label="GL account">
                        <span class="bf-cell__code">{{ c.employeeGlCode }}</span>
                        <span class="bf-cell__secondary"
                          >Clients <span class="bf-cell__code">{{ c.clientGlCode }}</span></span
                        >
                      </td>
                      <td data-label="Rules">
                        <span class="bf-codes">
                          @for (code of c.generatedRuleCodes; track code) {
                            <span class="bf-cell__code">{{ code }}</span>
                          }
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
        @case ('gifts') {
          <section class="bf-card" aria-labelledby="gifts-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="gifts-title">Gifts, entertainment and alcohol</h2>
              <p class="bf-card__hint">
                Generates {{ v.giftsEntertainment.generatedRuleCodes.join(', ') }}.
              </p>
            </div>
            <div class="bf-card__body">
              <dl class="bf-facts">
                <div>
                  <dt>Gift cap per recipient</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="v.giftsEntertainment.giftCapPerRecipientMinor"
                      currency="USD"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Gift cap a year</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="v.giftsEntertainment.giftAnnualCapMinor"
                      currency="USD"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Cash and gift cards</dt>
                  <dd>
                    {{ v.giftsEntertainment.blockCashEquivalents ? 'Never allowed' : 'Allowed' }}
                  </dd>
                </div>
                <div>
                  <dt>Over the gift cap</dt>
                  <dd><bf-rule-effect [effect]="v.giftsEntertainment.giftsOutcomeAboveCap" /></dd>
                </div>
                <div>
                  <dt>Client entertainment per attendee</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="v.giftsEntertainment.entertainmentCapPerAttendeeMinor"
                      currency="USD"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Alcohol</dt>
                  <dd>
                    {{
                      v.giftsEntertainment.alcoholAllowedAtApprovedEvents
                        ? 'Only at approved events'
                        : 'Not allowed'
                    }}
                  </dd>
                </div>
                <div>
                  <dt>Alcohol cap per attendee</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="v.giftsEntertainment.alcoholCapPerAttendeeMinor"
                      currency="USD"
                    />
                  </dd>
                </div>
              </dl>
            </div>
            @if (v.giftsEntertainment.locationOverrides.length) {
              <div class="bf-table-scroll">
                <table class="bf-split-table bf-table--stack" aria-label="Gift cap by location">
                  <thead>
                    <tr>
                      <th scope="col">Location</th>
                      <th scope="col" class="bf-num">Local cap</th>
                      <th scope="col" class="bf-num">In USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (o of v.giftsEntertainment.locationOverrides; track o.location) {
                      <tr>
                        <td>{{ o.location }}</td>
                        <td class="bf-num" data-label="Local cap">
                          <bf-money
                            [amountMinor]="o.localAmount.amountMinor"
                            [currency]="o.localAmount.currency"
                          />
                        </td>
                        <td class="bf-num" data-label="In USD">
                          <bf-money [amountMinor]="o.usdEquivalentMinor" currency="USD" />
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }
        @case ('locations') {
          <section class="bf-card" aria-labelledby="loc-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="loc-title">Location settings</h2>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table bf-table--stack" aria-label="Location policy">
                <thead>
                  <tr>
                    <th scope="col">Office</th>
                    <th scope="col">Currency</th>
                    <th scope="col" class="bf-num">Events per person</th>
                    <th scope="col" class="bf-num">Meals per person</th>
                    <th scope="col">Alcohol</th>
                    <th scope="col" class="bf-num">Receipt above</th>
                  </tr>
                </thead>
                <tbody>
                  @for (l of v.locations; track l.orgUnitId) {
                    <tr>
                      <td>
                        <span class="bf-cell__primary">{{ l.locationName }}</span>
                        @if (l.overriddenFields.length; as n) {
                          <span class="bf-cell__secondary"
                            >{{ n }} {{ n === 1 ? 'setting differs' : 'settings differ' }} from the
                            company default</span
                          >
                        }
                      </td>
                      <td data-label="Currency">
                        {{ l.localCurrency }}
                        <span class="bf-cell__secondary">plan rate {{ l.planRateToUsd }}</span>
                      </td>
                      <td class="bf-num" data-label="Events per person">
                        <bf-money [amountMinor]="l.teamEventsPerPersonUsdMinor" currency="USD" />
                      </td>
                      <td class="bf-num" data-label="Meals per person">
                        <bf-money [amountMinor]="l.teamMealsPerPersonUsdMinor" currency="USD" />
                        @if (l.localCurrency !== 'USD') {
                          <span class="bf-cell__secondary">
                            <bf-money
                              [amountMinor]="l.teamMealsLocalMinor"
                              [currency]="l.localCurrency"
                            />
                            for reference
                          </span>
                        }
                      </td>
                      <td data-label="Alcohol">
                        {{
                          l.alcoholPolicy === 'approved_events'
                            ? 'At approved events'
                            : 'Not allowed'
                        }}
                      </td>
                      <td class="bf-num" data-label="Receipt above">
                        <bf-money [amountMinor]="l.receiptAboveUsdMinor" currency="USD" />
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
        @case ('vendors') {
          <section class="bf-card" aria-labelledby="vendor-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="vendor-title">Vendors</h2>
              <p class="bf-card__hint">
                A vendor nobody has used before: {{ unknownVendor(v.vendors.unknownVendorPolicy) }}
              </p>
            </div>
            @if (v.vendors.items.length) {
              <div class="bf-table-scroll">
                <table class="bf-split-table bf-table--stack" aria-label="Vendor controls">
                  <thead>
                    <tr>
                      <th scope="col">Vendor</th>
                      <th scope="col">State</th>
                      <th scope="col">Why</th>
                      <th scope="col" class="bf-num">Requests (90 days)</th>
                      <th scope="col" class="bf-num">Open commitments</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (vendor of v.vendors.items; track vendor.vendorId) {
                      <tr>
                        <td class="bf-cell__primary">{{ vendor.vendorName }}</td>
                        <td class="bf-nowrap" data-label="State">
                          {{ sentenceCase(vendor.status) }}
                        </td>
                        <td data-label="Why">{{ vendor.reason ?? '—' }}</td>
                        <td class="bf-num" data-label="Requests (90 days)">
                          {{ vendor.requests90d | number }}
                        </td>
                        <td class="bf-num" data-label="Open commitments">
                          {{ vendor.openCommitmentsCount | number }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <div class="bf-card__body">
                <sat-empty-state>
                  <h3 satEmptyStateHeadline>No vendor is preferred or blocked</h3>
                  <p satEmptyStateDescription>
                    Vendors are managed in master data. Marking one blocked there stops new requests
                    from using it, while commitments already made still finish.
                  </p>
                  <a mat-stroked-button satEmptyStateAction routerLink="/admin/vendors"
                    >Open vendor master data</a
                  >
                </sat-empty-state>
              </div>
            }
          </section>
        }
        @case ('over-budget') {
          <section class="bf-card" aria-labelledby="ob-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="ob-title">Going over budget</h2>
              <p class="bf-card__hint">Generates rule {{ v.overBudget.ruleCode }}.</p>
            </div>
            <div class="bf-card__body">
              <dl class="bf-facts">
                <div>
                  <dt>Strict budgets</dt>
                  <dd class="bf-policy-mode">
                    <sat-status-tag status="important-loud"
                      ><mat-icon svgIcon="block" aria-hidden="true" />Hard block</sat-status-tag
                    >
                    <span
                      >Nothing over what is left ({{
                        v.overBudget.hardModeToleranceBps / 100 | number: '1.0-2'
                      }}% tolerance).</span
                    >
                  </dd>
                </div>
                <div>
                  <dt>Flexible budgets</dt>
                  <dd class="bf-policy-mode">
                    <sat-status-tag status="warning"
                      ><mat-icon svgIcon="critical" aria-hidden="true" />Soft
                      warning</sat-status-tag
                    >
                    <span
                      >Up to {{ v.overBudget.softModeTolerancePct }}% over, capped at
                      <bf-money
                        [amountMinor]="v.overBudget.softModeCapUsdMinor"
                        currency="USD"
                      />.</span
                    >
                  </dd>
                </div>
                <div>
                  <dt>Parent owner can approve up to</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="v.overBudget.parentOwnerApprovesUpToUsdMinor"
                      currency="USD"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Above that</dt>
                  <dd>
                    {{
                      v.overBudget.financeControllerAbove
                        ? 'The Finance Controller decides.'
                        : 'The parent owner decides.'
                    }}
                  </dd>
                </div>
                <div>
                  <dt>Before going over</dt>
                  <dd>
                    {{
                      v.overBudget.offerContributionFirst
                        ? 'The requester is offered an Inter-Director Budget Contribution Request first.'
                        : 'The request goes straight to the over-budget approval.'
                    }}
                  </dd>
                </div>
                <div>
                  <dt>Reason needed</dt>
                  <dd>{{ v.overBudget.justificationRequired ? 'Yes' : 'No' }}</dd>
                </div>
              </dl>
            </div>
          </section>
        }
        @case ('freeze') {
          <section class="bf-card" aria-labelledby="freeze-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="freeze-title">Freeze, reduce and set to zero</h2>
              <p class="bf-card__hint">
                Generates {{ v.freezeZero.generatedRuleCodes.join(', ') }}.
              </p>
            </div>
            <div class="bf-card__body bf-policy-groups">
              <section class="bf-policy-group" aria-label="Freeze">
                <h3 class="bf-section__title"><bf-budget-status status="frozen" /></h3>
                <dl class="bf-facts">
                  <div>
                    <dt>Who can freeze</dt>
                    <dd>{{ approverList(v.freezeZero.freezeAllowedRoles) }}</dd>
                  </div>
                  <div>
                    <dt>Requests already in flight when frozen</dt>
                    <dd>They wait until the freeze is lifted.</dd>
                  </div>
                  <div>
                    <dt>Freeze automatically when an owner leaves</dt>
                    <dd>{{ v.freezeZero.autoFreezeOnOwnerDeparture ? 'Yes' : 'No' }}</dd>
                  </div>
                </dl>
              </section>
              <section class="bf-policy-group" aria-label="Reduce">
                <h3 class="bf-section__title"><bf-budget-status status="reduced" /></h3>
                <dl class="bf-facts">
                  <div>
                    <dt>Who can reduce</dt>
                    <dd>{{ approverList(v.freezeZero.reduceAllowedRoles) }}</dd>
                  </div>
                  <div>
                    <dt>Money released goes to</dt>
                    <dd>{{ codeList(v.freezeZero.reduceDestinations) }}</dd>
                  </div>
                </dl>
              </section>
              <section class="bf-policy-group" aria-label="Set to zero">
                <h3 class="bf-section__title"><bf-budget-status status="set_to_zero" /></h3>
                <dl class="bf-facts">
                  <div>
                    <dt>Who can set to zero</dt>
                    <dd>{{ approverList(v.freezeZero.zeroAllowedRoles) }}</dd>
                  </div>
                  <div>
                    <dt>Requests already in flight when set to zero</dt>
                    <dd>They are cancelled.</dd>
                  </div>
                </dl>
              </section>
              <section class="bf-policy-group" aria-label="Alerts">
                <dl class="bf-facts">
                  <div>
                    <dt>Tell the parent owner at 90% used</dt>
                    <dd>{{ v.freezeZero.notifyParentAt90Pct ? 'Yes' : 'No' }}</dd>
                  </div>
                  <div>
                    <dt>Strict budgets today</dt>
                    <dd>{{ v.freezeZero.hardModeBudgetCount | number }}</dd>
                  </div>
                </dl>
              </section>
            </div>
          </section>
        }
        @case ('sla') {
          <section class="bf-card" aria-labelledby="sla-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="sla-title">How long each step has</h2>
              <p class="bf-card__hint">
                A step that passes its time is escalated to the next authority. The original
                approver can still decide until someone else does.
              </p>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table bf-table--stack" aria-label="Response times">
                <thead>
                  <tr>
                    <th scope="col">Step</th>
                    <th scope="col" class="bf-num">Working days</th>
                    <th scope="col">Reminders</th>
                    <th scope="col">Escalates to</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of v.slaNotifications.steps; track s.stepType) {
                    <tr>
                      <td>{{ s.label }}</td>
                      <td class="bf-num" data-label="Working days">{{ s.slaBusinessDays }}</td>
                      <td data-label="Reminders">
                        {{ s.remindAt50Pct ? 'Halfway' : '' }}
                        {{ s.remind1HourBeforeDue ? 'and an hour before it is due' : '' }}
                      </td>
                      <td data-label="Escalates to">{{ escalation(s.stepType, s.escalateTo) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
          <section class="bf-card" aria-labelledby="notify-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="notify-title">Who is told about what</h2>
              <p class="bf-card__hint">
                Quiet hours {{ v.slaNotifications.quietHoursStart }} to
                {{ v.slaNotifications.quietHoursEnd }}. Daily summary for approvers at
                {{ v.slaNotifications.dailyDigestTimeLocal }}.
              </p>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table bf-table--stack" aria-label="Notifications">
                <thead>
                  <tr>
                    <th scope="col">What happened</th>
                    <th scope="col">Who is told</th>
                    <th scope="col">In the app</th>
                    <th scope="col">By email</th>
                    <th scope="col">Can be turned off</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of v.slaNotifications.events; track e.eventKey) {
                    <tr>
                      <td>{{ e.label }}</td>
                      <td data-label="Who is told">{{ codeList(e.audiences) }}</td>
                      <td class="bf-yesno" data-label="In the app">
                        @if (e.inApp) {
                          <mat-icon svgIcon="check" aria-hidden="true" />Yes
                        } @else {
                          <mat-icon svgIcon="circle_minus" aria-hidden="true" />No
                        }
                      </td>
                      <td class="bf-yesno" data-label="By email">
                        @if (e.email) {
                          <mat-icon svgIcon="check" aria-hidden="true" />Yes
                        } @else {
                          <mat-icon svgIcon="circle_minus" aria-hidden="true" />No
                        }
                      </td>
                      <td class="bf-yesno" data-label="Can be turned off">
                        @if (!e.required) {
                          <mat-icon svgIcon="check" aria-hidden="true" />Yes
                        } @else {
                          <mat-icon svgIcon="circle_minus" aria-hidden="true" />No
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
      }
    }
  `,
  styles: `
    .bf-nowrap,
    .bf-codes {
      white-space: nowrap;
    }
    .bf-codes {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    /* The tag on its own line, then the sentence as plain inline text. */
    .bf-policy-mode {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
    .bf-policy-groups {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .bf-policy-group .bf-facts {
      padding-inline: 0;
    }
    .bf-yesno {
      white-space: nowrap;
    }
    .bf-yesno mat-icon {
      width: 18px;
      height: 18px;
      margin-inline-end: 4px;
      vertical-align: -4px;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoliciesPage {
  /**
   * Bound from the `:policySection` route parameter. Not named `section`: the shell puts a
   * `section` key in every route's `data` for the breadcrumb, and component input binding would
   * bind that instead of the parameter.
   */
  readonly policySection = input<PolicySectionKey>('limits');

  private readonly api = injectApi();
  private readonly router = inject(Router);
  protected readonly valueOf = valueOf;
  protected readonly approverList = approverList;
  protected readonly codeList = codeList;
  protected readonly sentenceCase = sentenceCase;
  protected readonly sections = POLICY_SECTIONS;
  protected readonly view = resource({ loader: () => data(this.api.getPolicyConfigs({})) });
  protected readonly intro = computed(() => SECTION_INTROS[this.policySection()] ?? '');

  protected go(key: PolicySectionKey): void {
    void this.router.navigate(['/admin/rules/policies', key]);
  }

  protected measure(m: string): string {
    return (
      {
        per_request: 'Each request',
        per_person_event: 'Each person at an event',
        per_event: 'Each event',
        per_period: 'Each period',
      }[m] ?? m
    );
  }

  protected categoryLook(status: string): StatusView {
    return (
      CATEGORY_LOOKS[status] ?? {
        label: sentenceCase(status),
        tone: 'neutral',
        icon: 'circle_minus',
      }
    );
  }

  protected unknownVendor(policy: string): string {
    return (
      {
        allow: 'is allowed without extra checks.',
        warn_quote: 'triggers a warning and a quote is asked for.',
        require_fc: 'needs the Finance Controller to approve.',
        block: 'is blocked until the vendor is approved.',
      }[policy] ?? policy
    );
  }

  protected escalation(stepType: string, target: string): string {
    // The last step has nobody above it, so it waits rather than escalating to itself.
    if (stepType === target) return 'Nobody above this step; it stays here';
    return (
      {
        next_doa_authority: 'The next approval authority',
        finance_controller: 'The Finance Controller',
        ceo: 'The CEO',
      }[target] ?? target
    );
  }
}
