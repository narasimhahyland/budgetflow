import { err, ok, type Result } from '../result';
import type { CurrencyCode } from './currency';
import type { Money } from './money';
import { convert, crossRate, type AppliedRate, type FxRate, type RateType } from './rate';

/** An exchange-rate row as stored: quoted as units of `quote` per one `base` (the reporting currency). */
export interface StoredRate extends FxRate {
  effectiveDate: string;
  fiscalYearId: string | null;
  locked: boolean;
}

export interface RateFiscalYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

export interface SelectedRate {
  rate: StoredRate;
  /** The fiscal year whose plan rate applied (plan rates only). */
  fiscalYear: RateFiscalYear | null;
}

const monthBounds = (date: string): { start: string; end: string } => {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${date.slice(0, 7)}-01`, end };
};

/**
 * Picks the rate row that applies on `date` for one quote currency and rate type:
 * - plan: the rate of the fiscal year containing the date (locked per fiscal year at plan approval);
 * - spot: the latest rate dated on or before the date;
 * - month_end: the rate dated the last day of the date's month;
 * - monthly_average: the rate dated within the date's month.
 */
export function selectRate(
  rates: readonly StoredRate[],
  q: {
    type: RateType;
    base: CurrencyCode;
    quote: CurrencyCode;
    date: string;
    fiscalYears: readonly RateFiscalYear[];
  },
): Result<SelectedRate> {
  const pool = rates.filter((r) => r.type === q.type && r.base === q.base && r.quote === q.quote);
  const missing = (detail: string) =>
    err<SelectedRate>('RATE_MISSING', detail, {
      type: q.type,
      base: q.base,
      quote: q.quote,
      date: q.date,
    });
  if (q.type === 'plan') {
    const covering = new Map(
      q.fiscalYears
        .filter((y) => y.startDate <= q.date && q.date <= y.endDate)
        .map((y) => [y.id, y]),
    );
    const r = pool
      .filter((x) => x.fiscalYearId !== null && covering.has(x.fiscalYearId))
      .sort(
        (a, b) =>
          Number(b.locked) - Number(a.locked) || b.effectiveDate.localeCompare(a.effectiveDate),
      )[0];
    return r
      ? ok({ rate: r, fiscalYear: covering.get(r.fiscalYearId!)! })
      : missing(`No plan rate from ${q.base} to ${q.quote} for a fiscal year covering ${q.date}.`);
  }
  if (q.type === 'spot') {
    const r = pool
      .filter((x) => x.effectiveDate <= q.date)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
    return r
      ? ok({ rate: r, fiscalYear: null })
      : missing(`No spot rate from ${q.base} to ${q.quote} on or before ${q.date}.`);
  }
  const { start, end } = monthBounds(q.date);
  if (q.type === 'month_end') {
    const r = pool.find((x) => x.effectiveDate === end);
    return r
      ? ok({ rate: r, fiscalYear: null })
      : missing(`No month-end rate from ${q.base} to ${q.quote} for the month ending ${end}.`);
  }
  const r = pool
    .filter((x) => start <= x.effectiveDate && x.effectiveDate <= end)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  return r
    ? ok({ rate: r, fiscalYear: null })
    : missing(`No monthly average rate from ${q.base} to ${q.quote} for ${start.slice(0, 7)}.`);
}

export interface RateLookup {
  applied: AppliedRate;
  sources: SelectedRate[];
  converted: Money | null;
}

/**
 * Cross rate between two currencies on a date for a rate type, from rates quoted against the
 * reporting currency, optionally converting an amount (half-even at the line).
 */
export function lookupRate(
  rates: readonly StoredRate[],
  q: {
    type: RateType;
    base: CurrencyCode;
    from: CurrencyCode;
    to: CurrencyCode;
    date: string;
    fiscalYears: readonly RateFiscalYear[];
    amount?: Money;
  },
): Result<RateLookup> {
  const sources: SelectedRate[] = [];
  for (const quote of new Set([q.from, q.to])) {
    if (quote === q.base) continue;
    const s = selectRate(rates, { ...q, quote });
    if (!s.ok) return s;
    sources.push(s.value);
  }
  const applied = crossRate(
    q.from,
    q.to,
    q.base,
    sources.map((s) => s.rate),
    q.type,
  );
  if (!applied.ok) return applied;
  let converted: Money | null = null;
  if (q.amount) {
    const c = convert(q.amount, applied.value);
    if (!c.ok) return c;
    converted = c.value;
  }
  return ok({ applied: applied.value, sources, converted });
}

/** Plan rates lock per fiscal year; a locked year's plan rates never change (FX never consumes budget). */
export function checkPlanRateWritable(locked: boolean, fiscalYearLabel: string): Result<true> {
  return locked
    ? err('PLAN_RATE_LOCKED', `${fiscalYearLabel} plan rates are locked and cannot change.`, {
        fiscalYear: fiscalYearLabel,
      })
    : ok(true);
}
