import { err, ok, type Result } from '../result';

/**
 * Employee benefit ledger and benefit-in-kind thresholds (screen 080h). Each person's share of event
 * costs, gifts and recognition is compared with the thresholds of their country (for example a UK
 * annual staff-function limit or a per-event company-event allowance) and the company's per-employee
 * annual cap. Pure: the API loads entries, converts them to the threshold currency at the locked plan
 * rate, and asks here. The benefit ledger never moves budget money.
 */

export const THRESHOLD_BASES = ['per_year', 'per_event'] as const;
export type ThresholdBasis = (typeof THRESHOLD_BASES)[number];

/** What becomes reportable once a threshold is exceeded. */
export const EXCEEDED_BEHAVIOURS = ['whole', 'excess', 'not_reportable'] as const;
export type ExceededBehaviour = (typeof EXCEEDED_BEHAVIOURS)[number];

export const BENEFIT_STATUSES = ['under', 'approaching', 'over'] as const;
export type BenefitStatus = (typeof BENEFIT_STATUSES)[number];

/** Approaching from 80% of the limit. */
export const APPROACHING_PCT = 80;

export interface BenefitThreshold {
  id: string;
  /** Legal entities in scope; empty means a template with nobody in scope yet. */
  legalEntityIds: readonly string[];
  benefitTypes: readonly string[];
  limitMinor: number;
  currency: string;
  basis: ThresholdBasis;
  /** Per-event allowances: how many occasions a year the allowance covers. */
  maxOccasions: number | null;
  /** Start of the threshold's own tax year (for example 4 / 6 for 6 April). */
  periodStartMonth: number;
  periodStartDay: number;
  exceeded: ExceededBehaviour;
}

export interface BenefitEntryInput {
  id: string;
  personId: string;
  legalEntityId: string;
  benefitType: string;
  /** Groups an event's entries (and their reversals) into one occasion. */
  occasionKey: string;
  entryDate: string;
  /** In the threshold currency at the locked plan rate (negative for reversals). */
  amountMinor: number;
}

