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
import { budgets } from './budgets';
import { documents } from './documents';
import { fiscalPeriods, fiscalYears, legalEntities } from './finance';
import { orgUnits, people } from './org';
import { commitments, events } from './spend';
import { tenants } from './tenancy';

/**
 * Phase 15 extended product features. Three groups live here and they are deliberately different
 * about money: a scenario never touches the ledger, a drafted narrative never publishes itself, and
 * wallet and recognition money is ordinary ledger money carried on `commitments` like any spend.
 */

// What-if reallocation scenarios (031a) -----------------------------------------------------------

/**
 * A private projection of reductions, transfers, freezes and set-to-zero across the tree. Nothing
 * here is money: the table stores what someone wants to try, and the impact is recomputed read-only
 * against the live ledger every time it is asked for. Promotion runs the normal control commands.
 */
export const scenarios = pgTable(
  'scenarios',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text('name').notNull(),
    note: text('note'),
    /** `draft`, `promoted` or `archived`. */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    /**
     * The ledger moment the author last recalculated against. Promotion is refused when the ledger
     * moved since, so a scenario can never apply a plan that was true an hour ago.
     */
    baselineAt: ts('baseline_at').notNull().defaultNow(),
    /** Ledger journals in the tenant when the baseline was taken; a change means the baseline is stale. */
    baselineJournalCount: integer('baseline_journal_count').notNull().default(0),
    createdByPersonId: uuid('created_by_person_id').references(() => people.id),
    promotedAt: ts('promoted_at'),
    promotionReasonCode: varchar('promotion_reason_code', { length: 40 }),
    promotionReason: text('promotion_reason'),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('scenarios_tenant_status').on(t.tenantId, t.status, t.name),
    index('scenarios_tenant_author').on(t.tenantId, t.createdByPersonId),
  ],
);

/** One modelled change. `promotion_status` records what the real command did, never a posting of its own. */
export const scenarioChanges = pgTable(
  'scenario_changes',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => scenarios.id),
    /** `reduce`, `transfer`, `freeze` or `set_to_zero`. */
    kind: varchar('kind', { length: 20 }).notNull(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    amountMinor: minor('amount_minor'),
    percentBps: integer('percent_bps'),
    currency: ccy('currency'),
    /** `parent`, `savings` or `reallocation`. */
    destination: varchar('destination', { length: 20 }),
    destinationBudgetId: uuid('destination_budget_id').references(() => budgets.id),
    cascade: boolean('cascade').notNull().default(false),
    position: integer('position').notNull().default(0),
    /** Null while the scenario is a draft; `pending`, `applied` or `failed` after promotion starts. */
    promotionStatus: varchar('promotion_status', { length: 20 }),
    appliedAt: ts('applied_at'),
    journalId: uuid('journal_id'),
    auditEventId: uuid('audit_event_id'),
    problemCode: varchar('problem_code', { length: 60 }),
    problemDetail: text('problem_detail'),
    createdAt: createdAt(),
  },
  (t) => [index('scenario_changes_scenario').on(t.tenantId, t.scenarioId, t.position, t.id)],
);

/** Collaborators who may read and comment on a scenario before it is promoted. */
export const scenarioCollaborators = pgTable(
  'scenario_collaborators',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => scenarios.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('scenario_collaborators_person').on(t.tenantId, t.scenarioId, t.personId)],
);

// Leadership summary and variance commentary (011b) ----------------------------------------------

/**
 * A drafted leadership narrative. The sections carry `{{figure:<token>}}` placeholders and a figure
 * list whose values came from the reconciled read models, so BudgetFlow renders every number and the
 * model only ever wrote the words around them. An approved summary is never edited again.
 */
