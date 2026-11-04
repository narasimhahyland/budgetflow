/**
 * Deterministic ids for the seed (company Hyland; Globex and Initech Sandbox are scenario-only tenants). Valid RFC 9562
 * shapes (version 4 nibble, variant 8) so contract validation accepts them.
 */
const id = (prefix: string, n: number | string) =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const TENANTS = {
  acme: id('10000000', 1),
  globex: id('10000000', 2),
  sandbox: id('10000000', 3),
} as const;

export const LEGAL_ENTITIES = {
  acmeUs: id('20000000', 1),
  acmeIndia: id('20000000', 2),
  acmeEurope: id('20000000', 3),
  globex: id('20000000', 4),
  sandbox: id('20000000', 5),
} as const;

export const CALENDARS = {
  acmeGroup: id('21000000', 1),
  acmeIndia: id('21000000', 2),
  globexGroup: id('21000000', 3),
  sandboxGroup: id('21000000', 4),
} as const;

/** Fiscal year id per calendar and labelled year. */
export function fiscalYearId(calendarIndex: number, year: number): string {
  return `22000000-0000-4000-8000-${String(calendarIndex).padStart(2, '0')}${year}000000`;
}

/** Period id per calendar, labelled year and period number. */
export function periodId(calendarIndex: number, year: number, period: number): string {
  return `23000000-0000-4000-8000-${String(calendarIndex).padStart(2, '0')}${year}${String(period).padStart(2, '0')}0000`;
}

export const CALENDAR_INDEX = {
  acmeGroup: 1,
  acmeIndia: 2,
  globexGroup: 3,
  sandboxGroup: 4,
} as const;

export const FISCAL_YEARS = {
  acmeFy2026: fiscalYearId(1, 2026),
  acmeFy2027: fiscalYearId(1, 2027),
  globexFy2026: fiscalYearId(3, 2026),
  sandboxFy2026: fiscalYearId(4, 2026),
} as const;

export const PLAN_VERSIONS = {
  acmeFy2026Original: id('61000000', 1),
  acmeFy2027Draft: id('61000000', 2),
  globexFy2026Original: id('61000000', 3),
  sandboxFy2026Original: id('61000000', 4),
} as const;

export const ORG_UNITS = {
  acme: id('30000000', 1),
  employeeExperience: id('30000000', 2),
  india: id('30000000', 3),
  unitedStates: id('30000000', 4),
  europe: id('30000000', 5),
  bengaluru: id('30000000', 6),
  hyderabad: id('30000000', 7),
  newYork: id('30000000', 8),
  berlin: id('30000000', 9),
  globex: id('30000000', 10),
  sandbox: id('30000000', 11),
} as const;

export const COST_CENTERS = {
  hq: id('31000000', 1),
  bengaluru: id('31000000', 2),
  hyderabad: id('31000000', 3),
  newYork: id('31000000', 4),
  berlin: id('31000000', 5),
  globex: id('31000000', 6),
  sandbox: id('31000000', 7),
} as const;

export const BUDGETS = {
  employeeExperience: id('70000000', 1),
  india: id('70000000', 2),
  unitedStates: id('70000000', 3),
  europe: id('70000000', 4),
  bengaluru: id('70000000', 5),
  hyderabad: id('70000000', 6),
  globexOperations: id('70000000', 7),
  sandboxProgram: id('70000000', 8),
  sandboxChild: id('70000000', 9),
} as const;

export const DOA_MATRIX = { acmeV1: id('63000000', 1) } as const;

export { id as seedId };
