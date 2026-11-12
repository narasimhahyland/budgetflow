import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { formatDate } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { type ErrorStateMatcher } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type {
  ActivityEntry,
  DecisionRequest,
  Money as MoneyAmount,
  PolicyCheckView,
  RequestDetail,
  RequestVersion,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import {
  ApprovalRoute,
  BudgetImpactCard,
  DateOnlyPipe,
  DateTimePipe,
  DecisionForm,
  DiscussionBox,
  formatMoney,
  LoadState,
  Money,
  SpendStatus,
} from '@bf/web/ui';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatCategoryTag, SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { DocumentsPanel } from './documents-panel';
import { toMajor, toMinor } from './money-input';

const KIND: Record<string, string> = {
  budget: 'Event budget request',
  additional_fund: 'Additional-fund request',
  spending: 'Spending request',
  over_budget: 'Over-budget request',
  exception: 'Exception request',
};

const DECISION_ACTIONS =
  /^request\.(approved|approved_partial|step_approved|rejected|changes_requested|escalated)$/;

type Tab = 'details' | 'history' | 'documents';
const asTab = (t: string | null): Tab => (t === 'history' || t === 'documents' ? t : 'details');

/** Screen 60 (with 61 decision and 119 request status): one request with its route, rules, budget impact and activity. */
@Component({
  selector: 'bf-request-detail-page',
  imports: [
    DateOnlyPipe,
    ApprovalRoute,
    BudgetImpactCard,
    DateTimePipe,
    DecisionForm,
    DiscussionBox,
    DocumentsPanel,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatAvatar,
    SatCategoryTag,
    SatImportantButton,
    SatStatusTag,
    SpendStatus,
  ],
  template: `
    <bf-load-state
      [loading]="(item.isLoading() && !item.hasValue()) || (item.hasValue() && !r())"
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
              <sat-status-tag status="warning"
                ><mat-icon svgIcon="clock" aria-hidden="true" />Pending your
                approval</sat-status-tag
              >
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
      <bf-discussion-box itemType="request" [itemId]="r.id" />
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
        <sat-banner variant="warning"
          ><sat-banner-message
            >Changes requested{{
              r.decisionReason ? ': ' + r.decisionReason : ''
            }}</sat-banner-message
          ></sat-banner
        >
      }
      @if (r.status === 'rejected') {
        <sat-banner variant="important"
          ><sat-banner-message>{{ rejectedText(r) }}</sat-banner-message></sat-banner
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
      <!-- Only while the offer is still open: once it is accepted or answered, the history tab has it. -->
      @if (r.status === 'changes_requested' && r.counterOffer; as offer) {
        <section class="bf-card" aria-labelledby="offer-title" data-testid="counter-offer">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="offer-title">
              {{ offer.offeredByName }} offered a smaller amount
            </h2>
          </div>
          <div class="bf-section">
            <dl class="bf-facts">
              <div class="bf-facts__item">
                <dt>You asked for</dt>
                <dd>
                  <bf-money [amountMinor]="r.amount.amountMinor" [currency]="r.amount.currency" />
                </dd>
              </div>
              <div class="bf-facts__item">
                <dt>Offered</dt>
                <dd class="bf-offer" data-testid="offer-amount">
                  <bf-money
                    [amountMinor]="offer.amount.amountMinor"
                    [currency]="offer.amount.currency"
                  />
                </dd>
              </div>
              <div class="bf-facts__item">
                <dt>Offered on</dt>
                <dd>{{ offer.offeredAt | bfDate: session.timezone() }}</dd>
              </div>
            </dl>
            @if (offer.expired) {
              <sat-banner variant="important"
                ><sat-banner-message
                  >This offer expired on {{ offer.expiresAt | bfDate: session.timezone() }}. Change
                  the request and send it again.</sat-banner-message
                ></sat-banner
              >
            } @else {
              <p class="bf-muted">
                Accepting approves the request at {{ money(offer.amount) }} with no further review.
                The offer runs out on {{ offer.expiresAt | bfDate: session.timezone() }}.
              </p>
            }
          </div>
          @if (r.allowedActions.includes('accept_offer') && !offer.expired) {
            <div class="bf-form__actions">
              <button
                mat-flat-button
                satImportantButton
                type="button"
                data-testid="accept-offer"
                [disabled]="busy()"
                (click)="acceptOffer()"
              >
                Accept {{ money(offer.amount) }}
              </button>
            </div>
          }
        </section>
      }
      @if (r.allowedActions.includes('resubmit')) {
        <section class="bf-card" aria-labelledby="resubmit-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="resubmit-title">Change and resubmit</h2>
          </div>
          <div class="bf-form">
            <mat-form-field appearance="outline">
              <mat-label>Amount</mat-label>
              <span matTextPrefix>{{ r.amount.currency }}&nbsp;</span>
              <input
                matInput
                inputmode="decimal"
                [(ngModel)]="newAmount"
                [errorStateMatcher]="amountMatcher"
                name="newAmount"
              />
              @if (amountProblem(); as problem) {
                <mat-error
                  ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />{{
                    problem
                  }}</mat-error
                >
              }
            </mat-form-field>
            <mat-form-field appearance="outline" class="bf-form__wide">
              <mat-label>Justification</mat-label>
              <textarea matInput rows="3" [(ngModel)]="newPurpose" name="newPurpose"></textarea>
            </mat-form-field>
            <mat-form-field appearance="outline" class="bf-form__wide">
              <mat-label>Note to the approver</mat-label>
              <textarea matInput rows="2" [(ngModel)]="resubmitNote" name="resubmitNote"></textarea>
              <mat-hint>Say what you changed and why.</mat-hint>
            </mat-form-field>
          </div>
          <div class="bf-section" data-testid="what-changed">
            <h3 class="bf-subtitle">What changed</h3>
            @if (amountProblem(); as problem) {
              <p class="bf-muted" data-testid="amount-problem">{{ problem }}</p>
            } @else if (changes().length) {
              <dl class="bf-facts">
                @for (c of changes(); track c.label) {
                  <div class="bf-facts__item">
                    <dt>{{ c.label }}</dt>
                    <dd>Changed · was {{ c.before }} · now {{ c.after }}</dd>
                  </div>
                }
              </dl>
            } @else {
              <p class="bf-muted">
                Nothing has changed yet. Change the amount or the justification above, then say what
                you changed.
              </p>
            }
          </div>
          <div class="bf-form__actions">
            <button
              mat-flat-button
              type="button"
              [disabled]="busy() || !canResubmit()"
              (click)="resubmit()"
            >
              Resubmit
            </button>
          </div>
        </section>
      }
      <sat-navigation-tabs class="bf-tabs" aria-label="Request sections">
        @for (t of tabs; track t.key) {
          <a
            satNavigationTab
            [active]="tab() === t.key"
            (click)="setTab(t.key)"
            (keydown.enter)="setTab(t.key)"
            tabindex="0"
            [attr.data-testid]="'tab-' + t.key"
            >{{ t.label }}
            @if (t.key === 'history') {
              <span class="bf-chip">{{ r.activity.length }}</span>
            }
            @if (t.key === 'documents') {
              <span class="bf-chip">{{ r.documents.length }}</span>
            }
          </a>
        }
      </sat-navigation-tabs>
      @switch (tab()) {
        @case ('history') {
          <div class="bf-layout">
            <div class="bf-layout__main">
              <section class="bf-card" aria-labelledby="history-title">
                <div class="bf-card__header">
                  <h2 class="bf-card__title" id="history-title">Request history</h2>
                  <span class="bf-card__hint">Newest first, from the audit trail</span>
                </div>
                <ol class="bf-timeline" data-testid="request-history">
                  @for (a of history(); track a.id) {
                    <li>
                      <span class="bf-cell__primary bf-history__who"
                        ><sat-avatar
                          size="24"
                          [initials]="initials(a.actorName ?? 'BudgetFlow')"
                          aria-hidden="true"
                        /><span
                          >{{ a.actorName ?? 'BudgetFlow'
                          }}{{ a.onBehalfOfName ? ' for ' + a.onBehalfOfName : '' }}:
                          {{ a.summary }}</span
                        ></span
                      >
                      <span class="bf-cell__secondary"
                        ><span data-testid="relative-time">{{
                          a.at | bfDateTime: session.timezone()
                        }}</span></span
                      >
                      <span class="bf-history__chips">
                        <sat-category-tag category="gray"
                          ><mat-icon [svgIcon]="channelIcon(a)" aria-hidden="true" />{{
                            channelLabel(a)
                          }}</sat-category-tag
                        >
                        @if (doaLimit(a); as limit) {
                          <sat-status-tag status="success"
                            ><mat-icon svgIcon="shield" aria-hidden="true" />Within DoA
                            <bf-money [amountMinor]="limit.amountMinor" [currency]="limit.currency"
                          /></sat-status-tag>
                        }
                        @if (canAudit()) {
                          <a
                            [routerLink]="['/audit-log']"
                            [queryParams]="{ type: 'request', resource: r.id }"
                            >Audit record</a
                          >
                        }
                      </span>
                      @if (a.reason) {
                        <blockquote class="bf-history__quote">“{{ a.reason }}”</blockquote>
                      }
                    </li>
                  }
                </ol>
              </section>
            </div>
            <aside class="bf-layout__side">
              @if (compare(); as c) {
                <section
                  class="bf-card"
                  aria-labelledby="compare-title"
                  data-testid="compare-versions"
                >
                  <div class="bf-card__header">
                    <h2 class="bf-card__title" id="compare-title">Compare versions</h2>
                  </div>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>Compare version {{ c.to.version }} with</mat-label>
                    <mat-select [value]="c.from.version" (valueChange)="baseVersion.set($event)">
                      @for (v of r.versions.slice(0, -1); track v.version) {
                        <mat-option [value]="v.version">Version {{ v.version }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  <dl class="bf-facts">
                    @for (f of c.fields; track f.label) {
                      <div>
                        <dt>{{ f.label }}</dt>
                        <dd>
                          @if (f.changed) {
                            <s>{{ f.from }}</s> → <strong>{{ f.to }}</strong>
                          } @else {
                            {{ f.to }} <span class="bf-cell__secondary">(unchanged)</span>
                          }
                        </dd>
                      </div>
                    }
                  </dl>
                </section>
              }
              @if (r.impact && !closed()) {
                <section class="bf-card" aria-label="Budget impact">
                  <div class="bf-section">
                    <bf-budget-impact [impact]="r.impact" title="Budget impact" />
                  </div>
                </section>
              }
            </aside>
          </div>
        }
        @case ('documents') {
          <section class="bf-card" aria-labelledby="documents-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="documents-title">Documents</h2>
              @if (r.allowedActions.includes('upload')) {
                <a
                  mat-stroked-button
                  routerLink="/requests/upload"
                  [queryParams]="{ request: r.id }"
                  >Upload receipt</a
                >
              }
            </div>
            <bf-documents-panel
              ownerType="request"
              [ownerId]="r.id"
              [documents]="r.documents"
              [canUpload]="r.allowedActions.includes('upload')"
              (changed)="item.reload()"
            />
          </section>
        }
        @default {
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
                      <bf-money
                        [amountMinor]="r.amount.amountMinor"
                        [currency]="r.amount.currency"
                      />
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
                    <dd>{{ spendLabel(r.spendType) }}</dd>
                  </div>
                  <div>
                    <dt>Needed by</dt>
                    <dd>{{ r.neededBy ? (r.neededBy | bfDate: 'UTC') : 'Not set' }}</dd>
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
              </section>
              @if (r.policyCheck; as pc) {
                <section class="bf-card" aria-labelledby="policy-title" data-testid="policy-check">
                  <div class="bf-card__header">
                    <h2 class="bf-card__title" id="policy-title">Policy check</h2>
                    <sat-status-tag [status]="policyTone(pc.effect)">{{
                      pc.outcomeLabel
                    }}</sat-status-tag>
                  </div>
                  <div class="bf-section">
                    <p>{{ pc.explanation }}</p>
                    <p class="bf-card__hint">
                      Checked at {{ pc.stage === 'approve' ? 'approval' : 'submission' }},
                      {{ pc.evaluatedAt | bfDateTime: session.timezone() }}
                    </p>
                  </div>
                  @if (r.benefitRecipients.length || pc.facts.length) {
                    <dl class="bf-facts">
                      @if (r.benefitRecipients.length) {
                        <div>
                          <dt>Benefit recipients</dt>
                          <dd>{{ recipientNames(r) }}</dd>
                        </div>
                      }
                      @if (pc.capPersonName) {
                        <div>
                          <dt>Nearest their cap</dt>
                          <dd>{{ pc.capPersonName }}</dd>
                        </div>
                      }
                      @for (f of pc.facts; track f.fact) {
                        <div>
                          <dt>{{ f.label }}</dt>
                          <dd>{{ f.value }}</dd>
                        </div>
                      }
                    </dl>
                  }
                  @if (pc.matches.length) {
                    <div class="bf-section">
                      <h3 class="bf-section__title">Rules that matched</h3>
                      <ul class="bf-timeline">
                        @for (m of pc.matches; track m.ruleCode) {
                          <li>
                            <strong
                              >{{ m.ruleCode }} v{{ m.version }} {{ m.ruleName
                              }}{{ m.decisive ? ' (decides)' : '' }}</strong
                            >
                            <span>{{ m.explanation }}</span>
                          </li>
                        }
                      </ul>
                    </div>
                  }
                </section>
              }
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
            </div>
            <aside class="bf-layout__side">
              @if (r.impact && !closed()) {
                <section class="bf-card" aria-label="Budget impact">
                  <div class="bf-section">
                    <bf-budget-impact [impact]="r.impact" title="Budget impact analysis" />
                  </div>
                </section>
              } @else if (r.impact) {
                <section class="bf-card" aria-labelledby="released-title">
                  <div class="bf-card__header">
                    <h2 class="bf-card__title" id="released-title">Budget impact</h2>
                  </div>
                  <p class="bf-section bf-muted">
                    This request is {{ closedLabel(r.status) }}, so nothing is held or charged on
                    {{ r.budgetName }} for it.
                  </p>
                </section>
              }
            </aside>
          </div>
        }
      }
    }
  `,
  styles: `
    .bf-timeline .bf-history__who {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .bf-history__chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }
    /* Below 1024px the status tag sits under the title, so the row height does not change
       when the heading font finishes loading (a wrap there was a 0.36 layout shift at 834px). */
    @media (width < 1024px) {
      .bf-title-row {
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }
    }
    .bf-muted {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .bf-offer {
      color: var(--sat-sys-on-info-container);
      font-weight: 600;
    }
    .bf-error-icon {
      width: 16px;
      height: 16px;
      margin-inline-end: 4px;
      vertical-align: -3px;
    }
    .bf-history__quote {
      margin: 8px 0 0;
      padding: 8px 12px;
      border-inline-start: 3px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container);
      font: var(--mat-sys-body-small);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestDetailPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);
  readonly requestId = input.required<string>();
  protected readonly tabs: { key: Tab; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'history', label: 'History' },
    { key: 'documents', label: 'Documents' },
  ];
  protected readonly tab = signal<Tab>(asTab(this.route.snapshot.queryParamMap.get('tab')));
  protected readonly baseVersion = signal<number | null>(null);
  protected readonly canAudit = computed(() => this.session.can('audit.read'));
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected newAmount = '';
  protected newPurpose = '';
  protected resubmitNote = '';

  protected readonly item = resource({
    params: () => ({ requestId: this.requestId() }),
    loader: async ({ params }) => {
      const r = await data(this.api.getRequest({ params }));
      this.newAmount = toMajor(r.amount.amountMinor, r.amount.currency);
      this.newPurpose = r.purpose;
      this.resubmitNote = '';
      return r;
    },
  });
  /** The request, shown once the viewer's decision task (if any) has loaded too, so nothing shifts. */
  protected readonly r = computed(() => {
    const v = valueOf(this.item);
    if (v?.myTaskId && !this.task.hasValue() && !this.task.error()) return undefined;
    return v;
  });
  protected readonly history = computed(() =>
    [...(this.r()?.activity ?? [])].sort((a, b) => b.at.localeCompare(a.at)),
  );
  /** Field-by-field comparison of the latest version with an earlier one (hidden for a single version). */
  protected readonly compare = computed(() => {
    const versions = this.r()?.versions ?? [];
    if (versions.length < 2) return null;
    const to = versions[versions.length - 1]!;
    const from =
      versions.find((v) => v.version === this.baseVersion()) ?? versions[versions.length - 2]!;
    const money = (v: RequestVersion) => formatMoney(v.amount.amountMinor, v.amount.currency);
    const date = (d: string | null) => (d ? formatDate(d, 'mediumDate', 'en-US') : 'Not set');
    const field = (label: string, a: string | null, b: string | null) => ({
      label,
      from: a ?? 'Not recorded',
      to: b ?? 'Not recorded',
      changed: a !== null && a !== b,
    });
    return {
      from,
      to,
      fields: [
        field('Amount', money(from), money(to)),
        field('Title', from.title, to.title),
        field('Needed by', date(from.neededBy), date(to.neededBy)),
        field('Justification', from.purpose, to.purpose),
      ],
    };
  });
  protected readonly task = resource({
    params: () => {
      const taskId = valueOf(this.item)?.myTaskId;
      return taskId ? { taskId } : undefined;
    },
    loader: ({ params }) => data(this.api.getApprovalTask({ params })),
  });

  protected kind(k: string): string {
    return KIND[k] ?? k;
  }

  /** Final statuses: the request no longer holds or consumes budget, so no after-approval figures. */
  protected readonly closed = computed(() =>
    ['rejected', 'withdrawn', 'cancelled'].includes(this.r()?.status ?? ''),
  );

  protected rejectedText(r: { decisionReason?: string | null; budgetName: string }): string {
    const reason = r.decisionReason?.trim().replace(/[.!?]+$/, '');
    return `Rejected${reason ? ': ' + reason : ''}. Nothing was charged to ${r.budgetName}; to ask again, start a new request.`;
  }

  protected closedLabel(status: string): string {
    return status === 'rejected' ? 'rejected' : status === 'withdrawn' ? 'withdrawn' : 'cancelled';
  }

  /** Soft warning in the warning tone, a block in the important tone (budget-safety visual rules). */
  protected policyTone(
    effect: PolicyCheckView['effect'],
  ): 'important' | 'warning' | 'info' | 'neutral' {
    if (effect === 'block' || effect === 'freeze') return 'important';
    if (effect === 'warn') return 'warning';
    if (effect === 'require_approval') return 'info';
    return 'neutral';
  }

  protected recipientNames(r: RequestDetail): string {
    return r.benefitRecipients.map((p) => p.displayName).join(', ');
  }

  protected spendLabel(type: string): string {
    const words = type.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /** Shows the amount field in its error state once it has been touched and cannot be sent. */
  protected readonly amountMatcher: ErrorStateMatcher = {
    isErrorState: (control) => !!control?.touched && this.amountProblem() !== null,
  };

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('');
  }

  protected channelIcon(a: ActivityEntry): string {
    if (a.channel === 'email') return 'mail';
    if (a.channel === 'slack') return 'slack';
    if (a.channel === 'teams') return 'chat';
    if (a.channel === 'mobile') return 'phone';
    return a.actorName === 'BudgetFlow' || !a.actorName ? 'sync' : 'monitor';
  }

  protected setTab(t: Tab): void {
    this.tab.set(t);
    void this.router.navigate([], {
      queryParams: { tab: t === 'details' ? null : t },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected channelLabel(a: ActivityEntry): string {
    if (a.channel === 'email') return 'Email';
    if (a.channel === 'slack') return 'Slack';
    if (a.channel === 'teams') return 'Teams';
    if (a.channel === 'mobile') return 'Mobile';
    return a.actorName === 'BudgetFlow' || !a.actorName ? 'System' : 'Web';
  }

  /** The delegation-of-authority limit the approver decided under, for approval decisions. */
  protected doaLimit(a: ActivityEntry): MoneyAmount | null {
    if (!DECISION_ACTIONS.test(a.action) || !a.actorName) return null;
    const step = this.r()?.route?.steps.find((s) => s.decidedAt && s.actedByName === a.actorName);
    return step?.limit ?? null;
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
    const note = this.resubmitNote.trim();
    void this.run(
      () =>
        data(
          this.api.resubmitRequest({
            params: { requestId: r.id },
            body: {
              ...(amount ? { amount: { amountMinor: amount, currency: r.amount.currency } } : {}),
              purpose: this.newPurpose.trim(),
              ...(note ? { note } : {}),
            },
          }),
        ),
      'Request resubmitted',
    );
  }

  protected acceptOffer(): void {
    const r = this.r()!;
    void this.run(
      () => data(this.api.acceptCounterOffer({ params: { requestId: r.id } })),
      `Accepted ${this.money(r.counterOffer!.amount)}; ${r.ref} is approved at that amount`,
    );
  }

  protected money(m: MoneyAmount): string {
    return formatMoney(m.amountMinor, m.currency);
  }

  /** Why the typed amount cannot be sent, so an unusable figure never reads as "nothing changed". */
  protected amountProblem(): string | null {
    const r = this.r();
    if (!r) return null;
    const typed = this.newAmount.trim();
    if (!typed) return 'Enter the amount you are asking for.';
    const amount = toMinor(typed, r.amount.currency);
    if (amount === null) return 'That amount is not a number. Use digits, for example 160.00.';
    if (amount <= 0) return 'The amount has to be more than zero.';
    return null;
  }

  /** What the resubmission would send, next to what the approver saw, so version 2 is deliberate. */
  protected changes(): { label: string; before: string; after: string }[] {
    const r = this.r();
    if (!r || this.amountProblem()) return [];
    const out: { label: string; before: string; after: string }[] = [];
    const amount = toMinor(this.newAmount, r.amount.currency);
    if (amount && amount !== r.amount.amountMinor)
      out.push({
        label: 'Amount',
        before: this.money(r.amount),
        after: formatMoney(amount, r.amount.currency),
      });
    const purpose = this.newPurpose.trim();
    if (purpose && purpose !== r.purpose)
      out.push({ label: 'Justification', before: r.purpose, after: purpose });
    return out;
  }

  protected canResubmit(): boolean {
    return (
      !this.amountProblem() && this.changes().length > 0 && this.resubmitNote.trim().length > 0
    );
  }
}