export const leadershipSummaries = pgTable(
  'leadership_summaries',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    periodId: uuid('period_id')
      .notNull()
      .references(() => fiscalPeriods.id),
    /** `closed` quotes the closed-period snapshot; an `open` draft can never be approved. */
    periodState: varchar('period_state', { length: 10 }).notNull(),
    snapshotTakenAt: ts('snapshot_taken_at'),
    /** `ai_draft`, `edited` or `approved`. */
    status: varchar('status', { length: 20 }).notNull().default('ai_draft'),
    version: integer('version').notNull().default(1),
    /** Sections with their text, figures, sources and review state. */
    sections: jsonb('sections').notNull().default([]),
    authorPersonId: uuid('author_person_id').references(() => people.id),
    approvedByPersonId: uuid('approved_by_person_id').references(() => people.id),
    approvedAt: ts('approved_at'),
    approvalNote: text('approval_note'),
    queryLogId: uuid('query_log_id'),
    suggestionId: uuid('suggestion_id'),
    modelId: varchar('model_id', { length: 80 }),
    modelVersion: varchar('model_version', { length: 40 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('leadership_summaries_period').on(t.tenantId, t.periodId, t.version),
    index('leadership_summaries_status').on(t.tenantId, t.status, t.createdAt),
  ],
);

/**
 * An owner's variance commentary (87a). A draft whose drivers do not explain the whole variance
 * carries an `[Explain: ...]` note, and submission is refused until the owner replaces it and
 * attests that the words are theirs.
 */
export const varianceCommentaries = pgTable(
  'variance_commentaries',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    forecastSnapshotId: uuid('forecast_snapshot_id'),
    /** `draft` or `submitted`. */
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    text: text('text').notNull(),
    drivers: jsonb('drivers').notNull().default([]),
    unexplainedMinor: minor('unexplained_minor'),
    currency: ccy('currency'),
    draftedWithAi: boolean('drafted_with_ai').notNull().default(false),
    attested: boolean('attested').notNull().default(false),
    authorPersonId: uuid('author_person_id').references(() => people.id),
    queryLogId: uuid('query_log_id'),
    suggestionId: uuid('suggestion_id'),
    modelId: varchar('model_id', { length: 80 }),
    modelVersion: varchar('model_version', { length: 40 }),
    submittedAt: ts('submitted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('variance_commentaries_budget').on(t.tenantId, t.budgetId, t.createdAt)],
);

// Wellbeing and learning wallets (120b) ------------------------------------------------------------

/**
 * A wallet program. The yearly allowance is capacity inside `funding_budget_id`, never a pot of money
 * outside the ledger: the budget's authorized amount is what actually limits the programme.
 */
export const walletPrograms = pgTable(
  'wallet_programs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    key: varchar('key', { length: 40 }).notNull(),
    name: text('name').notNull(),
    /** `wellbeing` or `learning`. */
    kind: varchar('kind', { length: 20 }).notNull(),
    fundingBudgetId: uuid('funding_budget_id')
      .notNull()
      .references(() => budgets.id),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    yearlyAllowanceMinor: minor('yearly_allowance_minor').notNull(),
    currency: ccy('currency').notNull(),
    categories: text('categories').array().notNull().default([]),
    /** Contractors and interns are excluded by default, matching per-head eligibility. */
    eligibleEmploymentTypes: text('eligible_employment_types').array().notNull().default([]),
    receiptRequired: boolean('receipt_required').notNull().default(true),
    taxable: boolean('taxable').notNull().default(false),
    carryUnused: boolean('carry_unused').notNull().default(false),
    reviewerPersonId: uuid('reviewer_person_id').references(() => people.id),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('wallet_programs_tenant_key').on(t.tenantId, t.key)],
);

/** One person's wallet for a program and fiscal year, prorated by whole months for joiners. */
export const wallets = pgTable(
  'wallets',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    programId: uuid('program_id')
      .notNull()
      .references(() => walletPrograms.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    allowanceMinor: minor('allowance_minor').notNull(),
    proratedAllowanceMinor: minor('prorated_allowance_minor').notNull(),
    currency: ccy('currency').notNull(),
    /** Closed when the person leaves; pending claims stay reviewable. */
    closedAt: ts('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('wallets_program_person_year').on(
      t.tenantId,
      t.programId,
      t.personId,
      t.fiscalYearId,
    ),
  ],
);

/**
 * A claim against a wallet. Submission pre-encumbers the funding budget, approval encumbers it,
 * payment consumes it and a return releases it, all through the ordinary commitment postings; the
 * `commitment_id` is the same kind of record any other spend would create.
 */
export const walletClaims = pgTable(
  'wallet_claims',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id),
    programId: uuid('program_id')
      .notNull()
      .references(() => walletPrograms.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    commitmentId: uuid('commitment_id').references(() => commitments.id),
    category: varchar('category', { length: 60 }).notNull(),
    merchant: text('merchant').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency').notNull(),
    budgetAmountMinor: minor('budget_amount_minor').notNull(),
    budgetCurrency: ccy('budget_currency').notNull(),
    claimDate: day('claim_date').notNull(),
    documentId: uuid('document_id').references(() => documents.id),
    note: text('note'),
    /** `submitted`, `approved`, `paid`, `returned` or `cancelled`. */
    status: varchar('status', { length: 20 }).notNull().default('submitted'),
    journalIds: uuid('journal_ids').array().notNull().default([]),
    reviewerPersonId: uuid('reviewer_person_id').references(() => people.id),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
    /** `expense` or `payroll`. */
    paidVia: varchar('paid_via', { length: 20 }),
    paidAt: ts('paid_at'),
    taxable: boolean('taxable').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('wallet_claims_wallet').on(t.tenantId, t.walletId, t.createdAt),
    index('wallet_claims_status').on(t.tenantId, t.status, t.createdAt),
  ],
);

