import { err, ok, type Result } from '../result';
import type { CurrencyCode } from '../money/currency';
import type { Money } from '../money/money';
import { convert, crossRate, type FxRate } from '../money/rate';
import type { ForecastMethod, ForecastStatus } from '../lifecycles';

/**
 * Forecast cycles (87a) and the figures screen 087 reports. A forecast is a statement about how the
 * year will end; it is never an actual. Nothing here posts, so no function in this file returns a
 * journal, a bucket or a balance change: the cycle only ever writes forecast snapshots beside the
 * ledger. `authorized`, `actual` and `committed` arrive from the ledger and travel through unchanged,
 * so a forecast can be compared with committed money without ever being mistaken for it.
 */

/** Everything a method needs, all in the reporting currency as integer minor units. */
export interface ForecastFacts {
  /** Authorized net of allocated out, so a parent and its children never count the same money. */
  authorizedMinor: number;
  heldMinor: number;
  preEncumberedMinor: number;
  encumberedMinor: number;
  actualMinor: number;
  /** Events approved for this budget whose costs are not committed yet. */
  plannedEventsMinor: number;
  /** How far through the fiscal year the as-of date is, in basis points. */
  elapsedBps: number;
}

export interface ForecastOption {
  method: ForecastMethod;
  amountMinor: number;
  /** One sentence an owner can check the number against. */
  explanation: string;
}

export const committedOfFacts = (f: ForecastFacts): number =>
  f.heldMinor + f.preEncumberedMinor + f.encumberedMinor;

/**
 * Run-rate: the spend so far projected over the whole year, never below what is already committed
 * and spent. Identical to the run-rate the unused-and-expired report (086) and the health checks
 * use, so the two screens never disagree about the same budget.
 */
export function runRateAmount(f: ForecastFacts): number {
  const committedAndSpent = f.actualMinor + committedOfFacts(f);
  if (f.elapsedBps <= 0) return committedAndSpent;
  const paced = Math.round((f.actualMinor * 10_000) / f.elapsedBps);
  return Math.max(paced, committedAndSpent);
}

/**
 * Committed plus pipeline: the run-rate for routine spend, plus the money that is already promised
 * (held, pending and approved commitments) and the approved events whose costs have not landed yet.
 * Always at least the run-rate, because the pipeline can only add to it.
 */
export function committedPipelineAmount(f: ForecastFacts): number {
  const routine =
    f.elapsedBps > 0 ? Math.round((f.actualMinor * (10_000 - f.elapsedBps)) / f.elapsedBps) : 0;
  return f.actualMinor + routine + committedOfFacts(f) + f.plannedEventsMinor;
}

/** The two system-computed starting points an owner chooses between, in a fixed order. */
export function forecastOptions(f: ForecastFacts): ForecastOption[] {
  return [
    {
      method: 'run_rate',
      amountMinor: runRateAmount(f),
      explanation:
        'Spend so far projected over the whole year, never below what is already committed and spent.',
    },
    {
      method: 'committed_pipeline',
      amountMinor: committedPipelineAmount(f),
      explanation:
        'Actual plus the run-rate for routine spend, plus held, pending and approved commitments and approved events not yet committed.',
    },
  ];
}

/** The amount a chosen method forecasts; `owner_input` is the owner's own figure. */
export function forecastAmount(
  f: ForecastFacts,
  method: ForecastMethod,
  ownerAmountMinor: number | null,
): Result<number> {
  if (method === 'owner_input') {
    if (ownerAmountMinor === null)
      return err(
        'FORECAST_AMOUNT_REQUIRED',
        'Enter the amount you expect this budget to end the year at.',
      );
    if (!Number.isSafeInteger(ownerAmountMinor) || ownerAmountMinor < 0)
      return err('FORECAST_AMOUNT_REQUIRED', 'A forecast amount cannot be negative.');
    return ok(ownerAmountMinor);
  }
  return ok(method === 'run_rate' ? runRateAmount(f) : committedPipelineAmount(f));
}

export interface ForecastVariance {
  /** Authorized − forecast: positive is under the budget, negative is over it. */
  varianceMinor: number;
  /** The same variance against authorized, in basis points; 0 when nothing is authorized. */
  varianceBps: number;
  direction: 'under' | 'over' | 'on';
}

