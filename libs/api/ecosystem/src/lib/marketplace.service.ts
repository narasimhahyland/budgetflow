import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  marketplaceBookings,
  marketplaceOffers,
  marketplacePartners,
  people,
  vendors,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { OutboundHttp } from '@bf/api/integrations';
import type {
  BookingList,
  BookingStatus,
  BookingView,
  CreateBookingRequest,
  MarketplaceCategory,
  OfferList,
  OfferView,
  PartnerList,
  PartnerSyncResult,
  PartnerView,
  UpdatePartnerRequest,
} from '@bf/contracts';
import type { CurrencyCode } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { CommandContext } from './connections.service';
import { EcosystemScopedReads } from './scoped-reads';
import { tenantOf } from './surfaces.service';

/** What a partner is told about an event. Nothing identifies an attendee. */
const DATA_SHARED = [
  'Event date, city and number of people',
  'Dietary totals as counts, never names',
  'Delivery addresses only for gifts the recipient agreed to',
];

const VENDOR_OK = ['approved', 'preferred'];

/**
 * The partner marketplace (092d).
 *
 * A booking request is a request for a price, not a purchase: it creates a booking that waits for
 * the partner, and the partner's answer is a quote the organizer takes into the ordinary approval
 * route. Nothing here posts to the ledger, creates a commitment or confirms anything to a partner.
 * Offers only appear for partners an admin has enabled and linked to an Approved or Preferred vendor
 * in the vendor master, so marketplace spend meets the same vendor controls as any other spend.
 */
