import { err, ok, type Result } from '../result';
import type { BudgetStatus } from '../budgets/budget-status';
import { reductionFloor } from '../budgets/controls';
import type { BucketBalances } from '../ledger/balances';
import { runRateAmount } from './forecast';

/**
 * Reclaim and redistribute unused budget (086a). Finance asks owners to release money forecast to
 * lapse; owners release all, part, or keep it with a reason and plan; money that is released moves
 * as a reduction with a destination (a target budget of the same legal entity, or back to the
 * budget's parent) through the normal hierarchy postings. Nothing here posts: these functions decide
 * who is a candidate, what an owner may release and how a pool is split into reductions.
 */

export const RECLAIM_CAMPAIGN_STATUSES = ['collecting', 'redistributing', 'completed'] as const;
export type ReclaimCampaignStatus = (typeof RECLAIM_CAMPAIGN_STATUSES)[number];

/**
 * A notice's lifecycle. `sent`: waiting for the owner. `released` / `kept`: the owner (or, after the
 * deadline, the parent owner) answered. `parent_review`: finance sent an unanswered notice to the
 * parent owner. `reclaimed`: the released money moved in a pool execution.
 */
export const RECLAIM_NOTICE_STATUSES = [
  'sent',
  'released',
  'kept',
  'parent_review',
  'reclaimed',
] as const;
export type ReclaimNoticeStatus = (typeof RECLAIM_NOTICE_STATUSES)[number];

export const RECLAIM_CHOICES = ['release_all', 'release_part', 'keep'] as const;
export type ReclaimChoice = (typeof RECLAIM_CHOICES)[number];

export interface ReclaimCriteria {
  /** Forecast unused must be above this share of authorized (basis points; 2000 = 20%). */
  minUnusedBps: number;
  /** ... and above this amount in the reporting currency. */
  minUnusedReportingMinor: number;
  /** Fewer than this many days left in the fiscal year. */
  maxDaysLeft: number;
}

export const DEFAULT_RECLAIM_CRITERIA: ReclaimCriteria = {
  minUnusedBps: 2_000,
  minUnusedReportingMinor: 100_000,
  maxDaysLeft: 90,
};

export interface ReclaimCandidateInput {
  status: BudgetStatus;
  /** The budget's own balances in its currency (not rolled up: children answer for themselves). */
  balances: BucketBalances;
  /** Authorized in the reporting currency at the locked plan rate, to compare the amount criterion. */
  authorizedReportingMinor: number;
  elapsedBps: number;
  daysLeft: number;
  /** On "Carry full" or "Carry with approval" with a carry request still pending. */
  pendingCarry: boolean;
}

export type ReclaimExclusion =
  | 'frozen'
  | 'set_to_zero'
  | 'not_open'
  | 'pending_carry'
  | 'too_early'
  | 'below_share'
  | 'below_amount';

export interface ReclaimCandidate {
  eligible: boolean;
  exclusion: ReclaimExclusion | null;
  /** What the run-rate forecast says will lapse at year end, in the budget currency. */
  forecastUnusedMinor: number;
  forecastUnusedReportingMinor: number;
  /** What the campaign proposes the owner releases: the forecast lapse, never past the floor. */
  proposedMinor: number;
  /** authorized − (allocated out + held + encumbered + actual), the most a reduction may take. */
  maxReclaimableMinor: number;
  floorMinor: number;
}

const OPEN_STATUSES: readonly BudgetStatus[] = [
  'active',
  'partially_allocated',
  'fully_allocated',
  'reduced',
  'revised',
];

/** The most a reclaim may take from a budget right now: what lies above its reduction floor. */
export function maxReclaimable(balances: BucketBalances): number {
  return Math.max(balances.authorized - reductionFloor(balances, false), 0);
}

/**
 * Whether a budget meets the campaign criteria, with the amounts the notice carries. The forecast is
 * the same run-rate the health checks and the unused report use, over the budget's own money
 * (authorized net of what it allocated to children).
 */
export function reclaimCandidate(
  input: ReclaimCandidateInput,
  criteria: ReclaimCriteria,
): ReclaimCandidate {
  const b = input.balances;
  const own = b.authorized - b.allocated_out;
  const forecast = runRateAmount({
    authorizedMinor: own,
    heldMinor: b.held,
    preEncumberedMinor: b.pre_encumbered,
    encumberedMinor: b.encumbered,
    actualMinor: b.actual,
    plannedEventsMinor: 0,
    elapsedBps: input.elapsedBps,
  });
  const unused = Math.max(own - forecast, 0);
  const unusedReporting =
    b.authorized > 0 ? Math.round((unused * input.authorizedReportingMinor) / b.authorized) : 0;
  const max = maxReclaimable(b);
  const floor = reductionFloor(b, false);
  const base = {
    forecastUnusedMinor: unused,
    forecastUnusedReportingMinor: unusedReporting,
    proposedMinor: Math.min(unused, max),
    maxReclaimableMinor: max,
    floorMinor: floor,
  };
  const out = (exclusion: ReclaimExclusion | null): ReclaimCandidate => ({
    eligible: exclusion === null,
    exclusion,
    ...base,
  });
  if (input.status === 'frozen') return out('frozen');
  if (input.status === 'set_to_zero') return out('set_to_zero');
  if (!OPEN_STATUSES.includes(input.status)) return out('not_open');
  if (input.pendingCarry) return out('pending_carry');
  if (input.daysLeft >= criteria.maxDaysLeft) return out('too_early');
  if (b.authorized <= 0 || unused * 10_000 <= b.authorized * criteria.minUnusedBps)
    return out('below_share');
  if (unusedReporting <= criteria.minUnusedReportingMinor) return out('below_amount');
  return out(base.proposedMinor > 0 ? null : 'below_amount');
}

