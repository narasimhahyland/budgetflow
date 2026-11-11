import { index, integer, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { appNow, ccy, createdAt, day, minor, pk, tenantRef, ts } from './_columns';
import { budgets, rolloverPolicies } from './budgets';
import { closeCheckCode, reopenAction, reopenRequestStatus, yearEndLineStatus } from './enums';
import { fiscalPeriods, legalEntities } from './finance';
import { yearEndRuns } from './accounting';
import { currencies, tenants } from './tenancy';

/**
 * Period close and year-end tables (Phase 11). Snapshots, acknowledgements and the audit trail are
 * append-only; the year-end run and its lines carry the decisions a run is executed from.
 */

/** A soft close check a Finance Controller accepted with a reason. Append-only. */
export const periodCloseAcknowledgements = pgTable(
  'period_close_acknowledgements',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fiscalPeriodId: uuid('fiscal_period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    checkCode: closeCheckCode('check_code').notNull(),
    reasonCode: varchar('reason_code', { length: 50 }).notNull(),
    reason: text('reason').notNull(),
    acknowledgedBy: uuid('acknowledged_by'),
    acknowledgedAt: ts('acknowledged_at').notNull().default(appNow),
    /**
     * Which close attempt this acknowledgement belongs to (the snapshot version it would be taken
     * with). Reopening a period starts the next attempt, so a re-close is judged on fresh evidence
     * and the earlier acknowledgements stay untouched for audit.
     */
    closeAttempt: integer('close_attempt').notNull().default(1),
  },
  (t) => [
    index('period_close_acks_period').on(
      t.tenantId,
      t.fiscalPeriodId,
      t.legalEntityId,
      t.closeAttempt,
    ),
  ],
);

/** Break-glass: reopening a closed period or unlocking a locked one needs two different people. */
export const periodReopenRequests = pgTable(
  'period_reopen_requests',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fiscalPeriodId: uuid('fiscal_period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    action: reopenAction('action').notNull(),
    reasonCode: varchar('reason_code', { length: 50 }).notNull(),
    reason: text('reason').notNull(),
    requestedBy: uuid('requested_by'),
    requestedAt: ts('requested_at').notNull().default(appNow),
    status: reopenRequestStatus('status').notNull().default('pending'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
  },
  (t) => [index('period_reopen_requests_period').on(t.tenantId, t.fiscalPeriodId, t.status)],
);

/** One budget's outcome in a year-end run: what it carries, lapses and sweeps, and to where. */
export const yearEndRunLines = pgTable(
  'year_end_run_lines',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => yearEndRuns.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    availableMinor: minor('available_minor').notNull().default(0),
    authorizedMinor: minor('authorized_minor').notNull().default(0),
    rolloverPolicyId: uuid('rollover_policy_id').references(() => rolloverPolicies.id),
    carryMinor: minor('carry_minor').notNull().default(0),
    lapseMinor: minor('lapse_minor').notNull().default(0),
    sweepToBudgetId: uuid('sweep_to_budget_id').references(() => budgets.id),
    openCommitmentCount: integer('open_commitment_count').notNull().default(0),
    openCommitmentMinor: minor('open_commitment_minor').notNull().default(0),
    targetBudgetId: uuid('target_budget_id').references(() => budgets.id),
    status: yearEndLineStatus('status').notNull().default('planned'),
    blockedReason: text('blocked_reason'),
    approvedCarryMinor: minor('approved_carry_minor'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
    journalIds: uuid('journal_ids').array().notNull().default([]),
    executedAt: ts('executed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('year_end_run_lines_run_budget').on(t.tenantId, t.runId, t.budgetId),
    index('year_end_run_lines_run').on(t.tenantId, t.runId, t.status),
  ],
);

/** Commitments carried into the next fiscal year, linking the released one to its re-posted twin. */
export const yearEndCommitmentCarries = pgTable(
  'year_end_commitment_carries',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => yearEndRuns.id),
    sourceCommitmentId: uuid('source_commitment_id').notNull(),
    carriedCommitmentId: uuid('carried_commitment_id').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    releaseJournalId: uuid('release_journal_id'),
    carryJournalId: uuid('carry_journal_id'),
    accountingDate: day('accounting_date'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('year_end_commitment_carries_source').on(t.tenantId, t.sourceCommitmentId),
    index('year_end_commitment_carries_run').on(t.tenantId, t.runId),
  ],
);
