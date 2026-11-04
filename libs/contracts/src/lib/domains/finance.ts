import { z } from 'zod';
import {
  AppliedRate,
  CurrencyCode,
  CursorQuery,
  Id,
  IsoDate,
  IsoDateTime,
  Money,
  RateType,
  RoleId,
} from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

const Code = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$/)
  .describe('Business code: letters, digits, dot, dash or underscore (up to 50).');
const Reason = z.string().trim().min(1).max(500);
const LegalEntityParams = z.object({ legalEntityId: Id }).strict();
const CalendarParams = z.object({ calendarId: Id }).strict();
const PeriodParams = z.object({ periodId: Id }).strict();
const FiscalYearParams = z.object({ fiscalYearId: Id }).strict();
const ReasonCodeParams = z.object({ reasonCodeId: Id }).strict();
const VendorParams = z.object({ vendorId: Id }).strict();

// Legal entities ---------------------------------------------------------------------------------
export const LegalEntity = named(
  'LegalEntity',
  z
    .object({
      id: Id,
      code: z.string(),
      name: z.string(),
      country: z.string().nullable(),
      functionalCurrency: CurrencyCode,
      fiscalCalendarId: Id,
      fiscalCalendarName: z.string(),
      taxJurisdiction: z.string().nullable(),
      erpCompanyCode: z.string().nullable(),
      costCenterCount: z.int().min(0),
      allowedActions: z.array(z.string()),
    })
    .strict()
    .describe('A legal entity: functional currency, fiscal calendar, tax jurisdiction, ERP code.'),
);
export type LegalEntity = z.infer<typeof LegalEntity>;

export const LegalEntityList = named(
  'LegalEntityList',
  z.object({ items: z.array(LegalEntity) }).strict(),
);

export const CreateLegalEntityRequest = named(
  'CreateLegalEntityRequest',
  z
    .object({
      code: Code,
      name: z.string().trim().min(1).max(200),
      country: z.string().regex(/^[A-Z]{2}$/),
      functionalCurrency: CurrencyCode,
      fiscalCalendarId: Id,
      taxJurisdiction: z.string().max(50).optional(),
      erpCompanyCode: z.string().max(50).optional(),
    })
    .strict(),
);

export const UpdateLegalEntityRequest = named(
  'UpdateLegalEntityRequest',
  z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      taxJurisdiction: z.string().max(50).nullable().optional(),
      erpCompanyCode: z.string().max(50).nullable().optional(),
      reason: Reason,
    })
    .strict()
    .describe(
      'Functional currency and fiscal calendar are fixed once an entity exists (they drive postings).',
    ),
);

// Fiscal calendars and periods -------------------------------------------------------------------
export const CALENDAR_TYPES = [
  'calendar_year',
  'non_calendar',
  '4-4-5',
  '4-5-4',
  '5-4-4',
  '13-period',
] as const;
export const CalendarType = z.enum(CALENDAR_TYPES);
export const PeriodStatus = z
  .enum(['open', 'soft_closed', 'closed', 'locked'])
  .describe('Open accepts postings; soft-closed finance adjustments only; closed and locked none.');
export const PeriodAction = z.enum(['soft_close', 'close', 'lock', 'reopen', 'unlock']);

export const CalendarDefinition = named(
  'CalendarDefinition',
  z
    .object({
      type: CalendarType,
      startMonth: z.int().min(1).max(12).optional().describe('Monthly calendars: first month.'),
      labelBy: z
        .enum(['start', 'end'])
        .optional()
        .describe('Monthly calendars: label the year by the calendar year it starts or ends in.'),
      endMonth: z.int().min(1).max(12).optional().describe('Weekly calendars: year-end month.'),
      endWeekday: z
        .int()
        .min(0)
        .max(6)
        .optional()
        .describe('Weekly calendars: year-end weekday, 0 = Sunday.'),
      method: z
        .enum(['last', 'nearest'])
        .optional()
        .describe('Weekly calendars: last such weekday of the month, or nearest the month end.'),
    })
    .strict()
    .describe(
      'Calendar year, non-calendar year (any start month), or 52/53-week 4-4-5, 4-5-4, 5-4-4 and 13-period.',
    ),
);
export type CalendarDefinition = z.infer<typeof CalendarDefinition>;

