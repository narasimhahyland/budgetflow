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
import { ccy, createdAt, minor, pk, tenantRef, ts } from './_columns';
import { actuals, glAccounts, glTieoutRuns } from './accounting';
import { budgets } from './budgets';
import { actualSource, importBatchStatus } from './enums';
import { costCenters } from './org';
import { commitments } from './spend';
import { currencies, tenants } from './tenancy';

/** One uploaded actuals file: reviewed (auto-match proposals), then posted. Idempotent per file hash. */
export const importBatches = pgTable(
  'import_batches',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    source: actualSource('source').notNull(),
    fileName: text('file_name').notNull(),
    fileHash: varchar('file_hash', { length: 64 }).notNull(),
    status: importBatchStatus('status').notNull().default('review'),
    lineCount: integer('line_count').notNull(),
    importedCount: integer('imported_count').notNull(),
    rejectedCount: integer('rejected_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    columnMapping: jsonb('column_mapping').notNull().default({}),
    issues: jsonb('issues').notNull().default([]),
    summary: jsonb('summary').notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    postedBy: uuid('posted_by'),
    postedAt: ts('posted_at'),
  },
  (t) => [
    uniqueIndex('import_batches_file_hash').on(t.tenantId, t.fileHash),
    index('import_batches_tenant_created').on(t.tenantId, t.createdAt),
  ],
);

/**
 * One part of an actual matched to a commitment or charged to a budget (a split has several). The
 * sum of live parts never exceeds the actual; a correction reverses the part's journals.
 */
export const actualMatches = pgTable(
  'actual_matches',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    actualId: uuid('actual_id')
      .notNull()
      .references(() => actuals.id),
    commitmentId: uuid('commitment_id').references(() => commitments.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    transactionAmountMinor: minor('transaction_amount_minor').notNull(),
    transactionCurrency: ccy('transaction_currency')
      .notNull()
      .references(() => currencies.code),
    budgetAmountMinor: minor('budget_amount_minor').notNull(),
    budgetCurrency: ccy('budget_currency')
      .notNull()
      .references(() => currencies.code),
    reliefMinor: minor('relief_minor').notNull().default(0),
    releasedMinor: minor('released_minor').notNull().default(0),
    excessMinor: minor('excess_minor').notNull().default(0),
    fit: varchar('fit', { length: 30 }),
    rule: varchar('rule', { length: 30 }),
    prepaid: boolean('prepaid').notNull().default(false),
    journalIds: uuid('journal_ids').array().notNull(),
    reversedAt: ts('reversed_at'),
    reversalJournalIds: uuid('reversal_journal_ids').array(),
    reversalReason: text('reversal_reason'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('actual_matches_actual').on(t.tenantId, t.actualId),
    index('actual_matches_commitment').on(t.tenantId, t.commitmentId),
  ],
);

/** Tie-out rows by cost center and GL account with the difference and its explanation. */
export const glTieoutLines = pgTable(
  'gl_tieout_lines',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => glTieoutRuns.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    glAccountId: uuid('gl_account_id').references(() => glAccounts.id),
    glMinor: minor('gl_minor').notNull(),
    budgetflowMinor: minor('budgetflow_minor').notNull(),
    differenceMinor: minor('difference_minor').notNull(),
    withinTolerance: boolean('within_tolerance').notNull(),
    explanation: text('explanation'),
    explainedBy: uuid('explained_by'),
    explainedAt: ts('explained_at'),
  },
  (t) => [index('gl_tieout_lines_run').on(t.tenantId, t.runId)],
);
