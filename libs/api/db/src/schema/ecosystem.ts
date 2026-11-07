import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ccy, createdAt, day, minor, pk, tenantRef, ts, updatedAt } from './_columns';
import { events } from './spend';
import { tenants } from './tenancy';

/**
 * Phase 16, the ecosystem surfaces (092a-092d, 102d). Everything here is tenant-scoped with FORCE
 * row level security: a BI feed, an assistant tool call, an automation action and a widget all read
 * through the same `tenant_isolation` policy as the app, and the token or session names the tenant
 * before any row is touched.
 */

/** The per-tenant switch and configuration of one external surface (datasets, tools, platforms). */
export const ecosystemSurfaces = pgTable(
  'ecosystem_surfaces',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    surface: varchar('surface', { length: 20 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').notNull().default({}),
    updatedBy: uuid('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ecosystem_surfaces_surface').on(t.tenantId, t.surface)],
);

/**
 * A personal connection from an outside tool. The token is stored hashed and its plaintext carries
 * the tenant id, so `authenticate` can scope the database session before the lookup. `grants` is
 * never wider than what the person's roles already allow: it narrows, it never adds.
 */
export const ecosystemConnections = pgTable(
  'ecosystem_connections',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    kind: varchar('kind', { length: 20 }).notNull(),
    personId: uuid('person_id'),
    /**
     * The identity provider subject of the person who connected. Authentication resolves the actor
     * from it on every call, so a role change, a lost budget or a deactivated membership takes
     * effect on the next request instead of being frozen into the token.
     */
    personSubject: varchar('person_subject', { length: 255 }).notNull(),
    /** Tool, assistant app or platform on the other end (`power_bi`, `zapier`, a client id). */
    clientKey: varchar('client_key', { length: 120 }).notNull(),
    label: text('label').notNull(),
    tokenPrefix: varchar('token_prefix', { length: 40 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    grants: text('grants').array().notNull().default([]),
    consentText: text('consent_text').notNull(),
    expiresAt: ts('expires_at').notNull(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by'),
    revokeReason: text('revoke_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ecosystem_connections_token').on(t.tokenHash),
    index('ecosystem_connections_person').on(t.tenantId, t.kind, t.personId),
  ],
);

/**
 * Every call an outside surface made: a BI refresh, an assistant tool call, an automation action, a
 * widget render. Append-only, so the usage an admin sees cannot be quietly trimmed. Assistant calls
 * also write an `ai_query_log` row, which is where the authorization scope is recorded.
 */
export const ecosystemCalls = pgTable(
  'ecosystem_calls',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    connectionId: uuid('connection_id'),
    widgetId: uuid('widget_id'),
    surface: varchar('surface', { length: 20 }).notNull(),
    operation: varchar('operation', { length: 80 }).notNull(),
    outcome: varchar('outcome', { length: 30 }).notNull(),
    recordsReturned: integer('records_returned').notNull().default(0),
    /** Set when a call was refused because the host page is not on the widget's allowed list. */
    refusedOrigin: varchar('refused_origin', { length: 200 }),
    actorPersonId: uuid('actor_person_id'),
    at: createdAt(),
  },
  (t) => [
    index('ecosystem_calls_connection').on(t.tenantId, t.connectionId, t.at),
    index('ecosystem_calls_surface').on(t.tenantId, t.surface, t.at),
    index('ecosystem_calls_widget').on(t.tenantId, t.widgetId, t.at),
  ],
);

/**
 * An embeddable widget (102d). `allowed_origins` holds exact site origins and nothing else: it is
 * the whole of who may frame the widget, and it never decides who may read the data behind it.
 */
export const embeddedWidgets = pgTable(
  'embedded_widgets',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text('name').notNull(),
    kind: varchar('kind', { length: 30 }).notNull(),
    allowedOrigins: text('allowed_origins').array().notNull().default([]),
    showAmounts: boolean('show_amounts').notNull().default(true),
    eventCount: integer('event_count').notNull().default(3),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdBy: uuid('created_by'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('embedded_widgets_tenant').on(t.tenantId, t.status, t.name)],
);

/** A booking partner (092d). Offers only show once the partner is linked to an approved vendor. */
export const marketplacePartners = pgTable(
  'marketplace_partners',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text('name').notNull(),
    slug: varchar('slug', { length: 60 }).notNull(),
    categories: text('categories').array().notNull().default([]),
    cities: text('cities').array().notNull().default([]),
    vendorId: uuid('vendor_id'),
    mode: varchar('mode', { length: 10 }).notNull().default('mock'),
    status: varchar('status', { length: 20 }).notNull().default('paused'),
    baseUrl: text('base_url'),
    lastSyncedAt: ts('last_synced_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('marketplace_partners_slug').on(t.tenantId, t.slug)],
);

/** A cached offer from a partner catalogue. Prices are integer minor units in the partner currency. */
export const marketplaceOffers = pgTable(
  'marketplace_offers',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    partnerId: uuid('partner_id').notNull(),
    externalRef: varchar('external_ref', { length: 120 }).notNull(),
    title: text('title').notNull(),
    category: varchar('category', { length: 30 }).notNull(),
    city: varchar('city', { length: 80 }).notNull(),
    pricePerHeadMinor: minor('price_per_head_minor').notNull(),
    currency: ccy('currency').notNull(),
    capacityMin: integer('capacity_min').notNull().default(1),
    capacityMax: integer('capacity_max').notNull().default(1),
    ratingBps: integer('rating_bps'),
    ratingCount: integer('rating_count').notNull().default(0),
    includes: text('includes').array().notNull().default([]),
    cancellationTerms: text('cancellation_terms').notNull().default(''),
    deliveryCountries: text('delivery_countries').array().notNull().default([]),
    status: varchar('status', { length: 20 }).notNull().default('available'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('marketplace_offers_external').on(t.tenantId, t.partnerId, t.externalRef),
    index('marketplace_offers_browse').on(t.tenantId, t.status, t.city, t.category),
  ],
);

/**
 * A booking request and the partner's answer. It never becomes a commitment here: the organizer
 * selects the answer as a quote on the event (51a) and the usual approval route decides.
 */
export const marketplaceBookings = pgTable(
  'marketplace_bookings',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    offerId: uuid('offer_id').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    requestedByPersonId: uuid('requested_by_person_id'),
    peopleCount: integer('people_count').notNull(),
    requestedDate: day('requested_date').notNull(),
    notes: text('notes'),
    status: varchar('status', { length: 30 }).notNull().default('waiting_for_partner'),
    partnerReference: varchar('partner_reference', { length: 120 }),
    quotedPricePerHeadMinor: minor('quoted_price_per_head_minor'),
    quotedCurrency: ccy('quoted_currency'),
    declineReason: text('decline_reason'),
    alternatives: text('alternatives').array().notNull().default([]),
    respondedAt: ts('responded_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('marketplace_bookings_event').on(t.tenantId, t.eventId, t.status),
    index('marketplace_bookings_offer').on(t.tenantId, t.offerId),
  ],
);
