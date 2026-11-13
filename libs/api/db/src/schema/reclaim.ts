import {
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
import { budgets } from './budgets';
import { fiscalPeriods, fiscalYears, legalEntities } from './finance';
import { currencies, tenants } from './tenancy';

/**
 * Reclaim and redistribute campaigns (086a) and burn-rate alerts (gap B4). None of these rows is
 * money: a campaign records who was asked, what they answered and which journals a pool execution
 * posted; the money itself only moves through ledger journals.
 */

/** A campaign: the criteria finance chose, the response window and its status. */
export const reclaimCampaigns = pgTable(
  'reclaim_campaigns',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text('name').notNull(),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    /** collecting, redistributing, completed. */
    status: varchar('status', { length: 20 }).notNull().default('collecting'),
    /** minUnusedBps, minUnusedReportingMinor, maxDaysLeft, reportingCurrency. */
    criteria: jsonb('criteria').notNull(),
    startedOn: day('started_on').notNull(),
    respondBy: day('respond_by').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('reclaim_campaigns_tenant').on(t.tenantId, t.status, t.createdAt)],
);

/** One budget asked to release money: the proposal, the owner's answer and the execution that moved it. */
export const reclaimNotices = pgTable(
  'reclaim_notices',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => reclaimCampaigns.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    ownerPersonId: uuid('owner_person_id'),
    /** Who decides after the deadline: the owner of the budget's parent. */
    parentOwnerPersonId: uuid('parent_owner_person_id'),
    forecastUnusedMinor: minor('forecast_unused_minor').notNull(),
    proposedMinor: minor('proposed_minor').notNull(),
    /** Floor and the most that could be reclaimed when the notice was sent (for the trail). */
    floorMinor: minor('floor_minor').notNull(),
    maxReclaimableMinor: minor('max_reclaimable_minor').notNull(),
    /** sent, released, kept, parent_review, reclaimed. */
    status: varchar('status', { length: 20 }).notNull().default('sent'),
    /** release_all, release_part, keep. */
    choice: varchar('choice', { length: 20 }),
    releasedMinor: minor('released_minor').notNull().default(0),
    keptMinor: minor('kept_minor').notNull().default(0),
    reason: text('reason'),
    plan: text('plan'),
    /** owner or parent_owner. */
    respondedAs: varchar('responded_as', { length: 20 }),
    respondedBy: uuid('responded_by'),
    respondedAt: ts('responded_at'),
    escalatedBy: uuid('escalated_by'),
    escalatedAt: ts('escalated_at'),
    executionId: uuid('execution_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('reclaim_notices_campaign_budget').on(t.tenantId, t.campaignId, t.budgetId),
    index('reclaim_notices_owner').on(t.tenantId, t.ownerPersonId, t.status),
  ],
);

/**
 * One legal entity's pool posted: the reductions to targets and parents, their journals and the
 * reason. Executed once per campaign, entity and currency; the unique index refuses a second run.
 */
export const reclaimExecutions = pgTable(
  'reclaim_executions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => reclaimCampaigns.id),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    poolMinor: minor('pool_minor').notNull(),
    allocatedMinor: minor('allocated_minor').notNull(),
    remainderMinor: minor('remainder_minor').notNull(),
    /** The legs posted: source, destination, target and amount, each with its journal id. */
    legs: jsonb('legs').notNull(),
    journalIds: uuid('journal_ids').array().notNull().default([]),
    reasonCode: varchar('reason_code', { length: 50 }).notNull(),
    reason: text('reason').notNull(),
    executedBy: uuid('executed_by'),
    executedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('reclaim_executions_pool').on(
      t.tenantId,
      t.campaignId,
      t.legalEntityId,
      t.currency,
    ),
  ],
);

/** A burn-rate check: on demand from finance or nightly, run by the worker at a fixed as-of date. */
export const burnRateRuns = pgTable(
  'burn_rate_runs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    asOf: day('as_of').notNull(),
    /** queued, completed, failed. */
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    trigger: varchar('trigger', { length: 20 }).notNull().default('manual'),
    evaluatedCount: integer('evaluated_count').notNull().default(0),
    alertsRaised: integer('alerts_raised').notNull().default(0),
    requestedBy: uuid('requested_by'),
    error: text('error'),
    createdAt: createdAt(),
    completedAt: ts('completed_at'),
  },
  (t) => [index('burn_rate_runs_tenant').on(t.tenantId, t.createdAt)],
);

/** An alert raised to a budget's owner. One per budget, fiscal period and level, so a rerun is a no-op. */
export const burnRateAlerts = pgTable(
  'burn_rate_alerts',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    fiscalPeriodId: uuid('fiscal_period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    /** ahead or well_ahead. */
    level: varchar('level', { length: 20 }).notNull(),
    burnBps: integer('burn_bps').notNull(),
    spentMinor: minor('spent_minor').notNull(),
    phasedMinor: minor('phased_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    ownerPersonId: uuid('owner_person_id'),
    runId: uuid('run_id')
      .notNull()
      .references(() => burnRateRuns.id),
    asOf: day('as_of').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('burn_rate_alerts_once').on(t.tenantId, t.budgetId, t.fiscalPeriodId, t.level),
    index('burn_rate_alerts_run').on(t.tenantId, t.runId),
  ],
);
