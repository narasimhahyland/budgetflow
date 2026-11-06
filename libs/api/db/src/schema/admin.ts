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
import { createdAt, day, pk, tenantRef, ts, updatedAt } from './_columns';
import { people } from './org';
import { tenants } from './tenancy';

/**
 * Administration changes that need a second person: a money-affecting feature flag (105), a retention
 * period that shortens a financial category (111) and a role grant that confers authority the
 * requester does not hold (103). Applied rows double as the change history each screen shows.
 */
export const adminChangeRequests = pgTable(
  'admin_change_requests',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    /** `feature_flag`, `retention_policy` or `role_grant`. */
    kind: varchar('kind', { length: 30 }).notNull(),
    /** What the change is about: the flag key, the retention category or `<membershipId>:<role>`. */
    subjectKey: varchar('subject_key', { length: 160 }).notNull(),
    /** The requested state, validated by the domain before it is stored. */
    payload: jsonb('payload').notNull().default({}),
    reason: text('reason').notNull(),
    requestedByPersonId: uuid('requested_by_person_id').references(() => people.id),
    requestedBySubject: varchar('requested_by_subject', { length: 255 }),
    /** `pending`, `applied`, `declined` or `cancelled`. */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    needsConfirmation: boolean('needs_confirmation').notNull().default(false),
    confirmedByPersonId: uuid('confirmed_by_person_id').references(() => people.id),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_change_requests_subject').on(t.tenantId, t.kind, t.subjectKey, t.createdAt),
    index('admin_change_requests_status').on(t.tenantId, t.status, t.createdAt),
  ],
);

/**
 * How long each kind of data is kept (111). Every period is a provisional default pending finance and
 * legal sign-off (`signoff_status`), never an approved legal position.
 */
export const retentionPolicies = pgTable(
  'retention_policies',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    category: varchar('category', { length: 60 }).notNull(),
    /** Whole days; null means kept permanently. */
    periodDays: integer('period_days'),
    /** `delete`, `anonymise`, `archive` or `never`. */
    action: varchar('action', { length: 20 }).notNull(),
    minimumDays: integer('minimum_days'),
    locked: boolean('locked').notNull().default(false),
    /** `provisional` until finance and legal sign off the period, then `approved`. */
    signoffStatus: varchar('signoff_status', { length: 20 }).notNull().default('provisional'),
    signoffNote: text('signoff_note'),
    updatedByPersonId: uuid('updated_by_person_id').references(() => people.id),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('retention_policies_tenant_category').on(t.tenantId, t.category)],
);

/**
 * A legal hold pauses every deletion and anonymisation in its scope. Placed by one person and
 * confirmed by another (`legal_hold.manage`), and it beats every retention policy while active.
 */
export const legalHolds = pgTable(
  'legal_holds',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    /** `person`, `event`, `budget` or `date_range`. */
    scopeKind: varchar('scope_kind', { length: 20 }).notNull(),
    scopeRefId: uuid('scope_ref_id'),
    scopeFrom: day('scope_from'),
    scopeTo: day('scope_to'),
    reason: text('reason').notNull(),
    placedByPersonId: uuid('placed_by_person_id').references(() => people.id),
    confirmedByPersonId: uuid('confirmed_by_person_id').references(() => people.id),
    confirmedAt: ts('confirmed_at'),
    /** `pending_confirmation`, `active`, `declined` or `released`. */
    status: varchar('status', { length: 25 }).notNull().default('pending_confirmation'),
    releasedByPersonId: uuid('released_by_person_id').references(() => people.id),
    releasedAt: ts('released_at'),
    releaseReason: text('release_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('legal_holds_tenant_status').on(t.tenantId, t.status, t.createdAt),
    index('legal_holds_scope').on(t.tenantId, t.scopeKind, t.scopeRefId),
  ],
);

/**
 * One retention run: a dry run that previews what would be removed, or the apply run that follows it.
 * An apply run always names the dry run it came from and repeats its scope, so a run can never widen
 * what was previewed.
 */
export const retentionRuns = pgTable(
  'retention_runs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    /** `dry_run` or `apply`. */
    mode: varchar('mode', { length: 10 }).notNull(),
    /** `manual` or `scheduled`. */
    trigger: varchar('trigger', { length: 10 }).notNull().default('manual'),
    /** `completed` or `failed`. */
    status: varchar('status', { length: 20 }).notNull().default('completed'),
    categories: text('categories').array().notNull(),
    dryRunId: uuid('dry_run_id'),
    /** Categories and periods the run covered; an apply run must match its dry run exactly. */
    scopeKey: text('scope_key').notNull(),
    requestedByPersonId: uuid('requested_by_person_id').references(() => people.id),
    confirmedByPersonId: uuid('confirmed_by_person_id').references(() => people.id),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('retention_runs_tenant_started').on(t.tenantId, t.startedAt)],
);

/** What a run found and did per category, including what a legal hold kept and which hold did it. */
export const retentionRunItems = pgTable(
  'retention_run_items',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => retentionRuns.id),
    category: varchar('category', { length: 60 }).notNull(),
    action: varchar('action', { length: 20 }).notNull(),
    cutoffAt: ts('cutoff_at'),
    candidateCount: integer('candidate_count').notNull().default(0),
    appliedCount: integer('applied_count').notNull().default(0),
    skippedHoldCount: integer('skipped_hold_count').notNull().default(0),
    holdIds: uuid('hold_ids').array().notNull().default([]),
    /** Why nothing happened, when nothing happened. */
    note: text('note'),
  },
  (t) => [uniqueIndex('retention_run_items_run_category').on(t.runId, t.category)],
);

/** Planned maintenance announced in the shell banner (114). */
export const maintenanceNotices = pgTable(
  'maintenance_notices',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    message: text('message').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    /** When the banner starts showing; 24 hours before the start by default. */
    showFrom: ts('show_from').notNull(),
    /** `scheduled` or `cancelled`. */
    status: varchar('status', { length: 20 }).notNull().default('scheduled'),
    createdByPersonId: uuid('created_by_person_id').references(() => people.id),
    cancelledByPersonId: uuid('cancelled_by_person_id').references(() => people.id),
    cancelledAt: ts('cancelled_at'),
    createdAt: createdAt(),
  },
  (t) => [index('maintenance_notices_window').on(t.tenantId, t.status, t.showFrom)],
);

/** Budget owners invited in a batch from the users screen (103a). An invite grants nothing by itself. */
export const ownerInvites = pgTable(
  'owner_invites',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    batchId: uuid('batch_id').notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: text('display_name').notNull(),
    /** The role the inviter suggests; it is granted later through user administration. */
    proposedRole: varchar('proposed_role', { length: 40 }).notNull(),
    orgUnitId: uuid('org_unit_id'),
    /** `invited`, `accepted`, `expired` or `revoked`. */
    status: varchar('status', { length: 20 }).notNull().default('invited'),
    invitedByPersonId: uuid('invited_by_person_id').references(() => people.id),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('owner_invites_tenant_email').on(t.tenantId, t.email),
    index('owner_invites_batch').on(t.tenantId, t.batchId),
  ],
);
