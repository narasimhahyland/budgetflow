import { err, ok, type Result } from '../result';
import { exponentOf, type CurrencyCode } from './currency';
import type { Money } from './money';

/** Rates carry 12 decimal places, held as scaled bigints so no float ever touches money. */
export const RATE_DECIMALS = 12;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

export const RATE_TYPES = ['plan', 'spot', 'month_end', 'monthly_average'] as const;
export type RateType = (typeof RATE_TYPES)[number];

/** A rate quoted as units of `quote` per one unit of `base` (the tenant reporting currency). */
export interface FxRate {
  id: string;
  type: RateType;
  base: CurrencyCode;
  quote: CurrencyCode;
  /** Decimal string, at most 12 fractional digits, greater than zero. */
  value: string;
}

/** The rate actually applied to convert one line's transaction amount into another currency. */
export interface AppliedRate {
  type: RateType;
  from: CurrencyCode;
  to: CurrencyCode;
  /** Cross rate rounded half-even to 12 decimals; amounts are converted with exactly this value. */
  value: string;
  /** Source rate rows (empty when from === to). */
  rateIds: string[];
}

export function parseRate(value: string): Result<bigint> {
  const m = /^(\d+)(?:\.(\d{1,12}))?$/.exec(value.trim());
  if (!m)
    return err('RATE_INVALID', `Rate ${value} is not a positive decimal with at most 12 decimals.`);
  const scaled = BigInt(m[1]) * RATE_SCALE + BigInt((m[2] ?? '').padEnd(RATE_DECIMALS, '0') || '0');
  if (scaled <= 0n) return err('RATE_INVALID', 'Rates must be greater than zero.');
  return ok(scaled);
}

export function formatRate(scaled: bigint): string {
  const int = scaled / RATE_SCALE;
  const frac = (scaled % RATE_SCALE).toString().padStart(RATE_DECIMALS, '0');
  return `${int}.${frac}`;
}

/**
 * How a conversion rounds the magnitude of an amount: `half_even` is the default for every line;
 * `up` (away from zero) and `down` (toward zero) are used on hierarchy lines so value never grows
 * when money moves between budgets in different currencies.
 */
export type Rounding = 'half_even' | 'up' | 'down';

/** Integer division of a signed numerator by a positive denominator with the given rounding of the magnitude. */
export function divRound(numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  let q = abs / denominator;
  const r = abs % denominator;
  if (rounding === 'up') {
    if (r > 0n) q += 1n;
  } else if (rounding === 'half_even') {
    const twice = r * 2n;
    if (twice > denominator || (twice === denominator && q % 2n === 1n)) q += 1n;
  }
  return sign * q;
}

/** Integer division of a signed numerator by a positive denominator, rounding half to even. */
export function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  return divRound(numerator, denominator, 'half_even');
}

function toSafeNumber(v: bigint): Result<number> {
  const n = Number(v);
  return Number.isSafeInteger(n)
    ? ok(n)
    : err('AMOUNT_NOT_SAFE_INTEGER', 'The converted amount is too large to represent safely.');
}

/**
 * Cross rate from `from` to `to` using rates quoted against the reporting currency `base`.
 * rate(from→to) = rate(base→to) / rate(base→from), rounded half-even to 12 decimals.
 */
export function crossRate(
  from: CurrencyCode,
  to: CurrencyCode,
  base: CurrencyCode,
  rates: readonly FxRate[],
  type: RateType,
): Result<AppliedRate> {
  if (from === to) return ok({ type, from, to, value: formatRate(RATE_SCALE), rateIds: [] });
  const find = (quote: CurrencyCode): Result<FxRate | null> => {
    if (quote === base) return ok(null);
    const r = rates.find((x) => x.type === type && x.base === base && x.quote === quote);
    return r
      ? ok(r)
      : err('RATE_MISSING', `No ${type} rate from ${base} to ${quote}.`, { base, quote, type });
  };
  const fromRate = find(from);
  if (!fromRate.ok) return fromRate;
  const toRate = find(to);
  if (!toRate.ok) return toRate;
  const parse = (r: FxRate | null): Result<bigint> => (r ? parseRate(r.value) : ok(RATE_SCALE));
  const f = parse(fromRate.value);
  if (!f.ok) return f;
  const t = parse(toRate.value);
  if (!t.ok) return t;
  const scaled = divRoundHalfEven(t.value * RATE_SCALE, f.value);
  const rateIds = [fromRate.value, toRate.value]
    .filter((r): r is FxRate => r !== null)
    .map((r) => r.id);
  return ok({ type, from, to, value: formatRate(scaled), rateIds });
}

/** Converts once, rounding at the line (half-even unless told otherwise): minor(to) = minor(from) × rate × 10^(expTo − expFrom). */
export function convert(
  amount: Money,
  rate: AppliedRate,
  rounding: Rounding = 'half_even',
): Result<Money> {
  if (amount.currency !== rate.from) {
    return err('CURRENCY_MISMATCH', `Rate converts from ${rate.from}, not ${amount.currency}.`);
  }
  if (rate.from === rate.to) return ok({ ...amount });
  const scaled = parseRate(rate.value);
  if (!scaled.ok) return scaled;
  const expFrom = BigInt(exponentOf(rate.from));
  const expTo = BigInt(exponentOf(rate.to));
  const numerator = BigInt(amount.amountMinor) * scaled.value * 10n ** expTo;
  const denominator = RATE_SCALE * 10n ** expFrom;
  const n = toSafeNumber(divRound(numerator, denominator, rounding));
  return n.ok ? ok({ amountMinor: n.value, currency: rate.to }) : n;
}
