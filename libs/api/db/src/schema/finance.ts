import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ccy, createdAt, day, minor, pk, tenantRef, ts, validFrom, validTo } from './_columns';
import { calendarType, intercompanyMode, periodStatus, rateType, rechargeStatus } from './enums';
import { currencies, tenants } from './tenancy';

export const fiscalCalendars = pgTable(
  'fiscal_calendars',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    name: text('name').notNull(),
    calendarType: calendarType('calendar_type').notNull(),
    startMonth: integer('start_month'),
    labelBy: varchar('label_by', { length: 5 }),
    endMonth: integer('end_month'),
    endWeekday: integer('end_weekday'),
    weekMethod: varchar('week_method', { length: 10 }),
    /** The group calendar this entity calendar maps to (null for the group calendar itself). */
    groupCalendarId: uuid('group_calendar_id'),
    createdAt: createdAt(),
  },
  (t) => [index('fiscal_calendars_tenant').on(t.tenantId)],
);

export const fiscalYears = pgTable(
  'fiscal_years',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fiscalCalendarId: uuid('fiscal_calendar_id')
      .notNull()
      .references(() => fiscalCalendars.id),
    label: varchar('label', { length: 20 }).notNull(),
    startDate: day('start_date').notNull(),
    endDate: day('end_date').notNull(),
    groupFiscalYearId: uuid('group_fiscal_year_id'),
    planRatesLockedAt: ts('plan_rates_locked_at'),
  },
  (t) => [
    index('fiscal_years_tenant').on(t.tenantId, t.fiscalCalendarId),
    uniqueIndex('fiscal_years_calendar_label').on(t.fiscalCalendarId, t.label),
  ],
);

export const fiscalPeriods = pgTable(
  'fiscal_periods',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id),
    fiscalCalendarId: uuid('fiscal_calendar_id')
      .notNull()
      .references(() => fiscalCalendars.id),
    periodNumber: integer('period_number').notNull(),
    label: varchar('label', { length: 30 }).notNull(),
    startDate: day('start_date').notNull(),
    endDate: day('end_date').notNull(),
    status: periodStatus('status').notNull().default('open'),
    statusChangedAt: ts('status_changed_at'),
    statusChangedBy: uuid('status_changed_by'),
  },
  (t) => [
    index('fiscal_periods_tenant_dates').on(t.tenantId, t.fiscalCalendarId, t.startDate),
    uniqueIndex('fiscal_periods_year_number').on(t.fiscalYearId, t.periodNumber),
  ],
);

export const legalEntities = pgTable(
  'legal_entities',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: varchar('code', { length: 30 }).notNull(),
    name: text('name').notNull(),
    country: char2('country'),
    functionalCurrency: ccy('functional_currency')
      .notNull()
      .references(() => currencies.code),
    fiscalCalendarId: uuid('fiscal_calendar_id')
      .notNull()
      .references(() => fiscalCalendars.id),
    taxJurisdiction: varchar('tax_jurisdiction', { length: 50 }),
    erpCompanyCode: varchar('erp_company_code', { length: 50 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('legal_entities_tenant_code').on(t.tenantId, t.code)],
);

function char2(name: string) {
  return varchar(name, { length: 2 });
}

/** Rates quoted as units of `quote` per one `base` (the tenant reporting currency). Plan rates lock per fiscal year. */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    rateType: rateType('rate_type').notNull(),
    baseCurrency: ccy('base_currency')
      .notNull()
      .references(() => currencies.code),
    quoteCurrency: ccy('quote_currency')
      .notNull()
      .references(() => currencies.code),
    rate: numeric('rate', { precision: 24, scale: 12 }).notNull(),
    effectiveDate: day('effective_date').notNull(),
    fiscalYearId: uuid('fiscal_year_id').references(() => fiscalYears.id),
    source: varchar('source', { length: 50 }).notNull(),
    locked: boolean('locked').notNull().default(false),
    lockedAt: ts('locked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('exchange_rates_lookup').on(t.tenantId, t.rateType, t.quoteCurrency, t.effectiveDate),
    uniqueIndex('exchange_rates_unique').on(
      t.tenantId,
      t.rateType,
      t.baseCurrency,
      t.quoteCurrency,
      t.effectiveDate,
    ),
  ],
);

export const intercompanyPolicies = pgTable(
  'intercompany_policies',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    fromLegalEntityId: uuid('from_legal_entity_id').references(() => legalEntities.id),
    toLegalEntityId: uuid('to_legal_entity_id').references(() => legalEntities.id),
    mode: intercompanyMode('mode').notNull(),
    markupBps: integer('markup_bps').notNull().default(0),
    taxApproverPersonId: uuid('tax_approver_person_id'),
    validFrom: validFrom(),
    validTo: validTo(),
    createdAt: createdAt(),
  },
  (t) => [index('intercompany_policies_tenant').on(t.tenantId)],
);

export const rechargeSchedules = pgTable(
  'recharge_schedules',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    contributionRequestId: uuid('contribution_request_id'),
    eventId: uuid('event_id'),
    fromLegalEntityId: uuid('from_legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    toLegalEntityId: uuid('to_legal_entity_id')
      .notNull()
      .references(() => legalEntities.id),
    mode: intercompanyMode('mode').notNull(),
    amountMinor: minor('amount_minor').notNull(),
    markupMinor: minor('markup_minor').notNull().default(0),
    currency: ccy('currency')
      .notNull()
      .references(() => currencies.code),
    status: rechargeStatus('status').notNull().default('proposed'),
    duePeriodId: uuid('due_period_id').references(() => fiscalPeriods.id),
    journalId: uuid('journal_id'),
    markupBps: integer('markup_bps').notNull().default(0),
    taxApproverPersonId: uuid('tax_approver_person_id'),
    taxApprovedAt: ts('tax_approved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('recharge_schedules_tenant').on(t.tenantId, t.status),
    index('recharge_schedules_event').on(t.tenantId, t.eventId),
  ],
);
