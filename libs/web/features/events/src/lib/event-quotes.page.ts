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
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { VendorQuoteItem } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { EventTabs } from './event-tabs';
import { label } from './labels';

const POLICY_LABEL: Record<VendorQuoteItem['policyCheck'], string> = {
  within_limit: 'Within the limit',
  above_limit: 'Above the per-head limit',
  above_available: 'Above what is available',
};

/** Screen 51a: vendor quote requests and the side-by-side comparison. Only selecting a quote commits money. */
@Component({
  selector: 'bf-event-quotes-page',
  imports: [
    DateOnlyPipe,
    EventTabs,
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
    SAT_EMPTY_STATE_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Quotes</h1>
        <p class="bf-page__subtitle">
          Compare vendor quotes side by side. Quotes never consume budget; selecting one creates the
          commitment.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button [routerLink]="['/events', eventId()]">Back to the event</a>
      </div>
    </header>

    <bf-event-tabs [eventId]="eventId()" section="quotes" />

    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }

    <bf-load-state
      [loading]="quotes.isLoading() && !quotes.hasValue()"
      [error]="quotes.hasValue() ? undefined : quotes.error()"
      what="the quotes"
      (retry)="quotes.reload()"
    />

    @if (view(); as v) {
      <section class="bf-kpis" aria-label="What the event can still spend">
        <div class="bf-kpi">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Funded</p>
            <mat-icon class="bf-kpi__icon" svgIcon="graph_radial" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            <bf-money [amountMinor]="v.funded.amountMinor" [currency]="v.funded.currency" />
          </p>
        </div>
        <div class="bf-kpi bf-kpi--warning">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Committed</p>
            <mat-icon class="bf-kpi__icon" svgIcon="shield_lock" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            <bf-money [amountMinor]="v.committed.amountMinor" [currency]="v.committed.currency" />
          </p>
        </div>
        <div class="bf-kpi bf-kpi--success">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Available under this event's rules</p>
            <mat-icon class="bf-kpi__icon" svgIcon="circle_check" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value bf-kpi__value--success" data-testid="quotes-available">
            <bf-money [amountMinor]="v.available.amountMinor" [currency]="v.available.currency" />
          </p>
        </div>
      </section>

      @if (v.requests.length === 0) {
        <sat-empty-state>
          <h2 satEmptyStateHeadline>No quotes yet</h2>
          <p satEmptyStateDescription>
            Ask Approved or Preferred vendors from the vendor master for a price, then compare the
            answers here.
          </p>
        </sat-empty-state>
      }

      @for (r of v.requests; track r.id) {
        <section class="bf-card" [attr.aria-label]="'Quotes for ' + r.title">
          <div class="bf-card__header">
            <h2 class="bf-card__title">{{ r.title }}</h2>
            <p class="bf-card__hint">
              {{ r.receivedCount }} of {{ r.totalCount }} received · {{ r.quantity }} people
              @if (r.respondBy) {
                · respond by {{ r.respondBy | bfDate: session.timezone() }}
              }
            </p>
          </div>
          <div class="bf-table-scroll bf-quote-matrix">
            <table class="bf-split-table" [attr.aria-label]="'Compare quotes for ' + r.title">
              <caption>
                Transaction currency and the budget amount at the locked plan rate, side by side.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Attribute</th>
                  @for (q of r.quotes; track q.id) {
                    <th scope="col">{{ q.vendorName }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Vendor status</th>
                  @for (q of r.quotes; track q.id) {
                    <td>
                      <sat-status-tag [status]="vendorTone(q.vendorStatus)">{{
                        label(q.vendorStatus)
                      }}</sat-status-tag>
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">Total</th>
                  @for (q of r.quotes; track q.id) {
                    <td class="bf-num">
                      @if (q.status === 'requested') {
                        <span class="bf-cell__secondary">Waiting for the answer</span>
                      } @else {
                        <span class="bf-cell__primary"
                          ><bf-money
                            [amountMinor]="q.amount.amountMinor"
                            [currency]="q.amount.currency"
                        /></span>
                        <span class="bf-cell__secondary"
                          >=
                          <bf-money
                            [amountMinor]="q.budgetAmount.amountMinor"
                            [currency]="q.budgetAmount.currency"
                          />
                        </span>
                        @if (q.isLowest) {
                          <sat-status-tag status="success">Lowest</sat-status-tag>
                        }
                      }
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">Per head</th>
                  @for (q of r.quotes; track q.id) {
                    <td class="bf-num">
                      <bf-money
                        [amountMinor]="q.perHead.amountMinor"
                        [currency]="q.perHead.currency"
                      />
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">Deposit</th>
                  @for (q of r.quotes; track q.id) {
                    <td>
                      {{ q.depositPct }}%,
                      {{ q.depositRefundable ? 'refundable' : 'non-refundable' }}
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">Cancellation</th>
                  @for (q of r.quotes; track q.id) {
                    <td>{{ q.cancellationTerms ?? 'Not given' }}</td>
                  }
                </tr>
                <tr>
                  <th scope="row">Valid until</th>
                  @for (q of r.quotes; track q.id) {
                    <td>
                      {{ q.validUntil ? (q.validUntil | bfDate: session.timezone()) : 'Not given' }}
                      @if (q.expired) {
                        <sat-status-tag status="neutral"
                          ><mat-icon
                            svgIcon="timer_off"
                            aria-hidden="true"
                          />Expired</sat-status-tag
                        >
                      }
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">Includes</th>
                  @for (q of r.quotes; track q.id) {
                    <td>{{ q.includesText ?? 'Not given' }}</td>
                  }
                </tr>
                <tr>
                  <th scope="row">Policy check</th>
                  @for (q of r.quotes; track q.id) {
                    <td>
                      <sat-status-tag [status]="policyTone(q.policyCheck)">{{
                        policyLabel(q.policyCheck)
                      }}</sat-status-tag>
                      <span class="bf-cell__secondary">
                        @if (q.policyCheck === 'above_available') {
                          Exceeds what is available under this event's rules by
                          <bf-money
                            [amountMinor]="q.exceedsAvailableByMinor"
                            [currency]="q.budgetAmount.currency"
                          />.
                        } @else {
                          {{ q.policyMessage }}
                        }
                      </span>
                    </td>
                  }
                </tr>
                @if (v.canManage) {
                  <tr>
                    <th scope="row">Decision</th>
                    @for (q of r.quotes; track q.id) {
                      <td>
                        @if (q.status === 'selected') {
                          <sat-status-tag status="success"
                            ><mat-icon
                              svgIcon="circle_check"
                              aria-hidden="true"
                            />Selected</sat-status-tag
                          >
                        } @else if (q.status === 'declined') {
                          <sat-status-tag status="neutral"
                            ><mat-icon
                              svgIcon="circle_x"
                              aria-hidden="true"
                            />Declined</sat-status-tag
                          >
                        } @else if (q.status === 'requested') {
                          <span class="bf-cell__secondary">No price yet</span>
                        } @else {
                          <button
                            mat-flat-button
                            satImportantButton
                            type="button"
                            [disabled]="busy() || q.expired || q.policyCheck === 'above_available'"
                            (click)="select(q)"
                            [attr.data-testid]="'select-quote'"
                          >
                            Select this quote
                          </button>
                          @if (q.expired || q.policyCheck === 'above_available') {
                            <span class="bf-cell__secondary">{{
                              q.expired
                                ? 'The quote has expired.'
                                : 'Above what the event can still commit.'
                            }}</span>
                          }
                          <button mat-button type="button" [disabled]="busy()" (click)="decline(q)">
                            Decline
                          </button>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <ul class="bf-quote-cards" [attr.aria-label]="'Quotes for ' + r.title">
            @for (q of r.quotes; track q.id) {
              <li class="bf-quote-card">
                <div class="bf-list__row">
                  <strong>{{ q.vendorName }}</strong>
                  <sat-status-tag [status]="vendorTone(q.vendorStatus)">{{
                    label(q.vendorStatus)
                  }}</sat-status-tag>
                </div>
                <dl class="bf-facts">
                  <div>
                    <dt>Total</dt>
                    <dd>
                      @if (q.status === 'requested') {
                        Waiting for the answer
                      } @else {
                        <bf-money
                          [amountMinor]="q.amount.amountMinor"
                          [currency]="q.amount.currency"
                        />
                        @if (q.isLowest) {
                          <sat-status-tag status="success">Lowest</sat-status-tag>
                        }
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Per head</dt>
                    <dd>
                      <bf-money
                        [amountMinor]="q.perHead.amountMinor"
                        [currency]="q.perHead.currency"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Valid until</dt>
                    <dd>
                      {{ q.validUntil ? (q.validUntil | bfDate: session.timezone()) : 'Not given' }}
                      @if (q.expired) {
                        <sat-status-tag status="neutral">Expired</sat-status-tag>
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Policy check</dt>
                    <dd>
                      <sat-status-tag [status]="policyTone(q.policyCheck)">{{
                        policyLabel(q.policyCheck)
                      }}</sat-status-tag>
                    </dd>
                  </div>
                </dl>
                @if (v.canManage) {
                  @if (q.status === 'selected') {
                    <sat-status-tag status="success">Selected</sat-status-tag>
                  } @else if (q.status === 'declined') {
                    <sat-status-tag status="neutral">Declined</sat-status-tag>
                  } @else if (q.status !== 'requested') {
                    <span class="bf-page__actions">
                      <button
                        mat-flat-button
                        satImportantButton
                        type="button"
                        [disabled]="busy() || q.expired || q.policyCheck === 'above_available'"
                        (click)="select(q)"
                      >
                        Select this quote
                      </button>
                      <button mat-button type="button" [disabled]="busy()" (click)="decline(q)">
                        Decline
                      </button>
                    </span>
                    @if (q.expired || q.policyCheck === 'above_available') {
                      <span class="bf-cell__secondary">{{
                        q.expired
                          ? 'The quote has expired.'
                          : 'Above what the event can still commit.'
                      }}</span>
                    }
                  }
                }
              </li>
            }
          </ul>
          @if (selecting()?.requestId === r.id) {
            <div class="bf-form">
              <mat-form-field class="bf-form__wide">
                <mat-label>Why this quote</mat-label>
                <input
                  matInput
                  [(ngModel)]="reason"
                  name="reason"
                  maxlength="500"
                  placeholder="Needed when the quote is not the lowest"
                />
              </mat-form-field>
            </div>
            <div class="bf-form__actions">
              <button
                mat-flat-button
                satImportantButton
                type="button"
                [disabled]="busy()"
                (click)="confirmSelect()"
                data-testid="confirm-select-quote"
              >
                Select and create commitment
              </button>
              <button mat-button type="button" (click)="selecting.set(null)">Cancel</button>
            </div>
          }
        </section>
      }
    }
  `,
  styles: `
    .bf-quote-cards {
      display: none;
      margin: 0;
      padding: 0 20px 16px;
      list-style: none;
    }
    .bf-quote-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 0;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .bf-quote-card .bf-facts {
      padding: 0;
    }
    /* Below 600px each vendor becomes a card; the side-by-side matrix needs the width. */
    @media (width < 600px) {
      .bf-quote-matrix {
        display: none;
      }
      .bf-quote-cards {
        display: block;
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventQuotesPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  readonly eventId = input.required<string>();
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly selecting = signal<{ quoteId: string; requestId: string } | null>(null);
  protected reason = '';

  protected readonly quotes = resource({
    params: () => ({ eventId: this.eventId() }),
    loader: ({ params }) => data(this.api.getEventQuotes({ params })),
  });
  protected readonly view = computed(() => valueOf(this.quotes));

  protected readonly label = label;
  protected vendorTone(status: string): 'success' | 'important' | 'neutral' {
    return status === 'approved' || status === 'preferred'
      ? 'success'
      : status === 'blocked'
        ? 'important'
        : 'neutral';
  }
  /** Section 5/8: within the limit success, above the limit a soft warning, above available a hard block. */
  protected policyTone(check: VendorQuoteItem['policyCheck']): 'success' | 'warning' | 'important' {
    return check === 'above_available'
      ? 'important'
      : check === 'above_limit'
        ? 'warning'
        : 'success';
  }
  protected policyLabel(check: VendorQuoteItem['policyCheck']): string {
    return POLICY_LABEL[check];
  }

  private async run(label: string, call: () => Promise<unknown>, done?: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await call();
      if (done) this.snack.open(done, undefined, { duration: 5000 });
      this.selecting.set(null);
      this.quotes.reload();
    } catch (e) {
      this.failure.set(`${label}: ${errorMessage(e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected select(q: VendorQuoteItem): void {
    this.failure.set('');
    this.reason = '';
    this.selecting.set({ quoteId: q.id, requestId: q.quoteRequestId });
  }

  protected confirmSelect(): void {
    const chosen = this.selecting();
    if (!chosen) return;
    void this.run(
      'Could not select the quote',
      () =>
        data(
          this.api.selectVendorQuote({
            params: { eventId: this.eventId(), quoteId: chosen.quoteId },
            body: {
              ...(this.reason.trim() ? { reason: this.reason.trim() } : {}),
              notifyDeclinedVendors: true,
            },
          }),
        ),
      'Quote selected and its commitment created',
    );
  }

  protected decline(q: VendorQuoteItem): void {
    void this.run(
      'Could not decline the quote',
      () =>
        data(
          this.api.declineVendorQuote({
            params: { eventId: this.eventId(), quoteId: q.id },
            body: { reason: 'Declined by the organizer' },
          }),
        ),
      `${q.vendorName} declined`,
    );
  }
}
