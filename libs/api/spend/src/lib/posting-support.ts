import { BudgetViews } from '@bf/api/budgets';
import { ApiProblem, type RequestActor } from '@bf/api/core';
import { ledgerLines, type Tx } from '@bf/api/db';
import { LedgerReads, LedgerService, toPostingBudget, type PostingBudget } from '@bf/api/ledger';
import type { BucketBalances, CurrencyCode, JournalDraft, PostingContext } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { BudgetRow } from '@bf/api/approvals';

export const todayUtc = () => new Date().toISOString().slice(0, 10);

export type LockedBudget = PostingBudget & { balances: BucketBalances; row: BudgetRow };

export interface PostCtx {
  actor: Pick<RequestActor, 'tenantId' | 'personId' | 'subject' | 'reportingCurrency'>;
  command: string;
  requestId: string | null;
  idempotencyKey: string | null;
}

export interface Remainder {
  transactionMinor: number;
  budgetMinor: number;
  reportingMinor: number;
}

/** Reads and posting helpers shared by requests, commitments and event funding. */
@Injectable()
export class PostingSupport {
  constructor(
    readonly reads: LedgerReads,
    private readonly ledger: LedgerService,
    private readonly views: BudgetViews,
  ) {}

  async budget(tx: Tx, id: string): Promise<BudgetRow | undefined> {
    return (await this.reads.budgetRows(tx, [id])).get(id);
  }

  /** Locks the budgets (parent before child, then id) and returns them with fresh balances. */
  async lock(tx: Tx, ids: readonly string[]): Promise<Map<string, LockedBudget>> {
    const unique = [...new Set(ids)];
    await this.reads.lockBudgets(tx, unique);
    const rows = await this.reads.budgetRows(tx, unique);
    const balances = await this.reads.balances(tx, unique);
    const out = new Map<string, LockedBudget>();
    for (const id of unique) {
      const row = rows.get(id);
      if (!row) throw ApiProblem.notFound('budget');
      out.set(id, { ...toPostingBudget(row), balances: balances.get(id)!.budget, row });
    }
    return out;
  }

  async context(
    tx: Tx,
    budget: Pick<BudgetRow, 'fiscalYearId'>,
    reportingCurrency: CurrencyCode,
    accountingDate = todayUtc(),
  ): Promise<PostingContext> {
    return {
      reportingCurrency,
      rates: await this.reads.planRates(tx, budget.fiscalYearId),
      accountingDate,
    };
  }

  /** Posts the journals, then raises owner alerts for thresholds the touched budgets newly reached. */
  async post(
    tx: Tx,
    journals: readonly JournalDraft[],
    fiscalYearId: string | null,
    c: PostCtx,
  ): Promise<string[]> {
    const budgetIds = [
      ...new Set(journals.flatMap((j) => j.lines.flatMap((l) => (l.budgetId ? [l.budgetId] : [])))),
    ];
    const before = await this.views.utilizations(tx, budgetIds);
    const ids: string[] = [];
    for (const j of journals) {
      ids.push(
        await this.ledger.post(tx, j, {
          actor: c.actor,
          command: c.command,
          fiscalYearId,
          requestId: c.requestId,
          idempotencyKey: c.idempotencyKey,
        }),
      );
    }
    await this.views.emitThresholds(tx, c.actor, before, budgetIds);
    return ids;
  }

  /**
   * What a commitment still has posted in a bucket on one budget, from the ledger: the transaction
   * amount counts only lines in the commitment's currency (true-up lines carry budget value only).
   */
  async remaining(
    tx: Tx,
    commitmentId: string,
    budgetId: string,
    account: 'pre_encumbered' | 'encumbered',
    currency: string,
  ): Promise<Remainder> {
    const [r] = await tx
      .select({
        t: sql<string>`coalesce(sum(case when ${ledgerLines.transactionCurrency} = ${currency} then ${ledgerLines.transactionAmountMinor} else 0 end), 0)`,
        b: sql<string>`coalesce(sum(${ledgerLines.budgetAmountMinor}), 0)`,
        r: sql<string>`coalesce(sum(${ledgerLines.reportingAmountMinor}), 0)`,
      })
      .from(ledgerLines)
      .where(
        and(
          eq(ledgerLines.commitmentId, commitmentId),
          eq(ledgerLines.budgetId, budgetId),
          eq(ledgerLines.account, account),
        ),
      );
    return { transactionMinor: Number(r.t), budgetMinor: Number(r.b), reportingMinor: Number(r.r) };
  }

  /** Same for request-level postings without a commitment row (event funding requests). */
  async requestRemaining(tx: Tx, requestId: string, budgetId: string): Promise<Remainder> {
    const [r] = await tx
      .select({
        t: sql<string>`coalesce(sum(${ledgerLines.transactionAmountMinor}), 0)`,
        b: sql<string>`coalesce(sum(${ledgerLines.budgetAmountMinor}), 0)`,
        r: sql<string>`coalesce(sum(${ledgerLines.reportingAmountMinor}), 0)`,
      })
      .from(ledgerLines)
      .where(
        and(
          eq(ledgerLines.requestId, requestId),
          eq(ledgerLines.budgetId, budgetId),
          eq(ledgerLines.account, 'pre_encumbered'),
        ),
      );
    return { transactionMinor: Number(r.t), budgetMinor: Number(r.b), reportingMinor: Number(r.r) };
  }
}
