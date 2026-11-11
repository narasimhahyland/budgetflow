import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ccy, createdAt, day, minor, pk, tenantRef, ts, updatedAt } from './_columns';
import { budgets } from './budgets';
import {
  commitmentStatus,
  contributionMode,
  contributionStatus,
  eventStatus,
  intercompanyMode,
  rateType,
  requestKind,
  requestStatus,
  vendorStatus,
} from './enums';
import { fiscalPeriods, fiscalYears, legalEntities } from './finance';
import { costCenters, orgUnits, people } from './org';
import { currencies, tenants } from './tenancy';

export const vendors = pgTable(
  'vendors',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text('name').notNull(),
    status: vendorStatus('status').notNull().default('unknown'),
    erpVendorId: varchar('erp_vendor_id', { length: 100 }),
    category: varchar('category', { length: 50 }),
    country: varchar('country', { length: 2 }),
    createdAt: createdAt(),
  },
  (t) => [index('vendors_tenant_name').on(t.tenantId, t.name)],
);

/** Human-readable references (REQ-00042, IDC-00007); ids stay opaque UUIDs. */
export const requestRefSeq = pgSequence('request_ref_seq');
export const contributionRefSeq = pgSequence('contribution_ref_seq');

/** Budget, spending, additional-fund, over-budget and exception requests with resubmission chain. */
export const requests = pgTable(
  'requests',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    kind: requestKind('kind').notNull(),
    status: requestStatus('status').notNull().default('draft'),
    requesterPersonId: uuid('requester_person_id')
      .notNull()
      .references(() => people.id),
    budgetId: uuid('budget_id').references(() => budgets.id),
    eventId: uuid('event_id'),
    amountMinor: minor('amount_minor').notNull(),
    approvedMinor: minor('approved_minor'),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    spendType: varchar('spend_type', { length: 50 }).notNull(),
    purpose: text('purpose').notNull(),
    resubmissionOfId: uuid('resubmission_of_id'),
    ref: varchar('ref', { length: 20 })
      .notNull()
      .default(sql`'REQ-' || lpad(nextval('request_ref_seq')::text, 5, '0')`),
    title: text('title').notNull().default(''),
    category: varchar('category', { length: 50 }),
    neededBy: day('needed_by'),
    /** The amount in the budget currency at the locked plan rate when submitted. */
    budgetAmountMinor: minor('budget_amount_minor'),
    budgetCurrency: ccy('budget_currency').references(() => currencies.code),
    commitmentId: uuid('commitment_id'),
    /** Spend beyond available within the budget's tolerance or soft mode needs an over-budget approval. */
    overBudget: boolean('over_budget').notNull().default(false),
    version: integer('version').notNull().default(1),
    submittedAt: ts('submitted_at'),
    decidedAt: ts('decided_at'),
    reasonCode: varchar('reason_code', { length: 50 }),
    decisionReason: text('decision_reason'),
    /** Set while the budget is frozen: decisions wait until it is unfrozen. */
    heldAt: ts('held_at'),
    holdReason: text('hold_reason'),
    cancelReason: text('cancel_reason'),
    counterOfferMinor: minor('counter_offer_minor'),
    counterOfferCurrency: ccy('counter_offer_currency').references(() => currencies.code),
    counterOfferedBy: uuid('counter_offered_by').references(() => people.id),
    counterOfferedAt: ts('counter_offered_at'),
    counterOfferExpiresAt: ts('counter_offer_expires_at'),
    /** Employees who receive the benefit; their annual employee and gift caps apply (gap A2). */
    benefitRecipientIds: uuid('benefit_recipient_ids').array(),
    /** People outside the company sharing the benefit; their shares count against no cap. */
    nonEmployeeCount: integer('non_employee_count'),
    /** The part of the amount spent on alcohol, in the request currency. */
    alcoholAmountMinor: minor('alcohol_amount_minor'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('requests_tenant_status').on(t.tenantId, t.status),
    index('requests_tenant_budget').on(t.tenantId, t.budgetId),
    index('requests_tenant_requester').on(t.tenantId, t.requesterPersonId, t.createdAt),
    index('requests_tenant_event').on(t.tenantId, t.eventId),
    uniqueIndex('requests_tenant_ref').on(t.tenantId, t.ref),
  ],
);

