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
import { DateOnlyPipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, valueOf } from './api';
import { EventTabs } from './event-tabs';
import { LoadState } from './load-state';

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
          <p class="bf-kpi__label">Funded</p>
          <p class="bf-kpi__value">
            <bf-money [amountMinor]="v.funded.amountMinor" [currency]="v.funded.currency" />
          </p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Committed</p>
          <p class="bf-kpi__value">
            <bf-money [amountMinor]="v.committed.amountMinor" [currency]="v.committed.currency" />
          </p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Available under this event's rules</p>
          <p class="bf-kpi__value" data-testid="quotes-available">
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
          <div class="bf-table-scroll">
            <table class="bf-split-table">
              <caption class="bf-empty">
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
                    <td>{{ q.vendorStatus }}</td>
                  }
                </tr>
                <tr>
                  <th scope="row">Total</th>
                  @for (q of r.quotes; track q.id) {
                    <td>
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
                          @if (q.isLowest) {
                            (lowest)
                          }
                        </span>
                      }
                    </td>
                  }
                </tr>
                <tr>
                  <th scope="row">Per head</th>
                  @for (q of r.quotes; track q.id) {
                    <td>
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
                        <span class="bf-chip">Expired</span>
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
                      <span class="bf-cell__primary">{{ policyLabel(q.policyCheck) }}</span>
                      <span class="bf-cell__secondary">{{ q.policyMessage }}</span>
                    </td>
                  }
                </tr>
                @if (v.canManage) {
                  <tr>
                    <th scope="row">Decision</th>
                    @for (q of r.quotes; track q.id) {
                      <td>
                        @if (q.status === 'selected') {
                          <span class="bf-chip">Selected</span>
                        } @else if (q.status === 'declined') {
                          <span class="bf-chip">Declined</span>
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
