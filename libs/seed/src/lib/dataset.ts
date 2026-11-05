import {
  BUDGETS,
  CALENDAR_INDEX,
  CALENDARS,
  COST_CENTERS,
  DOA_MATRIX,
  FISCAL_YEARS,
  LEGAL_ENTITIES,
  ORG_UNITS,
  PLAN_VERSIONS,
  seedId,
  TENANTS,
} from './ids';
import { ALL_USERS, userById, type SeedUserId } from './roles';

/** Fixed accounting date for seed postings (an open period) and the seed's notion of "as of". */
export const SEED_ACCOUNTING_DATE = '2026-11-02';

/**
 * Deterministic period statuses: periods ending before Jul 2026 are locked, Jul-Sep 2026 closed,
 * Oct 2026 soft-closed, Nov 2026 onward open.
 */
export function seedPeriodStatus(endDate: string): 'open' | 'soft_closed' | 'closed' | 'locked' {
  if (endDate < '2026-07-01') return 'locked';
  if (endDate < '2026-10-01') return 'closed';
  if (endDate < '2026-11-01') return 'soft_closed';
  return 'open';
}

export const tenantsData = [
  {
    id: TENANTS.acme,
    name: 'Hyland',
    slug: 'hyland',
    reportingCurrency: 'USD',
    defaultTimezone: 'America/New_York',
  },
  {
    id: TENANTS.globex,
    name: 'Globex Corporation',
    slug: 'globex',
    reportingCurrency: 'EUR',
    defaultTimezone: 'Europe/Berlin',
  },
  {
    id: TENANTS.sandbox,
    name: 'Initech Sandbox',
    slug: 'initech-sandbox',
    reportingCurrency: 'USD',
    defaultTimezone: 'UTC',
  },
] as const;

export const calendarsData = [
  {
    id: CALENDARS.acmeGroup,
    index: CALENDAR_INDEX.acmeGroup,
    tenantId: TENANTS.acme,
    name: 'Hyland group calendar (Jan-Dec)',
    def: { type: 'calendar_year', startMonth: 1, labelBy: 'end' },
    groupCalendarId: null,
    years: [2025, 2026, 2027, 2028],
  },
  {
    id: CALENDARS.acmeIndia,
    index: CALENDAR_INDEX.acmeIndia,
    tenantId: TENANTS.acme,
    name: 'Hyland India (Apr-Mar)',
    def: { type: 'non_calendar', startMonth: 4, labelBy: 'end' },
    groupCalendarId: CALENDARS.acmeGroup,
    years: [2026, 2027, 2028, 2029],
  },
  {
    id: CALENDARS.globexGroup,
    index: CALENDAR_INDEX.globexGroup,
    tenantId: TENANTS.globex,
    name: 'Globex calendar (Jan-Dec)',
    def: { type: 'calendar_year', startMonth: 1, labelBy: 'end' },
    groupCalendarId: null,
    years: [2025, 2026, 2027, 2028],
  },
  {
    id: CALENDARS.sandboxGroup,
    index: CALENDAR_INDEX.sandboxGroup,
    tenantId: TENANTS.sandbox,
    name: 'Sandbox calendar (Jan-Dec)',
    def: { type: 'calendar_year', startMonth: 1, labelBy: 'end' },
    groupCalendarId: null,
    years: [2025, 2026, 2027, 2028],
  },
] as const;

