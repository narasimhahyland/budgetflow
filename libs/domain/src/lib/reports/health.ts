import type { BudgetStatus } from '../budgets/budget-status';

/**
 * Budget health (screen 013): five written checks with fixed thresholds. A budget takes the worst
 * result of its checks and every result can be said in one sentence, so "At risk" is always
 * explainable and actionable. Health is a view: it never blocks anything.
 */
export const HEALTH_CHECKS = ['pace', 'forecast', 'controls', 'hygiene', 'unused'] as const;
export type HealthCheck = (typeof HEALTH_CHECKS)[number];

export type HealthLevel = 'healthy' | 'watch' | 'at_risk';

const RANK: Record<HealthLevel, number> = { healthy: 0, watch: 1, at_risk: 2 };

export interface HealthThresholds {
  /** Committed plus actual against the amount phased to date. */
  paceWatchBps: number;
  paceAtRiskBps: number;
  /** Forecast at year end against authorized. */
  forecastWatchBps: number;
  forecastAtRiskBps: number;
  /** Commitments past service end, or actuals unmatched, for longer than this. */
  hygieneDays: number;
  hygieneAtRiskMinor: number;
  /** Forecast unused that would lapse, as a share of authorized, with little of the year left. */
  unusedWatchBps: number;
  unusedDaysLeft: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  paceWatchBps: 11_000,
  paceAtRiskBps: 12_500,
  forecastWatchBps: 10_000,
  forecastAtRiskBps: 10_500,
  hygieneDays: 30,
  hygieneAtRiskMinor: 100_000,
  unusedWatchBps: 2_000,
  unusedDaysLeft: 90,
};

export interface HealthInput {
  status: BudgetStatus;
  /** Reporting currency, integer minor units. Committed buckets are subtree roll-ups. */
  authorizedMinor: number;
  heldMinor: number;
  preEncumberedMinor: number;
  encumberedMinor: number;
  actualMinor: number;
  /** Amount phased to date; null when the budget has no phasing (the elapsed share is used). */
  phasedToDateMinor: number | null;
  /** Share of the fiscal year already elapsed, in basis points. */
  elapsedBps: number;
  daysLeft: number;
  monthsLeft: number;
  toleranceBps: number;
  openCommitmentsMinor: number;
  agedCommitmentsMinor: number;
  agedCommitmentsCount: number;
  unmatchedActualsMinor: number;
  unmatchedActualsCount: number;
}

export interface HealthReason {
  check: HealthCheck;
  level: HealthLevel;
  text: string;
}

export interface HealthOutcome {
  level: HealthLevel;
  reasons: HealthReason[];
  /** Committed plus actual against the amount phased to date, in basis points. */
  pacedToDateBps: number;
  /** Run-rate forecast at year end, never below what is already committed and spent. */
  forecastMinor: number;
  forecastUnusedMinor: number;
  committedMinor: number;
  availableMinor: number;
}

const bps = (part: number, whole: number) => (whole > 0 ? Math.round((part * 10_000) / whole) : 0);
const pct = (value: number) => `${(value / 100).toFixed(value % 100 === 0 ? 0 : 1)}%`;

/**
 * Run-rate forecast at year end: what the budget would spend if it kept its pace, but never less
 * than what it has already committed and spent.
 */
export function runRateForecast(input: HealthInput): number {
  const committedAndSpent =
    input.actualMinor + input.heldMinor + input.preEncumberedMinor + input.encumberedMinor;
  if (input.elapsedBps <= 0) return committedAndSpent;
  const paced = Math.round((input.actualMinor * 10_000) / input.elapsedBps);
  return Math.max(paced, committedAndSpent);
}

