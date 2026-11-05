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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { ChatApprovalCardView, ChatProvider } from '@bf/contracts';
import { formatMoney, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const REASONS = [
  { code: 'REJ-BUDGET', label: 'Insufficient budget' },
  { code: 'REJ-POLICY', label: 'Outside policy' },
];

/**
 * Screens 061b (Slack approval card), 061c (Microsoft Teams approval card) & 061d (Slack and Teams
 * App Home, balance check, quick request and alerts) interactive surface (`/admin/channels/cards`).
 * Renders the real Block Kit / Adaptive Card payloads returned by the API and lets approvers test
 * one-click Approve, Reject (modal/inline) and `/budgetflow balance` / App Home within `PolicyService`
 * and DoA rules.
 */
@Component({
  selector: 'bf-chat-cards-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Slack and Microsoft Teams interactive cards</h1>
        <p class="bf-page__subtitle">
          Block Kit and Adaptive Card 1.5 approval cards, balance checks and quick requests
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/admin/channels">Channel setup</a>
      </div>
    </header>

    <div class="bf-chat-cards__controls">
      <mat-button-toggle-group
        [value]="provider()"
        (change)="provider.set($event.value)"
        aria-label="Chat provider"
        hideSingleSelectionIndicator
      >
        <mat-button-toggle value="slack" data-testid="provider-slack">
          Slack Block Kit (061b)
        </mat-button-toggle>
        <mat-button-toggle value="teams" data-testid="provider-teams">
          Microsoft Teams Adaptive Card (061c)
        </mat-button-toggle>
      </mat-button-toggle-group>

      <sat-navigation-tabs class="bf-tabs" aria-label="Chat surface">
        <a
          satNavigationTab
          [active]="surface() === 'card'"
          (click)="surface.set('card')"
          (keydown.enter)="surface.set('card')"
          tabindex="0"
          data-testid="surface-card"
          >Approval card</a
        >
        <a
          satNavigationTab
          [active]="surface() === 'app-home'"
          (click)="surface.set('app-home')"
          (keydown.enter)="surface.set('app-home')"
          tabindex="0"
          data-testid="surface-app-home"
          >App Home & Balance (061d)</a
        >
      </sat-navigation-tabs>
    </div>

    @if (failure()) {
      <sat-banner variant="important" data-testid="chat-card-error">
        <sat-banner-message>{{ failure() }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="inbox.isLoading() && !inbox.hasValue()"
      [error]="inbox.error()"
      what="approval tasks"
      (retry)="inbox.reload()"
    />

    @if (surface() === 'card') {
      @if (valueOf(card); as c) {
        <section
          class="bf-card bf-chat-cards__frame"
          [attr.aria-label]="provider() === 'slack' ? 'Slack approval card' : 'Teams approval card'"
          data-testid="chat-approval-card"
        >
          <div class="bf-card__header">
            <div>
              <span class="bf-chip">{{
                provider() === 'slack' ? 'Slack direct message · Block Kit' : 'Teams personal chat · Adaptive Card 1.5'
              }}</span>
              <h2 class="bf-card__title" data-testid="card-headline">{{ c.stateHeadline }}</h2>
            </div>
            <sat-status-tag
              [status]="
                c.state === 'approved'
                  ? 'success'
                  : c.state === 'rejected' || c.state === 'outside_doa' || c.state === 'hard_block'
                    ? 'important'
                    : 'warning'
              "
              data-testid="card-state-tag"
            >
              {{ c.state.replaceAll('_', ' ') }}
            </sat-status-tag>
          </div>

          <dl class="bf-facts">
            <div>
              <dt>Request</dt>
              <dd>{{ c.ref }} · {{ c.title }}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>
                <bf-money [amountMinor]="c.amount.amountMinor" [currency]="c.amount.currency" />
                @if (c.planRateNote) {
                  <span class="bf-cell__secondary">({{ c.planRateNote }})</span>
                }
              </dd>
            </div>
            <div>
              <dt>Requester</dt>
              <dd>{{ c.requesterName }}</dd>
            </div>
            <div>
              <dt>Charge to</dt>
              <dd>{{ c.chargeTo }}</dd>
            </div>
            @if (c.eventName) {
              <div>
                <dt>Event</dt>
                <dd>{{ c.eventName }}</dd>
              </div>
            }
          </dl>

          @if (c.availableBefore && c.availableAfter) {
            <div class="bf-chat-cards__impact" data-testid="card-budget-impact">
              <p>
                <strong>Available under this budget's rules:</strong>
                {{ money(c.availableBefore) }} now, {{ money(c.availableAfter) }} after approval.
              </p>
              @if (c.warning) {
                <sat-banner variant="warning">
                  <sat-banner-message>{{ c.warning }}</sat-banner-message>
                </sat-banner>
              }
            </div>
          }

          <p class="bf-cell__secondary" data-testid="card-why-you">{{ c.whyYou }}</p>

          @if (rejectModalOpen()) {
            <div class="bf-chat-cards__reject" data-testid="card-reject-modal">
              <h3 class="bf-section__title">Reject {{ c.ref }}</h3>
              <div class="bf-form">
                <mat-form-field appearance="outline">
                  <mat-label>Reason code</mat-label>
                  <mat-select [(ngModel)]="rejectCode" name="rejectCode" data-testid="card-reject-code">
                    @for (r of reasons; track r.code) {
                      <mat-option [value]="r.code">{{ r.code }} · {{ r.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" class="bf-form__wide">
                  <mat-label>Reason for {{ c.requesterName.split(' ')[0] }}</mat-label>
                  <textarea
                    matInput
                    rows="2"
                    [(ngModel)]="rejectReason"
                    name="rejectReason"
                    data-testid="card-reject-reason"
                  ></textarea>
                </mat-form-field>
              </div>
              <div class="bf-form__actions">
                <button mat-button type="button" (click)="rejectModalOpen.set(false)">Cancel</button>
                <button
                  mat-stroked-button
                  satImportantButton
                  type="button"
                  [disabled]="busy() || !rejectCode || !rejectReason.trim()"
                  (click)="decideFromCard(c, 'reject')"
                  data-testid="card-submit-reject"
                >
                  {{ provider() === 'teams' ? 'Submit rejection' : 'Reject' }}
                </button>
              </div>
            </div>
          }

          <div class="bf-form__actions" data-testid="card-actions">
            @if (c.canApprove) {
              <button
                mat-flat-button
                type="button"
                [disabled]="busy()"
                (click)="decideFromCard(c, 'approve')"
                data-testid="card-approve-btn"
              >
                Approve {{ money(c.amount) }}
              </button>
            } @else if (c.state === 'outside_doa') {
              <a
                mat-stroked-button
                [routerLink]="['/approvals']"
                [queryParams]="{ task: c.taskId }"
                data-testid="card-escalate-link"
              >
                Escalate in BudgetFlow
              </a>
            }
            @if (c.canReject) {
              <button
                mat-stroked-button
                satImportantButton
                type="button"
                [disabled]="busy()"
                (click)="rejectModalOpen.set(true)"
                data-testid="card-open-reject-btn"
              >
                Reject
              </button>
            }
            <a mat-stroked-button [routerLink]="['/requests', c.subjectId]" data-testid="card-open-bf">
              Open in BudgetFlow
            </a>
          </div>
        </section>
      }
    } @else {
      <!-- 061d App Home, Balance & Quick Request -->
      <div class="bf-split" data-testid="chat-app-home">
        <section class="bf-card" aria-labelledby="home-waiting-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="home-waiting-title">
              {{ provider() === 'slack' ? 'Slack App Home' : 'Teams Personal Tab' }} · Waiting for you
            </h2>
          </div>
          <ul class="bf-list">
            @for (t of tasks(); track t.taskId) {
              <li class="bf-list__item bf-list__row">
                <span>
                  <strong>{{ t.ref }}</strong> {{ t.title }} · {{ money(t.amount) }}
                </span>
                <button
                  mat-stroked-button
                  type="button"
                  (click)="pickTask(t.taskId)"
                >
                  Open card
                </button>
              </li>
            } @empty {
              <li class="bf-list__item">No approvals waiting for you.</li>
            }
          </ul>
        </section>

        <section class="bf-card" aria-labelledby="home-bal-title" data-testid="chat-balance-reply">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="home-bal-title">
                <code>/budgetflow balance</code> reply (private)
              </h2>
              <p class="bf-card__hint">
                Shows Available under each budget's rules (never company-wide Available)
              </p>
            </div>
          </div>
          <ul class="bf-list">
            @for (b of budgetsList(); track b.id) {
              <li class="bf-list__item">
                <div class="bf-list__row">
                  <strong>{{ b.name }}</strong>
                  <span class="bf-chip">{{ b.status.replaceAll('_', ' ') }}</span>
                </div>
                <p class="bf-cell__secondary">
                  Available under this budget's rules: {{ money(b.balances.available) }} of
                  {{ money(b.balances.budgetCurrency.authorized) }}
                </p>
              </li>
            }
          </ul>
          <div class="bf-form__actions">
            <a mat-stroked-button routerLink="/requests/new">New request</a>
            <a mat-button routerLink="/me/notifications">Notification settings</a>
          </div>
        </section>
      </div>
    }
  `,
  styles: `
    .bf-chat-cards__controls {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .bf-chat-cards__frame {
      max-width: 680px;
    }
    .bf-chat-cards__impact {
      padding: 12px 16px;
      margin: 12px 0;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-low);
    }
    .bf-chat-cards__impact p {
      margin: 0 0 6px;
    }
    .bf-chat-cards__reject {
      padding: 12px 16px;
      margin: 12px 0;
      border: 1px solid var(--mat-sys-error);
      border-radius: var(--mat-sys-corner-medium);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatCardsPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;
  protected readonly reasons = REASONS;

  protected readonly provider = signal<ChatProvider>(
    this.route.snapshot.queryParamMap.get('provider') === 'teams' ? 'teams' : 'slack',
  );
  protected readonly surface = signal<'card' | 'app-home'>(
    this.route.snapshot.queryParamMap.get('surface') === 'app-home' ? 'app-home' : 'card',
  );
  protected readonly selectedTaskId = signal<string | null>(
    this.route.snapshot.queryParamMap.get('task'),
  );
  protected readonly rejectModalOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected rejectCode = '';
  protected rejectReason = '';

  protected readonly inbox = resource({
    loader: async () => {
      const r = await data(this.api.getApprovalInbox({ query: { tab: 'assigned' } }));
      if (!this.selectedTaskId() && r.items.length) {
        this.selectedTaskId.set(r.items[0].taskId);
      }
      return r;
    },
  });
  protected readonly tasks = computed(() => valueOf(this.inbox)?.items ?? []);

  protected readonly card = resource({
    params: () => {
      const taskId = this.selectedTaskId() ?? this.tasks()[0]?.taskId;
      return taskId ? { provider: this.provider(), taskId } : undefined;
    },
    loader: ({ params }) => data(this.api.getChatApprovalCard({ params })),
  });

  protected readonly budgetsRes = resource({
    loader: () => data(this.api.listBudgets({ query: { limit: 6 } })),
  });
  protected readonly budgetsList = computed(() => valueOf(this.budgetsRes)?.items ?? []);

  protected money(m: { amountMinor: number; currency: string }): string {
    return formatMoney(m.amountMinor, m.currency);
  }

  protected pickTask(taskId: string): void {
    this.selectedTaskId.set(taskId);
    this.surface.set('card');
  }

  protected async decideFromCard(
    c: ChatApprovalCardView,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const res = await data(
        this.api.decideApprovalTask({
          params: { taskId: c.taskId },
          body: {
            decision,
            noConflictAttested: decision === 'approve',
            ...(decision === 'reject'
              ? { reasonCode: this.rejectCode, comment: this.rejectReason.trim() }
              : {}),
            channel: this.provider(),
          },
        }),
      );
      this.rejectModalOpen.set(false);
      this.snack.open(res.message, undefined, { duration: 4000 });
      this.card.reload();
      this.inbox.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
