import { splitByWeights } from '../money/split';
import { err, ok, type Result } from '../result';
import { fundingCap } from '../cofunding/cofunding';

/**
 * An event's funding sources: its own funds (approved event budget and additional-fund requests,
 * held on the charged budget) and approved Inter-Director Budget Contribution Requests (held on the
 * giver's budget, or transferred and held on the event's home budget). Amounts are in the budget
 * currency of the budget that holds them.
 */
export interface FundingSource {
  id: string;
  fundedMinor: number;
  consumedMinor: number;
  returnedMinor: number;
}

export const remainingOf = (s: FundingSource): number =>
  s.fundedMinor - s.consumedMinor - s.returnedMinor;

/**
 * Consumption order: every commitment draws on the event's sources pro rata by funded share, so each
 * source's cumulative consumption tracks its share of the total (largest remainder). A source that
 * has already given more than its share (funding changed later) gives nothing until the others catch
 * up; whatever a source cannot give moves to sources with spare remaining, again by share. The parts
 * sum exactly to the amount.
 */
export function allocateConsumption(
  sources: readonly FundingSource[],
  amountMinor: number,
): Result<{ id: string; amountMinor: number }[]> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
    return err('AMOUNT_NOT_POSITIVE', 'Enter an amount greater than zero.');
  const live = sources.filter((s) => remainingOf(s) > 0);
  const totalRemaining = live.reduce((a, s) => a + remainingOf(s), 0);
  if (amountMinor > totalRemaining) {
    return err('FUNDING_CAP_EXCEEDED', 'The event does not have that much approved funding left.', {
      remainingMinor: totalRemaining,
      requestedMinor: amountMinor,
    });
  }
  const consumedSoFar = live.reduce((a, s) => a + s.consumedMinor, 0);
  const targets = splitByWeights(
    consumedSoFar + amountMinor,
    live.map((s) => s.fundedMinor - s.returnedMinor),
  );
  if (!targets.ok) return targets;
  const parts = live.map((s, i) =>
    Math.min(Math.max(targets.value[i] - s.consumedMinor, 0), remainingOf(s)),
  );
  let shortfall = amountMinor - parts.reduce((a, b) => a + b, 0);
  while (shortfall > 0) {
    const spare = live.map((s, i) => remainingOf(s) - parts[i]);
    const extra = splitByWeights(shortfall, spare);
    if (!extra.ok) return extra;
    for (let i = 0; i < parts.length; i++) parts[i] += Math.min(extra.value[i], spare[i]);
    shortfall = amountMinor - parts.reduce((a, b) => a + b, 0);
  }
  return ok(
    live.map((s, i) => ({ id: s.id, amountMinor: parts[i] })).filter((p) => p.amountMinor > 0),
  );
}

/** At close each source gets back exactly what it still holds; with pro-rata consumption that is its share of the surplus. */
export function surplusPlan(
  sources: readonly FundingSource[],
): { id: string; returnMinor: number }[] {
  return sources.map((s) => ({ id: s.id, returnMinor: Math.max(remainingOf(s), 0) }));
}

export interface EventFunding {
  estimateMinor: number;
  toleranceMinor: number;
  /** Estimate + tolerance: the most the event may raise. */
  ceilingMinor: number;
  ownFundsMinor: number;
  contributionsMinor: number;
  pendingMinor: number;
  /** min(own funds + contributions, estimate + tolerance). */
  capMinor: number;
  committedMinor: number;
  gapMinor: number;
  fullyFunded: boolean;
}

export function eventFunding(input: {
  estimateMinor: number;
  toleranceBps: number;
  ownFundsMinor: number;
  contributionsMinor: number;
  pendingMinor: number;
  committedMinor: number;
}): EventFunding {
  const toleranceMinor = Math.floor((input.estimateMinor * input.toleranceBps) / 10_000);
  const capMinor = fundingCap({
    ownFundsMinor: input.ownFundsMinor,
    contributionsMinor: input.contributionsMinor,
    estimateMinor: input.estimateMinor,
    toleranceBps: input.toleranceBps,
  });
  const funded = input.ownFundsMinor + input.contributionsMinor;
  return {
    estimateMinor: input.estimateMinor,
    toleranceMinor,
    ceilingMinor: input.estimateMinor + toleranceMinor,
    ownFundsMinor: input.ownFundsMinor,
    contributionsMinor: input.contributionsMinor,
    pendingMinor: input.pendingMinor,
    capMinor,
    committedMinor: input.committedMinor,
    gapMinor: Math.max(input.estimateMinor - funded, 0),
    fullyFunded: funded >= input.estimateMinor && input.estimateMinor > 0,
  };
}

/** Raising funding (own funds or a contribution) may not take approved plus requested funding above estimate + tolerance. */
export function checkFundingCeiling(input: {
  estimateMinor: number;
  toleranceBps: number;
  approvedMinor: number;
  pendingMinor: number;
  requestedMinor: number;
}): Result<true> {
  const ceiling =
    input.estimateMinor + Math.floor((input.estimateMinor * input.toleranceBps) / 10_000);
  const total = input.approvedMinor + input.pendingMinor + input.requestedMinor;
  if (total > ceiling) {
    return err(
      'FUNDING_CAP_EXCEEDED',
      'This would raise more than the event estimate plus its tolerance.',
      {
        ceilingMinor: ceiling,
        approvedMinor: input.approvedMinor,
        pendingMinor: input.pendingMinor,
        requestedMinor: input.requestedMinor,
        maxMinor: Math.max(ceiling - input.approvedMinor - input.pendingMinor, 0),
      },
    );
  }
  return ok(true);
}