/** Variance of a forecast against the authorized amount, written the way 087 reads it. */
export function forecastVariance(authorizedMinor: number, forecastMinor: number): ForecastVariance {
  const varianceMinor = authorizedMinor - forecastMinor;
  const varianceBps =
    authorizedMinor > 0 ? Math.round((varianceMinor * 10_000) / authorizedMinor) : 0;
  return {
    varianceMinor,
    varianceBps,
    direction: varianceMinor > 0 ? 'under' : varianceMinor < 0 ? 'over' : 'on',
  };
}

export interface VarianceThreshold {
  /** Both tests must pass, so small budgets with large percentages do not create noise. */
  bps: number;
  minor: number;
}

export const DEFAULT_VARIANCE_THRESHOLD: VarianceThreshold = { bps: 1_000, minor: 100_000 };

/**
 * Whether the owner must explain this variance. "At least 10% and at least USD 1,000.00" is
 * inclusive at both boundaries: a variance exactly on the threshold needs commentary.
 */
export function commentaryRequired(v: ForecastVariance, threshold: VarianceThreshold): boolean {
  return Math.abs(v.varianceMinor) >= threshold.minor && Math.abs(v.varianceBps) >= threshold.bps;
}

export const COMMENTARY_MIN_LENGTH = 20;
export const COMMENTARY_MAX_LENGTH = 1_000;

export interface ForecastSubmissionInput {
  cycleStatus: 'open' | 'closed';
  currentStatus: ForecastStatus;
  method: ForecastMethod;
  ownerAmountMinor: number | null;
  commentary: string | null;
  /** False saves a draft; true submits it for finance to accept. */
  submit: boolean;
  facts: ForecastFacts;
  threshold: VarianceThreshold;
}

export interface ForecastSubmission {
  amountMinor: number;
  variance: ForecastVariance;
  commentaryRequired: boolean;
  nextStatus: ForecastStatus;
}

/**
 * Validates one owner submission. A closed cycle is immutable, an accepted line is the owner's last
 * word, and a submission whose variance is above the cycle threshold is refused without commentary
 * (`FORECAST_COMMENTARY_REQUIRED`) rather than accepted with a gap finance has to chase.
 */
export function checkForecastSubmission(
  input: ForecastSubmissionInput,
): Result<ForecastSubmission> {
  if (input.cycleStatus === 'closed')
    return err(
      'FORECAST_CYCLE_CLOSED',
      'This forecast cycle is closed; its snapshot cannot change. Ask finance to open a new cycle.',
    );
  if (input.currentStatus === 'accepted')
    return err(
      'FORECAST_ALREADY_ACCEPTED',
      'Finance has accepted this forecast; it cannot be changed.',
    );
  if (input.currentStatus === 'superseded')
    return err(
      'FORECAST_SUPERSEDED',
      'A later cycle has superseded this forecast; submit in the open cycle instead.',
    );
  const amount = forecastAmount(input.facts, input.method, input.ownerAmountMinor);
  if (!amount.ok) return amount;
  const variance = forecastVariance(input.facts.authorizedMinor, amount.value);
  const needed = commentaryRequired(variance, input.threshold);
  const commentary = input.commentary?.trim() ?? '';
  if (input.submit && needed && commentary.length < COMMENTARY_MIN_LENGTH)
    return err(
      'FORECAST_COMMENTARY_REQUIRED',
      `Explain the ${(Math.abs(variance.varianceBps) / 100).toFixed(1)}% variance from the authorized budget in at least ${COMMENTARY_MIN_LENGTH} characters before submitting.`,
      {
        varianceMinor: Math.abs(variance.varianceMinor),
        varianceBps: Math.abs(variance.varianceBps),
        minLength: COMMENTARY_MIN_LENGTH,
      },
    );
  return ok({
    amountMinor: amount.value,
    variance,
    commentaryRequired: needed,
    nextStatus: input.submit ? 'submitted' : 'draft',
  });
}

