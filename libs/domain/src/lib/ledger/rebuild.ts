import { exponentOf, type CurrencyCode } from '../money/currency';
import type { Money } from '../money/money';
import {
  crossRate,
  divRound,
  parseRate,
  RATE_DECIMALS,
  type AppliedRate,
  type FxRate,
} from '../money/rate';
import { verifyTriplet } from '../money/triplet';
import { ok, type Result } from '../result';
import { BUDGET_BUCKETS, NORMAL_SIGN, type BudgetBucket, type LedgerAccount } from './accounts';
import { isRoundingLine } from './journal';
import { budgetRoundingFor } from './postings';

/**
 * Pure comparisons for the nightly ledger rebuild check. The worker recomputes balances from ledger
 * lines, then these functions report drift; nothing is ever auto-repaired.
 */
export interface BalanceRow {
  budgetId: string;
  periodId: string;
  bucket: string;
  budgetMinor: number;
  reportingMinor: number;
}

export interface BalanceDrift {
  budgetId: string;
  periodId: string;
  bucket: string;
  rebuiltBudgetMinor: number;
  cachedBudgetMinor: number;
  rebuiltReportingMinor: number;
  cachedReportingMinor: number;
}

const key = (r: Pick<BalanceRow, 'budgetId' | 'periodId' | 'bucket'>) =>
  `${r.budgetId}|${r.periodId}|${r.bucket}`;

export function compareBalances(
  rebuilt: readonly BalanceRow[],
  cached: readonly BalanceRow[],
): BalanceDrift[] {
  const r = new Map(rebuilt.map((x) => [key(x), x]));
  const c = new Map(cached.map((x) => [key(x), x]));
  const drifts: BalanceDrift[] = [];
  for (const k of new Set([...r.keys(), ...c.keys()])) {
    const a = r.get(k);
    const b = c.get(k);
    const ref = (a ?? b)!;
    const rb = a?.budgetMinor ?? 0;
    const cb = b?.budgetMinor ?? 0;
    const rr = a?.reportingMinor ?? 0;
    const cr = b?.reportingMinor ?? 0;
    if (rb !== cb || rr !== cr) {
      drifts.push({
        budgetId: ref.budgetId,
        periodId: ref.periodId,
        bucket: ref.bucket,
        rebuiltBudgetMinor: rb,
        cachedBudgetMinor: cb,
        rebuiltReportingMinor: rr,
        cachedReportingMinor: cr,
      });
    }
  }
  return drifts.sort((x, y) => key(x).localeCompare(key(y)));
}

export interface NegativeBucket {
  budgetId: string;
  bucket: BudgetBucket;
  balanceMinor: number;
}

export interface OverAllocatedBudget {
  budgetId: string;
  authorizedMinor: number;
  allocatedOutMinor: number;
}

/**
 * From rebuilt balances (signed line sums per budget, period and bucket): every bucket's natural-sign
 * balance over all periods is non-negative, and no budget has allocated out more than it holds.
 */
export function checkBucketBalances(rows: readonly BalanceRow[]): {
  negativeBuckets: NegativeBucket[];
  overAllocatedBudgets: OverAllocatedBudget[];
} {
  const totals = new Map<string, Record<BudgetBucket, number>>();
  for (const r of rows) {
    if (!(BUDGET_BUCKETS as readonly string[]).includes(r.bucket)) continue;
    const bucket = r.bucket as BudgetBucket;
    const t =
      totals.get(r.budgetId) ??
      (Object.fromEntries(BUDGET_BUCKETS.map((b) => [b, 0])) as Record<BudgetBucket, number>);
    t[bucket] += NORMAL_SIGN[bucket] * r.budgetMinor;
    totals.set(r.budgetId, t);
  }
  const negativeBuckets: NegativeBucket[] = [];
  const overAllocatedBudgets: OverAllocatedBudget[] = [];
  for (const [budgetId, t] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const bucket of BUDGET_BUCKETS)
      if (t[bucket] < 0) negativeBuckets.push({ budgetId, bucket, balanceMinor: t[bucket] });
    if (t.allocated_out > t.authorized)
      overAllocatedBudgets.push({
        budgetId,
        authorizedMinor: t.authorized,
        allocatedOutMinor: t.allocated_out,
      });
  }
  return { negativeBuckets, overAllocatedBudgets };
}

export interface HierarchyMismatch {
  parentId: string;
  currency: string;
  allocatedOutMinor: number;
  /** Children's authorized valued in the parent currency at the locked plan rate (rounded half-even for display). */
  childrenAuthorizedAtPlanMinor: number;
  roundingAllowanceMinor: number;
}

export interface HierarchyBudget {
  id: string;
  parentId: string | null;
  currency: CurrencyCode;
  fiscalYearId: string;
}

export interface HierarchyTotals {
  /** Natural-sign allocated out in the budget's own currency. */
  allocatedOutMinor: number;
  /** Natural-sign authorized in the budget's own currency. */
  authorizedMinor: number;
  /** Number of ledger lines on the budget's authorized bucket. */
  authorizedLines: number;
}

const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

/**
 * A parent's allocated out equals its children's authorized, compared in the parent's budget currency
 * at the locked plan rate (bigint arithmetic, no floats). Children may never be worth more than the
 * parent gave up; the parent may have given up more only by rounding: per cross-currency line on a
 * child, one parent minor unit plus one child minor unit valued in the parent currency.
 */
