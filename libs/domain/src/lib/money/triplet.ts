import { err, ok, type Result } from '../result';
import type { CurrencyCode } from './currency';
import type { Money } from './money';
import { convert, crossRate, type AppliedRate, type FxRate, type RateType } from './rate';

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
  const budget = convert(transaction, br.value);
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

/** Verifies that stored triplet amounts equal a re-conversion with the stored rates. */
export function verifyTriplet(t: CurrencyTriplet): Result<true> {
  const b = convert(t.transaction, t.budgetRate);
  const r = convert(t.transaction, t.reportingRate);
  if (!b.ok) return b;
  if (!r.ok) return r;
  if (
    b.value.amountMinor !== t.budget.amountMinor ||
    r.value.amountMinor !== t.reporting.amountMinor
  ) {
    return err('VALIDATION_FAILED', 'Stored amounts do not match the stored rates.');
  }
  return ok(true);
}