export const legalEntitiesData = [
  {
    id: LEGAL_ENTITIES.acmeUs,
    tenantId: TENANTS.acme,
    code: 'HYL-US',
    name: 'Hyland North America, Inc.',
    country: 'US',
    functionalCurrency: 'USD',
    fiscalCalendarId: CALENDARS.acmeGroup,
    taxJurisdiction: 'US',
    erpCompanyCode: '1000',
  },
  {
    id: LEGAL_ENTITIES.acmeIndia,
    tenantId: TENANTS.acme,
    code: 'HYL-IN',
    name: 'Hyland Technologies India Private Limited',
    country: 'IN',
    functionalCurrency: 'INR',
    fiscalCalendarId: CALENDARS.acmeIndia,
    taxJurisdiction: 'IN',
    erpCompanyCode: '2000',
  },
  {
    id: LEGAL_ENTITIES.acmeEurope,
    tenantId: TENANTS.acme,
    code: 'HYL-DE',
    name: 'Hyland Europe GmbH',
    country: 'DE',
    functionalCurrency: 'EUR',
    fiscalCalendarId: CALENDARS.acmeGroup,
    taxJurisdiction: 'DE',
    erpCompanyCode: '3000',
  },
  {
    id: LEGAL_ENTITIES.globex,
    tenantId: TENANTS.globex,
    code: 'GLOBEX-DE',
    name: 'Globex Corporation GmbH',
    country: 'DE',
    functionalCurrency: 'EUR',
    fiscalCalendarId: CALENDARS.globexGroup,
    taxJurisdiction: 'DE',
    erpCompanyCode: 'G100',
  },
  {
    id: LEGAL_ENTITIES.sandbox,
    tenantId: TENANTS.sandbox,
    code: 'INITECH-US',
    name: 'Initech Sandbox LLC',
    country: 'US',
    functionalCurrency: 'USD',
    fiscalCalendarId: CALENDARS.sandboxGroup,
    taxJurisdiction: 'US',
    erpCompanyCode: 'S100',
  },
] as const;

/** Plan rates are locked per fiscal year (budget control); spot rates are informational. Quoted per 1 unit of the reporting currency. */
export const ratesData = [
  ...(
    [
      ['INR', '83.25'],
      ['EUR', '0.92'],
      ['GBP', '0.79'],
      ['JPY', '150'],
      ['KWD', '0.307'],
    ] as const
  ).map(([quote, rate], i) => ({
    id: seedId('24000000', 100 + i),
    tenantId: TENANTS.acme,
    rateType: 'plan' as const,
    baseCurrency: 'USD',
    quoteCurrency: quote,
    rate,
    effectiveDate: '2026-01-01',
    fiscalYearId: FISCAL_YEARS.acmeFy2026,
    source: 'FY2026 plan',
    locked: true,
  })),
  ...(
    [
      ['INR', '85.10'],
      ['EUR', '0.90'],
    ] as const
  ).map(([quote, rate], i) => ({
    id: seedId('24000000', 200 + i),
    tenantId: TENANTS.acme,
    rateType: 'plan' as const,
    baseCurrency: 'USD',
    quoteCurrency: quote,
    rate,
    effectiveDate: '2027-01-01',
    fiscalYearId: FISCAL_YEARS.acmeFy2027,
    source: 'FY2027 plan',
    locked: true,
  })),
  ...(
    [
      ['INR', '84.07'],
      ['EUR', '0.93'],
    ] as const
  ).map(([quote, rate], i) => ({
    id: seedId('24000000', 300 + i),
    tenantId: TENANTS.acme,
    rateType: 'spot' as const,
    baseCurrency: 'USD',
    quoteCurrency: quote,
    rate,
    effectiveDate: '2026-11-02',
    fiscalYearId: null,
    source: 'ECB reference (fictional)',
    locked: false,
  })),
  {
    id: seedId('24000000', 400),
    tenantId: TENANTS.globex,
    rateType: 'plan' as const,
    baseCurrency: 'EUR',
    quoteCurrency: 'USD',
    rate: '1.08',
    effectiveDate: '2026-01-01',
    fiscalYearId: FISCAL_YEARS.globexFy2026,
    source: 'FY2026 plan',
    locked: true,
  },
  {
    id: seedId('24000000', 500),
    tenantId: TENANTS.sandbox,
    rateType: 'plan' as const,
    baseCurrency: 'USD',
    quoteCurrency: 'EUR',
    rate: '0.92',
    effectiveDate: '2026-01-01',
    fiscalYearId: FISCAL_YEARS.sandboxFy2026,
    source: 'FY2026 plan',
    locked: true,
  },
] as const;

