import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { DecisionRequest } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import {
  ApprovalRoute,
  BudgetImpactCard,
  DateTimePipe,
  DecisionForm,
  Money,
  SpendStatus,
} from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

type Tab = 'assigned' | 'delegated' | 'escalated' | 'completed';
const TABS: { id: Tab; label: string }[] = [
  { id: 'assigned', label: 'Assigned to me' },
  { id: 'delegated', label: 'Delegated to me' },
  { id: 'escalated', label: 'Escalated' },
  { id: 'completed', label: 'Completed' },
];

/** Screen 59 (with 61 decision, 62 delegated, 63 escalated): what waits for me, its budget impact and route, and the decision. */
@Component({
  selector: 'bf-inbox-page',
  imports: [
    ApprovalRoute,
    BudgetImpactCard,
    DateTimePipe,
    DecisionForm,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SpendStatus,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Approval inbox</h1>
        <p class="bf-page__subtitle">
          Requests and Inter-Director Budget Contribution Requests waiting for you, within your
          delegation of authority
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/approvals/delegations">Delegations</a>
      </div>
    </header>
    <sat-navigation-tabs class="bf-tabs" aria-label="Inbox">
      @for (t of tabs; track t.id) {
        <a
          satNavigationTab
          [active]="tab() === t.id"
          (click)="setTab(t.id)"
          (keydown.enter)="setTab(t.id)"
          tabindex="0"
          >{{ t.label }} <span class="bf-chip">{{ counts()[t.id] }}</span></a
        >
      }
    </sat-navigation-tabs>
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <bf-load-state
      [loading]="inbox.isLoading() && !inbox.hasValue()"
      [error]="inbox.error()"
      what="your approvals"
      (retry)="inbox.reload()"
    />
    @if (inbox.hasValue()) {
      @if (items().length === 0) {
        <sat-empty-state>
          <h2 satEmptyStateHeadline>
            {{ tab() === 'assigned' ? 'You are all caught up' : 'Nothing here' }}
          </h2>
          <p satEmptyStateDescription>
            {{
              tab() === 'assigned'
                ? 'New approvals appear here and in your email.'
                : 'Approvals move here as they happen.'
            }}
          </p>
          <button mat-stroked-button type="button" (click)="setTab('completed')">
            View completed
          </button>
          <a mat-stroked-button routerLink="/approvals/delegations">Set up a delegate</a>
        </sat-empty-state>
      } @else {
        <div class="bf-split">
          <section class="bf-card" aria-label="Approvals">
            <div class="bf-card__header">
              <h2 class="bf-card__title">
                {{ items().length }} {{ items().length === 1 ? 'request' : 'requests' }}
              </h2>
            </div>
            <ul class="bf-list">
              @for (i of items(); track i.taskId) {
                <li>
                  <button
                    type="button"
                    class="bf-list__item"
                    [class.bf-list__item--active]="selectedId() === i.taskId"
                    (click)="select(i.taskId)"
                    [attr.aria-current]="selectedId() === i.taskId"
                  >
                    <span class="bf-list__row"
                      ><strong>{{ i.ref }}</strong
                      ><bf-money
                        [amountMinor]="i.amount.amountMinor"
                        [currency]="i.amount.currency"
                    /></span>
                    <span class="bf-cell__primary">{{ i.title }}</span>
                    <span class="bf-cell__secondary"
                      >{{ i.requesterName }} · {{ i.budgetName }}</span
                    >
                    <span class="bf-list__row">
                      <span class="bf-cell__secondary">
                        @if (i.delegatedFromName) {
                          For {{ i.delegatedFromName }} ·
                        }
                        @if (i.onHold) {
                          On hold ·
                        }
                        @if (i.dueAt && i.taskStatus === 'pending') {
                          <span data-testid="relative-time"
                            >Due
                            {{ i.dueAt | bfDateTime: session.timezone() : 'd MMM, HH:mm' }}</span
                          >
                        }
                      </span>
                      <bf-spend-status kind="task" [status]="i.taskStatus" />
                    </span>
                  </button>
                </li>
              }
            </ul>
          </section>
          <section class="bf-card" aria-label="Approval detail">
            <bf-load-state
              [loading]="detail.isLoading() && !detail.hasValue()"
              [error]="detail.error()"
              what="the approval"
              (retry)="detail.reload()"
            />
            @if (valueOf(detail); as d) {
              <div class="bf-section">
                <p class="bf-meta">
                  <span class="bf-chip">{{ d.task.ref }}</span>
                  <bf-spend-status kind="task" [status]="d.task.taskStatus" />
                  {{ d.task.kindLabel }}
                </p>
                <h2 class="bf-page__title">{{ d.task.title }}</h2>
                <p class="bf-meta">
                  Requester {{ d.task.requesterName }} · {{ d.task.budgetName
                  }}{{ d.task.eventName ? ' · ' + d.task.eventName : '' }}
                </p>
                <p class="bf-kpi__label">Total requested</p>
                <p class="bf-kpi__value">
                  <bf-money
                    [amountMinor]="d.task.amount.amountMinor"
                    [currency]="d.task.amount.currency"
                  />
                </p>
                @if (d.task.budgetAmount.currency !== d.task.amount.currency) {
                  <p class="bf-cell__secondary">
                    =
                    <bf-money
                      [amountMinor]="d.task.budgetAmount.amountMinor"
                      [currency]="d.task.budgetAmount.currency"
                    />
                    at the locked plan rate
                  </p>
                }
                @if (d.doa.onBehalfOfName) {
                  <sat-banner variant="info"
                    ><sat-banner-message
                      >You act as a delegate for {{ d.doa.onBehalfOfName }}.
                      {{ d.doa.message }}</sat-banner-message
                    ></sat-banner
                  >
                }
                @if (d.task.onHold) {
                  <sat-banner variant="info"
                    ><sat-banner-message>{{ d.task.holdReason }}</sat-banner-message></sat-banner
                  >
                }
              </div>
              @if (d.impact) {
                <div class="bf-section"><bf-budget-impact [impact]="d.impact" /></div>
              }
              <div class="bf-section">
                <sat-banner variant="info"
                  ><sat-banner-message>{{ d.ruleReason }}</sat-banner-message></sat-banner
                >
              </div>
              <div class="bf-section">
                <h3 class="bf-section__title">Approval sequence</h3>
                <bf-approval-route [route]="d.route" />
              </div>
              <div class="bf-section">
                <h3 class="bf-section__title">Purpose</h3>
                <p>{{ d.purpose }}</p>
                @for (doc of d.documents; track doc.id) {
                  <p class="bf-cell__secondary">Attached: {{ doc.fileName }}</p>
                }
                <a
                  mat-button
                  [routerLink]="
                    d.task.subjectType === 'request'
                      ? ['/requests', d.task.subjectId]
                      : ['/contributions', d.task.subjectId]
                  "
                  >Open full details</a
                >
              </div>
              @if (d.allowedDecisions.length) {
                <div class="bf-section">
                  @if (d.task.subjectType === 'contribution') {
                    <p class="bf-cell__secondary">
                      Giving directors can also decide on the
                      <a [routerLink]="['/contributions', d.task.subjectId]">contribution page</a>
                      with their budget position.
                    </p>
                  }
                  <bf-decision-form
                    [task]="d"
                    [busy]="busy()"
                    (decide)="decide(d.task.taskId, $event)"
                  />
                </div>
              }
            }
          </section>
        </div>
      }
    }
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InboxPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly tabs = TABS;
  protected readonly tab = signal<Tab>(
    (this.route.snapshot.queryParamMap.get('tab') as Tab) ?? 'assigned',
  );
  private readonly picked = signal<string | null>(this.route.snapshot.queryParamMap.get('task'));
  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  protected readonly inbox = resource({
    params: () => ({ tab: this.tab() }),
    loader: ({ params }) => data(this.api.getApprovalInbox({ query: params })),
  });
  protected readonly items = computed(() => valueOf(this.inbox)?.items ?? []);
  protected readonly counts = computed(
    () => valueOf(this.inbox)?.counts ?? { assigned: 0, delegated: 0, escalated: 0, completed: 0 },
  );
  protected readonly selectedId = computed(() => {
    const items = this.items();
    const p = this.picked();
    return p && (items.some((i) => i.taskId === p) || this.tab() === 'assigned')
      ? p
      : (items[0]?.taskId ?? null);
  });
  protected readonly detail = resource({
    params: () => (this.selectedId() ? { taskId: this.selectedId()! } : undefined),
    loader: ({ params }) => data(this.api.getApprovalTask({ params })),
  });

  protected setTab(t: Tab): void {
    this.tab.set(t);
    this.picked.set(null);
    void this.router.navigate([], { queryParams: { tab: t }, replaceUrl: true });
  }

  protected select(taskId: string): void {
    this.picked.set(taskId);
    void this.router.navigate([], {
      queryParams: { tab: this.tab(), task: taskId },
      replaceUrl: true,
    });
  }

  protected async decide(taskId: string, d: DecisionRequest): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const r = await data(this.api.decideApprovalTask({ params: { taskId }, body: d }));
      this.snack.open(r.message, undefined, { duration: 5000 });
      this.picked.set(null);
      this.inbox.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