export const FiscalPeriod = named(
  'FiscalPeriod',
  z
    .object({
      id: Id,
      fiscalYearId: Id,
      periodNumber: z.int(),
      label: z.string(),
      startDate: IsoDate,
      endDate: IsoDate,
      status: PeriodStatus,
      statusChangedAt: IsoDateTime.nullable(),
      allowedActions: z.array(PeriodAction).describe('Status changes the caller may make now.'),
    })
    .strict(),
);
export type FiscalPeriod = z.infer<typeof FiscalPeriod>;

export const FiscalYear = named(
  'FiscalYear',
  z
    .object({
      id: Id,
      label: z.string(),
      startDate: IsoDate,
      endDate: IsoDate,
      weeks: z.int().nullable().describe('52 or 53 for weekly calendars.'),
      groupFiscalYearId: Id.nullable(),
      groupFiscalYearLabel: z.string().nullable(),
      planRatesLockedAt: IsoDateTime.nullable(),
      periods: z.array(FiscalPeriod),
    })
    .strict(),
);

export const FiscalCalendarSummary = named(
  'FiscalCalendarSummary',
  z
    .object({
      id: Id,
      name: z.string(),
      definition: CalendarDefinition,
      groupCalendarId: Id.nullable(),
      groupCalendarName: z.string().nullable(),
      legalEntities: z.array(z.object({ id: Id, code: z.string(), name: z.string() }).strict()),
      years: z.array(
        z.object({ id: Id, label: z.string(), startDate: IsoDate, endDate: IsoDate }).strict(),
      ),
    })
    .strict(),
);

export const FiscalCalendarList = named(
  'FiscalCalendarList',
  z.object({ items: z.array(FiscalCalendarSummary) }).strict(),
);

export const FiscalCalendarDetail = named(
  'FiscalCalendarDetail',
  FiscalCalendarSummary.extend({ fiscalYears: z.array(FiscalYear) }).strict(),
);
export type FiscalCalendarDetail = z.infer<typeof FiscalCalendarDetail>;

export const CreateFiscalCalendarRequest = named(
  'CreateFiscalCalendarRequest',
  z
    .object({
      name: z.string().trim().min(1).max(200),
      definition: CalendarDefinition,
      groupCalendarId: Id.optional().describe('Map this entity calendar to the group calendar.'),
      years: z.array(z.int().min(1900).max(2999)).min(1).max(10),
    })
    .strict(),
);

export const PreviewFiscalCalendarRequest = named(
  'PreviewFiscalCalendarRequest',
  z.object({ definition: CalendarDefinition, year: z.int().min(1900).max(2999) }).strict(),
);

export const FiscalYearPreview = named(
  'FiscalYearPreview',
  z
    .object({
      label: z.string(),
      startDate: IsoDate,
      endDate: IsoDate,
      weeks: z.int().nullable(),
      days: z.int(),
      periods: z.array(
        z
          .object({
            number: z.int(),
            label: z.string(),
            startDate: IsoDate,
            endDate: IsoDate,
            days: z.int(),
          })
          .strict(),
      ),
    })
    .strict()
    .describe('Generated periods for one fiscal year (nothing saved).'),
);

export const AddFiscalYearRequest = named(
  'AddFiscalYearRequest',
  z.object({ year: z.int().min(1900).max(2999) }).strict(),
);

export const PeriodStatusChangeRequest = named(
  'PeriodStatusChangeRequest',
  z
    .object({
      action: PeriodAction,
      reason: Reason.optional().describe('Required to reopen or unlock.'),
    })
    .strict(),
);

export const PlanRateLockRequest = named(
  'PlanRateLockRequest',
  z.object({ reason: Reason }).strict(),
);

