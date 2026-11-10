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
import {
  appNow,
  ccy,
  createdAt,
  pk,
  tenantRef,
  ts,
  updatedAt,
  validFrom,
  validTo,
} from './_columns';
import { intercompanyMode, rateType, roleId } from './enums';

/** Reference data shared by all tenants (no tenant_id, no RLS). */
export const currencies = pgTable('currencies', {
  code: ccy('code').primaryKey(),
  exponent: integer('exponent').notNull(),
  name: text('name').notNull(),
});

export const tenants = pgTable('tenants', {
  id: pk(),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 63 }).notNull().unique(),
  reportingCurrency: ccy('reporting_currency')
    .notNull()
    .references(() => currencies.code),
  defaultTimezone: text('default_timezone').notNull().default('UTC'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: createdAt(),
});

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  reportingRateType: rateType('reporting_rate_type').notNull().default('month_end'),
  defaultIntercompanyMode: intercompanyMode('default_intercompany_mode').notNull().default('block'),
  alertThresholdsPct: integer('alert_thresholds_pct').array().notNull().default([50, 80, 100]),
  settings: jsonb('settings').notNull().default({}),
  updatedAt: updatedAt(),
});

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    key: varchar('key', { length: 100 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    /** `everyone` or `pilot`: a pilot reveals the capability only to the groups below (P14, screen 105). */
    rolloutMode: varchar('rollout_mode', { length: 20 }).notNull().default('everyone'),
    pilotOrgUnitIds: uuid('pilot_org_unit_ids').array().notNull().default([]),
    pilotRoleIds: text('pilot_role_ids').array().notNull().default([]),
    updatedByPersonId: uuid('updated_by_person_id'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('feature_flags_tenant_key').on(t.tenantId, t.key)],
);

export const entitlements = pgTable(
  'entitlements',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    plan: varchar('plan', { length: 50 }).notNull(),
    feature: varchar('feature', { length: 100 }).notNull(),
    limitValue: integer('limit_value'),
    validFrom: validFrom(),
    validTo: validTo(),
  },
  (t) => [index('entitlements_tenant').on(t.tenantId, t.feature)],
);

/** A Keycloak subject's membership in a tenant; role grants hang off it. */
export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    idpSubject: varchar('idp_subject', { length: 255 }).notNull(),
    personId: uuid('person_id'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('memberships_tenant_subject').on(t.tenantId, t.idpSubject),
    index('memberships_subject').on(t.idpSubject),
  ],
);

export const roleGrants = pgTable(
  'role_grants',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id),
    role: roleId('role').notNull(),
    /** Org subtree the grant is limited to; null = whole tenant (per the role's matrix scope). */
    scopeOrgUnitId: uuid('scope_org_unit_id'),
    validFrom: validFrom(),
    validTo: validTo(),
    createdAt: createdAt(),
  },
  (t) => [index('role_grants_membership').on(t.tenantId, t.membershipId)],
);

/** Audited, time-boxed access for platform operators to tenant financial data. */
export const breakGlassGrants = pgTable(
  'break_glass_grants',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    /** The platform operator who asked (their identity-provider subject). */
    idpSubject: varchar('idp_subject', { length: 255 }).notNull(),
    reason: text('reason').notNull(),
    /** The Organization Admin who approved. Never the requester. */
    grantedBy: uuid('granted_by'),
    /**
     * `requested`, `approved`, `declined` or `revoked`. Active and expired are derived: an approved
     * grant is active while now is inside its window and expired after it.
     */
    status: varchar('status', { length: 20 }).notNull().default('requested'),
    /** What the grant opens. Only `budgets_and_ledger` exists: read-only, see BREAK_GLASS_READS. */
    scope: varchar('scope', { length: 40 }).notNull().default('budgets_and_ledger'),
    /** How long the operator asked for, at most 240 minutes; the window starts on approval. */
    requestedMinutes: integer('requested_minutes').notNull().default(60),
    requestedByName: text('requested_by_name'),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
    revokedBy: uuid('revoked_by'),
    revokedAt: ts('revoked_at'),
    revokeReason: text('revoke_reason'),
    /** Set on approval; empty while a request waits or after a decline. */
    validFromTs: ts('valid_from'),
    validToTs: ts('valid_to'),
    createdAt: createdAt(),
  },
  (t) => [
    index('break_glass_tenant').on(t.tenantId, t.idpSubject),
    index('break_glass_status').on(t.tenantId, t.status),
  ],
);

/** Product analytics (activation, time to approve, auto-match rate); separate from the audit trail. */
export const productAnalyticsEvents = pgTable(
  'product_analytics_events',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    occurredAt: ts('occurred_at').notNull().default(appNow),
    actorPersonId: uuid('actor_person_id'),
    name: varchar('name', { length: 100 }).notNull(),
    properties: jsonb('properties').notNull().default({}),
  },
  (t) => [index('product_analytics_tenant_name').on(t.tenantId, t.name, t.occurredAt)],
);
