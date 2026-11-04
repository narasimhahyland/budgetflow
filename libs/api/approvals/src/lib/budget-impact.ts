import type { Tx } from '@bf/api/db';
import { LedgerReads, toPostingBudget } from '@bf/api/ledger';
import type { BudgetImpact } from '@bf/contracts';
import { acceptsNewActivity, availableOf, checkSpend, type CurrencyCode } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import type { BudgetRow } from './approval-handlers';

const pct = (part: number, whole: number) => (whole <= 0 ? 0 : Math.round((part * 100) / whole));

/**
 * The budget-impact card (approval inbox, request details, additional-fund form, actionable email):
 * available under the budget's rules before and after, the company-wide Available, run rate, and the
 * soft warning or hard block the request meets. Amounts are in the budget currency.
 */
@Injectable()
export class BudgetImpactService {
  constructor(private readonly reads: LedgerReads) {}

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
    const m = (amountMinor: number) => ({ amountMinor, currency: ccy });
    const available = availableOf(b, posting.control.basis);
    const consumes = opts.consumesAvailable !== false;
    const before = opts.pendingIncludesThis ? available + thisMinor : available;
    const after = consumes ? before - thisMinor : before;
    const fy = await this.reads.fiscalYear(tx, budget.fiscalYearId);
    const today = opts.today ?? new Date().toISOString().slice(0, 10);
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
      companyWideAvailable: m(b.authorized - b.pre_encumbered - b.encumbered - b.actual),
      runRateMonthly: m(runRate),
      projectedYearEnd: m(projected),
      utilizationAfterPct: pct(b.authorized - after, b.authorized),
      warning,
      blocked,
      blockedCode,
    };
  }
}
