import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, Money, SpendStatus } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/** Screen 115 (with 116 available budgets and 120 approved allocations): what I can still request, my requests, tasks and events. */
@Component({
  selector: 'bf-employee-dashboard-page',
  imports: [
    DateOnlyPipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
    SpendStatus,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Hello, {{ session.firstName() }}</h1>
        <p class="bf-page__subtitle">What you can request, and where your requests are</p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/requests"><mat-icon svgIcon="upload" />Upload receipt</a>
        <a mat-flat-button routerLink="/requests/new"
          ><mat-icon svgIcon="circle_add" />Request funds</a
        >
      </div>
    </header>

    <section aria-labelledby="budgets-title">
      <h2 class="bf-card__title" id="budgets-title">Budgets you can use</h2>
      <bf-load-state
        [loading]="budgets.isLoading() && !budgets.hasValue()"
        [error]="budgets.error()"
        what="your budgets"
        (retry)="budgets.reload()"
      />
      @if (budgets.hasValue()) {
        @if ((valueOf(budgets)?.items ?? []).length === 0) {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>No budgets available to you yet</h3>
            <p satEmptyStateDescription>
              Your location or team budget appears here once it is set up.
            </p>
          </sat-empty-state>
        } @else {
          <div class="bf-employee__cards">
            @for (b of valueOf(budgets)?.items ?? []; track b.budgetId) {
              <article class="bf-kpi" [attr.aria-label]="b.name">
                <div class="bf-list__row">
                  <strong>{{ b.name }}</strong>
                  @if (b.blockedCode === 'BUDGET_FROZEN') {
                    <sat-status-tag status="info">Frozen</sat-status-tag>
                  } @else if (b.blockedCode === 'BUDGET_SET_TO_ZERO') {
                    <sat-status-tag status="important">Set to zero</sat-status-tag>
                  } @else {
                    <sat-status-tag status="neutral" [hideIcon]="true">{{
                      b.approverHint ? 'Needs approval' : 'Open'
                    }}</sat-status-tag>
                  }
                </div>
                @if (b.blockedReason) {
                  <p class="bf-kpi__delta">
                    {{
                      b.blockedCode === 'BUDGET_SET_TO_ZERO'
                        ? 'No funds available this year.'
                        : b.blockedReason
                    }}
                  </p>
                } @else if (b.available) {
                  <p class="bf-kpi__value">
                    <bf-money
                      [amountMinor]="b.available.amountMinor"
                      [currency]="b.available.currency"
                    />
                  </p>
                  <p class="bf-kpi__delta">available</p>
                }
                <p class="bf-kpi__delta">
                  You requested
                  <bf-money
                    [amountMinor]="b.requestedThisYear.amountMinor"
                    [currency]="b.requestedThisYear.currency"
                  />
                  this year{{ b.pendingCount ? ' · ' + b.pendingCount + ' pending' : '' }}
                </p>
                @if (b.approverHint) {
                  <p class="bf-kpi__delta">{{ b.approverHint }}</p>
                }
                <a
                  mat-button
                  [routerLink]="['/requests/new']"
                  [queryParams]="{ kind: 'spending', budgetId: b.budgetId }"
                  [class.bf-disabled]="!!b.blockedReason"
                  [attr.aria-disabled]="!!b.blockedReason"
                  >Request from this budget</a
                >
              </article>
            }
          </div>
        }
      }
    </section>

    <div class="bf-layout">
      <section class="bf-card bf-layout__main" aria-labelledby="mine-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="mine-title">My requests</h2>
          <a mat-button routerLink="/requests">View history</a>
        </div>
        <bf-load-state
          [loading]="requests.isLoading() && !requests.hasValue()"
          [error]="requests.error()"
          what="your requests"
          (retry)="requests.reload()"
        />
        @if (requests.hasValue()) {
          @if (myRequests().length === 0) {
            <p class="bf-empty">You have no requests yet.</p>
          } @else {
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="My requests">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th class="bf-num">Amount</th>
                    <th>Status</th>
                    <th><span class="bf-cell__secondary">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of myRequests(); track r.id) {
                    <tr>
                      <td>
                        <span class="bf-cell__primary">{{ r.title }}</span
                        ><span class="bf-cell__secondary">{{ r.ref }}</span>
                      </td>
                      <td class="bf-num">
                        <bf-money
                          [amountMinor]="r.amount.amountMinor"
                          [currency]="r.amount.currency"
                        />
                      </td>
                      <td>
                        <bf-spend-status kind="request" [status]="r.status" />
                        @if (r.currentStep) {
                          <span class="bf-cell__secondary"
                            >waiting on {{ r.currentStep.approverName }}</span
                          >
                        }
                      </td>
                      <td>
                        <a mat-button [routerLink]="['/requests', r.id]">{{
                          r.status === 'changes_requested' || r.status === 'rejected'
                            ? 'Resubmit'
                            : 'Details'
                        }}</a>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      </section>
      <aside class="bf-layout__side">
        <section class="bf-card" aria-labelledby="tasks-title">
          <div class="bf-card__header"><h2 class="bf-card__title" id="tasks-title">Tasks</h2></div>
          <ul class="bf-timeline">
            @for (t of tasks(); track t.id) {
              <li>
                <a [routerLink]="['/requests', t.id]">Respond to the changes asked on {{ t.ref }}</a
                ><span class="bf-cell__secondary">{{ t.title }}</span>
              </li>
            } @empty {
              <li class="bf-cell__secondary">Nothing needs your action.</li>
            }
          </ul>
        </section>
        <section class="bf-card" aria-labelledby="events-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="events-title">Upcoming events</h2>
            <a mat-button routerLink="/events">All events</a>
          </div>
          <ul class="bf-timeline">
            @for (e of upcoming(); track e.id) {
              <li>
                <a [routerLink]="['/events', e.id]">{{ e.name }}</a>
                <span class="bf-cell__secondary"
                  >{{ e.startsAt | bfDate: session.timezone() }} ·
                  {{ e.venue ?? e.locationNames.join(', ') }}</span
                >
              </li>
            } @empty {
              <li class="bf-cell__secondary">No upcoming events.</li>
            }
          </ul>
        </section>
      </aside>
    </div>
  `,
  styles: `
    .bf-employee__cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
      margin-top: 8px;
    }
    .bf-employee__cards .bf-kpi {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bf-disabled {
      pointer-events: none;
      opacity: 0.5;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeDashboardPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly budgets = resource({ loader: () => data(this.api.requestableBudgets({})) });
  protected readonly requests = resource({
    loader: () => data(this.api.listRequests({ query: { scope: 'mine', limit: 5 } })),
  });
  protected readonly events = resource({ loader: () => data(this.api.listEvents({ query: {} })) });
  protected readonly myRequests = computed(() => valueOf(this.requests)?.items ?? []);
  protected readonly tasks = computed(() =>
    this.myRequests().filter((r) => r.status === 'changes_requested'),
  );
  protected readonly upcoming = computed(() =>
    (valueOf(this.events)?.items ?? [])
      .filter((e) => ['submitted', 'approved', 'funded', 'in_progress'].includes(e.status))
      .slice(0, 4),
  );
}