/** Evaluates the five checks. `money` formats a minor amount for the reason sentences. */
export function evaluateHealth(
  input: HealthInput,
  thresholds: HealthThresholds,
  money: (amountMinor: number) => string,
): HealthOutcome {
  const committed = input.heldMinor + input.preEncumberedMinor + input.encumberedMinor;
  const available = input.authorizedMinor - committed - input.actualMinor;
  const forecast = runRateForecast(input);
  const forecastUnused = Math.max(input.authorizedMinor - forecast, 0);
  const phased =
    input.phasedToDateMinor ?? Math.round((input.authorizedMinor * input.elapsedBps) / 10_000);
  const pacedBps = bps(committed + input.actualMinor, phased);
  const reasons: HealthReason[] = [];

  if (input.authorizedMinor > 0 && phased > 0) {
    if (pacedBps >= thresholds.paceAtRiskBps && input.monthsLeft > 2)
      reasons.push({
        check: 'pace',
        level: 'at_risk',
        text: `Pace ${pct(pacedBps)} of phased with ${input.monthsLeft} months left`,
      });
    else if (pacedBps >= thresholds.paceWatchBps)
      reasons.push({ check: 'pace', level: 'watch', text: `Pace ${pct(pacedBps)} of phased` });
  }

  if (input.authorizedMinor > 0) {
    const forecastBps = bps(forecast, input.authorizedMinor);
    const atRiskAt = Math.max(thresholds.forecastAtRiskBps, 10_000 + input.toleranceBps);
    if (forecastBps >= atRiskAt)
      reasons.push({
        check: 'forecast',
        level: 'at_risk',
        text: `Forecast ${money(forecast)} against ${money(input.authorizedMinor)}`,
      });
    else if (forecastBps > thresholds.forecastWatchBps)
      reasons.push({
        check: 'forecast',
        level: 'watch',
        text: `Forecast ${pct(forecastBps - 10_000)} over authorized`,
      });
  }

  if (input.status === 'frozen')
    reasons.push({ check: 'controls', level: 'watch', text: 'Frozen' });
  if (input.status === 'set_to_zero' && input.openCommitmentsMinor > 0)
    reasons.push({
      check: 'controls',
      level: 'watch',
      text: `Set to zero with ${money(input.openCommitmentsMinor)} open commitments`,
    });

  const hygieneMinor = input.agedCommitmentsMinor + input.unmatchedActualsMinor;
  const hygieneCount = input.agedCommitmentsCount + input.unmatchedActualsCount;
  if (hygieneCount > 0) {
    const what: string[] = [];
    if (input.agedCommitmentsCount)
      what.push(
        `${input.agedCommitmentsCount} commitment${input.agedCommitmentsCount === 1 ? '' : 's'} more than ${thresholds.hygieneDays} days past service end`,
      );
    if (input.unmatchedActualsCount)
      what.push(
        `${input.unmatchedActualsCount} unmatched actual${input.unmatchedActualsCount === 1 ? '' : 's'} older than ${thresholds.hygieneDays} days`,
      );
    reasons.push({
      check: 'hygiene',
      level: hygieneMinor > thresholds.hygieneAtRiskMinor ? 'at_risk' : 'watch',
      text: what.join(' and '),
    });
  }

  if (
    input.authorizedMinor > 0 &&
    input.daysLeft <= thresholds.unusedDaysLeft &&
    bps(forecastUnused, input.authorizedMinor) > thresholds.unusedWatchBps
  )
    reasons.push({
      check: 'unused',
      level: 'watch',
      text: `${money(forecastUnused)} would lapse (${pct(bps(forecastUnused, input.authorizedMinor))})`,
    });

  const level = reasons.reduce<HealthLevel>(
    (worst, r) => (RANK[r.level] > RANK[worst] ? r.level : worst),
    'healthy',
  );
  return {
    level,
    reasons: [...reasons].sort((a, b) => RANK[b.level] - RANK[a.level]),
    pacedToDateBps: pacedBps,
    forecastMinor: forecast,
    forecastUnusedMinor: forecastUnused,
    committedMinor: committed,
    availableMinor: available,
  };
}
