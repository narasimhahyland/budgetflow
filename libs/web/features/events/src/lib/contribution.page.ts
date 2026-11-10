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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import {
  ApprovalRoute,
  DateOnlyPipe,
  formatMoney,
  LoadState,
  Money,
  SpendStatus,
} from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, valueOf } from './api';
import { DocumentsPanel } from './documents-panel';
import { toMinor } from './money-input';

type Choice = 'full' | 'part' | 'decline';
const REASONS = [
  { code: 'TRF-COFUND', label: 'Co-funding a shared event' },
  { code: 'REJ-BUDGET', label: 'Insufficient budget' },
  { code: 'REJ-POLICY', label: 'Outside policy' },
];

/** Screen 56a: the giving director decides an Inter-Director Budget Contribution Request in full, in part, or declines it. */
@Component({
  selector: 'bf-contribution-page',
  imports: [
    DateOnlyPipe,
    ApprovalRoute,
    DocumentsPanel,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
    SpendStatus,
  ],
  template: `
    <bf-load-state
      [loading]="item.isLoading() && !item.hasValue()"
      [error]="item.error()"
      what="the contribution request"
      (retry)="item.reload()"
    />
    @if (c(); as c) {
      <header class="bf-page__header">
        <div class="bf-page__heading">
          <div class="bf-title-row">
            <h1 class="bf-page__title">Inter-Director Budget Contribution Request</h1>
            @if (deciding()) {
              <span class="bf-chip">Awaiting your decision</span>
            } @else {
              <bf-spend-status kind="contribution" [status]="c.status" />
            }
          </div>
          <p class="bf-meta">
            <span class="bf-chip">{{ c.ref }}</span>
            <span
              >from {{ c.requesterName }} ({{ c.receiverBudgetName }}) to {{ c.giverOwnerName }} ({{
                c.giverBudgetName
              }})</span
            >
            @if (c.eventId) {
              <span
                >for <a [routerLink]="['/events', c.eventId]">{{ c.eventName }}</a></span
              >
            }
          </p>
        </div>
        @if (c.allowedActions.includes('withdraw')) {
          <div class="bf-page__actions">
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="withdraw()">
              Withdraw
            </button>
          </div>
        }
      </header>
      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
      @if (c.onHold) {
        <sat-banner variant="info"
          ><sat-banner-message>{{ c.holdReason }}</sat-banner-message></sat-banner
        >
      }
      <div class="bf-layout">
        <div class="bf-layout__main">
          @if (deciding()) {
            <section class="bf-card" aria-labelledby="decision-title">
              <div class="bf-card__header">
                <h2 class="bf-card__title" id="decision-title">Your decision</h2>
              </div>
              <div class="bf-section">
                <p class="bf-kpi__label">The ask</p>
                <p class="bf-kpi__value">
                  <bf-money
                    [amountMinor]="c.requested.amountMinor"
                    [currency]="c.requested.currency"
                  />
                </p>
                <p class="bf-meta">
                  <span class="bf-chip">{{
                    c.mode === 'earmark' ? 'Earmark (default)' : 'Transfer'
                  }}</span>
                  Submitted
                  <span data-testid="relative-time">{{
                    c.createdAt | bfDate: session.timezone()
                  }}</span>
                </p>
              </div>
              <div class="bf-options" role="radiogroup" aria-label="Decision">
                <button
                  type="button"
                  role="radio"
                  class="bf-option"
                  [class.bf-option--selected]="choice() === 'full'"
                  [attr.aria-checked]="choice() === 'full'"
                  (click)="choice.set('full')"
                >
                  <span class="bf-option__title">Contribute in full</span>
                  <bf-money
                    [amountMinor]="c.requested.amountMinor"
                    [currency]="c.requested.currency"
                  />
                  <span class="bf-cell__secondary">100% of the requested amount</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  class="bf-option"
                  [class.bf-option--selected]="choice() === 'part'"
                  [attr.aria-checked]="choice() === 'part'"
                  (click)="choice.set('part')"
                >
                  <span class="bf-option__title">Contribute part</span>
                  <span>{{ partText() }}</span>
                  <span class="bf-cell__secondary">Custom amount</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  class="bf-option"
                  [class.bf-option--selected]="choice() === 'decline'"
                  [attr.aria-checked]="choice() === 'decline'"
                  (click)="choice.set('decline')"
                >
                  <span class="bf-option__title">Decline</span>
                  <span>{{ zero() }}</span>
                  <span class="bf-cell__secondary">Reject the contribution</span>
                </button>
              </div>
              <div class="bf-form">
                @if (choice() === 'part') {
                  <mat-form-field appearance="outline" class="bf-form__wide">
                    <mat-label>Approved contribution amount ({{ c.requested.currency }})</mat-label>
                    <input
                      matInput
                      inputmode="decimal"
                      [(ngModel)]="partAmount"
                      name="part"
                      (ngModelChange)="touch()"
                    />
                    <mat-hint>More than zero and less than {{ money(c.requested) }}</mat-hint>
                  </mat-form-field>
                }
                <mat-form-field appearance="outline" class="bf-form__wide">
                  <mat-label>Reason code{{ choice() === 'full' ? ' (optional)' : '' }}</mat-label>
                  <mat-select [(ngModel)]="reasonCode" name="reason">
                    @for (r of reasons; track r.code) {
                      <mat-option [value]="r.code">{{ r.code }} · {{ r.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" class="bf-form__wide">
                  <mat-label>Message to {{ c.requesterName }}</mat-label>
                  <textarea matInput rows="3" [(ngModel)]="message" name="message"></textarea>
                </mat-form-field>
              </div>
              @if (c.intercompany) {
                <sat-banner
                  [variant]="c.intercompany.mode === 'block' ? 'important' : 'info'"
                  class="bf-banner"
                  ><sat-banner-message
                    >Cross-entity: {{ c.intercompany.giverEntityName }} to
                    {{ c.intercompany.receiverEntityName }}.
                    {{ c.intercompany.message }}</sat-banner-message
                  ></sat-banner
                >
              }
              @if (choice() === 'full' && c.giverPosition?.lowAfterFull) {
                <sat-banner variant="warning" class="bf-banner"
                  ><sat-banner-message
                    >Contributing in full leaves your budget with less than 10%
                    available.</sat-banner-message
                  ></sat-banner
                >
              }
              @if (choice() !== 'decline') {
                <div class="bf-section">
                  <mat-checkbox [(ngModel)]="attested" name="attest"
                    >I have no conflict of interest</mat-checkbox
                  >
                </div>
              }
              <div class="bf-form__actions">
                <a mat-button routerLink="/approvals">Cancel</a>
                @if (choice() === 'decline') {
                  <button
                    mat-stroked-button
                    satImportantButton
                    type="button"
                    [disabled]="busy() || !reasonCode"
                    (click)="decide()"
                  >
                    Decline request
                  </button>
                } @else {
                  <button
                    mat-flat-button
                    type="button"
                    [disabled]="busy() || !attested || (choice() === 'part' && !reasonCode)"
                    (click)="decide()"
                  >
                    Contribute {{ choice() === 'full' ? money(c.requested) : partText() }}
                  </button>
                }
              </div>
            </section>
          } @else {
            <section class="bf-card" aria-labelledby="summary-title">
              <div class="bf-card__header">
                <h2 class="bf-card__title" id="summary-title">Request</h2>
              </div>
              <dl class="bf-facts">
                <div>
                  <dt>Requested</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="c.requested.amountMinor"
                      [currency]="c.requested.currency"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Approved</dt>
                  <dd>
                    @if (c.approved) {
                      <bf-money
                        [amountMinor]="c.approved.amountMinor"
                        [currency]="c.approved.currency"
                      />
                    } @else {
                      —
                    }
                  </dd>
                </div>
                <div>
                  <dt>Mode</dt>
                  <dd>{{ c.mode === 'earmark' ? 'Earmark' : 'Transfer' }}</dd>
                </div>
                <div>
                  <dt>Decided by</dt>
                  <dd>{{ c.decidedByName ?? '—' }}</dd>
                </div>
                @if (c.reasonCode) {
                  <div>
                    <dt>Reason code</dt>
                    <dd>{{ c.reasonCode }}</dd>
                  </div>
                }
                @if (c.message) {
                  <div>
                    <dt>Message</dt>
                    <dd>{{ c.message }}</dd>
                  </div>
                }
                @if (c.cancelReason) {
                  <div>
                    <dt>Cancelled</dt>
                    <dd>{{ c.cancelReason }}</dd>
                  </div>
                }
              </dl>
              @if (c.intercompany) {
                <sat-banner variant="info" class="bf-banner"
                  ><sat-banner-message
                    >{{ c.intercompany.message
                    }}{{
                      c.intercompany.rechargeStatus
                        ? ' Recharge: ' + c.intercompany.rechargeStatus.replace('_', ' ') + '.'
                        : ''
                    }}</sat-banner-message
                  ></sat-banner
                >
              }
            </section>
          }
          <section class="bf-card" aria-labelledby="purpose-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="purpose-title">Purpose and funding mode</h2>
            </div>
            <p class="bf-section">{{ c.purpose }}</p>
            <div class="bf-options">
              <div class="bf-option bf-option--selected">
                <span class="bf-option__title">Earmark (default)</span
                ><span class="bf-cell__secondary"
                  >Money stays in the giving budget, reserved for this event; what is not spent
                  returns after close.</span
                >
              </div>
              <div class="bf-option" [attr.aria-disabled]="!c.transferAllowed">
                <span class="bf-option__title"
                  >Transfer{{ c.transferAllowed ? '' : ' (not available)' }}</span
                ><span class="bf-cell__secondary">{{
                  c.transferAllowed
                    ? 'Moves the money to the event’s home budget.'
                    : 'Only within one legal entity.'
                }}</span>
              </div>
            </div>
          </section>
          @if (c.route) {
            <section class="bf-card" aria-labelledby="route-title">
              <div class="bf-card__header">
                <h2 class="bf-card__title" id="route-title">Approval route</h2>
              </div>
              <div class="bf-section"><bf-approval-route [route]="c.route" /></div>
            </section>
          }
          <section class="bf-card" aria-labelledby="docs-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="docs-title">Documents</h2>
            </div>
            <bf-documents-panel
              ownerType="contribution"
              [ownerId]="c.id"
              [documents]="c.documents"
              [canUpload]="c.allowedActions.includes('upload')"
              (changed)="item.reload()"
            />
          </section>
        </div>
        <aside class="bf-layout__side">
          @if (c.giverPosition; as g) {
            <section class="bf-card" aria-labelledby="position-title">
              <div class="bf-card__header">
                <h2 class="bf-card__title" id="position-title">
                  Your budget: {{ c.giverBudgetName }}
                </h2>
              </div>
              <dl class="bf-facts">
                <div>
                  <dt>Authorized</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="g.authorized.amountMinor"
                      [currency]="g.authorized.currency"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Earmarked</dt>
                  <dd>
                    <bf-money [amountMinor]="g.held.amountMinor" [currency]="g.held.currency" />
                  </dd>
                </div>
                <div>
                  <dt>Available under this budget's rules</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="g.available.amountMinor"
                      [currency]="g.available.currency"
                    />
                  </dd>
                </div>
                <div>
                  <dt>After this contribution</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="g.available.amountMinor - decisionMinor()"
                      [currency]="g.available.currency"
                    />
                  </dd>
                </div>
              </dl>
            </section>
          }
          @if (c.cofunding; as f) {
            <section class="bf-card" aria-labelledby="progress-title">
              <div class="bf-card__header">
                <h2 class="bf-card__title" id="progress-title">
                  Co-funding progress for this event
                </h2>
              </div>
              <dl class="bf-facts">
                <div>
                  <dt>Estimate</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="f.estimate.amountMinor"
                      [currency]="f.estimate.currency"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Currently funded</dt>
                  <dd>
                    <bf-money [amountMinor]="f.funded.amountMinor" [currency]="f.funded.currency" />
                  </dd>
                </div>
                @if (deciding()) {
                  <div>
                    <dt>This decision adds</dt>
                    <dd>
                      <bf-money [amountMinor]="decisionMinor()" [currency]="f.funded.currency" />
                    </dd>
                  </div>
                }
                <div>
                  <dt>Gap {{ deciding() ? 'after this decision' : '' }}</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="max0(f.gap.amountMinor - (deciding() ? decisionMinor() : 0))"
                      [currency]="f.gap.currency"
                    />
                  </dd>
                </div>
              </dl>
              @if (c.eventId) {
                <div class="bf-form__actions">
                  <a
                    mat-button
                    routerLink="/events/cofunding-board"
                    [queryParams]="{ event: c.eventId }"
                    >Open co-funding board</a
                  >
                </div>
              }
            </section>
          }
          <p class="bf-cell__secondary">
            Your decision is audited and {{ c.requesterName }} is notified.
          </p>
        </aside>
      </div>
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContributionPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  readonly contributionId = input.required<string>();
  protected readonly reasons = REASONS;
  protected readonly choice = signal<Choice>('full');
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  private readonly version = signal(0);
  protected partAmount = '';
  protected reasonCode = '';
  protected message = '';
  protected attested = false;

  protected readonly item = resource({
    params: () => ({ contributionId: this.contributionId() }),
    loader: ({ params }) => data(this.api.getContribution({ params })),
  });
  protected readonly c = computed(() => valueOf(this.item));
  protected readonly deciding = computed(
    () => this.c()?.allowedActions.includes('decide') ?? false,
  );
  protected readonly partMinor = computed(() => {
    this.version();
    return toMinor(this.partAmount, this.c()?.requested.currency ?? 'USD');
  });
  protected readonly decisionMinor = computed(() => {
    const c = this.c();
    if (!c) return 0;
    return this.choice() === 'full'
      ? c.requested.amountMinor
      : this.choice() === 'part'
        ? (this.partMinor() ?? 0)
        : 0;
  });
  protected readonly partText = computed(() =>
    this.money({
      amountMinor: this.partMinor() ?? 0,
      currency: this.c()?.requested.currency ?? 'USD',
    }),
  );
  protected readonly zero = computed(() =>
    this.money({ amountMinor: 0, currency: this.c()?.requested.currency ?? 'USD' }),
  );

  protected money(m: { amountMinor: number; currency: string }): string {
    return formatMoney(m.amountMinor, m.currency);
  }

  protected max0(v: number): number {
    return Math.max(v, 0);
  }

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  protected async decide(): Promise<void> {
    const c = this.c()!;
    this.busy.set(true);
    this.failure.set('');
    const choice = this.choice();
    try {
      const r = await data(
        this.api.decideContribution({
          params: { contributionId: c.id },
          body: {
            decision:
              choice === 'full' ? 'approve' : choice === 'part' ? 'approve_partial' : 'reject',
            ...(choice === 'part'
              ? {
                  approvedAmount: {
                    amountMinor: this.partMinor() ?? 0,
                    currency: c.requested.currency,
                  },
                }
              : {}),
            ...(this.reasonCode ? { reasonCode: this.reasonCode } : {}),
            ...(this.message.trim() ? { comment: this.message.trim() } : {}),
            noConflictAttested: choice !== 'decline' && this.attested,
          },
        }),
      );
      this.snack.open(r.message, undefined, { duration: 5000 });
      this.item.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async withdraw(): Promise<void> {
    this.busy.set(true);
    try {
      await data(this.api.withdrawContribution({ params: { contributionId: this.c()!.id } }));
      this.snack.open('Contribution request withdrawn', undefined, { duration: 4000 });
      this.item.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
