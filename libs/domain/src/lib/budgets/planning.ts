import { splitByWeights } from '../money/split';
import { err, ok, type Result } from '../result';
import { availableOf, type BucketBalances, type ControlSettings } from '../ledger/balances';
import { EMPLOYMENT_TYPES, type EmploymentType } from '../org/imports';

// Per-head driver ---------------------------------------------------------------------------------

export interface DriverHeadcountLine {
  employmentType: EmploymentType;
  headcount: number;
  /** Prorated headcount in thousandths (joiners and leavers counted for the part of the year they work). */
  proratedHeadcountMilli: number;
}

export interface PerHeadConfig {
  /** Rate per eligible head in the budget currency, minor units. */
  rateMinor: number;
  eligibleTypes: readonly EmploymentType[];
  prorate: boolean;
}

export interface PerHeadResult {
  headcount: number;
  eligibleHeadcount: number;
  eligibleHeadcountMilli: number;
  excludedHeadcount: number;
  byType: Record<EmploymentType, { headcount: number; headcountMilli: number; eligible: boolean }>;
  amountMinor: number;
}

/**
 * Per-head allocation: rate x eligible headcount, prorated (thousandths) when configured. Rounds
 * half-even once on the total so the child never receives more than rate x heads.
 */
export function perHeadAmount(
  lines: readonly DriverHeadcountLine[],
  config: PerHeadConfig,
): Result<PerHeadResult> {
  if (!Number.isSafeInteger(config.rateMinor) || config.rateMinor <= 0)
    return err('AMOUNT_NOT_POSITIVE', 'Enter a rate per head greater than zero.');
  if (config.eligibleTypes.length === 0)
    return err('VALIDATION_FAILED', 'Choose at least one eligible employment type.');
  if (lines.length === 0)
    return err('HEADCOUNT_MISSING', 'There is no headcount for this unit in the HR import.');
  const byType = Object.fromEntries(
    EMPLOYMENT_TYPES.map((t) => [
      t,
      { headcount: 0, headcountMilli: 0, eligible: config.eligibleTypes.includes(t) },
    ]),
  ) as PerHeadResult['byType'];
  for (const l of lines) {
    byType[l.employmentType].headcount += l.headcount;
    byType[l.employmentType].headcountMilli += config.prorate
      ? l.proratedHeadcountMilli
      : l.headcount * 1000;
  }
  const eligible = EMPLOYMENT_TYPES.filter((t) => byType[t].eligible);
  const eligibleMilli = eligible.reduce((s, t) => s + byType[t].headcountMilli, 0);
  const eligibleHeads = eligible.reduce((s, t) => s + byType[t].headcount, 0);
  const total = EMPLOYMENT_TYPES.reduce((s, t) => s + byType[t].headcount, 0);
  const amount = roundHalfEven(BigInt(config.rateMinor) * BigInt(eligibleMilli), 1000n);
  return ok({
    headcount: total,
    eligibleHeadcount: eligibleHeads,
    eligibleHeadcountMilli: eligibleMilli,
    excludedHeadcount: total - eligibleHeads,
    byType,
    amountMinor: Number(amount),
  });
}

function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice > denominator || (twice === denominator && q % 2n === 1n)) return q + 1n;
  return q;
}

/** True-up after a headcount refresh: the difference between the new driver amount and what was allocated. */
export function perHeadTrueUp(
  currentDriverAmountMinor: number,
  next: PerHeadResult,
): { deltaMinor: number; direction: 'allocate' | 'return' | 'none' } {
  const delta = next.amountMinor - currentDriverAmountMinor;
  return { deltaMinor: delta, direction: delta > 0 ? 'allocate' : delta < 0 ? 'return' : 'none' };
}

// Period phasing ----------------------------------------------------------------------------------

export const PHASING_METHODS = ['even', 'seasonal', 'manual'] as const;
export type PhasingMethod = (typeof PHASING_METHODS)[number];