export const commitments = pgTable(
  'commitments',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    requestId: uuid('request_id').references(() => requests.id),
    eventId: uuid('event_id'),
    status: commitmentStatus('status').notNull().default('pre_encumbered'),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    glAccountId: uuid('gl_account_id'),
    description: text('description').notNull(),
    serviceStart: day('service_start'),
    serviceEnd: day('service_end'),
    accountingPeriodId: uuid('accounting_period_id').references(() => fiscalPeriods.id),
    amountMinor: minor('amount_minor').notNull(),
    consumedMinor: minor('consumed_minor').notNull().default(0),
    releasedMinor: minor('released_minor').notNull().default(0),
    feesMinor: minor('fees_minor').notNull().default(0),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    nonRefundableDepositMinor: minor('non_refundable_deposit_minor').notNull().default(0),
    expiresOn: day('expires_on'),
    createdByPersonId: uuid('created_by_person_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Year-end carry-forward: the commitment in the ending year this one continues. */
    carriedFromCommitmentId: uuid('carried_from_commitment_id'),
  },
  (t) => [
    index('commitments_tenant_budget').on(t.tenantId, t.budgetId, t.status),
    index('commitments_tenant_event').on(t.tenantId, t.eventId),
  ],
);

/** One funding line per contributor (own budget or an Inter-Director Budget Contribution Request). */
export const commitmentFundingLines = pgTable(
  'commitment_funding_lines',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    commitmentId: uuid('commitment_id')
      .notNull()
      .references(() => commitments.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    contributionRequestId: uuid('contribution_request_id'),
    /** Event funding source the line draws on (null for a request's own budget). */
    fundingSourceId: uuid('funding_source_id'),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    /** Budget-currency amount first posted and the rates used; every later movement reuses these rates. */
    budgetAmountMinor: minor('budget_amount_minor'),
    budgetCurrency: ccy('budget_currency').references(() => currencies.code),
    rateType: rateType('rate_type'),
    budgetRate: numeric('budget_rate', { precision: 24, scale: 12 }),
    budgetRateIds: uuid('budget_rate_ids').array(),
    reportingCurrency: ccy('reporting_currency').references(() => currencies.code),
    reportingRate: numeric('reporting_rate', { precision: 24, scale: 12 }),
    reportingRateIds: uuid('reporting_rate_ids').array(),
  },
  (t) => [
    index('commitment_funding_lines_commitment').on(t.tenantId, t.commitmentId),
    index('commitment_funding_lines_source').on(t.tenantId, t.fundingSourceId),
  ],
);

export const commitmentTaxLines = pgTable(
  'commitment_tax_lines',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    commitmentId: uuid('commitment_id')
      .notNull()
      .references(() => commitments.id),
    taxCode: varchar('tax_code', { length: 30 }).notNull(),
    rateBps: integer('rate_bps').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    recoverable: boolean('recoverable').notNull(),
    withholding: boolean('withholding').notNull().default(false),
  },
  (t) => [index('commitment_tax_lines_commitment').on(t.tenantId, t.commitmentId)],
);

export const events = pgTable(
  'events',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text('name').notNull(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    status: eventStatus('status').notNull().default('draft'),
    organizerPersonId: uuid('organizer_person_id')
      .notNull()
      .references(() => people.id),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    eventCode: varchar('event_code', { length: 50 }).notNull(),
    budgetId: uuid('budget_id').references(() => budgets.id),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    expectedAttendance: integer('expected_attendance'),
    estimateMinor: minor('estimate_minor').notNull().default(0),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    toleranceBps: integer('tolerance_bps').notNull().default(0),
    description: text('description'),
    venue: text('venue'),
    spendType: varchar('spend_type', { length: 50 }).notNull().default('employee_events'),
    /** Own funds asked from the home budget when the event is submitted. */
    ownFundsMinor: minor('own_funds_minor').notNull().default(0),
    perHeadLimitMinor: minor('per_head_limit_minor'),
    submittedAt: ts('submitted_at'),
    closedAt: ts('closed_at'),
    cancelReason: text('cancel_reason'),
    templateId: uuid('template_id'),
    seriesId: uuid('series_id'),
    attendanceFinal: boolean('attendance_final').notNull().default(false),
    attendanceFinalAt: ts('attendance_final_at'),
    splitAppliedAt: ts('split_applied_at'),
    splitAppliedByPersonId: uuid('split_applied_by_person_id').references(() => people.id),
    splitKeepReason: text('split_keep_reason'),
    organizerNotes: text('organizer_notes'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('events_tenant_code').on(t.tenantId, t.eventCode),
    index('events_tenant_status').on(t.tenantId, t.status),
    index('events_tenant_organizer').on(t.tenantId, t.organizerPersonId),
  ],
);

export const eventLocations = pgTable(
  'event_locations',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    orgUnitId: uuid('org_unit_id')
      .notNull()
      .references(() => orgUnits.id),
  },
  (t) => [uniqueIndex('event_locations_unique').on(t.tenantId, t.eventId, t.orgUnitId)],
);

