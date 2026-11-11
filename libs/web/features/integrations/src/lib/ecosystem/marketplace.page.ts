import { DecimalPipe } from '@angular/common';
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
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import {
  MARKETPLACE_CATEGORIES,
  type BookingView,
  type MarketplaceCategory,
  type OfferView,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from '../api';
import type { Tone } from '../labels';
import { byText, ordered } from '../order';
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_TONES, MARKETPLACE_CATEGORY_LABELS } from './labels';

/**
 * Screen 092d, browse. Offers come from partners the company enabled and linked to an approved
 * vendor; asking for one produces a quote and nothing else. No money moves here.
 */
@Component({
  selector: 'bf-marketplace-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  templateUrl: './marketplace.page.html',
  styleUrls: ['../page.scss', '../integrations.scss', './ecosystem.scss'],
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketplacePage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly categories = MARKETPLACE_CATEGORIES;
  protected readonly bookingColumns = ['offer', 'event', 'people', 'date', 'quote', 'status'];

  protected readonly city = signal('');
  protected readonly category = signal<MarketplaceCategory | ''>('');
  protected readonly people = signal('');

  protected readonly offers = resource({
    params: () => ({
      ...(this.city().trim() ? { city: this.city().trim() } : {}),
      ...(this.category() ? { category: this.category() as MarketplaceCategory } : {}),
      ...(this.peopleCount() ? { people: this.peopleCount() } : {}),
    }),
    loader: ({ params }) => data(this.api.listOffers({ query: params })),
  });

  protected readonly bookings = resource({ loader: () => data(this.api.listBookings({})) });

  protected readonly peopleCount = computed(() => {
    const n = Number(this.people().trim());
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  });

  protected readonly items = computed(() =>
    ordered(
      valueOf(this.offers)?.items ?? [],
      byText<OfferView>((o) => o.title),
    ),
  );

  /** Named in the empty state so the filter that found nothing is obvious. */
  protected readonly filterSummary = computed(() => {
    const parts = [
      this.city().trim() ? `in ${this.city().trim()}` : '',
      this.category() ? MARKETPLACE_CATEGORY_LABELS[this.category() as MarketplaceCategory] : '',
      this.peopleCount() ? `for ${this.peopleCount()} people` : '',
    ].filter(Boolean);
    return parts.length ? ` ${parts.join(', ')}` : '';
  });

  protected readonly bookingItems = computed(() =>
    ordered(
      valueOf(this.bookings)?.items ?? [],
      byText<BookingView>((b) => b.offerTitle),
    ),
  );

  protected readonly hasFilters = computed(
    () => Boolean(this.city().trim()) || Boolean(this.category()) || Boolean(this.peopleCount()),
  );

  protected categoryLabel(category: MarketplaceCategory): string {
    return MARKETPLACE_CATEGORY_LABELS[category];
  }

  protected bookingStatusLabel(status: BookingView['status']): string {
    return BOOKING_STATUS_LABELS[status];
  }

  protected bookingStatusTone(status: BookingView['status']): Tone {
    return BOOKING_STATUS_TONES[status];
  }

  /** Ratings are stored in basis points of 5; readers want "4.5 out of 5". */
  protected rating(bps: number | null): string | null {
    return bps === null ? null : (bps / 1000).toFixed(1);
  }

  protected clearFilters(): void {
    this.city.set('');
    this.category.set('');
    this.people.set('');
  }
}