export interface ReclaimResponseInput {
  choice: ReclaimChoice;
  /** For `release_part`: the amount released, in the budget currency. */
  amountMinor?: number | null;
  reason?: string | null;
  plan?: string | null;
}

export interface ReclaimResponseOutcome {
  status: 'released' | 'kept';
  releasedMinor: number;
  keptMinor: number;
}

/**
 * Validates an owner's (or parent owner's) answer. Release all takes the proposed amount, release
 * part a positive amount up to it; either is refused above the budget's floor as it stands now
 * (commitments may have landed since the campaign started). Keeping the money needs a reason and a
 * plan, and moves nothing.
 */
export function validateReclaimResponse(
  proposedMinor: number,
  balances: BucketBalances,
  input: ReclaimResponseInput,
): Result<ReclaimResponseOutcome> {
  if (input.choice === 'keep') {
    if (!input.reason?.trim() || !input.plan?.trim())
      return err(
        'REASON_REQUIRED',
        'Say why you are keeping the money and what it is planned for.',
      );
    return ok({ status: 'kept', releasedMinor: 0, keptMinor: proposedMinor });
  }
  const amount = input.choice === 'release_all' ? proposedMinor : (input.amountMinor ?? 0);
  if (!Number.isSafeInteger(amount) || amount <= 0)
    return err('AMOUNT_NOT_POSITIVE', 'Enter an amount greater than zero to release.');
  if (amount > proposedMinor)
    return err('VALIDATION_FAILED', 'You can release at most the amount the campaign proposed.', {
      proposedMinor,
    });
  const max = maxReclaimable(balances);
  if (amount > max)
    return err(
      'REDUCTION_BELOW_FLOOR',
      'The budget cannot go below what is already allocated to children, committed and spent.',
      { floorMinor: reductionFloor(balances, false), maxReductionMinor: max },
    );
  return ok({ status: 'released', releasedMinor: amount, keptMinor: proposedMinor - amount });
}

export interface PoolSource {
  budgetId: string;
  releasedMinor: number;
}

export interface PoolTarget {
  budgetId: string;
  amountMinor: number;
}

/** One reduction to post: from a source either to a target (reallocation) or back to its parent. */
export interface PoolLeg {
  sourceBudgetId: string;
  destination: 'reallocation' | 'parent';
  targetBudgetId: string | null;
  amountMinor: number;
}

export interface PoolPlan {
  poolMinor: number;
  allocatedMinor: number;
  remainderMinor: number;
  legs: PoolLeg[];
}

/**
 * Splits a legal entity's released pool into reductions. Sources are taken in budget id order and
 * targets in the order finance listed them, so the same plan always produces the same legs; what no
 * target takes returns from each source to its own parent. Targets may not be sources, may not
 * repeat, and may not ask for more than the pool holds.
 */
export function planPoolRedistribution(
  sources: readonly PoolSource[],
  targets: readonly PoolTarget[],
): Result<PoolPlan> {
  const pool = sources.reduce((s, x) => s + x.releasedMinor, 0);
  const sourceIds = new Set(sources.map((s) => s.budgetId));
  const seen = new Set<string>();
  for (const t of targets) {
    if (!Number.isSafeInteger(t.amountMinor) || t.amountMinor <= 0)
      return err('AMOUNT_NOT_POSITIVE', 'Each target needs an amount greater than zero.', {
        budgetId: t.budgetId,
      });
    if (sourceIds.has(t.budgetId))
      return err('TRANSFER_INVALID', 'A budget that released money cannot also receive it.', {
        budgetId: t.budgetId,
      });
    if (seen.has(t.budgetId))
      return err('VALIDATION_FAILED', 'List each target budget once.', { budgetId: t.budgetId });
    seen.add(t.budgetId);
  }
  const allocated = targets.reduce((s, t) => s + t.amountMinor, 0);
  if (allocated > pool)
    return err('OVER_ALLOCATION', 'The targets add up to more than the released pool.', {
      poolMinor: pool,
      allocatedMinor: allocated,
    });
  const legs: PoolLeg[] = [];
  const queue = [...sources]
    .filter((s) => s.releasedMinor > 0)
    .sort((a, b) => a.budgetId.localeCompare(b.budgetId))
    .map((s) => ({ ...s, left: s.releasedMinor }));
  let i = 0;
  for (const t of targets) {
    let need = t.amountMinor;
    while (need > 0) {
      const src = queue[i];
      const take = Math.min(src.left, need);
      legs.push({
        sourceBudgetId: src.budgetId,
        destination: 'reallocation',
        targetBudgetId: t.budgetId,
        amountMinor: take,
      });
      src.left -= take;
      need -= take;
      if (src.left === 0) i++;
    }
  }
  for (const src of queue)
    if (src.left > 0)
      legs.push({
        sourceBudgetId: src.budgetId,
        destination: 'parent',
        targetBudgetId: null,
        amountMinor: src.left,
      });
  return ok({ poolMinor: pool, allocatedMinor: allocated, remainderMinor: pool - allocated, legs });
}