@Injectable()
export class MarketplaceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reads: EcosystemScopedReads,
    private readonly http: OutboundHttp,
  ) {}

  // Partner administration ------------------------------------------------------------------------------

  partners(actor: RequestActor): Promise<PartnerList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor), 'marketplace partners');
      const rows = await this.partnerViews(tx);
      return {
        items: rows,
        canManage: this.policy.can(actor, 'integration.manage', tenantOf(actor)).allowed,
      };
    });
  }

  updatePartner(
    actor: RequestActor,
    partnerId: string,
    req: UpdatePartnerRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<PartnerView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ecosystem.marketplace.partner:${partnerId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor), 'marketplace partners');
        const before = await this.partnerOrFail(tx, partnerId);
        if (req.vendorId) {
          const [vendor] = await tx.select().from(vendors).where(eq(vendors.id, req.vendorId));
          if (!vendor) throw ApiProblem.notFound('vendor');
          if (!VENDOR_OK.includes(vendor.status))
            throw new ApiProblem(
              422,
              'PARTNER_VENDOR_NOT_APPROVED',
              `${vendor.name} is not an Approved or Preferred vendor, so it cannot take bookings.`,
            );
        }
        // Enabling a partner without an approved vendor would put unvetted spend in front of
        // organizers, so the vendor link is a precondition rather than a later tidy-up.
        const vendorId = req.vendorId === undefined ? before.vendorId : req.vendorId;
        const status = req.status ?? before.status;
        if (status === 'enabled' && !vendorId)
          throw new ApiProblem(
            422,
            'PARTNER_VENDOR_NOT_APPROVED',
            'Link the partner to an Approved or Preferred vendor before enabling it.',
          );
        const [row] = await tx
          .update(marketplacePartners)
          .set({ status, mode: req.mode ?? before.mode, vendorId, updatedAt: new Date() })
          .where(eq(marketplacePartners.id, partnerId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.marketplace_partner_changed',
          resourceType: 'marketplace_partner',
          resourceId: partnerId,
          requestId: ctx.requestId,
          changes: {
            status: { from: before.status, to: row.status },
            mode: { from: before.mode, to: row.mode },
            vendor: { from: before.vendorId, to: row.vendorId },
          },
        });
        return (await this.partnerViews(tx, [row.id]))[0];
      },
    );
  }

  /**
   * Pulls the partner catalogue and any answers to open booking requests. The call goes through
   * `OutboundHttp`, which refuses a host that is not configured, so a partner cannot be pointed at
   * an arbitrary address. In Mock mode that host is the local mock partner service.
   */
  sync(
    actor: RequestActor,
    partnerId: string,
    ctx: CommandContext,
  ): Promise<CommandResult<PartnerSyncResult>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ecosystem.marketplace.sync:${partnerId}`,
        request: { partnerId },
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor), 'marketplace partners');
        const partner = await this.partnerOrFail(tx, partnerId);
        if (!partner.baseUrl)
          throw new ApiProblem(
            409,
            'INTEGRATION_NOT_CONNECTED',
            'This partner has no catalogue address configured.',
          );
        const catalogue = await this.fetchCatalogue(partner.baseUrl, partner.slug);
        let added = 0;
        let updated = 0;
        for (const offer of catalogue.offers) {
          const [existing] = await tx
            .select({ id: marketplaceOffers.id })
            .from(marketplaceOffers)
            .where(
              and(
                eq(marketplaceOffers.partnerId, partnerId),
                eq(marketplaceOffers.externalRef, offer.externalRef),
              ),
            );
          const values = {
            tenantId: actor.tenantId,
            partnerId,
            externalRef: offer.externalRef,
            title: offer.title,
            category: offer.category,
            city: offer.city,
            pricePerHeadMinor: offer.pricePerHeadMinor,
            currency: offer.currency,
            capacityMin: offer.capacityMin,
            capacityMax: offer.capacityMax,
            ratingBps: offer.ratingBps ?? null,
            ratingCount: offer.ratingCount ?? 0,
            includes: offer.includes ?? [],
            cancellationTerms: offer.cancellationTerms ?? '',
            deliveryCountries: offer.deliveryCountries ?? [],
            status: offer.withdrawn ? 'withdrawn' : 'available',
            updatedAt: new Date(),
          };
          if (existing) {
            await tx
              .update(marketplaceOffers)
              .set(values)
              .where(eq(marketplaceOffers.id, existing.id));
            updated += 1;
          } else {
            await tx.insert(marketplaceOffers).values(values);
            added += 1;
          }
        }
        const withdrawn = catalogue.offers.filter((o) => o.withdrawn).length;

        // Answers to bookings this tenant is waiting on. A partner can only move a booking it was
        // actually asked about: the lookup is by booking id inside this tenant, under RLS.
        let responses = 0;
        for (const answer of catalogue.bookingAnswers) {
          const [booking] = await tx
            .select()
            .from(marketplaceBookings)
            .where(
              and(
                eq(marketplaceBookings.id, answer.bookingId),
                eq(marketplaceBookings.status, 'waiting_for_partner'),
              ),
            );
          if (!booking) continue;
          await tx
            .update(marketplaceBookings)
            .set({
              status: answer.available ? 'quoted' : 'declined',
              partnerReference: answer.reference ?? null,
              quotedPricePerHeadMinor: answer.available ? (answer.pricePerHeadMinor ?? null) : null,
              quotedCurrency: answer.available ? (answer.currency ?? null) : null,
              declineReason: answer.available ? null : (answer.reason ?? 'Not available'),
              alternatives: answer.alternatives ?? [],
              respondedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(marketplaceBookings.id, booking.id));
          responses += 1;
        }
        const syncedAt = new Date();
        await tx
          .update(marketplacePartners)
          .set({ lastSyncedAt: syncedAt, updatedAt: syncedAt })
          .where(eq(marketplacePartners.id, partnerId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.marketplace_partner_synced',
          resourceType: 'marketplace_partner',
          resourceId: partnerId,
          requestId: ctx.requestId,
          changes: {
            offersAdded: { from: null, to: added },
            offersUpdated: { from: null, to: updated },
            bookingResponses: { from: null, to: responses },
          },
        });
        return {
          partnerId,
          offersAdded: added,
          offersUpdated: updated,
          offersWithdrawn: withdrawn,
          bookingResponses: responses,
          syncedAt: iso(syncedAt),
        };
      },
    );
  }

  // Browsing and booking ----------------------------------------------------------------------------------

  offers(
    actor: RequestActor,
    query: {
      city?: string;
      category?: MarketplaceCategory;
      people?: number;
      maxPricePerHeadMinor?: number;
      cursor?: string;
      limit?: number;
    },
  ): Promise<OfferList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'event.read', tenantOf(actor), 'the marketplace');
      const limit = Math.min(query.limit ?? 50, 100);
      const rows = await this.offerRows(tx);
      const filtered = rows
        .filter((r) => !query.city || r.offer.city.toLowerCase() === query.city.toLowerCase())
        .filter((r) => !query.category || r.offer.category === query.category)
        .filter(
          (r) =>
            !query.people ||
            (r.offer.capacityMin <= query.people && r.offer.capacityMax >= query.people),
        )
        .filter(
          (r) =>
            query.maxPricePerHeadMinor === undefined ||
            r.offer.pricePerHeadMinor <= query.maxPricePerHeadMinor,
        )
        .filter((r) => !query.cursor || r.offer.id > query.cursor);
      const page = filtered.slice(0, limit);
      return {
        items: page.map((r) => this.offerView(r, actor.reportingCurrency)),
        nextCursor: filtered.length > limit ? (page.at(-1)?.offer.id ?? null) : null,
      };
    });
  }

  offer(actor: RequestActor, offerId: string): Promise<OfferView> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'event.read', tenantOf(actor), 'the marketplace');
      const row = (await this.offerRows(tx)).find((r) => r.offer.id === offerId);
      if (!row) throw ApiProblem.notFound('offer');
      return this.offerView(row, actor.reportingCurrency);
    });
  }

  bookings(actor: RequestActor): Promise<BookingList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      // Bookings are read through the events they sit on, so a person sees exactly the bookings for
      // the events they can already see.
      const visible = new Map((await this.reads.events(tx, actor)).map((e) => [e.id, e] as const));
      if (visible.size === 0) return { items: [] };
      const rows = await tx
        .select()
        .from(marketplaceBookings)
        .where(inArray(marketplaceBookings.eventId, [...visible.keys()]))
        .orderBy(asc(marketplaceBookings.createdAt), asc(marketplaceBookings.id));
      const offers = await this.offerRows(tx, { includePaused: true });
      const names = await this.personNames(
        tx,
        rows.map((r) => r.requestedByPersonId),
      );
      return {
        items: rows.map((r) =>
          this.bookingView(r, offers, visible.get(r.eventId)?.name ?? '', names),
        ),
      };
    });
  }

  /**
   * Asks a partner for a price. The organizer must be able to manage the event, the offer must come
   * from an enabled partner and fit the number of people, and that is all this does: no money moves
   * and no commitment exists until the quote is selected and approved the usual way.
   */
  createBooking(
    actor: RequestActor,
    req: CreateBookingRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<BookingView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'ecosystem.marketplace.booking',
        request: req,
        status: 201,
      },
      async (tx) => {
        const visible = await this.reads.events(tx, actor);
        const event = visible.find((e) => e.id === req.eventId);
        if (!event) throw ApiProblem.notFound('event');
        this.policy.assert(actor, 'event.manage', tenantOf(actor), 'this event');
        const row = (await this.offerRows(tx)).find((r) => r.offer.id === req.offerId);
        if (!row)
          throw new ApiProblem(
            409,
            'OFFER_NOT_AVAILABLE',
            'That offer is no longer available from an enabled partner.',
          );
        if (req.peopleCount < row.offer.capacityMin || req.peopleCount > row.offer.capacityMax)
          throw new ApiProblem(
            422,
            'OFFER_NOT_AVAILABLE',
            `${row.partner.name} takes ${row.offer.capacityMin} to ${row.offer.capacityMax} people for this offer.`,
          );
        const [booking] = await tx
          .insert(marketplaceBookings)
          .values({
            tenantId: actor.tenantId,
            offerId: row.offer.id,
            eventId: event.id,
            requestedByPersonId: actor.personId,
            peopleCount: req.peopleCount,
            requestedDate: req.requestedDate,
            notes: req.notes ?? null,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.marketplace_booking_requested',
          resourceType: 'marketplace_booking',
          resourceId: booking.id,
          requestId: ctx.requestId,
          changes: {
            partner: { from: null, to: row.partner.name },
            offer: { from: null, to: row.offer.title },
            event: { from: null, to: event.name },
            people: { from: null, to: req.peopleCount },
            requestedDate: { from: null, to: req.requestedDate },
          },
        });
        const names = await this.personNames(tx, [actor.personId]);
        return this.bookingView(booking, [row], event.name, names);
      },
    );
  }

  // Internals ------------------------------------------------------------------------------------------------

  private async partnerOrFail(tx: Tx, partnerId: string) {
    const [row] = await tx
      .select()
      .from(marketplacePartners)
      .where(eq(marketplacePartners.id, partnerId));
    if (!row) throw ApiProblem.notFound('partner');
    return row;
  }

  private async partnerViews(tx: Tx, ids?: readonly string[]): Promise<PartnerView[]> {
    const rows = await tx
      .select({ p: marketplacePartners, vendorName: vendors.name, vendorStatus: vendors.status })
      .from(marketplacePartners)
      .leftJoin(vendors, eq(vendors.id, marketplacePartners.vendorId))
      .where(ids?.length ? inArray(marketplacePartners.id, [...ids]) : undefined)
      .orderBy(asc(marketplacePartners.name), asc(marketplacePartners.id));
    const counts = await tx
      .select({ partnerId: marketplaceOffers.partnerId, n: marketplaceOffers.id })
      .from(marketplaceOffers)
      .where(eq(marketplaceOffers.status, 'available'));
    const perPartner = new Map<string, number>();
    for (const c of counts) perPartner.set(c.partnerId, (perPartner.get(c.partnerId) ?? 0) + 1);
    return rows.map(({ p, vendorName, vendorStatus }) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      categories: p.categories as MarketplaceCategory[],
      cities: p.cities,
      vendorId: p.vendorId,
      vendorName,
      vendorStatus,
      mode: p.mode as PartnerView['mode'],
      status: p.status as PartnerView['status'],
      offersCached: perPartner.get(p.id) ?? 0,
      lastSyncedAt: p.lastSyncedAt ? iso(p.lastSyncedAt) : null,
      dataShared: [...DATA_SHARED],
    }));
  }

  /** Available offers from enabled partners with an approved vendor, ordered by title then id. */
  private async offerRows(tx: Tx, opts: { includePaused?: boolean } = {}) {
    const rows = await tx
      .select({
        offer: marketplaceOffers,
        partner: marketplacePartners,
        vendorStatus: vendors.status,
      })
      .from(marketplaceOffers)
      .innerJoin(marketplacePartners, eq(marketplacePartners.id, marketplaceOffers.partnerId))
      .leftJoin(vendors, eq(vendors.id, marketplacePartners.vendorId))
      .orderBy(asc(marketplaceOffers.title), asc(marketplaceOffers.id));
    return rows.filter(
      (r) =>
        opts.includePaused ||
        (r.partner.status === 'enabled' &&
          r.offer.status === 'available' &&
          r.vendorStatus !== null &&
          VENDOR_OK.includes(r.vendorStatus)),
    );
  }

  private offerView(
    row: {
      offer: typeof marketplaceOffers.$inferSelect;
      partner: typeof marketplacePartners.$inferSelect;
      vendorStatus: string | null;
    },
    reportingCurrency: CurrencyCode,
  ): OfferView {
    const currency = row.offer.currency as CurrencyCode;
    return {
      id: row.offer.id,
      partnerId: row.partner.id,
      partnerName: row.partner.name,
      title: row.offer.title,
      category: row.offer.category as MarketplaceCategory,
      city: row.offer.city,
      pricePerHead: { amountMinor: row.offer.pricePerHeadMinor, currency },
      // Shown for comparison only. A price in the reporting currency never consumes budget; the
      // commitment is made later, in the budget currency at its locked plan rate.
      pricePerHeadReporting: {
        amountMinor: row.offer.pricePerHeadMinor,
        currency: currency === reportingCurrency ? reportingCurrency : currency,
      },
      capacityMin: row.offer.capacityMin,
      capacityMax: row.offer.capacityMax,
      ratingBps: row.offer.ratingBps,
      ratingCount: row.offer.ratingCount,
      vendorStatus: row.vendorStatus,
      includes: row.offer.includes,
      cancellationTerms: row.offer.cancellationTerms,
      deliveryCountries: row.offer.deliveryCountries,
    };
  }

  private bookingView(
    row: typeof marketplaceBookings.$inferSelect,
    offers: {
      offer: typeof marketplaceOffers.$inferSelect;
      partner: typeof marketplacePartners.$inferSelect;
    }[],
    eventName: string,
    names: Map<string, string>,
  ): BookingView {
    const match = offers.find((o) => o.offer.id === row.offerId);
    const currency = (row.quotedCurrency ?? match?.offer.currency ?? 'USD') as CurrencyCode;
    const perHead = row.quotedPricePerHeadMinor;
    return {
      id: row.id,
      offerId: row.offerId,
      offerTitle: match?.offer.title ?? '',
      partnerName: match?.partner.name ?? '',
      eventId: row.eventId,
      eventName,
      peopleCount: row.peopleCount,
      requestedDate: row.requestedDate,
      status: row.status as BookingStatus,
      partnerReference: row.partnerReference,
      quotedPricePerHead: perHead === null ? null : { amountMinor: perHead, currency },
      quotedTotal: perHead === null ? null : { amountMinor: perHead * row.peopleCount, currency },
      declineReason: row.declineReason,
      alternatives: row.alternatives,
      requestedByName: row.requestedByPersonId
        ? (names.get(row.requestedByPersonId) ?? null)
        : null,
      createdAt: iso(row.createdAt),
      respondedAt: row.respondedAt ? iso(row.respondedAt) : null,
      notice:
        'A booking request is a quote. It becomes a commitment only when you select it on the event and the usual approval route decides.',
    };
  }

  private async personNames(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async fetchCatalogue(baseUrl: string, slug: string): Promise<PartnerCatalogue> {
    const res = await this.http.send({
      url: `${baseUrl.replace(/\/$/, '')}/partners/${slug}/catalogue`,
      method: 'GET',
    });
    if (!res.ok)
      throw new ApiProblem(
        502,
        'INTEGRATION_TEST_FAILED',
        `The partner catalogue answered ${res.statusCode}.`,
      );
    let body: Partial<PartnerCatalogue>;
    try {
      body = JSON.parse(res.body) as Partial<PartnerCatalogue>;
    } catch {
      throw new ApiProblem(
        502,
        'INTEGRATION_TEST_FAILED',
        'The partner catalogue did not answer with a catalogue.',
      );
    }
    return {
      offers: Array.isArray(body.offers) ? body.offers : [],
      bookingAnswers: Array.isArray(body.bookingAnswers) ? body.bookingAnswers : [],
    };
  }
}

interface PartnerCatalogue {
  offers: {
    externalRef: string;
    title: string;
    category: MarketplaceCategory;
    city: string;
    pricePerHeadMinor: number;
    currency: string;
    capacityMin: number;
    capacityMax: number;
    ratingBps?: number;
    ratingCount?: number;
    includes?: string[];
    cancellationTerms?: string;
    deliveryCountries?: string[];
    withdrawn?: boolean;
  }[];
  bookingAnswers: {
    bookingId: string;
    available: boolean;
    reference?: string;
    pricePerHeadMinor?: number;
    currency?: string;
    reason?: string;
    alternatives?: string[];
  }[];
}

const iso = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, 'Z');