export const orgUnitsData = [
  {
    id: ORG_UNITS.acme,
    tenantId: TENANTS.acme,
    kind: 'company',
    code: 'HYL',
    name: 'Hyland',
    parentId: null,
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    timezone: 'America/New_York',
  },
  {
    id: ORG_UNITS.employeeExperience,
    tenantId: TENANTS.acme,
    kind: 'business_unit',
    code: 'EX',
    name: 'Employee Experience',
    parentId: ORG_UNITS.acme,
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    timezone: null,
  },
  {
    id: ORG_UNITS.india,
    tenantId: TENANTS.acme,
    kind: 'region',
    code: 'IN',
    name: 'India',
    parentId: ORG_UNITS.acme,
    legalEntityId: LEGAL_ENTITIES.acmeIndia,
    timezone: 'Asia/Kolkata',
  },
  {
    id: ORG_UNITS.unitedStates,
    tenantId: TENANTS.acme,
    kind: 'region',
    code: 'US',
    name: 'United States',
    parentId: ORG_UNITS.acme,
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    timezone: 'America/New_York',
  },
  {
    id: ORG_UNITS.europe,
    tenantId: TENANTS.acme,
    kind: 'region',
    code: 'EU',
    name: 'Europe',
    parentId: ORG_UNITS.acme,
    legalEntityId: LEGAL_ENTITIES.acmeEurope,
    timezone: 'Europe/Berlin',
  },
  {
    id: ORG_UNITS.bengaluru,
    tenantId: TENANTS.acme,
    kind: 'location',
    code: 'BLR',
    name: 'Bengaluru',
    parentId: ORG_UNITS.india,
    legalEntityId: LEGAL_ENTITIES.acmeIndia,
    timezone: 'Asia/Kolkata',
  },
  {
    id: ORG_UNITS.hyderabad,
    tenantId: TENANTS.acme,
    kind: 'location',
    code: 'HYD',
    name: 'Hyderabad',
    parentId: ORG_UNITS.india,
    legalEntityId: LEGAL_ENTITIES.acmeIndia,
    timezone: 'Asia/Kolkata',
  },
  {
    id: ORG_UNITS.newYork,
    tenantId: TENANTS.acme,
    kind: 'location',
    code: 'NYC',
    name: 'New York',
    parentId: ORG_UNITS.unitedStates,
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    timezone: 'America/New_York',
  },
  {
    id: ORG_UNITS.berlin,
    tenantId: TENANTS.acme,
    kind: 'location',
    code: 'BER',
    name: 'Berlin',
    parentId: ORG_UNITS.europe,
    legalEntityId: LEGAL_ENTITIES.acmeEurope,
    timezone: 'Europe/Berlin',
  },
  {
    id: ORG_UNITS.globex,
    tenantId: TENANTS.globex,
    kind: 'company',
    code: 'GLOBEX',
    name: 'Globex Corporation',
    parentId: null,
    legalEntityId: LEGAL_ENTITIES.globex,
    timezone: 'Europe/Berlin',
  },
  {
    id: ORG_UNITS.sandbox,
    tenantId: TENANTS.sandbox,
    kind: 'company',
    code: 'INITECH',
    name: 'Initech Sandbox',
    parentId: null,
    legalEntityId: LEGAL_ENTITIES.sandbox,
    timezone: 'UTC',
  },
] as const;

export const costCentersData = [
  {
    id: COST_CENTERS.hq,
    tenantId: TENANTS.acme,
    code: 'CC-HQ-100',
    name: 'Employee Experience',
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    orgUnitId: ORG_UNITS.employeeExperience,
  },
  {
    id: COST_CENTERS.bengaluru,
    tenantId: TENANTS.acme,
    code: 'CC-IN-BLR-200',
    name: 'Bengaluru office',
    legalEntityId: LEGAL_ENTITIES.acmeIndia,
    orgUnitId: ORG_UNITS.bengaluru,
  },
  {
    id: COST_CENTERS.hyderabad,
    tenantId: TENANTS.acme,
    code: 'CC-IN-HYD-210',
    name: 'Hyderabad office',
    legalEntityId: LEGAL_ENTITIES.acmeIndia,
    orgUnitId: ORG_UNITS.hyderabad,
  },
  {
    id: COST_CENTERS.newYork,
    tenantId: TENANTS.acme,
    code: 'CC-US-NYC-300',
    name: 'New York office',
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    orgUnitId: ORG_UNITS.newYork,
  },
  {
    id: COST_CENTERS.berlin,
    tenantId: TENANTS.acme,
    code: 'CC-EU-BER-400',
    name: 'Berlin office',
    legalEntityId: LEGAL_ENTITIES.acmeEurope,
    orgUnitId: ORG_UNITS.berlin,
  },
  {
    id: COST_CENTERS.globex,
    tenantId: TENANTS.globex,
    code: 'CC-GX-100',
    name: 'Globex operations',
    legalEntityId: LEGAL_ENTITIES.globex,
    orgUnitId: ORG_UNITS.globex,
  },
  {
    id: COST_CENTERS.sandbox,
    tenantId: TENANTS.sandbox,
    code: 'CC-SB-100',
    name: 'Sandbox operations',
    legalEntityId: LEGAL_ENTITIES.sandbox,
    orgUnitId: ORG_UNITS.sandbox,
  },
] as const;

