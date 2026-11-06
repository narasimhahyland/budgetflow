import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
  forecastCycleStatus,
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
    name: text('name').notNull().default(''),
    createdBy: uuid('created_by'),
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
    // Phase 6: file line, references, plan-rate triplet, FX view, auto-match proposal and resolution.
    lineNo: integer('line_no'),
    reference: varchar('reference', { length: 100 }),
    originalRef: varchar('original_ref', { length: 200 }),
    cardProgram: varchar('card_program', { length: 50 }),
    planRate: numeric('plan_rate', { precision: 24, scale: 12 }),
    actualRateType: varchar('actual_rate_type', { length: 20 }),
    actualReportingMinor: minor('actual_reporting_minor'),
    fxEffectMinor: minor('fx_effect_minor').notNull().default(0),
    budgetCurrency: ccy('budget_currency'),
    budgetAmountMinor: minor('budget_amount_minor'),
    proposedCommitmentId: uuid('proposed_commitment_id'),
    proposedBudgetId: uuid('proposed_budget_id'),
    matchRule: varchar('match_rule', { length: 30 }),
    matchConfidence: integer('match_confidence'),
    matchNote: text('match_note'),
    overBudgetRequestId: uuid('over_budget_request_id'),
    excludedReason: text('excluded_reason'),
    duplicateOfActualId: uuid('duplicate_of_actual_id'),
    matchedAt: ts('matched_at'),
    matchedBy: uuid('matched_by'),
  },
  (t) => [
    uniqueIndex('actuals_source_ref').on(t.tenantId, t.source, t.sourceRef),
    index('actuals_tenant_match').on(t.tenantId, t.matchStatus),
    index('actuals_duplicate_key').on(t.tenantId, t.duplicateKey),
    index('actuals_batch').on(t.tenantId, t.importBatchId),
    index('actuals_event_code').on(t.tenantId, t.eventCode),
    check(
      'actuals_matched_within_amount',
      sql`abs(${t.matchedMinor}) <= abs(${t.transactionAmountMinor})`,
    ),
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
    accrualDate: day('accrual_date'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
    exportedAt: ts('exported_at'),
    reversalTrigger: varchar('reversal_trigger', { length: 20 }),
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
    actualId: uuid('actual_id'),
    budgetId: uuid('budget_id').references(() => budgets.id),
    recognizedThrough: day('recognized_through'),
    createdAt: ts('created_at').defaultNow(),
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
    toleranceMinor: minor('tolerance_minor').notNull().default(0),
    currency: ccy('currency'),
    preparedBy: uuid('prepared_by'),
    sourceFileName: text('source_file_name'),
    signOffComment: text('sign_off_comment'),
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

/**
 * A reforecast round (87a). Finance opens it with an as-of date, a due date and the variance
 * threshold above which an owner must explain themselves; owners submit one forecast per budget and
 * included event into `forecast_snapshots`; closing locks the set. Nothing here posts: a cycle only
 * ever writes forecast snapshots, so no row in it can move money or a ledger bucket.
 */
export const forecastCycles = pgTable(
  'forecast_cycles',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text('name').notNull(),
    asOfDate: day('as_of_date').notNull(),
    dueDate: day('due_date').notNull(),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    /** Null means every active budget in the tenant. */
    scopeRootBudgetId: uuid('scope_root_budget_id').references(() => budgets.id),
    status: forecastCycleStatus('status').notNull().default('open'),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    varianceThresholdBps: integer('variance_threshold_bps').notNull().default(1000),
    varianceThresholdMinor: minor('variance_threshold_minor').notNull().default(100000),
    defaultMethodOperating: forecastMethod('default_method_operating')
      .notNull()
      .default('run_rate'),
    defaultMethodEvent: forecastMethod('default_method_event')
      .notNull()
      .default('committed_pipeline'),
    includeOpenEvents: boolean('include_open_events').notNull().default(true),
    reminderDaysBefore: integer('reminder_days_before').array().notNull().default([3, 1]),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    closedAt: ts('closed_at'),
    closedBy: uuid('closed_by'),
  },
  (t) => [
    uniqueIndex('forecast_cycles_name').on(t.tenantId, t.name),
    index('forecast_cycles_year').on(t.tenantId, t.fiscalYearId, t.status),
  ],
);

/**
 * One forecast of where a budget or event will land. Never an actual: no `forecast_snapshots` row
 * is ever read by the ledger, and the ledger facts the forecast was measured against are copied in
 * (`authorized_minor`, `actual_minor`, `committed_minor`) so a closed cycle reports the same
 * variance for ever without the forecast having touched a bucket.
 */
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
    cycleId: uuid('cycle_id').references(() => forecastCycles.id),
    /** Ledger facts as of the cycle date, copied so the variance never drifts after the close. */
    authorizedMinor: minor('authorized_minor').notNull().default(0),
    actualMinor: minor('actual_minor').notNull().default(0),
    committedMinor: minor('committed_minor').notNull().default(0),
    pendingMinor: minor('pending_minor').notNull().default(0),
    plannedEventsMinor: minor('planned_events_minor').notNull().default(0),
    varianceMinor: minor('variance_minor').notNull().default(0),
    commentaryRequired: boolean('commentary_required').notNull().default(false),
    /** Finance's note when they sent the line back for more explanation. */
    commentaryNote: text('commentary_note'),
    /** True for the run-rate forecast the cycle close wrote because nobody submitted. */
    systemGenerated: boolean('system_generated').notNull().default(false),
    submittedAt: ts('submitted_at'),
    acceptedAt: ts('accepted_at'),
    acceptedBy: uuid('accepted_by'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('forecast_snapshots_budget').on(t.tenantId, t.budgetId, t.asOfDate),
    uniqueIndex('forecast_snapshots_cycle_budget').on(t.tenantId, t.cycleId, t.budgetId),
    uniqueIndex('forecast_snapshots_cycle_event').on(t.tenantId, t.cycleId, t.eventId),
    index('forecast_snapshots_cycle').on(t.tenantId, t.cycleId, t.status),
  ],
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
    /** Re-closing a reopened period takes the next version; earlier versions stay for audit. */
    version: integer('version').notNull().default(1),
    currency: ccy('currency'),
    budgetCount: integer('budget_count').notNull().default(0),
  },
  (t) => [
    index('period_close_snapshots_period').on(t.tenantId, t.fiscalPeriodId),
    uniqueIndex('period_close_snapshots_version').on(
      t.tenantId,
      t.fiscalPeriodId,
      t.legalEntityId,
      t.version,
    ),
  ],
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
    /** The year the money moves into, the plan version it ties to and the tree the run covers. */
    targetFiscalYearId: uuid('target_fiscal_year_id').references(() => fiscalYears.id),
    targetPlanVersionId: uuid('target_plan_version_id'),
    rootBudgetId: uuid('root_budget_id').references(() => budgets.id),
    executedAt: ts('executed_at'),
    executedBy: uuid('executed_by'),
    error: text('error'),
  },
  (t) => [index('year_end_runs_year').on(t.tenantId, t.fiscalYearId)],
);
