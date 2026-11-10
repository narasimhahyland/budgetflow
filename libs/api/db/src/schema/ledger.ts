import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { appNow, ccy, createdAt, day, minor, pk, tenantRef, ts } from './_columns';
import { budgets, planVersions } from './budgets';
import { journalType, ledgerAccount, rateType } from './enums';
import { fiscalPeriods, legalEntities } from './finance';
import { currencies, tenants } from './tenancy';

/**
 * Append-only journals: UPDATE/DELETE are rejected by triggers and not granted to the app role;
 * inserts into a closed or locked period fail in the database; every journal balances at commit.
 */
export const ledgerJournals = pgTable(
  'ledger_journals',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    journalType: journalType('journal_type').notNull(),
    transactionCurrency: ccy('transaction_currency')
      .notNull()
      .references(() => currencies.code),
    reportingCurrency: ccy('reporting_currency')
      .notNull()
      .references(() => currencies.code),
    accountingDate: day('accounting_date').notNull(),
    fiscalPeriodId: uuid('fiscal_period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    late: boolean('late').notNull().default(false),
    originalPeriodId: uuid('original_period_id').references(() => fiscalPeriods.id),
    reversalOfJournalId: uuid('reversal_of_journal_id'),
    reasonCode: varchar('reason_code', { length: 50 }),
    reason: text('reason'),
    command: varchar('command', { length: 100 }).notNull(),
    requestId: varchar('request_id', { length: 100 }),
    idempotencyKey: varchar('idempotency_key', { length: 200 }),
    actorPersonId: uuid('actor_person_id'),
    actorSubject: varchar('actor_subject', { length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_journals_tenant_period').on(t.tenantId, t.fiscalPeriodId),
    uniqueIndex('ledger_journals_one_reversal').on(t.reversalOfJournalId),
  ],
);

export const ledgerLines = pgTable(
  'ledger_lines',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => ledgerJournals.id),
    lineNo: integer('line_no').notNull(),
    budgetId: uuid('budget_id').references(() => budgets.id),
    account: ledgerAccount('account').notNull(),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    costCenterId: uuid('cost_center_id'),
    glAccountId: uuid('gl_account_id'),
    eventCode: varchar('event_code', { length: 50 }),
    fiscalPeriodId: uuid('fiscal_period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    accountingDate: day('accounting_date').notNull(),
    late: boolean('late').notNull().default(false),
    transactionCurrency: ccy('transaction_currency')
      .notNull()
      .references(() => currencies.code),
    transactionAmountMinor: minor('transaction_amount_minor').notNull(),
    budgetCurrency: ccy('budget_currency').references(() => currencies.code),
    budgetAmountMinor: minor('budget_amount_minor'),
    reportingCurrency: ccy('reporting_currency')
      .notNull()
      .references(() => currencies.code),
    reportingAmountMinor: minor('reporting_amount_minor').notNull(),
    budgetRateType: rateType('budget_rate_type'),
    budgetRate: numeric('budget_rate', { precision: 24, scale: 12 }),
    budgetRateIds: uuid('budget_rate_ids').array(),
    reportingRateType: rateType('reporting_rate_type').notNull(),
    reportingRate: numeric('reporting_rate', { precision: 24, scale: 12 }).notNull(),
    reportingRateIds: uuid('reporting_rate_ids').array().notNull(),
    planVersionId: uuid('plan_version_id').references(() => planVersions.id),
    // Provenance (plain ids: the ledger outlives the rows it came from).
    commitmentId: uuid('commitment_id'),
    eventId: uuid('event_id'),
    contributionId: uuid('contribution_id'),
    actualId: uuid('actual_id'),
    requestId: uuid('request_id'),
    approvalId: uuid('approval_id'),
    importLineId: uuid('import_line_id'),
    reversalOfLineId: uuid('reversal_of_line_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_lines_tenant_budget').on(t.tenantId, t.budgetId, t.fiscalPeriodId, t.account),
    index('ledger_lines_journal').on(t.journalId),
    uniqueIndex('ledger_lines_one_reversal').on(t.reversalOfLineId),
    uniqueIndex('ledger_lines_journal_line').on(t.journalId, t.lineNo),
    check(
      'ledger_lines_budget_bucket_shape',
      sql`(${t.account} in ('authorized','allocated_out','held','pre_encumbered','encumbered','actual','accrued')) = (${t.budgetId} is not null and ${t.budgetAmountMinor} is not null and ${t.budgetCurrency} is not null)`,
    ),
  ],
);

/** Cached balances per budget, period and bucket; derived, rebuildable, compared nightly. */
export const ledgerBalances = pgTable(
  'ledger_balances',
  {
    tenantId: tenantRef().references(() => tenants.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    fiscalPeriodId: uuid('fiscal_period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    bucket: ledgerAccount('bucket').notNull(),
    budgetAmountMinor: minor('budget_amount_minor').notNull().default(0),
    reportingAmountMinor: minor('reporting_amount_minor').notNull().default(0),
    lineCount: integer('line_count').notNull().default(0),
    updatedAt: ts('updated_at').notNull().default(appNow),
  },
  (t) => [
    primaryKey({ columns: [t.budgetId, t.fiscalPeriodId, t.bucket] }),
    index('ledger_balances_tenant').on(t.tenantId, t.budgetId),
  ],
);