const PERSON_PLACEMENT: Partial<
  Record<SeedUserId, { location: string; entity: string; costCenter: string; seniority: number }>
> = {
  'org-admin': {
    location: ORG_UNITS.newYork,
    entity: LEGAL_ENTITIES.acmeUs,
    costCenter: COST_CENTERS.hq,
    seniority: 4,
  },
  ceo: {
    location: ORG_UNITS.newYork,
    entity: LEGAL_ENTITIES.acmeUs,
    costCenter: COST_CENTERS.hq,
    seniority: 9,
  },
  'finance-admin': {
    location: ORG_UNITS.newYork,
    entity: LEGAL_ENTITIES.acmeUs,
    costCenter: COST_CENTERS.hq,
    seniority: 6,
  },
  'finance-controller': {
    location: ORG_UNITS.berlin,
    entity: LEGAL_ENTITIES.acmeEurope,
    costCenter: COST_CENTERS.berlin,
    seniority: 7,
  },
  'budget-owner': {
    location: ORG_UNITS.newYork,
    entity: LEGAL_ENTITIES.acmeUs,
    costCenter: COST_CENTERS.newYork,
    seniority: 7,
  },
  'department-head': {
    location: ORG_UNITS.berlin,
    entity: LEGAL_ENTITIES.acmeEurope,
    costCenter: COST_CENTERS.berlin,
    seniority: 7,
  },
  'regional-manager': {
    location: ORG_UNITS.bengaluru,
    entity: LEGAL_ENTITIES.acmeIndia,
    costCenter: COST_CENTERS.bengaluru,
    seniority: 6,
  },
  'location-manager': {
    location: ORG_UNITS.bengaluru,
    entity: LEGAL_ENTITIES.acmeIndia,
    costCenter: COST_CENTERS.bengaluru,
    seniority: 5,
  },
  'event-organizer': {
    location: ORG_UNITS.bengaluru,
    entity: LEGAL_ENTITIES.acmeIndia,
    costCenter: COST_CENTERS.bengaluru,
    seniority: 3,
  },
  employee: {
    location: ORG_UNITS.hyderabad,
    entity: LEGAL_ENTITIES.acmeIndia,
    costCenter: COST_CENTERS.hyderabad,
    seniority: 2,
  },
  auditor: {
    location: ORG_UNITS.newYork,
    entity: LEGAL_ENTITIES.acmeUs,
    costCenter: COST_CENTERS.hq,
    seniority: 5,
  },
  'integration-admin': {
    location: ORG_UNITS.newYork,
    entity: LEGAL_ENTITIES.acmeUs,
    costCenter: COST_CENTERS.hq,
    seniority: 4,
  },
  analyst: {
    location: ORG_UNITS.newYork,
    entity: LEGAL_ENTITIES.acmeUs,
    costCenter: COST_CENTERS.hq,
    seniority: 3,
  },
  'globex-admin': {
    location: ORG_UNITS.globex,
    entity: LEGAL_ENTITIES.globex,
    costCenter: COST_CENTERS.globex,
    seniority: 7,
  },
  'sandbox-admin': {
    location: ORG_UNITS.sandbox,
    entity: LEGAL_ENTITIES.sandbox,
    costCenter: COST_CENTERS.sandbox,
    seniority: 7,
  },
  'mfa-user': {
    location: ORG_UNITS.newYork,
    entity: LEGAL_ENTITIES.acmeUs,
    costCenter: COST_CENTERS.hq,
    seniority: 6,
  },
  'reset-user': {
    location: ORG_UNITS.berlin,
    entity: LEGAL_ENTITIES.acmeEurope,
    costCenter: COST_CENTERS.berlin,
    seniority: 2,
  },
  'finance-admin-2': {
    location: ORG_UNITS.newYork,
    entity: LEGAL_ENTITIES.acmeUs,
    costCenter: COST_CENTERS.hq,
    seniority: 6,
  },
};

