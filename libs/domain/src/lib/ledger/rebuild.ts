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

export interface HierarchyMismatch {
  parentId: string;
  allocatedOutReportingMinor: number;
  childrenAuthorizedReportingMinor: number;
}

/** A parent's allocated out equals its children's authorized (compared in reporting currency at plan rate). */
export function checkHierarchy(
  budgets: readonly { id: string; parentId: string | null }[],
  totals: ReadonlyMap<
    string,
    { allocatedOutReportingMinor: number; authorizedReportingMinor: number }
  >,
): HierarchyMismatch[] {
  const children = new Map<string, string[]>();
  for (const b of budgets)
    if (b.parentId) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b.id]);
  const out: HierarchyMismatch[] = [];
  for (const b of budgets) {
    const own = totals.get(b.id)?.allocatedOutReportingMinor ?? 0;
    const kids = (children.get(b.id) ?? []).reduce(
      (acc, id) => acc + (totals.get(id)?.authorizedReportingMinor ?? 0),
      0,
    );
    if (own !== kids)
      out.push({
        parentId: b.id,
        allocatedOutReportingMinor: own,
        childrenAuthorizedReportingMinor: kids,
      });
  }
  return out;
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
