import { todayUtc } from '@bf/api/core';
import { tenants, type Tx } from '@bf/api/db';
import { LedgerReads, ThresholdAlerts, toPostingBudget } from '@bf/api/ledger';
import type { BudgetImpact } from '@bf/contracts';
import {
  acceptsNewActivity,
  availableOf,
  checkSpend,
  companyAvailable,
  type CurrencyCode,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { BudgetRow } from './approval-handlers';

const pct = (part: number, whole: number) => (whole <= 0 ? 0 : Math.round((part * 100) / whole));

/**
 * The budget-impact card (approval inbox, request details, additional-fund form, actionable email):
 * available under the budget's rules before and after, the company-wide Available, run rate, and the
 * soft warning or hard block the request meets. Amounts are in the budget currency.
 */
@Injectable()
export class BudgetImpactService {
  constructor(
    private readonly reads: LedgerReads,
    private readonly subtrees: ThresholdAlerts,
  ) {}

  async impact(
    tx: Tx,
    budget: BudgetRow,
    thisMinor: number,
    opts: { pendingIncludesThis: boolean; consumesAvailable?: boolean; today?: string },
  ): Promise<BudgetImpact> {
    const posting = toPostingBudget(budget);
    const pair = (await this.reads.balances(tx, [budget.id])).get(budget.id)!;
    const b = pair.budget;
    const ccy = budget.currency as CurrencyCode;
    // Company-wide Available is the dashboards' figure: authorized less everything held, pending,
    // approved and spent in the budget and its whole subtree, in the reporting currency, which is
    // the only currency a subtree of mixed-currency budgets can be summed in. It is the same
    // calculation the budget page and the health dashboard use (explainAvailable, companyAvailable).
    const subtree = (await this.subtrees.subtreeTotals(tx, [budget.id])).get(budget.id)!;
    const companyWide = companyAvailable(pair.reporting.authorized, subtree);
    const [tenant] = await tx
      .select({ reportingCurrency: tenants.reportingCurrency })
      .from(tenants)
      .where(eq(tenants.id, budget.tenantId));
    const m = (amountMinor: number) => ({ amountMinor, currency: ccy });
    const available = availableOf(b, posting.control.basis);
    const consumes = opts.consumesAvailable !== false;
    const before = opts.pendingIncludesThis ? available + thisMinor : available;
    const after = consumes ? before - thisMinor : before;
    const fy = await this.reads.fiscalYear(tx, budget.fiscalYearId);
    const today = opts.today ?? todayUtc();
    const months = (from: string, to: string) =>
      Math.max(
        1,
        (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
          Number(to.slice(5, 7)) -
          Number(from.slice(5, 7)) +
          1,
      );
    const elapsed = Math.min(months(fy.startDate, today), months(fy.startDate, fy.endDate));
    const spent = b.actual + b.encumbered;
    const runRate = Math.round(spent / elapsed);
    const projected = runRate * months(fy.startDate, fy.endDate);
    const status = acceptsNewActivity(budget.status);
    let warning: string | null = null;
    let blocked: string | null = status.ok ? null : status.error.message;
    let blockedCode: string | null = status.ok ? null : status.error.code;
    if (!blocked && consumes) {
      const spend = checkSpend(
        opts.pendingIncludesThis
          ? { ...b, pre_encumbered: Math.max(b.pre_encumbered - thisMinor, 0) }
          : b,
        posting.control,
        thisMinor,
      );
      if (spend.outcome === 'blocked') {
        blocked = 'This is more than the budget has available, even with its tolerance.';
        blockedCode = 'INSUFFICIENT_AVAILABLE';
      } else if (spend.outcome === 'warning') {
        warning =
          'This goes over what the budget has available (within its tolerance or soft control).';
      } else if (b.authorized > 0 && pct(after, b.authorized) < 10) {
        warning = `After approval the budget has less than 10% left (${pct(after, b.authorized)}%).`;
      }
    }
    return {
      budgetId: budget.id,
      budgetName: budget.name,
      budgetStatus: budget.status,
      controlMode: posting.control.mode,
      authorized: m(b.authorized),
      approvedCommitments: m(b.encumbered),
      pending: m(b.pre_encumbered),
      held: m(b.held),
      actual: m(b.actual),
      thisRequest: m(thisMinor),
      availableBefore: m(before),
      availableAfter: m(after),
      companyWideAvailable: { amountMinor: companyWide, currency: tenant.reportingCurrency },
      runRateMonthly: m(runRate),
      projectedYearEnd: m(projected),
      utilizationAfterPct: pct(b.authorized - after, b.authorized),
      warning,
      blocked,
      blockedCode,
    };
  }
}
