import { err, ok, type Result } from '../result';

/**
 * Fiscal calendar engine. Dates are ISO `YYYY-MM-DD` strings handled in UTC so results never depend
 * on the server timezone. Each legal entity has a calendar; its fiscal years map to the group year.
 */
export const CALENDAR_TYPES = [
  'calendar_year',
  'non_calendar',
  '4-4-5',
  '4-5-4',
  '5-4-4',
  '13-period',
] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];

export interface MonthlyCalendarDefinition {
  type: 'calendar_year' | 'non_calendar';
  /** First month of the fiscal year, 1-12 (1 for calendar_year). */
  startMonth: number;
  /** Label the fiscal year by the calendar year in which it ends (FY2027 = Apr 2026-Mar 2027) or starts. */
  labelBy: 'start' | 'end';
}

export interface WeeklyCalendarDefinition {
  type: '4-4-5' | '4-5-4' | '5-4-4' | '13-period';
  /** Month (1-12) in which the fiscal year ends. */
  endMonth: number;
  /** Day of week the year ends on: 0 = Sunday ... 6 = Saturday. */
  endWeekday: number;
  /** 'last' = last such weekday of endMonth; 'nearest' = such weekday nearest the end of endMonth. */
  method: 'last' | 'nearest';
}

export type FiscalCalendarDefinition = MonthlyCalendarDefinition | WeeklyCalendarDefinition;

export interface GeneratedPeriod {
  number: number;
  label: string;
  startDate: string;
  endDate: string;
}

export interface GeneratedFiscalYear {
  label: string;
  fiscalYear: number;
  startDate: string;
  endDate: string;
  weeks: number | null;
  periods: GeneratedPeriod[];
}

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseIsoDate(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Invalid ISO date ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function lastDayOfMonth(year: number, month1: number): number {
  return Date.UTC(year, month1, 0);
}

/** Generates fiscal year `fiscalYear` (as labelled) for a monthly calendar. */
function monthlyYear(def: MonthlyCalendarDefinition, fiscalYear: number): GeneratedFiscalYear {
  const startMonth = def.type === 'calendar_year' ? 1 : def.startMonth;
  const startYear = def.labelBy === 'end' && startMonth !== 1 ? fiscalYear - 1 : fiscalYear;
  const periods: GeneratedPeriod[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIndex = startMonth - 1 + i;
    const y = startYear + Math.floor(monthIndex / 12);
    const m = (monthIndex % 12) + 1;
    periods.push({
      number: i + 1,
      label: `${MONTHS[m - 1]} ${y}`,
      startDate: toIsoDate(Date.UTC(y, m - 1, 1)),
      endDate: toIsoDate(lastDayOfMonth(y, m)),
    });
  }
  return {
    label: `FY${fiscalYear}`,
    fiscalYear,
    startDate: periods[0].startDate,
    endDate: periods[11].endDate,
    weeks: null,
    periods,
  };
}

/** End date of the weekly fiscal year that ends in `endMonth` of calendar year `year`. */
function weeklyYearEnd(def: WeeklyCalendarDefinition, year: number): number {
  const monthEnd = lastDayOfMonth(year, def.endMonth);
  const dow = new Date(monthEnd).getUTCDay();
  const back = (dow - def.endWeekday + 7) % 7;
  const last = monthEnd - back * DAY_MS;
  if (def.method === 'last') return last;
  const next = last + 7 * DAY_MS;
  return monthEnd - last <= next - monthEnd ? last : next;
}

const PATTERNS: Record<WeeklyCalendarDefinition['type'], number[]> = {
  '4-4-5': [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5],
  '4-5-4': [4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4],
  '5-4-4': [5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4],
  '13-period': Array.from({ length: 13 }, () => 4),
};

/** Weekly (52/53-week) year labelled by the calendar year in which it ends; the 53rd week joins the last period. */
function weeklyYear(def: WeeklyCalendarDefinition, fiscalYear: number): GeneratedFiscalYear {
  const end = weeklyYearEnd(def, fiscalYear);
  const prevEnd = weeklyYearEnd(def, fiscalYear - 1);
  const start = prevEnd + DAY_MS;
  const weeks = Math.round((end - prevEnd) / (7 * DAY_MS));
  const pattern = [...PATTERNS[def.type]];
  if (weeks === 53) pattern[pattern.length - 1] += 1;
  const periods: GeneratedPeriod[] = [];
  let cursor = start;
  pattern.forEach((w, i) => {
    const pEnd = cursor + w * 7 * DAY_MS - DAY_MS;
    periods.push({
      number: i + 1,
      label: `P${String(i + 1).padStart(2, '0')} FY${fiscalYear}`,
      startDate: toIsoDate(cursor),
      endDate: toIsoDate(pEnd),
    });
    cursor = pEnd + DAY_MS;
  });
  return {
    label: `FY${fiscalYear}`,
    fiscalYear,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    weeks,
    periods,
  };
}

function isMonthly(def: FiscalCalendarDefinition): def is MonthlyCalendarDefinition {
  return def.type === 'calendar_year' || def.type === 'non_calendar';
}

export function generateFiscalYear(
  def: FiscalCalendarDefinition,
  fiscalYear: number,
): Result<GeneratedFiscalYear> {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2999) {
    return err('VALIDATION_FAILED', 'Fiscal year must be a four-digit year.');
  }
  if (isMonthly(def)) {
    if (def.type === 'non_calendar' && (def.startMonth < 2 || def.startMonth > 12)) {
      return err('VALIDATION_FAILED', 'A non-calendar year starts in month 2 to 12.');
    }
    return ok(monthlyYear(def, fiscalYear));
  }
  const weekly = def as WeeklyCalendarDefinition;
  if (
    weekly.endMonth < 1 ||
    weekly.endMonth > 12 ||
    weekly.endWeekday < 0 ||
    weekly.endWeekday > 6
  ) {
    return err(
      'VALIDATION_FAILED',
      'Weekly calendars need an end month (1-12) and an end weekday (0-6).',
    );
  }
  return ok(weeklyYear(weekly, fiscalYear));
}

/** The group fiscal year containing an entity year's end date (entity years map to group years). */
export function mapToGroupYear<T extends { startDate: string; endDate: string }>(
  entityYear: { endDate: string },
  groupYears: readonly T[],
): T | null {
  return (
    groupYears.find((g) => g.startDate <= entityYear.endDate && entityYear.endDate <= g.endDate) ??
    null
  );
}