/** Splits the authorized amount over periods: even, seasonal (weights) or manual (amounts that must add up). */
export function phaseAmounts(
  totalMinor: number,
  periodCount: number,
  method: PhasingMethod,
  input: { weights?: readonly number[]; amountsMinor?: readonly number[] } = {},
): Result<number[]> {
  if (periodCount <= 0) return err('PERIOD_NOT_FOUND', 'The budget has no fiscal periods.');
  if (method === 'manual') {
    const amounts = input.amountsMinor ?? [];
    if (amounts.length !== periodCount)
      return err('VALIDATION_FAILED', `Enter one amount for each of the ${periodCount} periods.`);
    if (amounts.some((a) => !Number.isSafeInteger(a) || a < 0))
      return err('AMOUNT_NOT_SAFE_INTEGER', 'Period amounts are whole, non-negative minor units.');
    const sum = amounts.reduce((s, a) => s + a, 0);
    if (sum !== totalMinor)
      return err(
        'PHASING_TOTAL_MISMATCH',
        'The period amounts must add up to the authorized amount.',
        { totalMinor, phasedMinor: sum, differenceMinor: totalMinor - sum },
      );
    return ok([...amounts]);
  }
  if (totalMinor === 0) return ok(Array.from({ length: periodCount }, () => 0));
  const weights =
    method === 'even' ? Array.from({ length: periodCount }, () => 1) : (input.weights ?? []);
  if (weights.length !== periodCount)
    return err('VALIDATION_FAILED', `Enter one weight for each of the ${periodCount} periods.`);
  return splitByWeights(totalMinor, weights);
}

// Utilization, roll-ups and alert thresholds ------------------------------------------------------

/** Utilization = (encumbered + actual) / authorized in basis points; pending requests are shown separately. */
export function utilizationBps(b: Pick<BucketBalances, 'authorized' | 'encumbered' | 'actual'>) {
  if (b.authorized <= 0) return 0;
  return Math.floor(((b.encumbered + b.actual) * 10_000) / b.authorized);
}

/** Thresholds (percent) newly reached between two utilization readings. */
export function thresholdsReached(
  beforeBps: number,
  afterBps: number,
  thresholdsPct: readonly number[],
): number[] {
  return thresholdsPct.filter((t) => beforeBps < t * 100 && afterBps >= t * 100);
}

export interface SubtreeTotals {
  heldMinor: number;
  preEncumberedMinor: number;
  encumberedMinor: number;
  actualMinor: number;
}

/**
 * Company-wide Available for a budget and everything below it: authorized − held − pre-encumbered −
 * encumbered − actual summed over the subtree. Money allocated to children is counted once (it is
 * still available until a child holds, commits or spends it); held money (earmarks, reserve holds)
 * cannot be spent.
 */
export function companyAvailable(authorizedMinor: number, subtree: SubtreeTotals): number {
  return (
    authorizedMinor -
    subtree.heldMinor -
    subtree.preEncumberedMinor -
    subtree.encumberedMinor -
    subtree.actualMinor
  );
}

/**
 * Roll-up utilization of a budget: (encumbered + actual of the budget and everything below it) /
 * its authorized, so a parent's owner sees (and is alerted on) spend in the children, counted once.
 */
export function rollupUtilizationBps(authorizedMinor: number, subtree: SubtreeTotals): number {
  return utilizationBps({
    authorized: authorizedMinor,
    encumbered: subtree.encumberedMinor,
    actual: subtree.actualMinor,
  });
}

export interface AvailableExplanation {
  companyWideMinor: number;
  underRulesMinor: number;
  differenceMinor: number;
  /** Why the two differ, largest first; empty when they are equal. */
  reasons: {
    kind: 'allocated_to_children' | 'held' | 'basis_excludes' | 'children_spend';
    amountMinor: number;
  }[];
}

/** The difference between company-wide Available and "Available under this budget's rules", explained. */
export function explainAvailable(
  own: BucketBalances,
  control: ControlSettings,
  subtree: SubtreeTotals,
): AvailableExplanation {
  const companyWide = companyAvailable(own.authorized, subtree);
  const underRules = availableOf(own, control.basis);
  const reasons: AvailableExplanation['reasons'] = [];
  const childrenSpend =
    subtree.heldMinor -
    own.held +
    subtree.preEncumberedMinor -
    own.pre_encumbered +
    subtree.encumberedMinor -
    own.encumbered +
    subtree.actualMinor -
    own.actual;
  if (control.basis.includes('allocated_out') && own.allocated_out)
    reasons.push({ kind: 'allocated_to_children', amountMinor: own.allocated_out });
  if (childrenSpend) reasons.push({ kind: 'children_spend', amountMinor: -childrenSpend });
  const excluded = (['held', 'pre_encumbered', 'encumbered', 'actual'] as const)
    .filter((b) => !control.basis.includes(b))
    .reduce((s, b) => s + own[b], 0);
  if (excluded) reasons.push({ kind: 'basis_excludes', amountMinor: -excluded });
  return {
    companyWideMinor: companyWide,
    underRulesMinor: underRules,
    differenceMinor: companyWide - underRules,
    reasons: reasons.sort((a, b) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor)),
  };
}

