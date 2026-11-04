import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ccy, createdAt, day, minor, pk, tenantRef, ts, validFrom, validTo } from './_columns';
import { budgetCategories, budgets } from './budgets';
import {
  accrualStatus,
  actualKind,
  actualMatchStatus,
  actualSource,
  forecastMethod,
  forecastStatus,
  integrityCheckStatus,
  integrityFlagKind,
  integrityFlagStatus,
  tieoutStatus,
  yearEndRunStatus,
} from './enums';
import { fiscalPeriods, fiscalYears, legalEntities } from './finance';
import { costCenters } from './org';
import { commitments, events, vendors } from './spend';
import { currencies, tenants } from './tenancy';

export const glAccounts = pgTable(
  'gl_accounts',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    code: varchar('code', { length: 30 }).notNull(),
    name: text('name').notNull(),
    accountType: varchar('account_type', { length: 30 }).notNull(),
  },
  (t) => [uniqueIndex('gl_accounts_entity_code').on(t.tenantId, t.legalEntityId, t.code)],
);

/** Category-to-GL mapping per entity, employee versus client attendees. */
export const glMappings = pgTable(
  'gl_mappings',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => budgetCategories.id),
    attendeeType: varchar('attendee_type', { length: 10 }).notNull(),
    glAccountId: uuid('gl_account_id')
      .notNull()
      .references(() => glAccounts.id),
    validFrom: validFrom(),
    validTo: validTo(),
  },
  (t) => [index('gl_mappings_lookup').on(t.tenantId, t.legalEntityId, t.categoryId)],
);

/** Actual-to-budget mapping rules (event code, cost center, merchant, memo). */
export const actualMappingRules = pgTable(
  'actual_mapping_rules',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    priority: integer('priority').notNull(),
    match: jsonb('match').notNull(),
    targetBudgetId: uuid('target_budget_id').references(() => budgets.id),
    targetEventId: uuid('target_event_id').references(() => events.id),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('actual_mapping_rules_tenant').on(t.tenantId, t.priority)],
);

export const actuals = pgTable(
  'actuals',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    source: actualSource('source').notNull(),
    sourceRef: varchar('source_ref', { length: 200 }).notNull(),
    importBatchId: uuid('import_batch_id'),
    kind: actualKind('kind').notNull().default('charge'),
    reversalOfActualId: uuid('reversal_of_actual_id'),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    glAccountId: uuid('gl_account_id').references(() => glAccounts.id),
    eventCode: varchar('event_code', { length: 50 }),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    merchant: text('merchant'),
    memo: text('memo'),
    transactionDate: day('transaction_date').notNull(),
    accountingDate: day('accounting_date').notNull(),
    fiscalPeriodId: uuid('fiscal_period_id').references(() => fiscalPeriods.id),
    transactionCurrency: ccy('transaction_currency')
      .notNull()
      .references(() => currencies.code),
    transactionAmountMinor: minor('transaction_amount_minor').notNull(),
    reportingCurrency: ccy('reporting_currency')
      .notNull()
      .references(() => currencies.code),
    reportingAmountMinor: minor('reporting_amount_minor').notNull(),
    actualRate: numeric('actual_rate', { precision: 24, scale: 12 }).notNull(),
    matchStatus: actualMatchStatus('match_status').notNull().default('unmatched'),
    matchedMinor: minor('matched_minor').notNull().default(0),
    matchedCommitmentId: uuid('matched_commitment_id').references(() => commitments.id),
    matchedBudgetId: uuid('matched_budget_id').references(() => budgets.id),
    duplicateKey: varchar('duplicate_key', { length: 300 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('actuals_source_ref').on(t.tenantId, t.source, t.sourceRef),
    index('actuals_tenant_match').on(t.tenantId, t.matchStatus),
    index('actuals_duplicate_key').on(t.tenantId, t.duplicateKey),
  ],
);

export const actualTaxLines = pgTable(
  'actual_tax_lines',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    actualId: uuid('actual_id')
      .notNull()
      .references(() => actuals.id),
    taxCode: varchar('tax_code', { length: 30 }).notNull(),
    amountMinor: minor('amount_minor').notNull(),
    recoverable: boolean('recoverable').notNull(),
  },
  (t) => [index('actual_tax_lines_actual').on(t.tenantId, t.actualId)],
);