export const eventParticipants = pgTable(
  'event_participants',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    personId: uuid('person_id').references(() => people.id),
    guestName: text('guest_name'),
    isEmployee: boolean('is_employee').notNull().default(true),
    employingEntityId: uuid('employing_entity_id').references(() => legalEntities.id),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    locationOrgUnitId: uuid('location_org_unit_id').references(() => orgUnits.id),
    rsvpStatus: varchar('rsvp_status', { length: 20 }).notNull().default('invited'),
    rsvpRespondedAt: ts('rsvp_responded_at'),
    waitlistPosition: integer('waitlist_position'),
    remindersSentCount: integer('reminders_sent_count').notNull().default(0),
    attendanceStatus: varchar('attendance_status', { length: 20 }).notNull().default('unknown'),
    needs: jsonb('needs').notNull().default({}),
    needsSubmittedAt: ts('needs_submitted_at'),
    needsDeletedAt: ts('needs_deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('event_participants_event').on(t.tenantId, t.eventId),
    uniqueIndex('event_participants_person')
      .on(t.tenantId, t.eventId, t.personId)
      .where(sql`${t.personId} is not null`),
  ],
);

export const eventCoOrganizers = pgTable(
  'event_co_organizers',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
  },
  (t) => [uniqueIndex('event_co_organizers_unique').on(t.tenantId, t.eventId, t.personId)],
);

/** Cost split by location, team, employing entity or cost center; parts sum to the whole (largest remainder). */
export const eventCostSplits = pgTable(
  'event_cost_splits',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    dimension: varchar('dimension', { length: 20 }).notNull(),
    dimensionId: uuid('dimension_id').notNull(),
    shareWeight: integer('share_weight').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
  },
  (t) => [index('event_cost_splits_event').on(t.tenantId, t.eventId)],
);

/** Inter-Director Budget Contribution Request. */
export const contributionRequests = pgTable(
  'contribution_requests',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id').references(() => events.id),
    requesterPersonId: uuid('requester_person_id')
      .notNull()
      .references(() => people.id),
    giverBudgetId: uuid('giver_budget_id')
      .notNull()
      .references(() => budgets.id),
    receiverBudgetId: uuid('receiver_budget_id').references(() => budgets.id),
    requestedMinor: minor('requested_minor').notNull(),
    approvedMinor: minor('approved_minor'),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    mode: contributionMode('mode').notNull().default('earmark'),
    status: contributionStatus('status').notNull().default('draft'),
    purpose: text('purpose').notNull(),
    decisionReason: text('decision_reason'),
    decidedByPersonId: uuid('decided_by_person_id'),
    decidedAt: ts('decided_at'),
    intercompanyMode: intercompanyMode('intercompany_mode'),
    resubmissionOfId: uuid('resubmission_of_id'),
    ref: varchar('ref', { length: 20 })
      .notNull()
      .default(sql`'IDC-' || lpad(nextval('contribution_ref_seq')::text, 5, '0')`),
    neededBy: day('needed_by'),
    reasonCode: varchar('reason_code', { length: 50 }),
    /** Message from the giving director to the requester with the decision. */
    message: text('message'),
    fundingSourceId: uuid('funding_source_id'),
    rechargeScheduleId: uuid('recharge_schedule_id'),
    version: integer('version').notNull().default(1),
    submittedAt: ts('submitted_at'),
    heldAt: ts('held_at'),
    holdReason: text('hold_reason'),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('contribution_requests_tenant_status').on(t.tenantId, t.status),
    index('contribution_requests_giver').on(t.tenantId, t.giverBudgetId),
    index('contribution_requests_event').on(t.tenantId, t.eventId),
    uniqueIndex('contribution_requests_tenant_ref').on(t.tenantId, t.ref),
  ],
);

export const contributionLines = pgTable(
  'contribution_lines',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    contributionRequestId: uuid('contribution_request_id')
      .notNull()
      .references(() => contributionRequests.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [index('contribution_lines_request').on(t.tenantId, t.contributionRequestId)],
);

export const surplusReturns = pgTable(
  'surplus_returns',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    contributionRequestId: uuid('contribution_request_id').references(
      () => contributionRequests.id,
    ),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    journalId: uuid('journal_id'),
    createdAt: createdAt(),
  },
  (t) => [index('surplus_returns_event').on(t.tenantId, t.eventId)],
);

/** Per-employee benefits for annual caps and benefit-in-kind thresholds. */
export const employeeBenefitLedger = pgTable(
  'employee_benefit_ledger',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    eventId: uuid('event_id').references(() => events.id),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    benefitType: varchar('benefit_type', { length: 50 }).notNull(),
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    taxable: boolean('taxable').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('employee_benefit_ledger_person').on(t.tenantId, t.personId, t.fiscalYearId)],
);