/** Only a submitted line can be accepted or sent back; a draft is still the owner's to finish. */
export function checkForecastDecision(
  cycleStatus: 'open' | 'closed',
  currentStatus: ForecastStatus,
  decision: 'accept' | 'request_commentary',
): Result<ForecastStatus> {
  if (cycleStatus === 'closed')
    return err(
      'FORECAST_CYCLE_CLOSED',
      'This forecast cycle is closed; its snapshot cannot change.',
    );
  if (currentStatus !== 'submitted')
    return err(
      'FORECAST_NOT_SUBMITTED',
      `Only a submitted forecast can be ${decision === 'accept' ? 'accepted' : 'sent back for commentary'}; this one is ${currentStatus.replace(/_/g, ' ')}.`,
      { status: currentStatus },
    );
  return ok(decision === 'accept' ? 'accepted' : 'commentary_required');
}

/** The phrase closing a cycle must repeat, for example `CLOSE OCTOBER REFORECAST`. */
export const forecastCloseConfirmationFor = (cycleName: string): string =>
  `CLOSE ${cycleName.toUpperCase()}`;

// FX bridge (16a) ---------------------------------------------------------------------------------

export interface FxBridgeInput {
  /** Spend in one transaction currency, as posted. */
  transactionCurrency: CurrencyCode;
  transactionAmountMinor: number;
  /** The reporting amount the ledger stored, converted at the company's reporting rate type. */
  reportingAmountMinor: number;
}

export interface FxBridgeRow {
  transactionCurrency: CurrencyCode;
  transaction: Money;
  /** The same spend valued at the locked plan rate: the rate budget control used. */
  atPlanRate: Money;
  /** The same spend at the reporting rate type (monthly average by default). */
  atReportingRate: Money;
  /** At reporting rate − at plan rate. Explains the gap; never spend, variance or budget. */
  fxEffect: Money;
  planRate: string | null;
  note: string;
}

export const FX_BRIDGE_NOTE = 'Not part of spend or variance; FX never consumes budget.';

/**
 * Values each currency's spend twice — once at the locked plan rate, once at the rate the ledger
 * reported it at — and reports the gap as its own figure. The bridge explains why a constant-currency
 * total differs from the reported one; it moves no money, so it never appears as spend or variance.
 * Rows come back in a total order (currency code), so a regenerated pack lists them identically.
 */
export function fxBridge(
  rows: readonly FxBridgeInput[],
  reportingCurrency: CurrencyCode,
  planRates: readonly FxRate[],
): { rows: FxBridgeRow[]; totalEffect: Money } {
  const byCurrency = new Map<CurrencyCode, { transaction: number; reporting: number }>();
  for (const r of rows) {
    const cur = byCurrency.get(r.transactionCurrency) ?? { transaction: 0, reporting: 0 };
    cur.transaction += r.transactionAmountMinor;
    cur.reporting += r.reportingAmountMinor;
    byCurrency.set(r.transactionCurrency, cur);
  }
  const out: FxBridgeRow[] = [];
  let totalEffect = 0;
  for (const currency of [...byCurrency.keys()].sort()) {
    const sums = byCurrency.get(currency)!;
    const transaction: Money = { amountMinor: sums.transaction, currency };
    const rate = crossRate(currency, reportingCurrency, reportingCurrency, planRates, 'plan');
    const atPlan = rate.ok ? convert(transaction, rate.value) : rate;
    // Without a locked plan rate there is nothing to bridge against, so the row reports the
    // reported amount on both sides and an effect of zero rather than inventing a rate.
    const atPlanMinor = atPlan.ok ? atPlan.value.amountMinor : sums.reporting;
    const effect = sums.reporting - atPlanMinor;
    totalEffect += effect;
    out.push({
      transactionCurrency: currency,
      transaction,
      atPlanRate: { amountMinor: atPlanMinor, currency: reportingCurrency },
      atReportingRate: { amountMinor: sums.reporting, currency: reportingCurrency },
      fxEffect: { amountMinor: effect, currency: reportingCurrency },
      planRate: rate.ok ? rate.value.value : null,
      note: FX_BRIDGE_NOTE,
    });
  }
  return { rows: out, totalEffect: { amountMinor: totalEffect, currency: reportingCurrency } };
}