export const accruals = pgTable(
  'accruals',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    commitmentId: uuid('commitment_id')
      .notNull()
      .references(() => commitments.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    accountingPeriodId: uuid('accounting_period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    autoReversePeriodId: uuid('auto_reverse_period_id').references(() => fiscalPeriods.id),
    status: accrualStatus('status').notNull().default('proposed'),
    journalId: uuid('journal_id'),
    reversalJournalId: uuid('reversal_journal_id'),
    createdAt: createdAt(),
  },
  (t) => [index('accruals_tenant_status').on(t.tenantId, t.status)],
);

/** Prepaids and deposits consumed in their service period. */
export const prepaids = pgTable(
  'prepaids',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    commitmentId: uuid('commitment_id')
      .notNull()
      .references(() => commitments.id),
    amountMinor: minor('amount_minor').notNull(),
    consumedMinor: minor('consumed_minor').notNull().default(0),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    serviceStart: day('service_start').notNull(),
    serviceEnd: day('service_end').notNull(),
    nonRefundable: boolean('non_refundable').notNull().default(false),
  },
  (t) => [index('prepaids_commitment').on(t.tenantId, t.commitmentId)],
);

export const glTieoutRuns = pgTable(
  'gl_tieout_runs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fiscalPeriodId: uuid('fiscal_period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    status: tieoutStatus('status').notNull().default('draft'),
    totals: jsonb('totals').notNull().default({}),
    signedOffBy: uuid('signed_off_by'),
    signedOffAt: ts('signed_off_at'),
    createdAt: createdAt(),
  },
  (t) => [index('gl_tieout_runs_period').on(t.tenantId, t.fiscalPeriodId, t.legalEntityId)],
);

export const integrityCheckRuns = pgTable(
  'integrity_check_runs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    kind: varchar('kind', { length: 30 }).notNull().default('ledger_rebuild'),
    status: integrityCheckStatus('status').notNull().default('queued'),
    requestedBy: uuid('requested_by'),
    trigger: varchar('trigger', { length: 20 }).notNull().default('manual'),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    summary: jsonb('summary'),
    flagsRaised: integer('flags_raised').notNull().default(0),
  },
  (t) => [index('integrity_check_runs_tenant').on(t.tenantId, t.requestedAt)],
);

/** Integrity flags: request anomalies and ledger or audit drift. Never auto-repaired. */
export const integrityFlags = pgTable(
  'integrity_flags',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    kind: integrityFlagKind('kind').notNull(),
    severity: varchar('severity', { length: 10 }).notNull(),
    resourceType: varchar('resource_type', { length: 50 }).notNull(),
    resourceId: varchar('resource_id', { length: 100 }).notNull(),
    details: jsonb('details').notNull().default({}),
    status: integrityFlagStatus('status').notNull().default('open'),
    checkRunId: uuid('check_run_id').references(() => integrityCheckRuns.id),
    raisedAt: ts('raised_at').notNull().defaultNow(),
  },
  (t) => [index('integrity_flags_tenant').on(t.tenantId, t.kind, t.status)],
);

export const forecastSnapshots = pgTable(
  'forecast_snapshots',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    budgetId: uuid('budget_id').references(() => budgets.id),
    eventId: uuid('event_id').references(() => events.id),
    method: forecastMethod('method').notNull(),
    asOfDate: day('as_of_date').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    varianceBps: integer('variance_bps'),
    commentary: text('commentary'),
    status: forecastStatus('status').notNull().default('draft'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('forecast_snapshots_budget').on(t.tenantId, t.budgetId, t.asOfDate)],
);

/** As-of balances when a period closes (append-only). */
export const periodCloseSnapshots = pgTable(
  'period_close_snapshots',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fiscalPeriodId: uuid('fiscal_period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id),
    balances: jsonb('balances').notNull(),
    takenBy: uuid('taken_by'),
    takenAt: ts('taken_at').notNull().defaultNow(),
  },
  (t) => [index('period_close_snapshots_period').on(t.tenantId, t.fiscalPeriodId)],
);

export const yearEndRuns = pgTable(
  'year_end_runs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    status: yearEndRunStatus('status').notNull().default('draft'),
    dryRun: boolean('dry_run').notNull().default(true),
    commitmentFreezeDate: day('commitment_freeze_date'),
    summary: jsonb('summary'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('year_end_runs_year').on(t.tenantId, t.fiscalYearId)],
);