// Currencies and exchange rates -----------------------------------------------------------------
export const Currency = named(
  'Currency',
  z.object({ code: CurrencyCode, name: z.string(), exponent: z.int() }).strict(),
);

export const CurrencyList = named(
  'CurrencyList',
  z.object({ reportingCurrency: CurrencyCode, items: z.array(Currency) }).strict(),
);

export const ExchangeRate = named(
  'ExchangeRate',
  z
    .object({
      id: Id,
      rateType: RateType,
      baseCurrency: CurrencyCode,
      quoteCurrency: CurrencyCode,
      rate: z.string().describe('Units of quote per one base, up to 12 decimals.'),
      effectiveDate: IsoDate,
      fiscalYearId: Id.nullable(),
      fiscalYearLabel: z.string().nullable(),
      source: z.string(),
      locked: z.boolean(),
      lockedAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type ExchangeRate = z.infer<typeof ExchangeRate>;

export const RatesQuery = CursorQuery.extend({
  rateType: RateType.optional(),
  quoteCurrency: CurrencyCode.optional(),
  fiscalYearId: Id.optional(),
}).strict();

export const ExchangeRateList = named(
  'ExchangeRateList',
  z
    .object({
      reportingCurrency: CurrencyCode,
      items: z.array(ExchangeRate),
      nextCursor: z.string().nullable(),
    })
    .strict(),
);

export const CreateExchangeRateRequest = named(
  'CreateExchangeRateRequest',
  z
    .object({
      rateType: RateType,
      quoteCurrency: CurrencyCode,
      rate: z
        .string()
        .regex(/^\d{1,12}(\.\d{1,12})?$/)
        .describe('Units of quote per one reporting-currency unit.'),
      effectiveDate: IsoDate,
      fiscalYearId: Id.optional().describe('Required for plan rates.'),
      source: z.string().trim().min(1).max(50),
    })
    .strict(),
);

export const RateLookupQuery = z
  .object({
    from: CurrencyCode,
    to: CurrencyCode,
    date: IsoDate,
    type: RateType,
    amountMinor: z.coerce.number().int().optional(),
  })
  .strict();

export const RateLookupResponse = named(
  'RateLookupResponse',
  z
    .object({
      type: RateType,
      date: IsoDate,
      applied: AppliedRate,
      sources: z.array(
        z
          .object({
            rateId: Id,
            quoteCurrency: CurrencyCode,
            rate: z.string(),
            effectiveDate: IsoDate,
            fiscalYearLabel: z.string().nullable(),
            locked: z.boolean(),
          })
          .strict(),
      ),
      amount: Money.nullable(),
      converted: Money.nullable(),
    })
    .strict()
    .describe('The rate that applies on a date for a rate type, and an optional conversion.'),
);
export type RateLookupResponse = z.infer<typeof RateLookupResponse>;

export const PlanRateLockResponse = named(
  'PlanRateLockResponse',
  z
    .object({
      fiscalYearId: Id,
      fiscalYearLabel: z.string(),
      planRatesLockedAt: IsoDateTime,
      lockedRates: z.int(),
    })
    .strict(),
);

// GL accounts, mappings and categories ----------------------------------------------------------
export const GlAccountType = z.enum(['expense', 'liability', 'asset', 'revenue', 'equity']);
export const AttendeeType = z
  .enum(['employee', 'client'])
  .describe('Employee events and client entertainment map to different GL accounts.');

export const GlAccount = named(
  'GlAccount',
  z
    .object({
      id: Id,
      legalEntityId: Id,
      code: z.string(),
      name: z.string(),
      accountType: GlAccountType,
    })
    .strict(),
);

export const GlAccountQuery = z.object({ legalEntityId: Id.optional() }).strict();

export const GlAccountList = named(
  'GlAccountList',
  z.object({ items: z.array(GlAccount) }).strict(),
);

export const CreateGlAccountRequest = named(
  'CreateGlAccountRequest',
  z
    .object({
      legalEntityId: Id,
      code: Code,
      name: z.string().trim().min(1).max(200),
      accountType: GlAccountType,
    })
    .strict(),
);

export const GlMapping = named(
  'GlMapping',
  z
    .object({
      id: Id,
      legalEntityId: Id,
      categoryId: Id,
      categoryCode: z.string(),
      categoryName: z.string(),
      attendeeType: AttendeeType,
      glAccountId: Id,
      glAccountCode: z.string(),
      glAccountName: z.string(),
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
    })
    .strict(),
);

export const GlMappingQuery = z
  .object({ legalEntityId: Id.optional(), asOf: IsoDate.optional() })
  .strict();

export const GlMappingList = named(
  'GlMappingList',
  z.object({ asOf: IsoDate, items: z.array(GlMapping) }).strict(),
);

export const CreateGlMappingRequest = named(
  'CreateGlMappingRequest',
  z
    .object({
      legalEntityId: Id,
      categoryCode: z.string().min(1).max(50),
      attendeeType: AttendeeType,
      glAccountId: Id,
      effectiveFrom: IsoDate.describe('The current mapping, if any, ends the day before.'),
    })
    .strict(),
);

export const Category = named(
  'Category',
  z.object({ id: Id, code: z.string(), name: z.string() }).strict(),
);
export const CategoryList = named('CategoryList', z.object({ items: z.array(Category) }).strict());

// Reason codes -----------------------------------------------------------------------------------
export const REASON_CATEGORIES = [
  'reduction',
  'freeze',
  'transfer',
  'increase',
  'reversal',
  'exception',
  'rejection',
  'manual',
] as const;
export const ReasonCategory = z.enum(REASON_CATEGORIES);

export const ReasonCode = named(
  'ReasonCode',
  z
    .object({
      id: Id,
      category: z.string(),
      code: z.string(),
      label: z.string(),
      active: z.boolean(),
    })
    .strict(),
);

export const ReasonCodeQuery = z
  .object({
    category: z.string().max(30).optional(),
    includeInactive: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const ReasonCodeList = named(
  'ReasonCodeList',
  z.object({ items: z.array(ReasonCode) }).strict(),
);

export const CreateReasonCodeRequest = named(
  'CreateReasonCodeRequest',
  z
    .object({ category: ReasonCategory, code: Code, label: z.string().trim().min(1).max(200) })
    .strict(),
);

export const UpdateReasonCodeRequest = named(
  'UpdateReasonCodeRequest',
  z
    .object({ label: z.string().trim().min(1).max(200).optional(), active: z.boolean().optional() })
    .strict()
    .refine((r) => r.label !== undefined || r.active !== undefined, {
      message: 'Give a label or an active flag.',
    }),
);

// Vendors ----------------------------------------------------------------------------------------
export const VendorStatus = z
  .enum(['approved', 'preferred', 'blocked', 'unknown'])
  .describe('Blocked vendors cannot be used for new commitments (enforced from Phase 7).');

export const Vendor = named(
  'Vendor',
  z
    .object({
      id: Id,
      name: z.string(),
      status: VendorStatus,
      category: z.string().nullable(),
      country: z.string().nullable(),
      erpVendorId: z.string().nullable(),
      createdAt: IsoDateTime,
    })
    .strict(),
);

export const VendorQuery = CursorQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: VendorStatus.optional(),
}).strict();

export const VendorList = named(
  'VendorList',
  z.object({ items: z.array(Vendor), nextCursor: z.string().nullable() }).strict(),
);

export const CreateVendorRequest = named(
  'CreateVendorRequest',
  z
    .object({
      name: z.string().trim().min(1).max(200),
      status: VendorStatus.default('unknown'),
      category: z.string().max(50).optional(),
      country: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
      erpVendorId: z.string().max(100).optional(),
    })
    .strict(),
);

export const UpdateVendorRequest = named(
  'UpdateVendorRequest',
  z
    .object({
      status: VendorStatus.optional(),
      category: z.string().max(50).nullable().optional(),
      country: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .nullable()
        .optional(),
      reason: Reason,
    })
    .strict(),
);

// Delegation of authority (read view) ------------------------------------------------------------
export const DoaLimit = named(
  'DoaLimit',
  z
    .object({
      id: Id,
      role: RoleId.nullable(),
      personId: Id.nullable(),
      personName: z.string().nullable(),
      spendType: z.string().describe("'*' applies to every spend type."),
      legalEntityId: Id.nullable().describe('Null applies to every legal entity.'),
      legalEntityCode: z.string().nullable(),
      limit: Money,
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
    })
    .strict(),
);
export type DoaLimit = z.infer<typeof DoaLimit>;

export const DoaMatrix = named(
  'DoaMatrix',
  z
    .object({
      version: z
        .object({
          id: Id,
          version: z.int(),
          status: z.string(),
          validFrom: IsoDate,
          validTo: IsoDate.nullable(),
          approvedByName: z.string().nullable(),
        })
        .strict()
        .nullable(),
      spendTypes: z.array(z.string()),
      items: z.array(DoaLimit),
    })
    .strict()
    .describe(
      'The active delegation-of-authority matrix (read-only in Phase 3; enforced Phase 5, administered Phase 7).',
    ),
);
export type DoaMatrix = z.infer<typeof DoaMatrix>;

export const DoaLookupQuery = z
  .object({
    personId: Id.optional(),
    role: RoleId.optional(),
    spendType: z.string().min(1).max(50),
    legalEntityId: Id,
    amountMinor: z.coerce.number().int().min(0),
    currency: CurrencyCode,
    date: IsoDate.optional(),
  })
  .strict();

export const DoaLookupResponse = named(
  'DoaLookupResponse',
  z
    .object({
      withinLimit: z.boolean(),
      code: z.enum(['DOA_LIMIT_EXCEEDED', 'DOA_NO_AUTHORITY']).nullable(),
      message: z.string(),
      date: IsoDate,
      amount: Money,
      limit: DoaLimit.nullable(),
      approver: z
        .object({
          personId: Id.nullable(),
          displayName: z.string().nullable(),
          roles: z.array(RoleId),
        })
        .strict(),
    })
    .strict()
    .describe('Which limit applies to an approver for a spend type, entity and amount.'),
);
export type DoaLookupResponse = z.infer<typeof DoaLookupResponse>;

// Endpoints --------------------------------------------------------------------------------------
export const financeEndpoints = {
  listLegalEntities: {
    operationId: 'listLegalEntities',
    method: 'get',
    path: '/api/finance/legal-entities',
    summary: 'Legal entities',
    tags: ['finance'],
    auth: true,
    response: { status: 200, schema: LegalEntityList },
    errors: [401, 403],
  },
  createLegalEntity: {
    operationId: 'createLegalEntity',
    method: 'post',
    path: '/api/finance/legal-entities',
    summary: 'Create a legal entity',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    body: CreateLegalEntityRequest,
    response: { status: 201, schema: LegalEntity },
    errors: [400, 401, 403, 404, 409, 422],
  },
  updateLegalEntity: {
    operationId: 'updateLegalEntity',
    method: 'patch',
    path: '/api/finance/legal-entities/{legalEntityId}',
    summary: 'Rename a legal entity or change its tax and ERP codes',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    params: LegalEntityParams,
    body: UpdateLegalEntityRequest,
    response: { status: 200, schema: LegalEntity },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listFiscalCalendars: {
    operationId: 'listFiscalCalendars',
    method: 'get',
    path: '/api/finance/fiscal-calendars',
    summary: 'Fiscal calendars with their entities and years',
    tags: ['finance'],
    auth: true,
    response: { status: 200, schema: FiscalCalendarList },
    errors: [401, 403],
  },
  getFiscalCalendar: {
    operationId: 'getFiscalCalendar',
    method: 'get',
    path: '/api/finance/fiscal-calendars/{calendarId}',
    summary: 'A fiscal calendar with years, periods and statuses',
    tags: ['finance'],
    auth: true,
    params: CalendarParams,
    response: { status: 200, schema: FiscalCalendarDetail },
    errors: [400, 401, 403, 404],
  },
  createFiscalCalendar: {
    operationId: 'createFiscalCalendar',
    method: 'post',
    path: '/api/finance/fiscal-calendars',
    summary: 'Create a fiscal calendar and generate its years and periods',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    body: CreateFiscalCalendarRequest,
    response: { status: 201, schema: FiscalCalendarDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  previewFiscalCalendar: {
    operationId: 'previewFiscalCalendar',
    method: 'post',
    path: '/api/finance/fiscal-calendars/preview',
    summary: 'Generate the periods of one fiscal year without saving',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    body: PreviewFiscalCalendarRequest,
    response: { status: 200, schema: FiscalYearPreview },
    errors: [400, 401, 403, 404, 409, 422],
  },
  addFiscalYear: {
    operationId: 'addFiscalYear',
    method: 'post',
    path: '/api/finance/fiscal-calendars/{calendarId}/years',
    summary: 'Generate another fiscal year for a calendar',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    params: CalendarParams,
    body: AddFiscalYearRequest,
    response: { status: 201, schema: FiscalCalendarDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  changePeriodStatus: {
    operationId: 'changePeriodStatus',
    method: 'post',
    path: '/api/finance/fiscal-periods/{periodId}/status',
    summary: 'Soft-close, close, lock, reopen or unlock an accounting period',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    params: PeriodParams,
    body: PeriodStatusChangeRequest,
    response: { status: 201, schema: FiscalPeriod },
    errors: [400, 401, 403, 404, 409, 422],
  },
  lockPlanRates: {
    operationId: 'lockPlanRates',
    method: 'post',
    path: '/api/finance/fiscal-years/{fiscalYearId}/plan-rate-lock',
    summary: 'Lock the plan rates of a fiscal year',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    params: FiscalYearParams,
    body: PlanRateLockRequest,
    response: { status: 201, schema: PlanRateLockResponse },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listCurrencies: {
    operationId: 'listCurrencies',
    method: 'get',
    path: '/api/finance/currencies',
    summary: 'Currencies and the tenant reporting currency',
    tags: ['finance'],
    auth: true,
    response: { status: 200, schema: CurrencyList },
    errors: [401, 403],
  },
  listExchangeRates: {
    operationId: 'listExchangeRates',
    method: 'get',
    path: '/api/finance/exchange-rates',
    summary: 'Exchange rates by type, currency and fiscal year',
    tags: ['finance'],
    auth: true,
    query: RatesQuery,
    response: { status: 200, schema: ExchangeRateList },
    errors: [400, 401, 403, 404],
  },
  createExchangeRate: {
    operationId: 'createExchangeRate',
    method: 'post',
    path: '/api/finance/exchange-rates',
    summary: 'Add an exchange rate (plan rates only while the fiscal year is unlocked)',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    body: CreateExchangeRateRequest,
    response: { status: 201, schema: ExchangeRate },
    errors: [400, 401, 403, 404, 409, 422],
  },
  lookupExchangeRate: {
    operationId: 'lookupExchangeRate',
    method: 'get',
    path: '/api/finance/exchange-rates/lookup',
    summary: 'The rate that applies on a date for a rate type, with an optional conversion',
    tags: ['finance'],
    auth: true,
    query: RateLookupQuery,
    response: { status: 200, schema: RateLookupResponse },
    errors: [400, 401, 403, 404, 422],
  },
  listGlAccounts: {
    operationId: 'listGlAccounts',
    method: 'get',
    path: '/api/finance/gl-accounts',
    summary: 'GL accounts per legal entity',
    tags: ['finance'],
    auth: true,
    query: GlAccountQuery,
    response: { status: 200, schema: GlAccountList },
    errors: [400, 401, 403, 404],
  },
  createGlAccount: {
    operationId: 'createGlAccount',
    method: 'post',
    path: '/api/finance/gl-accounts',
    summary: 'Create a GL account',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    body: CreateGlAccountRequest,
    response: { status: 201, schema: GlAccount },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listGlMappings: {
    operationId: 'listGlMappings',
    method: 'get',
    path: '/api/finance/gl-mappings',
    summary: 'Category-to-GL mappings as of a date',
    tags: ['finance'],
    auth: true,
    query: GlMappingQuery,
    response: { status: 200, schema: GlMappingList },
    errors: [400, 401, 403, 404],
  },
  createGlMapping: {
    operationId: 'createGlMapping',
    method: 'post',
    path: '/api/finance/gl-mappings',
    summary: 'Map a category and attendee type to a GL account from an effective date',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    body: CreateGlMappingRequest,
    response: { status: 201, schema: GlMapping },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listCategories: {
    operationId: 'listCategories',
    method: 'get',
    path: '/api/finance/categories',
    summary: 'Budget categories',
    tags: ['finance'],
    auth: true,
    response: { status: 200, schema: CategoryList },
    errors: [401, 403],
  },
  listReasonCodes: {
    operationId: 'listReasonCodes',
    method: 'get',
    path: '/api/finance/reason-codes',
    summary: 'Reason-code taxonomy',
    tags: ['finance'],
    auth: true,
    query: ReasonCodeQuery,
    response: { status: 200, schema: ReasonCodeList },
    errors: [400, 401, 403, 404],
  },
  createReasonCode: {
    operationId: 'createReasonCode',
    method: 'post',
    path: '/api/finance/reason-codes',
    summary: 'Add a reason code',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    body: CreateReasonCodeRequest,
    response: { status: 201, schema: ReasonCode },
    errors: [400, 401, 403, 404, 409, 422],
  },
  updateReasonCode: {
    operationId: 'updateReasonCode',
    method: 'patch',
    path: '/api/finance/reason-codes/{reasonCodeId}',
    summary: 'Relabel, retire or reinstate a reason code',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    params: ReasonCodeParams,
    body: UpdateReasonCodeRequest,
    response: { status: 200, schema: ReasonCode },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listVendors: {
    operationId: 'listVendors',
    method: 'get',
    path: '/api/finance/vendors',
    summary: 'Vendor master',
    tags: ['finance'],
    auth: true,
    query: VendorQuery,
    response: { status: 200, schema: VendorList },
    errors: [400, 401, 403, 404],
  },
  createVendor: {
    operationId: 'createVendor',
    method: 'post',
    path: '/api/finance/vendors',
    summary: 'Add a vendor',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    body: CreateVendorRequest,
    response: { status: 201, schema: Vendor },
    errors: [400, 401, 403, 404, 409, 422],
  },
  updateVendor: {
    operationId: 'updateVendor',
    method: 'patch',
    path: '/api/finance/vendors/{vendorId}',
    summary: 'Approve, prefer or block a vendor',
    tags: ['finance'],
    auth: true,
    idempotent: true,
    params: VendorParams,
    body: UpdateVendorRequest,
    response: { status: 200, schema: Vendor },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getDoaMatrix: {
    operationId: 'getDoaMatrix',
    method: 'get',
    path: '/api/finance/doa',
    summary: 'The active delegation-of-authority matrix',
    tags: ['finance'],
    auth: true,
    response: { status: 200, schema: DoaMatrix },
    errors: [401, 403],
  },
  lookupDoa: {
    operationId: 'lookupDoa',
    method: 'get',
    path: '/api/finance/doa/lookup',
    summary: 'Which DoA limit applies to an approver for a spend type, entity and amount',
    tags: ['finance'],
    auth: true,
    query: DoaLookupQuery,
    response: { status: 200, schema: DoaLookupResponse },
    errors: [400, 401, 403, 404, 422],
  },
} as const satisfies Record<string, Endpoint>;