export function checkHierarchy(
  budgets: readonly HierarchyBudget[],
  totals: ReadonlyMap<string, HierarchyTotals>,
  ctx: {
    reportingCurrency: CurrencyCode;
    ratesByFiscalYear: ReadonlyMap<string, readonly FxRate[]>;
  },
): Result<HierarchyMismatch[]> {
  const children = new Map<string, HierarchyBudget[]>();
  for (const b of budgets)
    if (b.parentId) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b]);
  const out: HierarchyMismatch[] = [];
  for (const parent of budgets) {
    const kids = children.get(parent.id) ?? [];
    const ao = BigInt(totals.get(parent.id)?.allocatedOutMinor ?? 0);
    if (kids.length === 0 && ao === 0n) continue;
    const expP = BigInt(exponentOf(parent.currency));
    const maxExpC = BigInt(Math.max(0, ...kids.map((k) => exponentOf(k.currency))));
    const denominator = RATE_SCALE * 10n ** maxExpC;
    let numerator = 0n;
    let allowance = 0n;
    let crossNumerator = 0n;
    for (const kid of kids) {
      const rate = crossRate(
        kid.currency,
        parent.currency,
        ctx.reportingCurrency,
        ctx.ratesByFiscalYear.get(parent.fiscalYearId) ?? [],
        'plan',
      );
      if (!rate.ok) return rate;
      const scaled = parseRate(rate.value.value);
      if (!scaled.ok) return scaled;
      const expC = BigInt(exponentOf(kid.currency));
      const kt = totals.get(kid.id);
      numerator +=
        BigInt(kt?.authorizedMinor ?? 0) * scaled.value * 10n ** expP * 10n ** (maxExpC - expC);
      if (kid.currency !== parent.currency) {
        const unitInParent = divRound(scaled.value * 10n ** expP, RATE_SCALE * 10n ** expC, 'up');
        allowance += BigInt(kt?.authorizedLines ?? 0) * (1n + unitInParent);
        const authorized = BigInt(kt?.authorizedMinor ?? 0);
        crossNumerator +=
          (authorized < 0n ? -authorized : authorized) * 10n ** expP * 10n ** (maxExpC - expC);
      }
    }
    // Cross rates carry 12 decimals, so valuing a child back into the parent currency can be off by
    // 10^-12 per unit converted; that slack (rounded up to whole parent minor units) is not over-funding.
    // Each line's own rounding is re-verified exactly by checkLineTriplet.
    const rateSlack = divRound(crossNumerator, denominator, 'up');
    const surplus = ao * denominator - numerator;
    if (surplus < -rateSlack * denominator || surplus > (allowance + rateSlack) * denominator) {
      out.push({
        parentId: parent.id,
        currency: parent.currency,
        allocatedOutMinor: Number(ao),
        childrenAuthorizedAtPlanMinor: Number(divRound(numerator, denominator, 'half_even')),
        roundingAllowanceMinor: Number(allowance + rateSlack),
      });
    }
  }
  return ok(out);
}

export interface StoredLine {
  id: string;
  journalId: string;
  account: LedgerAccount;
  budgetId: string | null;
  transaction: Money;
  budget: Money | null;
  reporting: Money;
  budgetRate: AppliedRate | null;
  reportingRate: AppliedRate;
  /** Number of lines in the line's journal. */
  journalLineCount: number;
}

export interface TripletMismatch {
  lineId: string;
  journalId: string;
  view: 'budget' | 'reporting' | 'rounding' | 'reversal';
  expectedMinor: number | null;
  storedMinor: number;
}

/**
 * Re-verifies one stored (non-reversal) line: budget and reporting amounts equal a re-conversion of
 * the transaction amount with the stored rates and the rounding the line was posted with. A rounding
 * line absorbs at most half a minor unit per other line of its journal.
 */
export function checkLineTriplet(line: StoredLine): TripletMismatch | null {
  const at = { lineId: line.id, journalId: line.journalId };
  if (isRoundingLine(line)) {
    const bound = Math.ceil((line.journalLineCount - 1) / 2);
    return Math.abs(line.reporting.amountMinor) <= bound
      ? null
      : { ...at, view: 'rounding', expectedMinor: bound, storedMinor: line.reporting.amountMinor };
  }
  const v = verifyTriplet(line, {
    budgetRounding: budgetRoundingFor(line.account, line.transaction.amountMinor),
  });
  if (v.ok) return null;
  const view = v.error.params?.['view'] === 'budget' ? 'budget' : 'reporting';
  const expected = v.error.params?.['expectedMinor'];
  return {
    ...at,
    view,
    expectedMinor: typeof expected === 'number' ? expected : null,
    storedMinor: view === 'budget' ? (line.budget?.amountMinor ?? 0) : line.reporting.amountMinor,
  };
}

export interface PlanTieMismatch {
  planVersionId: string;
  planFundingReportingMinor: number;
  rootAuthorizedReportingMinor: number;
}

/** Root budgets tie to their approved plan version: plan funding equals root authorized. */
export function checkPlanTie(
  rows: readonly {
    planVersionId: string;
    planFundingReportingMinor: number;
    rootAuthorizedReportingMinor: number;
  }[],
): PlanTieMismatch[] {
  return rows.filter((r) => r.planFundingReportingMinor !== r.rootAuthorizedReportingMinor);
}
