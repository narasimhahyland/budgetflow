import { formatAmount } from '../money/currency';
import { err, ok, type Result } from '../result';
import {
  BUDGET_BUCKETS,
  CONSUMING_BUCKETS,
  NORMAL_SIGN,
  type BudgetBucket,
  type ConsumingBucket,
  type LedgerAccount,
} from './accounts';

/** Balance per bucket in the budget currency, natural sign (positive = normal balance). */
export type BucketBalances = Record<BudgetBucket, number>;

export const CONTROL_MODES = ['hard', 'soft', 'track'] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

export interface ControlSettings {
  /** Buckets counted against available. Defaults to all consuming buckets. */
  basis: readonly ConsumingBucket[];
  mode: ControlMode;
  /** Tolerance in basis points of authorized, applied to spend checks only (never to allocations). */
  toleranceBps: number;
}

export const DEFAULT_CONTROL: ControlSettings = {
  basis: CONSUMING_BUCKETS,
  mode: 'hard',
  toleranceBps: 0,
};

export function emptyBalances(): BucketBalances {
  return Object.fromEntries(BUDGET_BUCKETS.map((b) => [b, 0])) as BucketBalances;
}

/** Folds signed line amounts (debit +, credit −) for one budget into natural-sign balances. */
export function balancesFromLines(
  lines: readonly { account: LedgerAccount; budgetAmountMinor: number }[],
): BucketBalances {
  const b = emptyBalances();
  for (const l of lines) {
    if ((BUDGET_BUCKETS as readonly string[]).includes(l.account)) {
      b[l.account as BudgetBucket] += NORMAL_SIGN[l.account] * l.budgetAmountMinor;
    }
  }
  return b;
}

export function applyDelta(
  balances: BucketBalances,
  deltas: readonly { account: LedgerAccount; budgetAmountMinor: number }[],
): BucketBalances {
  const next = { ...balances };
  for (const d of deltas) {
    if ((BUDGET_BUCKETS as readonly string[]).includes(d.account)) {
      next[d.account as BudgetBucket] += NORMAL_SIGN[d.account] * d.budgetAmountMinor;
    }
  }
  return next;
}

/** available = authorized − Σ consuming buckets selected by the control basis. Accrued never counts. */
export function availableOf(
  balances: BucketBalances,
  basis: readonly ConsumingBucket[] = CONSUMING_BUCKETS,
): number {
  return basis.reduce((acc, bucket) => acc - balances[bucket], balances.authorized);
}

/** Allocation always counts allocated out on top of the basis, and allows no tolerance. */
export function allocationAvailable(balances: BucketBalances, control: ControlSettings): number {
  const basis = control.basis.includes('allocated_out')
    ? control.basis
    : [...control.basis, 'allocated_out' as const];
  return availableOf(balances, basis);
}

export function committedOf(b: BucketBalances): number {
  return b.held + b.pre_encumbered + b.encumbered;
}

/** Buckets whose natural-sign balance is below zero; every bucket is non-negative in a sound ledger. */
export function negativeBuckets(b: BucketBalances): BudgetBucket[] {
  return BUDGET_BUCKETS.filter((bucket) => b[bucket] < 0);
}

/**
 * Over-allocation is a hard block naming the remaining amount. A negative consuming bucket never
 * adds headroom, and allocated out plus the request may never exceed authorized.
 */
export function checkAllocation(
  parent: BucketBalances,
  control: ControlSettings,
  requestedMinor: number,
  currency: string,
): Result<{ availableAfterMinor: number }> {
  const floored = { ...parent };
  for (const bucket of CONSUMING_BUCKETS) floored[bucket] = Math.max(parent[bucket], 0);
  const available = Math.min(
    allocationAvailable(floored, control),
    parent.authorized - floored.allocated_out,
  );
  if (requestedMinor > available) {
    return err(
      'OVER_ALLOCATION',
      `Only ${formatAmount(available, currency)} is available to allocate; ${formatAmount(requestedMinor, currency)} was asked for. Lower the amount or ask for an increase.`,
      {
        availableMinor: available,
        requestedMinor,
        shortfallMinor: requestedMinor - available,
        currency,
      },
    );
  }
  return ok({ availableAfterMinor: available - requestedMinor });
}

export type SpendOutcome = 'ok' | 'warning' | 'blocked';

/** Spend check per control mode: hard blocks beyond tolerance, soft warns, track records only. */
export function checkSpend(
  balances: BucketBalances,
  control: ControlSettings,
  requestedMinor: number,
): { outcome: SpendOutcome; availableMinor: number; toleranceMinor: number } {
  const availableMinor = availableOf(balances, control.basis);
  const toleranceMinor = Math.floor(
    (Math.max(balances.authorized, 0) * control.toleranceBps) / 10_000,
  );
  if (requestedMinor <= availableMinor) return { outcome: 'ok', availableMinor, toleranceMinor };
  if (control.mode === 'track') return { outcome: 'ok', availableMinor, toleranceMinor };
  if (control.mode === 'soft') return { outcome: 'warning', availableMinor, toleranceMinor };
  return {
    outcome: requestedMinor <= availableMinor + toleranceMinor ? 'warning' : 'blocked',
    availableMinor,
    toleranceMinor,
  };
}

/**
 * After a posting (reversal, manual journal), no bucket may go below zero, authorized may never drop
 * below what has already been allocated out to children, and a hard-mode budget's available may not
 * go negative.
 */
export function checkNotOverdrawn(
  after: BucketBalances,
  control: ControlSettings,
  budgetId: string,
  code: 'REVERSAL_WOULD_OVERDRAW' | 'INSUFFICIENT_AVAILABLE',
): Result<true> {
  const negative = negativeBuckets(after);
  if (negative.length > 0) {
    return err(
      'NEGATIVE_BUCKET_BALANCE',
      `This would leave the budget's ${negative[0].replace(/_/g, ' ')} below zero.`,
      { budgetId, bucket: negative[0], balanceMinor: after[negative[0]] },
    );
  }
  const allocAvail = allocationAvailable(after, control);
  const spendAvail = availableOf(after, control.basis);
  const toleranceMinor = Math.floor(
    (Math.max(after.authorized, 0) * control.toleranceBps) / 10_000,
  );
  if (after.allocated_out > after.authorized) {
    return err(code, 'This would leave the budget with more allocated to children than it holds.', {
      budgetId,
      availableMinor: allocAvail,
    });
  }
  if (control.mode === 'hard' && spendAvail + toleranceMinor < 0) {
    return err(code, "This would make the budget's available amount negative.", {
      budgetId,
      availableMinor: spendAvail,
    });
  }
  return ok(true);
}

/** Owner alert thresholds (percent of authorized consumed) crossed by moving from `before` to `after`. */
export function thresholdsCrossed(
  before: BucketBalances,
  after: BucketBalances,
  control: ControlSettings,
  thresholdsPct: readonly number[],
): number[] {
  const pct = (b: BucketBalances) =>
    b.authorized <= 0 ? 0 : ((b.authorized - availableOf(b, control.basis)) * 100) / b.authorized;
  const p0 = pct(before);
  const p1 = pct(after);
  return thresholdsPct.filter((t) => p0 < t && p1 >= t);
}