export const peopleData = ALL_USERS.filter((u) => u.personId).map((u) => {
  const p = PERSON_PLACEMENT[u.id as SeedUserId]!;
  return {
    id: u.personId!,
    tenantId: u.tenantId,
    displayName: u.displayName,
    email: u.username,
    jobTitle: u.jobTitle,
    seniority: p.seniority,
    locationOrgUnitId: p.location,
    employingEntityId: p.entity,
    costCenterId: p.costCenter,
    employmentType: 'employee' as const,
    startDate: '2022-04-01',
  };
});

export const membershipsData = ALL_USERS.map((u, i) => ({
  id: seedId('41000000', i + 1),
  tenantId: u.tenantId,
  idpSubject: u.subject,
  personId: u.personId,
}));

export const roleGrantsData = ALL_USERS.flatMap((u, i) =>
  u.roles.map((role, j) => ({
    id: seedId('42000000', (i + 1) * 10 + j),
    tenantId: u.tenantId,
    membershipId: seedId('41000000', i + 1),
    role,
    validFrom: '2026-01-01',
  })),
);

export const BUDGET_CATEGORIES = [
  ['employee_events', 'Employee events'],
  ['team_lunch', 'Team lunch'],
  ['travel', 'Travel'],
  ['training', 'Training'],
  ['conferences', 'Conferences'],
  ['office_supplies', 'Office supplies'],
  ['wellbeing', 'Wellbeing'],
  ['recognition', 'Recognition'],
  ['equipment', 'Equipment'],
  ['marketing', 'Marketing'],
  ['other', 'Other'],
] as const;

export const categoriesData = tenantsData.flatMap((t, ti) =>
  BUDGET_CATEGORIES.map(([code, name], i) => ({
    id: seedId('60000000', (ti + 1) * 100 + i),
    tenantId: t.id,
    code,
    name,
  })),
);

export const reasonCodesData = tenantsData.flatMap((t, ti) =>
  (
    [
      ['reversal', 'REV-ERROR', 'Posting error'],
      ['reversal', 'REV-DUPLICATE', 'Duplicate posting'],
      ['reduction', 'RED-REPRIORITIZE', 'Reprioritized spend'],
      ['reduction', 'RED-COST-SAVING', 'Cost-saving program'],
      ['transfer', 'TRF-REBALANCE', 'Rebalance between teams'],
      ['exception', 'EXC-POLICY', 'Policy exception'],
      ['manual', 'ADJ-OPENING', 'Opening balance at go-live'],
      ['manual', 'ADJ-CORRECTION', 'Correction'],
    ] as const
  ).map(([category, code, label], i) => ({
    id: seedId('62000000', (ti + 1) * 100 + i),
    tenantId: t.id,
    category,
    code,
    label,
  })),
);

