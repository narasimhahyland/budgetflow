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
import {
  commitmentStatus,
  contributionMode,
  contributionStatus,
  eventStatus,
  intercompanyMode,
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('requests_tenant_status').on(t.tenantId, t.status),
    index('requests_tenant_budget').on(t.tenantId, t.budgetId),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('commitments_tenant_budget').on(t.tenantId, t.budgetId, t.status)],
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
    amountMinor: minor('amount_minor').notNull(),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
  },
  (t) => [index('commitment_funding_lines_commitment').on(t.tenantId, t.commitmentId)],
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('events_tenant_code').on(t.tenantId, t.eventCode),
    index('events_tenant_status').on(t.tenantId, t.status),
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
    attendanceStatus: varchar('attendance_status', { length: 20 }).notNull().default('unknown'),
    needs: jsonb('needs').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('event_participants_event').on(t.tenantId, t.eventId)],
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('contribution_requests_tenant_status').on(t.tenantId, t.status),
    index('contribution_requests_giver').on(t.tenantId, t.giverBudgetId),
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