export interface TaxYearWindow {
  fromDate: string;
  toDate: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The threshold's tax year containing `date` (for 6 April: 6 Apr of one year to 5 Apr the next). */
export function taxYearWindow(
  t: Pick<BenefitThreshold, 'periodStartMonth' | 'periodStartDay'>,
  date: string,
): TaxYearWindow {
  const [y, m, d] = date.split('-').map(Number);
  const startsThisYear =
    m > t.periodStartMonth || (m === t.periodStartMonth && d >= t.periodStartDay);
  const startYear = startsThisYear ? y : y - 1;
  const from = `${startYear}-${pad(t.periodStartMonth)}-${pad(t.periodStartDay)}`;
  const end = new Date(Date.UTC(startYear + 1, t.periodStartMonth - 1, t.periodStartDay));
  end.setUTCDate(end.getUTCDate() - 1);
  return { fromDate: from, toDate: end.toISOString().slice(0, 10) };
}

/** Whether an entry counts toward a threshold: entity in scope, benefit type counted, date in window. */
export function countsToward(
  t: BenefitThreshold,
  e: Pick<BenefitEntryInput, 'legalEntityId' | 'benefitType' | 'entryDate'>,
  window: TaxYearWindow,
): boolean {
  return (
    t.legalEntityIds.includes(e.legalEntityId) &&
    t.benefitTypes.includes(e.benefitType) &&
    e.entryDate >= window.fromDate &&
    e.entryDate <= window.toDate
  );
}

export interface ThresholdEvaluation {
  countedMinor: number;
  limitMinor: number;
  status: BenefitStatus;
  reportableMinor: number;
  occasions: number;
}

const approaching = (amount: number, limit: number) =>
  limit > 0 && BigInt(amount) * 100n >= BigInt(limit) * BigInt(APPROACHING_PCT);

/**
 * Evaluates one person's counted entries against a threshold. Exactly at the limit is not over; one
 * minor unit above is. Per year: the whole amount (or only the excess) becomes reportable once the
 * total is above the limit. Per event: each occasion above the allowance reports its excess (or its
 * whole amount), and occasions beyond the allowed number are reportable in full.
 */
export function evaluateThreshold(
  t: BenefitThreshold,
  entries: readonly Pick<BenefitEntryInput, 'occasionKey' | 'entryDate' | 'amountMinor'>[],
): Result<ThresholdEvaluation> {
  if (!Number.isSafeInteger(t.limitMinor) || t.limitMinor <= 0)
    return err('VALIDATION_FAILED', 'A threshold needs a limit above zero.', { field: 'limit' });
  const counted = entries.reduce((s, e) => s + e.amountMinor, 0);
  const report = (amount: number, limit: number) =>
    t.exceeded === 'whole' ? amount : t.exceeded === 'excess' ? amount - limit : 0;
  if (t.basis === 'per_year') {
    const over = counted > t.limitMinor;
    return ok({
      countedMinor: counted,
      limitMinor: t.limitMinor,
      status: over ? 'over' : approaching(counted, t.limitMinor) ? 'approaching' : 'under',
      reportableMinor: over ? report(counted, t.limitMinor) : 0,
      occasions: new Set(entries.filter((e) => e.amountMinor !== 0).map((e) => e.occasionKey)).size,
    });
  }
  const byOccasion = new Map<string, { first: string; amount: number }>();
  for (const e of entries) {
    const o = byOccasion.get(e.occasionKey) ?? { first: e.entryDate, amount: 0 };
    o.amount += e.amountMinor;
    if (e.entryDate < o.first) o.first = e.entryDate;
    byOccasion.set(e.occasionKey, o);
  }
  const occasions = [...byOccasion.entries()]
    .filter(([, o]) => o.amount > 0)
    .sort(([ka, a], [kb, b]) =>
      a.first === b.first ? ka.localeCompare(kb) : a.first < b.first ? -1 : 1,
    );
  let reportable = 0;
  let near = false;
  let over = false;
  for (const [i, [, o]] of occasions.entries()) {
    const beyond = t.maxOccasions !== null && i >= t.maxOccasions;
    if (beyond) {
      over = true;
      reportable += t.exceeded === 'not_reportable' ? 0 : o.amount;
    } else if (o.amount > t.limitMinor) {
      over = true;
      reportable += report(o.amount, t.limitMinor);
    } else if (approaching(o.amount, t.limitMinor)) near = true;
  }
  return ok({
    countedMinor: counted,
    limitMinor: t.limitMinor,
    status: over ? 'over' : near ? 'approaching' : 'under',
    reportableMinor: reportable,
    occasions: occasions.length,
  });
}

/** Validates a threshold draft before it is saved or submitted. */
export function validateThreshold(t: Omit<BenefitThreshold, 'id'>): Result<true> {
  if (!Number.isSafeInteger(t.limitMinor) || t.limitMinor <= 0)
    return err('VALIDATION_FAILED', 'The limit must be above zero.', { field: 'limit' });
  if (!t.benefitTypes.length)
    return err('VALIDATION_FAILED', 'Choose at least one benefit type to count.', {
      field: 'benefitTypes',
    });
  if (t.periodStartMonth < 1 || t.periodStartMonth > 12)
    return err('VALIDATION_FAILED', 'The tax year starts in a month from 1 to 12.', {
      field: 'periodStartMonth',
    });
  const days = new Date(Date.UTC(2001, t.periodStartMonth, 0)).getUTCDate();
  if (t.periodStartDay < 1 || t.periodStartDay > days)
    return err('VALIDATION_FAILED', 'The tax year start day is not in that month.', {
      field: 'periodStartDay',
    });
  if (t.basis === 'per_event' && t.maxOccasions !== null && t.maxOccasions < 1)
    return err('VALIDATION_FAILED', 'Allow at least one occasion a year.', {
      field: 'maxOccasions',
    });
  if (t.basis === 'per_year' && t.maxOccasions !== null)
    return err('VALIDATION_FAILED', 'Only per-event allowances limit the number of occasions.', {
      field: 'maxOccasions',
    });
  return ok(true);
}