/** Unlinked plan lines inserted while the version is still draft, then approved before roots are created. */
export const planVersionLinesData = [
  {
    id: seedId('72000000', 1),
    tenantId: TENANTS.acme,
    planVersionId: PLAN_VERSIONS.acmeFy2026Original,
    lineNo: 1,
    budgetId: null as string | null,
    code: 'EX-2026',
    name: 'Employee Experience FY2026',
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    costCenterId: COST_CENTERS.hq,
    ownerPersonId: userById('ceo').personId,
    categoryCode: null,
    amountMinor: 10_000_000,
    currency: 'USD',
  },
  {
    id: seedId('72000000', 2),
    tenantId: TENANTS.acme,
    planVersionId: PLAN_VERSIONS.acmeFy2026Original,
    lineNo: 2,
    budgetId: null,
    code: 'EX-RESERVE',
    name: 'Central Contingency Reserve',
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    costCenterId: COST_CENTERS.hq,
    ownerPersonId: userById('finance-admin').personId,
    categoryCode: null,
    amountMinor: 300_000,
    currency: 'USD',
  },
  {
    id: seedId('72000000', 3),
    tenantId: TENANTS.globex,
    planVersionId: PLAN_VERSIONS.globexFy2026Original,
    lineNo: 1,
    budgetId: null,
    code: 'GX-2026',
    name: 'Globex Operations FY2026',
    legalEntityId: LEGAL_ENTITIES.globex,
    costCenterId: COST_CENTERS.globex,
    ownerPersonId: userById('globex-admin').personId,
    categoryCode: null,
    amountMinor: 5_000_000,
    currency: 'EUR',
  },
  {
    id: seedId('72000000', 4),
    tenantId: TENANTS.sandbox,
    planVersionId: PLAN_VERSIONS.sandboxFy2026Original,
    lineNo: 1,
    budgetId: null,
    code: 'SB-2026',
    name: 'Sandbox Program FY2026',
    legalEntityId: LEGAL_ENTITIES.sandbox,
    costCenterId: COST_CENTERS.sandbox,
    ownerPersonId: userById('sandbox-admin').personId,
    categoryCode: null,
    amountMinor: 1_000_000,
    currency: 'USD',
  },
] as const;

export const planVersionsData = [
  {
    id: PLAN_VERSIONS.acmeFy2026Original,
    tenantId: TENANTS.acme,
    fiscalYearId: FISCAL_YEARS.acmeFy2026,
    kind: 'original',
    label: 'FY2026 original plan',
    status: 'approved',
  },
  {
    id: PLAN_VERSIONS.acmeFy2027Draft,
    tenantId: TENANTS.acme,
    fiscalYearId: FISCAL_YEARS.acmeFy2027,
    kind: 'original',
    label: 'FY2027 plan (draft)',
    status: 'draft',
  },
  {
    id: PLAN_VERSIONS.globexFy2026Original,
    tenantId: TENANTS.globex,
    fiscalYearId: FISCAL_YEARS.globexFy2026,
    kind: 'original',
    label: 'FY2026 original plan',
    status: 'approved',
  },
  {
    id: PLAN_VERSIONS.sandboxFy2026Original,
    tenantId: TENANTS.sandbox,
    fiscalYearId: FISCAL_YEARS.sandboxFy2026,
    kind: 'original',
    label: 'FY2026 original plan',
    status: 'approved',
  },
] as const;

/** Seeded DoA matrix (Phase 5 enforces, Phase 7 administers): role-based limits in USD for every spend type and entity. */
export const doaLimitsData = (
  [
    ['ceo', 25_000_000],
    ['finance-admin', 10_000_000],
    ['finance-controller', 10_000_000],
    ['budget-owner', 1_000_000],
    ['department-head', 1_000_000],
    ['regional-manager', 1_000_000],
    ['location-manager', 250_000],
  ] as const
).map(([role, limitMinor], i) => ({
  id: seedId('64000000', i + 1),
  tenantId: TENANTS.acme,
  matrixVersionId: DOA_MATRIX.acmeV1,
  role,
  spendType: '*',
  limitMinor,
  currency: 'USD',
  validFrom: '2026-01-01',
}));

export const headcountData = {
  snapshot: {
    id: seedId('32000000', 1),
    tenantId: TENANTS.acme,
    asOfDate: '2026-10-31',
    source: 'hr-file',
  },
  lines: (
    [
      [ORG_UNITS.bengaluru, COST_CENTERS.bengaluru, 'employee', 120, 118_500],
      [ORG_UNITS.bengaluru, COST_CENTERS.bengaluru, 'contractor', 10, 10_000],
      [ORG_UNITS.hyderabad, COST_CENTERS.hyderabad, 'employee', 80, 77_250],
      [ORG_UNITS.hyderabad, COST_CENTERS.hyderabad, 'intern', 6, 4_500],
    ] as const
  ).map(([orgUnitId, costCenterId, employmentType, headcount, proratedHeadcountMilli], i) => ({
    id: seedId('33000000', i + 1),
    tenantId: TENANTS.acme,
    snapshotId: seedId('32000000', 1),
    orgUnitId,
    costCenterId,
    employmentType,
    headcount,
    proratedHeadcountMilli,
  })),
};