// Recognition awards (120a) and organizer recognition (122b) ---------------------------------------

/** The award types a location offers: fixed amounts, who may give them, and which budget pays. */
export const recognitionAwardTypes = pgTable(
  'recognition_award_types',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    /** `thank_you`, `spot`, `peer` or `team`. */
    kind: varchar('kind', { length: 20 }).notNull(),
    name: text('name').notNull(),
    locationOrgUnitId: uuid('location_org_unit_id').references(() => orgUnits.id),
    amountMinor: minor('amount_minor'),
    currency: ccy('currency'),
    needsApproval: boolean('needs_approval').notNull().default(false),
    fundingBudgetId: uuid('funding_budget_id').references(() => budgets.id),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('recognition_award_types_location_kind').on(
      t.tenantId,
      t.locationOrgUnitId,
      t.kind,
      t.name,
    ),
  ],
);

/**
 * A manager's quarterly recognition allowance: a cap on what they may give, granted once by the
 * Recognition budget owner. The money itself is committed award by award, so an allowance never
 * becomes a private pot a manager can spend outside the budget's controls.
 */
export const recognitionAllowances = pgTable(
  'recognition_allowances',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    managerPersonId: uuid('manager_person_id')
      .notNull()
      .references(() => people.id),
    fundingBudgetId: uuid('funding_budget_id')
      .notNull()
      .references(() => budgets.id),
    /** `FY2026-Q4`. */
    periodKey: varchar('period_key', { length: 20 }).notNull(),
    grantedMinor: minor('granted_minor').notNull(),
    currency: ccy('currency').notNull(),
    grantedByPersonId: uuid('granted_by_person_id').references(() => people.id),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('recognition_allowances_manager_period').on(
      t.tenantId,
      t.managerPersonId,
      t.fundingBudgetId,
      t.periodKey,
    ),
  ],
);

/** One recognition. Thank-you notes carry no amount; every monetary award carries a commitment. */
export const recognitionAwards = pgTable(
  'recognition_awards',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    awardTypeId: uuid('award_type_id').references(() => recognitionAwardTypes.id),
    kind: varchar('kind', { length: 20 }).notNull(),
    giverPersonId: uuid('giver_person_id')
      .notNull()
      .references(() => people.id),
    recipientPersonId: uuid('recipient_person_id')
      .notNull()
      .references(() => people.id),
    message: text('message').notNull(),
    /** `customer_focus`, `teamwork`, `ownership` or `learning`. */
    valueTag: varchar('value_tag', { length: 30 }),
    /** `public` or `private`; private by default, the recipient chooses. */
    visibility: varchar('visibility', { length: 20 }).notNull().default('private'),
    amountMinor: minor('amount_minor'),
    currency: ccy('currency'),
    fundingBudgetId: uuid('funding_budget_id').references(() => budgets.id),
    commitmentId: uuid('commitment_id').references(() => commitments.id),
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id),
    /** `pending_approval`, `awarded`, `redeemed` or `cancelled`. */
    status: varchar('status', { length: 20 }).notNull().default('awarded'),
    journalIds: uuid('journal_ids').array().notNull().default([]),
    approverPersonId: uuid('approver_person_id').references(() => people.id),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
    /** `payroll` or `partner_catalogue`; never cash or a gift card. */
    rewardChoice: varchar('reward_choice', { length: 30 }),
    redeemedAt: ts('redeemed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('recognition_awards_recipient').on(t.tenantId, t.recipientPersonId, t.createdAt),
    index('recognition_awards_giver').on(t.tenantId, t.giverPersonId, t.createdAt),
    index('recognition_awards_status').on(t.tenantId, t.status, t.createdAt),
  ],
);

/** A thank-you note to an event organizer (122b). No money is ever attached to a note. */
export const organizerThankNotes = pgTable(
  'organizer_thank_notes',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    organizerPersonId: uuid('organizer_person_id')
      .notNull()
      .references(() => people.id),
    authorPersonId: uuid('author_person_id')
      .notNull()
      .references(() => people.id),
    eventId: uuid('event_id').references(() => events.id),
    note: text('note').notNull(),
    /** `public` or `private`; the organizer can still hide an individual note. */
    visibility: varchar('visibility', { length: 20 }).notNull().default('public'),
    hidden: boolean('hidden').notNull().default(false),
    hiddenReason: text('hidden_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('organizer_thank_notes_organizer').on(t.tenantId, t.organizerPersonId, t.createdAt),
  ],
);
