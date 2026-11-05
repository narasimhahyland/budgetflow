import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { ApprovalTaskSummary } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import {
  ApprovalRoute,
  BudgetImpactCard,
  DateTimePipe,
  DiscussionBox,
  formatMoney,
  MobileTabBar,
  Money,
} from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

type Tab = 'assigned' | 'delegated' | 'completed';
const REASONS = [
  { code: 'REJ-BUDGET', label: 'Insufficient budget' },
  { code: 'REJ-POLICY', label: 'Outside policy' },
];

/**
 * Screen 059a: Mobile web approvals (`/m/approvals`, `/m/approvals/:taskId`).
 * Segmented control (Waiting, Delegated to me, Done today), cards with SLA and DoA tags,
 * detail view with BudgetImpactCard, Why you, ApprovalRoute, DiscussionBox, sticky Approve/Reject bar,
 * Reject bottom sheet (reason code + reason required), Above limit / Hard block / Offline states,
 * and install prompt.
 */
@Component({
  selector: 'bf-mobile-approvals-page',
  imports: [
    ApprovalRoute,
    BudgetImpactCard,
    DateTimePipe,
    DiscussionBox,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MobileTabBar,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <div class="bf-mobile-page">
      @if (offline()) {
        <sat-banner variant="warning" data-testid="mobile-offline-banner">
          <sat-banner-message>
            You're offline. You can read waiting approvals; decisions need a connection.
          </sat-banner-message>
        </sat-banner>
      }

      @if (showInstallPrompt()) {
        <section class="bf-card bf-mobile__install" data-testid="mobile-install-prompt">
          <div class="bf-list__row">
            <div>
              <strong>Add BudgetFlow to your home screen</strong>
              <p class="bf-cell__secondary">
                Get push alerts and one-tap approvals on your phone.
              </p>
            </div>
            <div class="bf-mobile__install-actions">
              <button
                mat-button
                type="button"
                (click)="showInstallPrompt.set(false)"
                data-testid="dismiss-install"
              >
                Not now
              </button>
              <button
                mat-flat-button
                type="button"
                (click)="installApp()"
                data-testid="accept-install"
              >
                Install
              </button>
            </div>
          </div>
        </section>
      }

      @if (failure()) {
        <sat-banner variant="important" data-testid="mobile-approval-error">
          <sat-banner-message>{{ failure() }}</sat-banner-message>
        </sat-banner>
      }

      @if (!activeTaskId()) {
        <!-- List view -->
        <header class="bf-page__header">
          <div class="bf-page__heading">
            <h1 class="bf-page__title">Mobile approvals</h1>
            <p class="bf-page__subtitle">
              Decide requests from your phone within your delegation of authority
            </p>
          </div>
          <div class="bf-page__actions">
            <button
              mat-stroked-button
              type="button"
              (click)="showInstallPrompt.set(!showInstallPrompt())"
              data-testid="toggle-install-prompt"
            >
              Install app
            </button>
          </div>
        </header>

        <mat-button-toggle-group
          class="bf-mobile__seg"
          [value]="tab()"
          (change)="setTab($event.value)"
          aria-label="Approval queues"
          hideSingleSelectionIndicator
        >
          <mat-button-toggle value="assigned" data-testid="seg-waiting">
            Waiting ({{ counts().assigned }})
          </mat-button-toggle>
          <mat-button-toggle value="delegated" data-testid="seg-delegated">
            Delegated to me ({{ counts().delegated }})
          </mat-button-toggle>
          <mat-button-toggle value="completed" data-testid="seg-done">
            Done today ({{ counts().completed }})
          </mat-button-toggle>
        </mat-button-toggle-group>

        <bf-load-state
          [loading]="inbox.isLoading() && !inbox.hasValue()"
          [error]="inbox.error()"
          what="your waiting approvals"
          (retry)="inbox.reload()"
        />

        @if (inbox.hasValue()) {
          @if (items().length === 0) {
            <sat-empty-state>
              <h2 satEmptyStateHeadline>You're all caught up</h2>
              <p satEmptyStateDescription>
                New requests routed to you appear here and in your notifications.
              </p>
              <a mat-stroked-button routerLink="/approvals/delegations">Set up a delegate</a>
            </sat-empty-state>
          } @else {
            <ul class="bf-mobile__cards" data-testid="mobile-approval-cards">
              @for (item of items(); track item.taskId) {
                <li>
                  <button
                    type="button"
                    class="bf-card bf-mobile__card"
                    (click)="openTask(item.taskId)"
                    [attr.data-testid]="'mobile-card-' + item.taskId"
                  >
                    <div class="bf-list__row">
                      <strong>{{ item.ref }} · {{ item.title }}</strong>
                      @if (item.onHold) {
                        <sat-status-tag status="info">On hold</sat-status-tag>
                      } @else if (item.taskStatus === 'pending') {
                        <sat-status-tag status="warning">Due soon</sat-status-tag>
                      } @else {
                        <sat-status-tag status="success">{{ item.taskStatus }}</sat-status-tag>
                      }
                    </div>
                    <p class="bf-cell__secondary">
                      {{ item.requesterName }} · {{ item.budgetName }}
                    </p>
                    <div class="bf-list__row">
                      <span class="bf-kpi__value">
                        <bf-money
                          [amountMinor]="item.amount.amountMinor"
                          [currency]="item.amount.currency"
                        />
                      </span>
                      @if (item.dueAt) {
                        <span class="bf-cell__secondary" data-testid="relative-time">
                          Due {{ item.dueAt | bfDateTime: session.timezone() : 'd MMM, HH:mm' }}
                        </span>
                      }
                    </div>
                  </button>
                </li>
              }
            </ul>
          }
        }
      } @else {
        <!-- Detail view -->
        <div class="bf-mobile__back">
          <button
            mat-stroked-button
            type="button"
            (click)="closeTask()"
            data-testid="mobile-back-to-list"
          >
            Back to waiting approvals
          </button>
        </div>

        <bf-load-state
          [loading]="detail.isLoading() && !detail.hasValue()"
          [error]="detail.error()"
          what="the approval"
          (retry)="detail.reload()"
        />

        @if (valueOf(detail); as d) {
          <section class="bf-card" aria-labelledby="mobile-detail-title" data-testid="mobile-approval-detail">
            <div class="bf-section">
              <p class="bf-meta">
                <span class="bf-chip">{{ d.task.ref }}</span>
                <span>{{ d.task.kindLabel }}</span>
              </p>
              <h1 class="bf-page__title" id="mobile-detail-title">{{ d.task.title }}</h1>
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
                  at the FY2026 plan rate
                </p>
              }
              <p class="bf-cell__secondary">
                Requester {{ d.task.requesterName }} · Charge to {{ d.task.budgetName }}
                @if (d.task.eventName) {
                  · Event {{ d.task.eventName }}
                }
              </p>
              <p>{{ d.purpose }}</p>
            </div>

            @if (!d.doa.withinLimit) {
              <sat-banner variant="important" data-testid="mobile-outside-doa-banner">
                <sat-banner-message>
                  {{ money(d.task.budgetAmount) }} is above your
                  {{ d.doa.limit ? money(d.doa.limit) : 'delegation-of-authority' }} limit.
                </sat-banner-message>
              </sat-banner>
            }

            @if (d.task.onHold || d.impact?.blocked) {
              <sat-banner variant="important" data-testid="mobile-hard-block-banner">
                <sat-banner-message>
                  {{ d.impact?.blocked ?? d.task.holdReason }}
                </sat-banner-message>
              </sat-banner>
            }

            @if (d.impact) {
              <div class="bf-section">
                <bf-budget-impact [impact]="d.impact" />
              </div>
            }

            <div class="bf-section" data-testid="mobile-why-you">
              <h2 class="bf-section__title">Why you</h2>
              <p class="bf-cell__secondary">{{ d.ruleReason }} {{ d.doa.message }}</p>
            </div>

            <div class="bf-section">
              <h2 class="bf-section__title">Approval route</h2>
              <bf-approval-route [route]="d.route" />
            </div>

            @if (d.task.subjectType === 'request') {
              <div class="bf-section">
                <bf-discussion-box itemType="request" [itemId]="d.task.subjectId" />
              </div>
            }
          </section>

          @if (rejectSheetOpen()) {
            <section
              class="bf-card bf-mobile__reject-sheet"
              role="dialog"
              aria-labelledby="reject-sheet-title"
              data-testid="mobile-reject-sheet"
            >
              <h2 class="bf-card__title" id="reject-sheet-title">Reject {{ d.task.ref }}</h2>
              <div class="bf-form">
                <mat-form-field appearance="outline" class="bf-form__wide">
                  <mat-label>Reason code</mat-label>
                  <mat-select
                    [(ngModel)]="rejectCode"
                    name="rejectCode"
                    data-testid="mobile-reject-code"
                  >
                    @for (r of reasons; track r.code) {
                      <mat-option [value]="r.code">{{ r.code }} · {{ r.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                @if (rejectSubmitted() && !rejectCode) {
                  <p class="bf-mobile__field-error" data-testid="err-reason-code">
                    Choose a reason code
                  </p>
                }

                <mat-form-field appearance="outline" class="bf-form__wide">
                  <mat-label>Reason for {{ d.task.requesterName.split(' ')[0] }}</mat-label>
                  <textarea
                    matInput
                    rows="3"
                    maxlength="500"
                    [(ngModel)]="rejectReason"
                    name="rejectReason"
                    data-testid="mobile-reject-reason"
                  ></textarea>
                </mat-form-field>
                @if (rejectSubmitted() && !rejectReason.trim()) {
                  <p class="bf-mobile__field-error" data-testid="err-reason-text">
                    Tell {{ d.task.requesterName.split(' ')[0] }} why
                  </p>
                }
              </div>
              <div class="bf-form__actions">
                <button mat-button type="button" (click)="rejectSheetOpen.set(false)">
                  Cancel
                </button>
                <button
                  mat-stroked-button
                  satImportantButton
                  type="button"
                  [disabled]="busy() || offline()"
                  (click)="confirmReject(d.task.taskId)"
                  data-testid="mobile-confirm-reject"
                >
                  Reject request
                </button>
              </div>
            </section>
          }

          @if (d.task.taskStatus === 'pending') {
            <div class="bf-mobile__sticky-actions" data-testid="mobile-sticky-actions">
              <button
                mat-stroked-button
                type="button"
                [disabled]="busy() || offline()"
                (click)="openRejectSheet()"
                [attr.aria-label]="'Reject ' + d.task.ref"
                data-testid="mobile-open-reject"
              >
                Reject
              </button>

              @if (d.allowedDecisions.includes('approve')) {
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="busy() || offline() || !!d.impact?.blocked || d.task.onHold"
                  (click)="approve(d.task.taskId, d.task.ref)"
                  [attr.aria-label]="'Approve ' + d.task.ref + ', ' + money(d.task.amount)"
                  data-testid="mobile-approve-btn"
                >
                  Approve {{ money(d.task.amount) }}
                </button>
              } @else if (!d.doa.withinLimit) {
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="busy() || offline()"
                  (click)="escalate(d.task.taskId, d.task.ref)"
                  data-testid="mobile-escalate-btn"
                >
                  Escalate
                </button>
              }

              <a
                mat-button
                [routerLink]="['/approvals']"
                [queryParams]="{ task: d.task.taskId }"
                data-testid="mobile-approve-part-link"
              >
                Approve part or request changes
              </a>
            </div>
          } @else {
            <sat-banner variant="info" data-testid="mobile-already-decided">
              <sat-banner-message>
                Already decided ({{ d.task.taskStatus.replaceAll('_', ' ') }}).
              </sat-banner-message>
            </sat-banner>
          }
        }
      }

      <bf-mobile-tab-bar [approvalCount]="counts().assigned" />
    </div>
  `,
  styles: `
    .bf-mobile-page {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-bottom: 72px;
    }
    .bf-mobile__seg {
      width: fit-content;
    }
    .bf-mobile__cards {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .bf-mobile__card {
      width: 100%;
      text-align: start;
      cursor: pointer;
      padding: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .bf-mobile__back {
      margin-bottom: 4px;
    }
    .bf-mobile__sticky-actions {
      position: sticky;
      bottom: 60px;
      z-index: 15;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-radius: var(--mat-sys-corner-large);
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-lowest);
    }
    .bf-mobile__reject-sheet {
      border: 1px solid var(--mat-sys-error);
      padding: 16px;
    }
    .bf-mobile__field-error {
      margin: -8px 0 8px;
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
    .bf-mobile__install {
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-primary);
    }
    .bf-mobile__install-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileApprovalsPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly reasons = REASONS;

  readonly taskId = input<string | undefined>(undefined);
  protected readonly tab = signal<Tab>('assigned');
  protected readonly pickedTaskId = signal<string | null>(null);
  protected readonly rejectSheetOpen = signal(false);
  protected readonly rejectSubmitted = signal(false);
  protected readonly showInstallPrompt = signal(
    this.route.snapshot.queryParamMap.get('install') === '1',
  );
  protected readonly offline = signal(
    this.route.snapshot.queryParamMap.get('offline') === '1',
  );
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected rejectCode = '';
  protected rejectReason = '';

  protected readonly activeTaskId = computed(
    () => this.pickedTaskId() ?? this.taskId() ?? null,
  );

  protected readonly inbox = resource({
    params: () => ({ tab: this.tab() }),
    loader: ({ params }) => data(this.api.getApprovalInbox({ query: params })),
  });
  protected readonly items = computed<ApprovalTaskSummary[]>(
    () => valueOf(this.inbox)?.items ?? [],
  );
  protected readonly counts = computed(
    () =>
      valueOf(this.inbox)?.counts ?? {
        assigned: 0,
        delegated: 0,
        escalated: 0,
        completed: 0,
      },
  );

  protected readonly detail = resource({
    params: () => {
      const id = this.activeTaskId();
      return id ? { taskId: id } : undefined;
    },
    loader: ({ params }) => data(this.api.getApprovalTask({ params })),
  });

  protected money(m: { amountMinor: number; currency: string }): string {
    return formatMoney(m.amountMinor, m.currency);
  }

  protected setTab(t: Tab): void {
    this.tab.set(t);
    this.pickedTaskId.set(null);
  }

  protected openTask(id: string): void {
    this.pickedTaskId.set(id);
    this.rejectSheetOpen.set(false);
    void this.router.navigate(['/m/approvals', id]);
  }

  protected closeTask(): void {
    this.pickedTaskId.set(null);
    this.rejectSheetOpen.set(false);
    void this.router.navigate(['/m/approvals']);
  }

  protected openRejectSheet(): void {
    this.rejectSubmitted.set(false);
    this.rejectSheetOpen.set(true);
  }

  protected installApp(): void {
    this.showInstallPrompt.set(false);
    this.snack.open('BudgetFlow added to home screen', undefined, { duration: 3000 });
  }

  protected async approve(id: string, ref: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await data(
        this.api.decideApprovalTask({
          params: { taskId: id },
          body: {
            decision: 'approve',
            noConflictAttested: true,
            channel: 'mobile',
          },
        }),
      );
      this.snack.open(`Approved ${ref}`, undefined, { duration: 4000 });
      this.closeTask();
      this.inbox.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirmReject(id: string): Promise<void> {
    this.rejectSubmitted.set(true);
    if (!this.rejectCode || !this.rejectReason.trim()) return;
    this.busy.set(true);
    this.failure.set('');
    try {
      const res = await data(
        this.api.decideApprovalTask({
          params: { taskId: id },
          body: {
            decision: 'reject',
            reasonCode: this.rejectCode,
            comment: this.rejectReason.trim(),
            noConflictAttested: false,
            channel: 'mobile',
          },
        }),
      );
      this.snack.open(res.message, undefined, { duration: 4000 });
      this.rejectSheetOpen.set(false);
      this.closeTask();
      this.inbox.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async escalate(id: string, ref: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const res = await data(
        this.api.decideApprovalTask({
          params: { taskId: id },
          body: {
            decision: 'escalate',
            noConflictAttested: false,
            channel: 'mobile',
          },
        }),
      );
      this.snack.open(res.message || `Escalated ${ref}`, undefined, { duration: 4000 });
      this.closeTask();
      this.inbox.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
