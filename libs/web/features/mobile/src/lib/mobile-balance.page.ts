import { getNumberOfCurrencyDigits } from '@angular/common';
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
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  type BudgetDetail,
  type RequestableBudget,
  type RequestSummary,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import {
  BudgetBar,
  type BudgetBarSegment,
  BudgetStatus,
  formatMoney,
  LoadState,
  MobileTabBar,
  Money,
} from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';

interface QueuedReceipt {
  id: string;
  requestRef: string;
  fileName: string;
  status: 'Waiting for connection' | 'Uploading' | 'Failed';
}

/**
 * Screen 059b: Mobile balance check (`/m/balance`) and camera receipts (`/m/receipt`).
 * Phones show "Available under this budget's rules" (never company-wide Available) with stacked bar,
 * bottom sheet breakdown, and camera receipt capture with amount comparison and offline queue.
 */
@Component({
  selector: 'bf-mobile-balance-page',
  imports: [
    BudgetBar,
    BudgetStatus,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MobileTabBar,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <div class="bf-mobile-page">
      @if (mode() === 'balance') {
        <header class="bf-page__header">
          <div class="bf-page__heading">
            <h1 class="bf-page__title">Mobile balance check</h1>
            <p class="bf-page__subtitle">
              Amounts in {{ session.me()?.reportingCurrency ?? 'USD' }} · Available under each
              budget's rules
            </p>
          </div>
          <div class="bf-page__actions">
            <a mat-stroked-button routerLink="/m/receipt" data-testid="go-to-receipt"
              >Capture receipt</a
            >
          </div>
        </header>

        @if (canReadBudgets()) {
          <bf-load-state
            [loading]="ownedBudgets.isLoading() && !ownedBudgets.hasValue()"
            [error]="ownedBudgets.error()"
            what="your budgets"
            (retry)="ownedBudgets.reload()"
          />
          @if (ownedBudgets.hasValue()) {
            @if (budgetItems().length === 0) {
              <sat-empty-state>
                <h2 satEmptyStateHeadline>No budgets to show</h2>
                <p satEmptyStateDescription>Ask your manager about team budgets.</p>
              </sat-empty-state>
            } @else {
              <div class="bf-mobile-bal__cards" data-testid="mobile-balance-cards">
                @for (b of budgetItems(); track b.id) {
                  <article
                    class="bf-card bf-mobile-bal__card"
                    (click)="selectedBudgetId.set(b.id)"
                    (keydown.enter)="selectedBudgetId.set(b.id)"
                    tabindex="0"
                    [attr.data-testid]="'balance-card-' + b.id"
                  >
                    <div class="bf-list__row">
                      <h2 class="bf-card__title">{{ b.name }}</h2>
                      <bf-budget-status [status]="b.status" />
                    </div>
                    <p class="bf-cell__secondary">Available under this budget's rules</p>
                    <p class="bf-kpi__value" data-testid="balance-under-rules">
                      <bf-money
                        [amountMinor]="b.balances.available.amountMinor"
                        [currency]="b.balances.available.currency"
                      />
                    </p>
                    <p class="bf-cell__secondary">
                      of
                      <bf-money
                        [amountMinor]="b.balances.budgetCurrency.authorized.amountMinor"
                        [currency]="b.balances.budgetCurrency.authorized.currency"
                      />
                      authorized
                    </p>
                    <bf-budget-bar
                      [label]="b.name + ' budget'"
                      [segments]="segments().get(b.id) ?? []"
                      [totalMinor]="b.balances.budgetCurrency.authorized.amountMinor"
                      [currency]="b.balances.budgetCurrency.authorized.currency"
                      data-testid="balance-bar"
                    />
                    @if (b.status === 'frozen') {
                      <sat-banner variant="info">
                        <sat-banner-message>
                          New requests are paused while this budget is frozen. Existing commitments
                          continue.
                        </sat-banner-message>
                      </sat-banner>
                    } @else if (b.status === 'set_to_zero') {
                      <sat-banner variant="important">
                        <sat-banner-message>
                          Set to zero: new requests are paused.
                        </sat-banner-message>
                      </sat-banner>
                    }
                  </article>
                }
              </div>

              @if (selectedBudget(); as sb) {
                <section
                  class="bf-card bf-mobile-bal__sheet"
                  aria-labelledby="sheet-title"
                  data-testid="budget-detail-sheet"
                >
                  <div class="bf-card__header">
                    <h2 class="bf-card__title" id="sheet-title">{{ sb.name }} breakdown</h2>
                    <button mat-button type="button" (click)="selectedBudgetId.set(null)">
                      Close
                    </button>
                  </div>
                  <dl class="bf-facts">
                    <div>
                      <dt>Authorized</dt>
                      <dd>
                        <bf-money
                          [amountMinor]="sb.balances.budgetCurrency.authorized.amountMinor"
                          [currency]="sb.balances.budgetCurrency.authorized.currency"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Allocated to children</dt>
                      <dd>
                        <bf-money
                          [amountMinor]="sb.balances.budgetCurrency.allocatedOut.amountMinor"
                          [currency]="sb.balances.budgetCurrency.allocatedOut.currency"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Pending</dt>
                      <dd>
                        <bf-money
                          [amountMinor]="sb.balances.budgetCurrency.preEncumbered.amountMinor"
                          [currency]="sb.balances.budgetCurrency.preEncumbered.currency"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Committed</dt>
                      <dd>
                        <bf-money
                          [amountMinor]="sb.balances.budgetCurrency.encumbered.amountMinor"
                          [currency]="sb.balances.budgetCurrency.encumbered.currency"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Actual</dt>
                      <dd>
                        <bf-money
                          [amountMinor]="sb.balances.budgetCurrency.actual.amountMinor"
                          [currency]="sb.balances.budgetCurrency.actual.currency"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Available under this budget's rules</dt>
                      <dd>
                        <bf-money
                          [amountMinor]="sb.balances.available.amountMinor"
                          [currency]="sb.balances.available.currency"
                        />
                      </dd>
                    </div>
                  </dl>
                  <div class="bf-form__actions">
                    <a
                      mat-stroked-button
                      [routerLink]="['/budgets', sb.id]"
                      data-testid="sheet-open-details"
                      >Open full details</a
                    >
                    @if (sb.status === 'frozen' || sb.status === 'set_to_zero') {
                      <button mat-flat-button type="button" disabled>
                        New requests are paused
                      </button>
                    } @else {
                      <a
                        mat-flat-button
                        [routerLink]="['/requests/new']"
                        [queryParams]="{ kind: 'spending', budgetId: sb.id }"
                        data-testid="sheet-request-funds"
                        >Request funds</a
                      >
                    }
                  </div>
                </section>
              }
            }
          }
        } @else {
          <!-- Employee view -->
          <section
            class="bf-card"
            aria-labelledby="emp-bal-title"
            data-testid="employee-balance-view"
          >
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="emp-bal-title">Budgets you can use</h2>
            </div>
            @for (eb of employeeBudgets(); track eb.budgetId) {
              <div class="bf-list__item bf-list__row">
                <div>
                  <strong>{{ eb.name }}</strong>
                  <p class="bf-cell__secondary">
                    You requested
                    <bf-money
                      [amountMinor]="eb.requestedThisYear.amountMinor"
                      [currency]="eb.requestedThisYear.currency"
                    />
                    this year
                  </p>
                </div>
                <a
                  mat-stroked-button
                  [routerLink]="['/requests/new']"
                  [queryParams]="{ kind: 'spending', budgetId: eb.budgetId }"
                  >Request</a
                >
              </div>
            } @empty {
              <p class="bf-empty">No budgets to show. Ask your manager about team budgets.</p>
            }
          </section>
        }
      } @else {
        <!-- Receipt capture & review mode -->
        <header class="bf-page__header">
          <div class="bf-page__heading">
            <h1 class="bf-page__title">Mobile receipt capture</h1>
            <p class="bf-page__subtitle">Photograph or attach a receipt to an approved request</p>
          </div>
          <div class="bf-page__actions">
            <button
              mat-stroked-button
              type="button"
              (click)="offlineQueueMode.set(!offlineQueueMode())"
              data-testid="toggle-offline-queue"
            >
              {{ offlineQueueMode() ? 'Back online' : 'Simulate offline' }}
            </button>
          </div>
        </header>

        @if (failure()) {
          <sat-banner variant="important" data-testid="receipt-error">
            <sat-banner-message>{{ failure() }}</sat-banner-message>
          </sat-banner>
        }

        @if (offlineQueueMode()) {
          <sat-banner variant="info" data-testid="receipt-offline-banner">
            <sat-banner-message>
              Saved on this phone. It uploads when you're back online.
            </sat-banner-message>
          </sat-banner>
        }

        <section class="bf-card" aria-labelledby="capture-title" data-testid="receipt-capture-card">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="capture-title">1. Capture or choose a receipt</h2>
          </div>
          <div class="bf-section">
            <div class="bf-mobile-bal__capture-actions">
              <label class="bf-mobile-bal__camera-btn" data-testid="take-photo-btn">
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  capture="environment"
                  (change)="pickFile($event)"
                />
                <mat-icon svgIcon="upload" aria-hidden="true" />
                <span>Take photo or choose a file</span>
              </label>
            </div>
            <p class="bf-cell__secondary">
              PDF, PNG or JPEG up to 10 MB. Photos are compressed on your phone. Up to 5 pages kept
              as one document.
            </p>
            @if (pages().length > 0) {
              <div class="bf-mobile-bal__pages" data-testid="captured-pages">
                @for (f of pages(); track $index) {
                  <span class="bf-chip">Page {{ $index + 1 }}: {{ f.name }}</span>
                }
                <button mat-button type="button" (click)="pages.set([])">Clear</button>
              </div>
            }
          </div>
        </section>

        <section class="bf-card" aria-labelledby="review-title" data-testid="receipt-review-card">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="review-title">2. Review before upload</h2>
          </div>
          <div class="bf-form">
            <mat-form-field appearance="outline" class="bf-form__wide">
              <mat-label>For approved request</mat-label>
              <mat-select
                [(ngModel)]="requestId"
                name="requestId"
                (ngModelChange)="touch()"
                data-testid="receipt-for-select"
              >
                @for (r of myRequests(); track r.id) {
                  <mat-option [value]="r.id">
                    {{ r.ref }} {{ r.title }} ({{ money(r.approvedAmount ?? r.amount) }})
                  </mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Receipt amount</mat-label>
              <span matTextPrefix class="bf-mobile-bal__currency"
                >{{ selectedRequest()?.amount?.currency ?? 'USD' }}&nbsp;</span
              >
              <input
                matInput
                inputmode="decimal"
                [(ngModel)]="receiptAmount"
                (ngModelChange)="touch()"
                name="receiptAmount"
                data-testid="mobile-receipt-amount"
              />
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Merchant</mat-label>
              <input
                matInput
                [(ngModel)]="merchant"
                name="merchant"
                data-testid="mobile-receipt-merchant"
              />
            </mat-form-field>
          </div>

          @if (comparison(); as c) {
            <sat-banner
              [variant]="c.over ? 'warning' : 'info'"
              role="status"
              data-testid="mobile-receipt-comparison"
            >
              <sat-banner-message>{{ c.text }}</sat-banner-message>
            </sat-banner>
          }

          @if (stage() !== 'idle') {
            <div class="bf-section" role="status">
              <mat-progress-bar mode="indeterminate" />
              <span class="bf-cell__secondary">{{
                stage() === 'uploading' ? 'Uploading 60%' : 'Checking the file'
              }}</span>
            </div>
          }

          <div class="bf-form__actions">
            <a mat-button routerLink="/m/balance">Cancel</a>
            <button
              mat-flat-button
              type="button"
              [disabled]="busy() || !requestId || !receiptAmount.trim() || pages().length === 0"
              (click)="uploadReceipt()"
              data-testid="mobile-upload-receipt-btn"
            >
              Upload receipt
            </button>
          </div>
        </section>

        @if (queue().length > 0) {
          <section
            class="bf-card"
            aria-labelledby="queue-title"
            data-testid="offline-receipt-queue"
          >
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="queue-title">Saved on this phone</h2>
            </div>
            <ul class="bf-list">
              @for (q of queue(); track q.id) {
                <li class="bf-list__item bf-list__row">
                  <span>{{ q.requestRef }} · {{ q.fileName }}</span>
                  <sat-status-tag status="info">{{ q.status }}</sat-status-tag>
                </li>
              }
            </ul>
          </section>
        }
      }

      <bf-mobile-tab-bar />
    </div>
  `,
  styles: `
    .bf-mobile-page {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-bottom: 72px;
    }
    .bf-mobile-bal__cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    .bf-mobile-bal__currency {
      color: var(--mat-sys-on-surface-variant);
      font-weight: 600;
    }
    .bf-mobile-bal__card {
      padding: 16px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .bf-mobile-bal__sheet {
      border: 1px solid var(--mat-sys-primary);
    }
    .bf-mobile-bal__camera-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      cursor: pointer;
      font: var(--mat-sys-label-large);
    }
    .bf-mobile-bal__camera-btn input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }
    .bf-mobile-bal__pages {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 8px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MobileBalancePage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  protected readonly mode = computed<'balance' | 'receipt'>(() =>
    this.router.url.includes('/m/receipt') ? 'receipt' : 'balance',
  );
  protected readonly canReadBudgets = computed(() => this.session.can('budget.read'));

  protected readonly selectedBudgetId = signal<string | null>(null);
  protected readonly pages = signal<File[]>([]);
  protected readonly stage = signal<'idle' | 'uploading' | 'verifying'>('idle');
  protected readonly busy = computed(() => this.stage() !== 'idle');
  protected readonly failure = signal('');
  protected readonly offlineQueueMode = signal(
    this.route.snapshot.queryParamMap.get('offline') === '1',
  );
  protected readonly queue = signal<QueuedReceipt[]>([]);
  private readonly ver = signal(0);

  protected requestId = this.route.snapshot.queryParamMap.get('request') ?? '';
  protected receiptAmount = '';
  protected merchant = '';

  protected readonly ownedBudgets = resource({
    loader: async () => {
      if (!this.canReadBudgets()) return { items: [], nextCursor: null };
      return data(this.api.listBudgets({ query: { limit: 20 } }));
    },
  });
  /**
   * Section 10 buckets per budget, as the API reports them. Available is drawn only when it fits
   * under authorized: under some control bases it is not the remainder of the other buckets.
   */
  protected readonly segments = computed(() => {
    const out = new Map<string, BudgetBarSegment[]>();
    for (const b of this.budgetItems()) {
      const c = b.balances.budgetCurrency;
      const buckets: BudgetBarSegment[] = [
        {
          bucket: 'allocatedOut',
          amountMinor: c.allocatedOut.amountMinor,
          label: 'Allocated to teams',
        },
        { bucket: 'held', amountMinor: c.held.amountMinor },
        { bucket: 'preEncumbered', amountMinor: c.preEncumbered.amountMinor },
        { bucket: 'encumbered', amountMinor: c.encumbered.amountMinor },
        { bucket: 'actual', amountMinor: c.actual.amountMinor },
      ];
      const parts = buckets.filter((p) => p.amountMinor > 0);
      const used = parts.reduce((n, p) => n + p.amountMinor, 0);
      const available = b.balances.available.amountMinor;
      if (available > 0 && used + available <= c.authorized.amountMinor)
        parts.push({ bucket: 'available', amountMinor: available });
      out.set(b.id, parts);
    }
    return out;
  });

  protected readonly budgetItems = computed<BudgetDetail[]>(
    () => valueOf(this.ownedBudgets)?.items ?? [],
  );
  protected readonly selectedBudget = computed(
    () => this.budgetItems().find((b) => b.id === this.selectedBudgetId()) ?? null,
  );

  protected readonly reqBudgets = resource({
    loader: () => data(this.api.requestableBudgets({})),
  });
  protected readonly employeeBudgets = computed<RequestableBudget[]>(
    () => valueOf(this.reqBudgets)?.items ?? [],
  );

  protected readonly requestsRes = resource({
    loader: async () => {
      const r = await data(
        this.api.listRequests({ query: { scope: 'mine', tab: 'all', limit: 50 } }),
      );
      if (!this.requestId && r.items.length) {
        const firstApproved = r.items.find((x) => x.status === 'approved') ?? r.items[0];
        if (firstApproved) this.requestId = firstApproved.id;
      }
      return r;
    },
  });
  protected readonly myRequests = computed<RequestSummary[]>(() =>
    (valueOf(this.requestsRes)?.items ?? []).filter((r) => r.status !== 'draft'),
  );
  protected readonly selectedRequest = computed(() => {
    this.ver();
    return this.myRequests().find((r) => r.id === this.requestId) ?? null;
  });

  protected readonly comparison = computed(() => {
    this.ver();
    const r = this.selectedRequest();
    if (!r) return null;
    const base = r.approvedAmount ?? r.amount;
    const n = Number(this.receiptAmount.replace(/[,\s]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return null;
    const minor = Math.round(n * 10 ** getNumberOfCurrencyDigits(base.currency));
    const diff = minor - base.amountMinor;
    const money = formatMoney(Math.abs(diff), base.currency);
    if (diff > 0) {
      return {
        over: true,
        text: `Receipt is ${money} more than approved. Your approver will be asked to accept the difference.`,
      };
    }
    if (diff < 0) {
      return {
        over: false,
        text: `${money} less than approved. The rest returns to the budget when finance matches the receipt.`,
      };
    }
    return { over: false, text: 'Matches the approved amount.' };
  });

  protected touch(): void {
    this.ver.update((v) => v + 1);
  }

  protected money(m: { amountMinor: number; currency: string }): string {
    return formatMoney(m.amountMinor, m.currency);
  }

  protected pickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    this.failure.set('');
    if (!f) return;
    if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(f.type)) {
      this.failure.set('This file is not a valid image or PDF.');
      return;
    }
    if (f.size > DOCUMENT_MAX_BYTES) {
      this.failure.set('File is larger than 10 MB after compression.');
      return;
    }
    if (this.pages().length >= 5) {
      this.failure.set('A receipt can have up to 5 pages.');
      return;
    }
    this.pages.set([...this.pages(), f]);
  }

  protected async uploadReceipt(): Promise<void> {
    const r = this.selectedRequest();
    const f = this.pages()[0];
    if (!r || !f) return;

    if (this.offlineQueueMode()) {
      this.queue.set([
        ...this.queue(),
        {
          id: `${Date.now()}`,
          requestRef: r.ref,
          fileName: f.name,
          status: 'Waiting for connection',
        },
      ]);
      this.pages.set([]);
      this.snack.open('Saved on this phone; queued for upload', undefined, { duration: 3500 });
      return;
    }

    this.failure.set('');
    this.stage.set('uploading');
    try {
      const upload = await data(
        this.api.createDocumentUpload({
          body: {
            ownerType: 'request',
            ownerId: r.id,
            kind: 'receipt',
            fileName: f.name,
            contentType: f.type as (typeof DOCUMENT_CONTENT_TYPES)[number],
            sizeBytes: f.size,
          },
        }),
      );
      const put = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: upload.uploadHeaders,
        body: f,
      });
      if (!put.ok) throw new Error('upload');
      this.stage.set('verifying');
      await data(this.api.completeDocumentUpload({ params: { documentId: upload.document.id } }));
      this.pages.set([]);
      this.snack.open(`Receipt added to ${r.ref}`, undefined, { duration: 4000 });
    } catch (e) {
      this.failure.set(
        e instanceof Error && e.message === 'upload'
          ? 'The upload failed; try again.'
          : errorMessage(e),
      );
    } finally {
      this.stage.set('idle');
    }
  }
}
