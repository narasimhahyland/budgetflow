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
import { Router, RouterLink } from '@angular/router';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { approverList, POLICY_SECTIONS, type PolicySectionKey } from './labels';
import { LoadState } from './load-state';
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

/** Screens 071-076: the policy settings behind the generated rules, one section at a time. */
@Component({
  selector: 'bf-policies-page',
  imports: [
    DecimalPipe,
    LoadState,
    MatButtonModule,
    Money,
    RouterLink,
    RuleEffectTag,
    RulesTabs,
    SAT_BANNER_IMPORTS,
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
          [active]="s.key === section()"
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
      (retry)="view.reload()"
    />
    @if (valueOf(view); as v) {
      @switch (section()) {
        @case ('limits') {
          <section class="bf-card" aria-labelledby="limits-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="limits-title">Spending limits</h2>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="Spending limits">
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
                      <td>{{ l.appliesTo }}</td>
                      <td>{{ measure(l.measure) }}</td>
                      <td>{{ l.location }}</td>
                      <td class="bf-num">
                        <bf-money [amountMinor]="l.amountUsdMinor" currency="USD" />
                        @if (l.referenceLocal) {
                          <span class="bf-cell__secondary">
                            <bf-money
                              [amountMinor]="l.referenceLocal.amountMinor"
                              [currency]="l.referenceLocal.currency"
                            />
                          </span>
                        }
                      </td>
                      <td><bf-rule-effect [effect]="l.outcome" /></td>
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
                <dt>Limit a year</dt>
                <dd>
                  <bf-money
                    [amountMinor]="v.spendingLimits.employeeCap.annualCapUsdMinor"
                    currency="USD"
                  />
                </dd>
                <dt>Counts towards it</dt>
                <dd>{{ v.spendingLimits.employeeCap.includedCategories.join(', ') }}</dd>
                <dt>Warn at</dt>
                <dd>{{ v.spendingLimits.employeeCap.warnAtPct }}%</dd>
                <dt>Block at</dt>
                <dd>{{ v.spendingLimits.employeeCap.blockAtPct }}%</dd>
              </dl>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="People closest to the yearly limit">
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
                      <td>{{ p.location }}</td>
                      <td class="bf-num">
                        <bf-money [amountMinor]="p.usedMinor" currency="USD" />
                      </td>
                      <td class="bf-num">
                        <bf-money [amountMinor]="p.leftMinor" currency="USD" />
                      </td>
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
              <table class="bf-split-table" aria-label="Category policy">
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
                      <td>
                        <sat-status-tag [status]="categoryTone(c.status)">{{
                          categoryLabel(c.status)
                        }}</sat-status-tag>
                      </td>
                      <td>{{ c.requesterGroups.join(', ') || 'Nobody' }}</td>
                      <td class="bf-num">
                        <bf-money [amountMinor]="c.receiptAboveUsdMinor" currency="USD" />
                      </td>
                      <td>
                        {{ c.employeeGlCode }}
                        <span class="bf-cell__secondary">clients {{ c.clientGlCode }}</span>
                      </td>
                      <td>{{ c.generatedRuleCodes.join(', ') }}</td>
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
                <dt>Gift cap per recipient</dt>
                <dd>
                  <bf-money
                    [amountMinor]="v.giftsEntertainment.giftCapPerRecipientMinor"
                    currency="USD"
                  />
                </dd>
                <dt>Gift cap a year</dt>
                <dd>
                  <bf-money
                    [amountMinor]="v.giftsEntertainment.giftAnnualCapMinor"
                    currency="USD"
                  />
                </dd>
                <dt>Cash and gift cards</dt>
                <dd>
                  {{ v.giftsEntertainment.blockCashEquivalents ? 'Never allowed' : 'Allowed' }}
                </dd>
                <dt>Over the gift cap</dt>
                <dd><bf-rule-effect [effect]="v.giftsEntertainment.giftsOutcomeAboveCap" /></dd>
                <dt>Client entertainment per attendee</dt>
                <dd>
                  <bf-money
                    [amountMinor]="v.giftsEntertainment.entertainmentCapPerAttendeeMinor"
                    currency="USD"
                  />
                </dd>
                <dt>Alcohol</dt>
                <dd>
                  {{
                    v.giftsEntertainment.alcoholAllowedAtApprovedEvents
                      ? 'Only at approved events'
                      : 'Not allowed'
                  }}
                </dd>
                <dt>Alcohol cap per attendee</dt>
                <dd>
                  <bf-money
                    [amountMinor]="v.giftsEntertainment.alcoholCapPerAttendeeMinor"
                    currency="USD"
                  />
                </dd>
              </dl>
            </div>
            @if (v.giftsEntertainment.locationOverrides.length) {
              <div class="bf-table-scroll">
                <table class="bf-split-table" aria-label="Gift cap by location">
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
                        <td class="bf-num">
                          <bf-money
                            [amountMinor]="o.localAmount.amountMinor"
                            [currency]="o.localAmount.currency"
                          />
                        </td>
                        <td class="bf-num">
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
              <table class="bf-split-table" aria-label="Location policy">
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
                        @if (l.overriddenFields.length) {
                          <span class="bf-cell__secondary"
                            >{{ l.overriddenFields.length }} setting(s) differ from the company
                            default</span
                          >
                        }
                      </td>
                      <td>
                        {{ l.localCurrency }}
                        <span class="bf-cell__secondary">plan rate {{ l.planRateToUsd }}</span>
                      </td>
                      <td class="bf-num">
                        <bf-money [amountMinor]="l.teamEventsPerPersonUsdMinor" currency="USD" />
                      </td>
                      <td class="bf-num">
                        <bf-money [amountMinor]="l.teamMealsPerPersonUsdMinor" currency="USD" />
                        <span class="bf-cell__secondary">
                          <bf-money
                            [amountMinor]="l.teamMealsLocalMinor"
                            [currency]="l.localCurrency"
                          />
                        </span>
                      </td>
                      <td>
                        {{
                          l.alcoholPolicy === 'approved_events'
                            ? 'At approved events'
                            : 'Not allowed'
                        }}
                      </td>
                      <td class="bf-num">
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
                <table class="bf-split-table" aria-label="Vendor controls">
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
                        <td>{{ vendor.status }}</td>
                        <td>{{ vendor.reason ?? '—' }}</td>
                        <td class="bf-num">{{ vendor.requests90d | number }}</td>
                        <td class="bf-num">{{ vendor.openCommitmentsCount | number }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <div class="bf-card__body">
                <p>
                  No vendor is preferred or blocked yet. Vendors are managed in
                  <a routerLink="/admin/vendors">master data</a>; blocking one there stops new
                  requests from using it.
                </p>
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
                <dt>Strict budgets</dt>
                <dd>
                  Nothing over what is left ({{ v.overBudget.hardModeToleranceBps }} tolerance).
                </dd>
                <dt>Flexible budgets</dt>
                <dd>
                  Up to {{ v.overBudget.softModeTolerancePct }}% over, capped at
                  <bf-money [amountMinor]="v.overBudget.softModeCapUsdMinor" currency="USD" />.
                </dd>
                <dt>Parent owner can approve up to</dt>
                <dd>
                  <bf-money
                    [amountMinor]="v.overBudget.parentOwnerApprovesUpToUsdMinor"
                    currency="USD"
                  />
                </dd>
                <dt>Above that</dt>
                <dd>
                  {{
                    v.overBudget.financeControllerAbove
                      ? 'The Finance Controller decides.'
                      : 'The parent owner decides.'
                  }}
                </dd>
                <dt>Before going over</dt>
                <dd>
                  {{
                    v.overBudget.offerContributionFirst
                      ? 'The requester is offered an Inter-Director Budget Contribution Request first.'
                      : 'The request goes straight to the over-budget approval.'
                  }}
                </dd>
                <dt>Reason needed</dt>
                <dd>{{ v.overBudget.justificationRequired ? 'Yes' : 'No' }}</dd>
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
            <div class="bf-card__body">
              <dl class="bf-facts">
                <dt>Who can freeze</dt>
                <dd>{{ approverList(v.freezeZero.freezeAllowedRoles) }}</dd>
                <dt>Requests already in flight when frozen</dt>
                <dd>They wait until the freeze is lifted.</dd>
                <dt>Who can reduce</dt>
                <dd>{{ approverList(v.freezeZero.reduceAllowedRoles) }}</dd>
                <dt>Money released goes to</dt>
                <dd>{{ v.freezeZero.reduceDestinations.join(', ') }}</dd>
                <dt>Who can set to zero</dt>
                <dd>{{ approverList(v.freezeZero.zeroAllowedRoles) }}</dd>
                <dt>Requests already in flight when set to zero</dt>
                <dd>They are cancelled.</dd>
                <dt>Freeze automatically when an owner leaves</dt>
                <dd>{{ v.freezeZero.autoFreezeOnOwnerDeparture ? 'Yes' : 'No' }}</dd>
                <dt>Tell the parent owner at 90% used</dt>
                <dd>{{ v.freezeZero.notifyParentAt90Pct ? 'Yes' : 'No' }}</dd>
                <dt>Strict budgets today</dt>
                <dd>{{ v.freezeZero.hardModeBudgetCount | number }}</dd>
              </dl>
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
              <table class="bf-split-table" aria-label="Response times">
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
                      <td class="bf-num">{{ s.slaBusinessDays }}</td>
                      <td>
                        {{ s.remindAt50Pct ? 'Halfway' : '' }}
                        {{ s.remind1HourBeforeDue ? 'and an hour before it is due' : '' }}
                      </td>
                      <td>{{ escalation(s.escalateTo) }}</td>
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
              <table class="bf-split-table" aria-label="Notifications">
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
                      <td>{{ e.audiences.join(', ') }}</td>
                      <td>{{ e.inApp ? 'Yes' : 'No' }}</td>
                      <td>{{ e.email ? 'Yes' : 'No' }}</td>
                      <td>{{ e.required ? 'No' : 'Yes' }}</td>
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
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoliciesPage {
  /** Bound from the `:section` route parameter. */
  readonly section = input<PolicySectionKey>('limits');

  private readonly api = injectApi();
  private readonly router = inject(Router);
  protected readonly valueOf = valueOf;
  protected readonly approverList = approverList;
  protected readonly sections = POLICY_SECTIONS;
  protected readonly view = resource({ loader: () => data(this.api.getPolicyConfigs({})) });
  protected readonly intro = computed(() => SECTION_INTROS[this.section()] ?? '');

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

  protected categoryTone(status: string): 'success' | 'warning' | 'important' {
    return status === 'allowed' ? 'success' : status === 'not_allowed' ? 'important' : 'warning';
  }

  protected categoryLabel(status: string): string {
    return (
      {
        allowed: 'Allowed',
        allowed_with_approval: 'With approval',
        not_allowed: 'Not allowed',
      }[status] ?? status
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

  protected escalation(target: string): string {
    return (
      {
        next_doa_authority: 'The next approval authority',
        finance_controller: 'The Finance Controller',
        ceo: 'The CEO',
      }[target] ?? target
    );
  }
}
