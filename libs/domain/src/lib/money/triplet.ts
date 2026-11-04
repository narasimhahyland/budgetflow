import { err, ok, type Result } from '../result';
import type { CurrencyCode } from './currency';
import type { Money } from './money';
import {
  convert,
  crossRate,
  type AppliedRate,
  type FxRate,
  type RateType,
  type Rounding,
} from './rate';

/**
 * Every ledger amount carries the transaction, budget and reporting amounts, each in integer minor
 * units with its ISO 4217 code, plus the rates used. Budget control always uses the locked plan rate.
 */
export interface CurrencyTriplet {
  transaction: Money;
  budget: Money;
  reporting: Money;
  budgetRate: AppliedRate;
  reportingRate: AppliedRate;
}

export interface TripletContext {
  budgetCurrency: CurrencyCode;
  reportingCurrency: CurrencyCode;
  rates: readonly FxRate[];
  rateType?: RateType;
  /** Rounding of the budget-currency amount; the reporting amount always rounds half-even. */
  budgetRounding?: Rounding;
}

export function buildTriplet(transaction: Money, ctx: TripletContext): Result<CurrencyTriplet> {
  const type = ctx.rateType ?? 'plan';
  const br = crossRate(
    transaction.currency,
    ctx.budgetCurrency,
    ctx.reportingCurrency,
    ctx.rates,
    type,
  );
  if (!br.ok) return br;
  const rr = crossRate(
    transaction.currency,
    ctx.reportingCurrency,
    ctx.reportingCurrency,
    ctx.rates,
    type,
  );
  if (!rr.ok) return rr;
  const budget = convert(transaction, br.value, ctx.budgetRounding);
  if (!budget.ok) return budget;
  const reporting = convert(transaction, rr.value);
  if (!reporting.ok) return reporting;
  return ok({
    transaction,
    budget: budget.value,
    reporting: reporting.value,
    budgetRate: br.value,
    reportingRate: rr.value,
  });
}

/**
 * Verifies that stored triplet amounts equal a re-conversion with the stored rates (the budget amount
 * with the rounding its line was posted with). Counter-account lines carry no budget amount.
 */
export function verifyTriplet(
  t: Omit<CurrencyTriplet, 'budget' | 'budgetRate'> & {
    budget: Money | null;
    budgetRate: AppliedRate | null;
  },
  opts: { budgetRounding?: Rounding } = {},
): Result<true> {
  const r = convert(t.transaction, t.reportingRate);
  if (!r.ok) return r;
  if (r.value.amountMinor !== t.reporting.amountMinor || r.value.currency !== t.reporting.currency)
    return err('VALIDATION_FAILED', 'The reporting amount does not match the stored rate.', {
      view: 'reporting',
      expectedMinor: r.value.amountMinor,
      storedMinor: t.reporting.amountMinor,
    });
  if (!t.budget || !t.budgetRate) return ok(true);
  const b = convert(t.transaction, t.budgetRate, opts.budgetRounding);
  if (!b.ok) return b;
  if (b.value.amountMinor !== t.budget.amountMinor || b.value.currency !== t.budget.currency)
    return err('VALIDATION_FAILED', 'The budget amount does not match the stored rate.', {
      view: 'budget',
      expectedMinor: b.value.amountMinor,
      storedMinor: t.budget.amountMinor,
    });
  return ok(true);
}
