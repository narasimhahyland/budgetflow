/**
 * Burn-rate alerts: an owner hears when actual spend runs ahead of the budget's phasing. The
 * comparison is actual spend to the as-of date against the amount phased to that date (whole periods
 * already ended plus the elapsed share of the current one). Without phasing, the budget's own money
 * (authorized net of allocated out) is spread evenly over the fiscal year. Alerts never block
 * anything; they are a nudge, raised once per budget, period and level.
 */

export const BURN_RATE_LEVELS = ['ahead', 'well_ahead'] as const;
export type BurnRateLevel = (typeof BURN_RATE_LEVELS)[number];

export interface BurnRateThresholds {
  /** Spend at or above this share of phased-to-date is "ahead" (basis points). */
  aheadBps: number;
  /** ... and at or above this one "well ahead". */
  wellAheadBps: number;
}

/** The same thresholds the health pace check uses (110% watch, 125% at risk). */
export const DEFAULT_BURN_RATE_THRESHOLDS: BurnRateThresholds = {
  aheadBps: 11_000,
  wellAheadBps: 12_500,
};

export interface PhasedPeriod {
  startDate: string;
  endDate: string;
  amountMinor: number;
}

const DAY = 86_400_000;
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;

/**
 * Amount phased up to and including `asOf`: every period that has ended in full, plus the current
 * period's allotment in proportion to the days elapsed (the as-of day counts).
 */
export function phasedToDate(periods: readonly PhasedPeriod[], asOf: string): number {
  let total = 0;
  for (const p of periods) {
    if (p.startDate > asOf) continue;
    if (p.endDate <= asOf) {
      total += p.amountMinor;
      continue;
    }
    total += Math.round((p.amountMinor * days(p.startDate, asOf)) / days(p.startDate, p.endDate));
  }
  return total;
}

/** Even phasing over the fiscal year when a budget has none. */
export function evenPhasedToDate(
  ownMinor: number,
  fiscalYear: { startDate: string; endDate: string },
  asOf: string,
): number {
  return phasedToDate([{ ...fiscalYear, amountMinor: ownMinor }], asOf);
}

export interface BurnRateOutcome {
  /** Actual spend against phased-to-date, in basis points (0 when nothing is phased yet). */
  burnBps: number;
  level: BurnRateLevel | null;
}

export function evaluateBurnRate(
  spentMinor: number,
  phasedMinor: number,
  thresholds: BurnRateThresholds = DEFAULT_BURN_RATE_THRESHOLDS,
): BurnRateOutcome {
  if (phasedMinor <= 0 || spentMinor <= 0) return { burnBps: 0, level: null };
  // Compared in integers so 110.00% exactly is "ahead" and one minor unit less is not.
  const level =
    spentMinor * 10_000 >= phasedMinor * thresholds.wellAheadBps
      ? 'well_ahead'
      : spentMinor * 10_000 >= phasedMinor * thresholds.aheadBps
        ? 'ahead'
        : null;
  return { burnBps: Math.floor((spentMinor * 10_000) / phasedMinor), level };
}