// Limits ------------------------------------------------------------------------------------------

export const LIMIT_KINDS = ['category', 'per_event', 'per_person'] as const;
export type LimitKind = (typeof LIMIT_KINDS)[number];

export interface BudgetLimit {
  id: string;
  kind: LimitKind;
  categoryCode: string | null;
  /** Location the limit applies to (null: every location). */
  orgUnitId: string | null;
  amountMinor: number;
  mode: 'hard' | 'soft';
}

export interface SpendFacts {
  amountMinor: number;
  categoryCode?: string | null;
  orgUnitId?: string | null;
  plannedAttendance?: number | null;
  /** Already committed and spent in the request's category on this budget (from Phase 5 requests). */
  categoryCommittedMinor?: number;
}

export interface LimitFinding {
  limitId: string;
  kind: LimitKind;
  outcome: 'warning' | 'blocked';
  limitMinor: number;
  valueMinor: number;
  message: string;
}

/** Category, per-event and per-person limits that a request would break. */
export function checkLimits(limits: readonly BudgetLimit[], facts: SpendFacts): LimitFinding[] {
  const out: LimitFinding[] = [];
  for (const l of limits) {
    if (l.orgUnitId && facts.orgUnitId && l.orgUnitId !== facts.orgUnitId) continue;
    if (l.orgUnitId && !facts.orgUnitId) continue;
    let value: number | null = null;
    let message = '';
    if (l.kind === 'category') {
      if (!facts.categoryCode || l.categoryCode !== facts.categoryCode) continue;
      value = (facts.categoryCommittedMinor ?? 0) + facts.amountMinor;
      message = `The ${l.categoryCode.replace(/_/g, ' ')} limit on this budget would be exceeded.`;
    } else if (l.kind === 'per_event') {
      if (l.categoryCode && l.categoryCode !== facts.categoryCode) continue;
      value = facts.amountMinor;
      message = 'The amount is above the per-event limit.';
    } else {
      if (!facts.plannedAttendance || facts.plannedAttendance <= 0) continue;
      if (l.categoryCode && l.categoryCode !== facts.categoryCode) continue;
      value = Math.ceil(facts.amountMinor / facts.plannedAttendance);
      message = 'The cost per planned attendee is above the per-person limit.';
    }
    if (value > l.amountMinor) {
      out.push({
        limitId: l.id,
        kind: l.kind,
        outcome: l.mode === 'hard' ? 'blocked' : 'warning',
        limitMinor: l.amountMinor,
        valueMinor: value,
        message,
      });
    }
  }
  return out;
}

// Plan tie-out ------------------------------------------------------------------------------------

export interface PlanTieOutRow {
  key: string;
  planMinor: number;
  rootAuthorizedMinor: number;
  savingsMinor: number;
}

/**
 * Root budgets tie to the controlling plan version: plan total = root authorized + money returned to
 * savings, per line and in total.
 */
export function planTieOut(rows: readonly PlanTieOutRow[]): {
  planTotalMinor: number;
  rootAuthorizedMinor: number;
  savingsMinor: number;
  differenceMinor: number;
  tiedOut: boolean;
  mismatches: (PlanTieOutRow & { differenceMinor: number })[];
} {
  const sum = (f: (r: PlanTieOutRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const planTotal = sum((r) => r.planMinor);
  const roots = sum((r) => r.rootAuthorizedMinor);
  const savings = sum((r) => r.savingsMinor);
  const mismatches = rows
    .map((r) => ({ ...r, differenceMinor: r.planMinor - r.rootAuthorizedMinor - r.savingsMinor }))
    .filter((r) => r.differenceMinor !== 0);
  return {
    planTotalMinor: planTotal,
    rootAuthorizedMinor: roots,
    savingsMinor: savings,
    differenceMinor: planTotal - roots - savings,
    tiedOut: mismatches.length === 0 && planTotal === roots + savings,
    mismatches,
  };
}

/** Roll-forward amount for a cloned budget: copy or scale by percent (rounded down so children always fit). */
export function rollForwardAmount(sourceMinor: number, scalePct: number): number {
  if (sourceMinor <= 0) return 0;
  return Number((BigInt(sourceMinor) * BigInt(Math.round(scalePct * 100))) / 10_000n);
}
