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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { DecisionRequest } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import {
  ApprovalRoute,
  BudgetImpactCard,
  DateOnlyPipe,
  DateTimePipe,
  DecisionForm,
  Money,
  SpendStatus,
} from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, errorMessage, injectApi, valueOf } from './api';
import { DocumentsPanel } from './documents-panel';
import { LoadState } from './load-state';
import { toMajor, toMinor } from './money-input';

const KIND: Record<string, string> = {
  budget: 'Event budget request',
  additional_fund: 'Additional-fund request',
  spending: 'Spending request',
  over_budget: 'Over-budget request',
  exception: 'Exception request',
};

/** Screen 60 (with 61 decision and 119 request status): one request with its route, rules, budget impact and activity. */
@Component({
  selector: 'bf-request-detail-page',
  imports: [
    DateOnlyPipe,
    ApprovalRoute,
    BudgetImpactCard,
    DateTimePipe,
    DecisionForm,
    DocumentsPanel,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SpendStatus,
  ],
  template: `
    <bf-load-state
      [loading]="item.isLoading() && !item.hasValue()"
      [error]="item.error()"
      what="the request"
      (retry)="item.reload()"
    />
    @if (r(); as r) {
      <header class="bf-page__header">
        <div class="bf-page__heading">
          <div class="bf-title-row">
            <h1 class="bf-page__title">{{ r.title }}</h1>
            @if (r.myTaskId) {
              <span class="bf-chip">Pending your approval</span>
            } @else {
              <bf-spend-status kind="request" [status]="r.status" />
            }
          </div>
          <p class="bf-meta">
            <span>{{ r.ref }} · {{ kind(r.kind) }}</span>
            <span>requested by {{ r.requesterName }}</span>
            @if (r.submittedAt) {
              <span data-testid="relative-time"
                >submitted {{ r.submittedAt | bfDate: session.timezone() }}</span
              >
            }
            @if (r.currentStep) {
              <span>with {{ r.currentStep.approverName }}</span>
            }
          </p>
        </div>
        <div class="bf-page__actions">
          @if (r.allowedActions.includes('withdraw')) {
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="withdraw()">
              Withdraw
            </button>
          }
          @if (r.allowedActions.includes('submit')) {
            <button mat-flat-button type="button" [disabled]="busy()" (click)="submit()">
              Submit
            </button>
          }
        </div>
      </header>
      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
      @if (r.onHold) {
        <sat-banner variant="info"
          ><sat-banner-message>{{ r.holdReason }}</sat-banner-message></sat-banner
        >
      }
      @if (r.status === 'changes_requested') {
        <sat-banner variant="info"
          ><sat-banner-message
            >Changes requested{{
              r.decisionReason ? ': ' + r.decisionReason : ''
            }}</sat-banner-message
          ></sat-banner
        >
      }
      @if (r.status === 'cancelled' && r.cancelReason) {
        <sat-banner variant="info"
          ><sat-banner-message
            >Cancelled: {{ r.cancelReason }}. Nothing was charged.</sat-banner-message
          ></sat-banner
        >
      }
      @if (task.hasValue() && r.myTaskId) {
        <section class="bf-card" aria-labelledby="decide-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="decide-title">Your decision</h2>
          </div>
          <div class="bf-section">
            <bf-decision-form [task]="task.value()!" [busy]="busy()" (decide)="decide($event)" />
          </div>
        </section>
      }
      @if (r.allowedActions.includes('resubmit')) {
        <section class="bf-card" aria-labelledby="resubmit-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="resubmit-title">Change and resubmit</h2>
          </div>
          <div class="bf-form">
            <mat-form-field appearance="outline">
              <mat-label>Amount ({{ r.amount.currency }})</mat-label>
              <input matInput inputmode="decimal" [(ngModel)]="newAmount" name="newAmount" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="bf-form__wide">
              <mat-label>Justification</mat-label>
              <textarea matInput rows="3" [(ngModel)]="newPurpose" name="newPurpose"></textarea>
            </mat-form-field>
          </div>
          <div class="bf-form__actions">
            <button mat-flat-button type="button" [disabled]="busy()" (click)="resubmit()">
              Resubmit
            </button>
          </div>
        </section>
      }
      <div class="bf-layout">
        <div class="bf-layout__main">
          <section class="bf-card" aria-labelledby="details-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="details-title">Request details</h2>
            </div>
            <dl class="bf-facts">
              <div>
                <dt>Amount</dt>
                <dd>
                  <bf-money [amountMinor]="r.amount.amountMinor" [currency]="r.amount.currency" />
                </dd>
              </div>
              @if (r.budgetAmount && r.budgetAmount.currency !== r.amount.currency) {
                <div>
                  <dt>In budget currency (locked plan rate)</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="r.budgetAmount.amountMinor"
                      [currency]="r.budgetAmount.currency"
                    />
                  </dd>
                </div>
              }
              @if (r.approvedAmount) {
                <div>
                  <dt>Approved</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="r.approvedAmount.amountMinor"
                      [currency]="r.approvedAmount.currency"
                    />
                  </dd>
                </div>
              }
              <div>
                <dt>Spend type</dt>
                <dd>{{ r.spendType.replace('_', ' ') }}</dd>
              </div>
              <div>
                <dt>Needed by</dt>
                <dd>{{ r.neededBy ?? '—' }}</dd>
              </div>
              <div>
                <dt>Charge to</dt>
                <dd>{{ r.budgetName }}</dd>
              </div>
              @if (r.eventId) {
                <div>
                  <dt>Event</dt>
                  <dd>
                    <a [routerLink]="['/events', r.eventId]">{{ r.eventName }}</a>
                  </dd>
                </div>
              }
              @if (r.overBudget) {
                <div>
                  <dt>Over budget</dt>
                  <dd>Needs finance review</dd>
                </div>
              }
            </dl>
            <div class="bf-section">
              <h3 class="bf-section__title">Business justification</h3>
              <p>{{ r.purpose }}</p>
            </div>
            <bf-documents-panel
              ownerType="request"
              [ownerId]="r.id"
              [documents]="r.documents"
              [canUpload]="r.allowedActions.includes('upload')"
              (changed)="item.reload()"
            />
          </section>
          @if (r.route; as route) {
            <section class="bf-card" aria-labelledby="route-title">
              <div class="bf-card__header">
                <h2 class="bf-card__title" id="route-title">Approval route</h2>
              </div>
              <div class="bf-section"><bf-approval-route [route]="route" /></div>
            </section>
            <section class="bf-card" aria-labelledby="rules-title">
              <div class="bf-card__header">
                <h2 class="bf-card__title" id="rules-title">Rules applied: why this route</h2>
              </div>
              <ul class="bf-timeline">
                @for (line of route.explanation; track $index) {
                  <li>{{ line }}</li>
                }
              </ul>
            </section>
          }
          <section class="bf-card" aria-labelledby="activity-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="activity-title">Activity</h2>
            </div>
            <ol class="bf-timeline">
              @for (a of r.activity; track a.id) {
                <li>
                  <span class="bf-cell__primary">{{ a.summary }}</span>
                  <span class="bf-cell__secondary"
                    ><span data-testid="relative-time">{{
                      a.at | bfDateTime: session.timezone()
                    }}</span>
                    · {{ a.actorName ?? 'BudgetFlow'
                    }}{{ a.onBehalfOfName ? ' for ' + a.onBehalfOfName : ''
                    }}{{ a.channel === 'email' ? ' · from email' : '' }}</span
                  >
                  @if (a.reason) {
                    <span class="bf-cell__secondary">“{{ a.reason }}”</span>
                  }
                </li>
              }
            </ol>
          </section>
        </div>
        <aside class="bf-layout__side">
          @if (r.impact; as impact) {
            <section class="bf-card" aria-label="Budget impact">
              <div class="bf-section">
                <bf-budget-impact [impact]="impact" title="Budget impact analysis" />
              </div>
            </section>
          }
        </aside>
      </div>
    }
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestDetailPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  readonly requestId = input.required<string>();
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected newAmount = '';
  protected newPurpose = '';

  protected readonly item = resource({
    params: () => ({ requestId: this.requestId() }),
    loader: async ({ params }) => {
      const r = await data(this.api.getRequest({ params }));
      this.newAmount = toMajor(r.amount.amountMinor, r.amount.currency);
      this.newPurpose = r.purpose;
      return r;
    },
  });
  protected readonly r = computed(() => valueOf(this.item));
  protected readonly task = resource({
    params: () => (this.r()?.myTaskId ? { taskId: this.r()!.myTaskId! } : undefined),
    loader: ({ params }) => data(this.api.getApprovalTask({ params })),
  });

  protected kind(k: string): string {
    return KIND[k] ?? k;
  }

  private async run(
    call: () => Promise<{ ref?: string; message?: string }>,
    done: string,
  ): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const res = await call();
      this.snack.open(res.message ?? done, undefined, { duration: 4000 });
      this.item.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected decide(d: DecisionRequest): void {
    void this.run(
      () => data(this.api.decideApprovalTask({ params: { taskId: this.r()!.myTaskId! }, body: d })),
      'Decision recorded',
    );
  }

  protected withdraw(): void {
    void this.run(
      () => data(this.api.withdrawRequest({ params: { requestId: this.requestId() }, body: {} })),
      'Request withdrawn',
    );
  }

  protected submit(): void {
    void this.run(
      () => data(this.api.submitRequest({ params: { requestId: this.requestId() } })),
      'Request submitted',
    );
  }

  protected resubmit(): void {
    const r = this.r()!;
    const amount = toMinor(this.newAmount, r.amount.currency);
    void this.run(
      () =>
        data(
          this.api.resubmitRequest({
            params: { requestId: r.id },
            body: {
              ...(amount ? { amount: { amountMinor: amount, currency: r.amount.currency } } : {}),
              purpose: this.newPurpose.trim(),
            },
          }),
        ),
      'Request resubmitted',
    );
  }
}