type BudgetStep =
  | {
      kind: 'create';
      id: string;
      as: SeedUserId;
      tenantId: string;
      name: string;
      code: string;
      parentId?: string;
      legalEntityId: string;
      costCenterId?: string;
      orgUnitId?: string;
      owner: SeedUserId;
      categoryCode?: string;
      currency: string;
      fiscalYearId: string;
      planVersionId?: string;
      originalAmount?: { amountMinor: number; currency: string };
    }
  | {
      kind: 'allocate';
      as: SeedUserId;
      tenantId: string;
      parentId: string;
      childId: string;
      amount: { amountMinor: number; currency: string };
    };

/** Reference budget tree, posted through the real commands (idempotent seed keys). */
export const budgetSteps: BudgetStep[] = [
  {
    kind: 'create',
    id: BUDGETS.employeeExperience,
    as: 'ceo',
    tenantId: TENANTS.acme,
    name: 'Employee Experience FY2026',
    code: 'EX-2026',
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    costCenterId: COST_CENTERS.hq,
    orgUnitId: ORG_UNITS.employeeExperience,
    owner: 'ceo',
    currency: 'USD',
    fiscalYearId: FISCAL_YEARS.acmeFy2026,
    planVersionId: PLAN_VERSIONS.acmeFy2026Original,
    originalAmount: { amountMinor: 10_000_000, currency: 'USD' },
  },
  {
    kind: 'create',
    id: BUDGETS.india,
    as: 'ceo',
    tenantId: TENANTS.acme,
    name: 'India Region',
    code: 'EX-IN',
    parentId: BUDGETS.employeeExperience,
    legalEntityId: LEGAL_ENTITIES.acmeIndia,
    orgUnitId: ORG_UNITS.india,
    owner: 'regional-manager',
    currency: 'USD',
    fiscalYearId: FISCAL_YEARS.acmeFy2026,
  },
  {
    kind: 'create',
    id: BUDGETS.unitedStates,
    as: 'ceo',
    tenantId: TENANTS.acme,
    name: 'United States Region',
    code: 'EX-US',
    parentId: BUDGETS.employeeExperience,
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    orgUnitId: ORG_UNITS.unitedStates,
    owner: 'budget-owner',
    currency: 'USD',
    fiscalYearId: FISCAL_YEARS.acmeFy2026,
  },
  {
    kind: 'create',
    id: BUDGETS.europe,
    as: 'ceo',
    tenantId: TENANTS.acme,
    name: 'Europe Region',
    code: 'EX-EU',
    parentId: BUDGETS.employeeExperience,
    legalEntityId: LEGAL_ENTITIES.acmeEurope,
    orgUnitId: ORG_UNITS.europe,
    owner: 'department-head',
    currency: 'USD',
    fiscalYearId: FISCAL_YEARS.acmeFy2026,
  },
  {
    kind: 'allocate',
    as: 'ceo',
    tenantId: TENANTS.acme,
    parentId: BUDGETS.employeeExperience,
    childId: BUDGETS.india,
    amount: { amountMinor: 3_000_000, currency: 'USD' },
  },
  {
    kind: 'allocate',
    as: 'ceo',
    tenantId: TENANTS.acme,
    parentId: BUDGETS.employeeExperience,
    childId: BUDGETS.unitedStates,
    amount: { amountMinor: 4_000_000, currency: 'USD' },
  },
  {
    kind: 'allocate',
    as: 'ceo',
    tenantId: TENANTS.acme,
    parentId: BUDGETS.employeeExperience,
    childId: BUDGETS.europe,
    amount: { amountMinor: 3_000_000, currency: 'USD' },
  },
  {
    kind: 'create',
    id: BUDGETS.bengaluru,
    as: 'regional-manager',
    tenantId: TENANTS.acme,
    name: 'Bengaluru Events',
    code: 'EX-IN-BLR',
    parentId: BUDGETS.india,
    legalEntityId: LEGAL_ENTITIES.acmeIndia,
    costCenterId: COST_CENTERS.bengaluru,
    orgUnitId: ORG_UNITS.bengaluru,
    owner: 'location-manager',
    categoryCode: 'employee_events',
    currency: 'USD',
    fiscalYearId: FISCAL_YEARS.acmeFy2026,
  },
  {
    kind: 'create',
    id: BUDGETS.hyderabad,
    as: 'regional-manager',
    tenantId: TENANTS.acme,
    name: 'Hyderabad Events',
    code: 'EX-IN-HYD',
    parentId: BUDGETS.india,
    legalEntityId: LEGAL_ENTITIES.acmeIndia,
    costCenterId: COST_CENTERS.hyderabad,
    orgUnitId: ORG_UNITS.hyderabad,
    owner: 'regional-manager',
    categoryCode: 'employee_events',
    currency: 'USD',
    fiscalYearId: FISCAL_YEARS.acmeFy2026,
  },
  {
    kind: 'allocate',
    as: 'regional-manager',
    tenantId: TENANTS.acme,
    parentId: BUDGETS.india,
    childId: BUDGETS.bengaluru,
    amount: { amountMinor: 1_200_000, currency: 'USD' },
  },
  {
    kind: 'create',
    id: BUDGETS.globexOperations,
    as: 'globex-admin',
    tenantId: TENANTS.globex,
    name: 'Globex Operations FY2026',
    code: 'GX-2026',
    legalEntityId: LEGAL_ENTITIES.globex,
    costCenterId: COST_CENTERS.globex,
    owner: 'globex-admin',
    currency: 'EUR',
    fiscalYearId: FISCAL_YEARS.globexFy2026,
    planVersionId: PLAN_VERSIONS.globexFy2026Original,
    originalAmount: { amountMinor: 5_000_000, currency: 'EUR' },
  },
  {
    kind: 'create',
    id: BUDGETS.sandboxProgram,
    as: 'sandbox-admin',
    tenantId: TENANTS.sandbox,
    name: 'Sandbox Program FY2026',
    code: 'SB-2026',
    legalEntityId: LEGAL_ENTITIES.sandbox,
    costCenterId: COST_CENTERS.sandbox,
    owner: 'sandbox-admin',
    currency: 'USD',
    fiscalYearId: FISCAL_YEARS.sandboxFy2026,
    planVersionId: PLAN_VERSIONS.sandboxFy2026Original,
    originalAmount: { amountMinor: 1_000_000, currency: 'USD' },
  },
  {
    kind: 'create',
    id: BUDGETS.sandboxChild,
    as: 'sandbox-admin',
    tenantId: TENANTS.sandbox,
    name: 'Sandbox Child',
    code: 'SB-2026-A',
    parentId: BUDGETS.sandboxProgram,
    legalEntityId: LEGAL_ENTITIES.sandbox,
    costCenterId: COST_CENTERS.sandbox,
    owner: 'sandbox-admin',
    currency: 'USD',
    fiscalYearId: FISCAL_YEARS.sandboxFy2026,
  },
  {
    kind: 'allocate',
    as: 'sandbox-admin',
    tenantId: TENANTS.sandbox,
    parentId: BUDGETS.sandboxProgram,
    childId: BUDGETS.sandboxChild,
    amount: { amountMinor: 250_000, currency: 'USD' },
  },
];

/** Handy expectations for scenarios and journeys (all minor units). */
export const SEED = {
  tenants: TENANTS,
  legalEntities: LEGAL_ENTITIES,
  fiscalYears: FISCAL_YEARS,
  planVersions: PLAN_VERSIONS,
  budgets: { ...BUDGETS, contingency: seedId('71000000', 5) },
  costCenters: COST_CENTERS,
  orgUnits: ORG_UNITS,
  planRates: { INR: '83.25', EUR: '0.92', GBP: '0.79', JPY: '150', KWD: '0.307' },
  /** Every Hyland budget is held in USD (local-currency actuals convert at the locked plan rate). */
  indiaAuthorizedMinor: 3_000_000,
  europeAuthorizedMinor: 3_000_000,
  /** Accounting dates by period status in every Acme calendar. */
  dates: {
    locked: '2026-03-15',
    closed: '2026-08-14',
    softClosed: '2026-10-15',
    open: '2026-11-16',
  },
} as const;
