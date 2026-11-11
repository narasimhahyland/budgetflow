import { DecimalPipe } from '@angular/common';
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
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import type { BookingView, MarketplaceCategory } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, todayIso, valueOf } from '../api';
import { MARKETPLACE_CATEGORY_LABELS } from './labels';

/**
 * Screen 092d, one offer. The booking form asks a partner for a price against an event the person
 * can manage. It never commits money: the page says what happens next rather than implying this is
 * a purchase.
 */
@Component({
  selector: 'bf-marketplace-offer-page',
  imports: [
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './offer.page.html',
  styleUrls: ['../page.scss', '../integrations.scss', './ecosystem.scss'],
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketplaceOfferPage {
  /** Bound from the route parameter by `withComponentInputBinding`. */
  readonly offerId = input.required<string>();

  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;

  protected readonly offer = resource({
    params: () => ({ offerId: this.offerId() }),
    loader: ({ params }) => data(this.api.getOffer({ params })),
  });

  /** Only events the person may manage can carry a booking, and the API refuses the rest. */
  protected readonly events = resource({
    params: () => (this.session.can('event.manage') ? {} : undefined),
    loader: () => data(this.api.listEvents({ query: { limit: 100 } })),
  });

  protected readonly canRequest = computed(() => this.session.can('event.manage'));
  protected readonly eventOptions = computed(() =>
    [...(valueOf(this.events)?.items ?? [])].sort(
      (a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id),
    ),
  );

  protected readonly requesting = signal(false);
  protected readonly eventId = signal<string | null>(null);
  protected readonly peopleCount = signal('');
  protected readonly requestedDate = signal(todayIso());
  protected readonly notes = signal('');

  protected readonly busy = signal(false);
  protected readonly booked = signal<BookingView | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly people = computed(() => {
    const n = Number(this.peopleCount().trim());
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  });

  /** The partner's own limits, so a refusal the API would give is explained before it is given. */
  protected readonly capacityProblem = computed(() => {
    const o = valueOf(this.offer);
    const n = this.people();
    if (!o || n === undefined) return null;
    return n < o.capacityMin || n > o.capacityMax
      ? `${o.partnerName} takes ${o.capacityMin} to ${o.capacityMax} people for this offer.`
      : null;
  });

  protected readonly estimatedTotal = computed(() => {
    const o = valueOf(this.offer);
    const n = this.people();
    return o && n !== undefined
      ? { amountMinor: o.pricePerHead.amountMinor * n, currency: o.pricePerHead.currency }
      : null;
  });

  protected categoryLabel(category: MarketplaceCategory): string {
    return MARKETPLACE_CATEGORY_LABELS[category];
  }

  protected rating(bps: number | null): string | null {
    return bps === null ? null : (bps / 1000).toFixed(1);
  }

  protected startRequest(): void {
    this.requesting.set(true);
    this.booked.set(null);
    this.failure.set(null);
    this.eventId.set(this.eventOptions()[0]?.id ?? null);
    this.peopleCount.set(String(valueOf(this.offer)?.capacityMin ?? ''));
  }

  protected async request(): Promise<void> {
    const eventId = this.eventId();
    const people = this.people();
    if (!eventId || people === undefined) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      const notes = this.notes().trim();
      const booking = await data(
        this.api.createBooking({
          body: {
            offerId: this.offerId(),
            eventId,
            peopleCount: people,
            requestedDate: this.requestedDate(),
            ...(notes ? { notes } : {}),
          },
        }),
      );
      this.booked.set(booking);
      this.requesting.set(false);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
