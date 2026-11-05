import { commitmentFundingLines, commitments, prepaids, type Tx } from '@bf/api/db';
import { unwrap, type RequestActor } from '@bf/api/core';
import { LedgerReads, LedgerService, toPostingBudget, type PostingBudget } from '@bf/api/ledger';
import {
  CommitmentsService as SpendCommitments,
  PostingSupport,
  type Remainder,
} from '@bf/api/spend';
import {
  applyDelta,
  divRoundHalfEven,
  postSpendMovement,
  splitByWeights,
  type AppliedRate,
  type BucketBalances,
  type CurrencyCode,
  type JournalDraft,
  type StoredRates,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { CommitmentRow } from './actuals-reads';

type LineRow = typeof commitmentFundingLines.$inferSelect;
type Actor = Pick<RequestActor, 'tenantId' | 'personId' | 'subject' | 'reportingCurrency'>;

export interface FundingRemainder {
  budgetId: string;
  line: LineRow | null;
  rem: Remainder;
}

export interface ReliefDraft {
  budget: PostingBudget;
  transactionMinor: number;
  budgetMinor: number;
  journals: JournalDraft[];
}

export interface PostOpts {
  command: string;
  idempotencyKey: string;
  requestId: string | null;
}

const half = (num: bigint, den: bigint) => Number(divRoundHalfEven(num, den));

const storedRates = (c: CommitmentRow, l: LineRow): StoredRates => ({
  budgetRate: {
    type: l.rateType ?? 'plan',
    from: c.currency as CurrencyCode,
    to: (l.budgetCurrency ?? c.currency) as CurrencyCode,
    value: l.budgetRate ?? '1',
    rateIds: l.budgetRateIds ?? [],
  } as AppliedRate,
  reportingRate: {
    type: l.rateType ?? 'plan',
    from: c.currency as CurrencyCode,
    to: (l.reportingCurrency ?? c.currency) as CurrencyCode,
    value: l.reportingRate ?? '1',
    rateIds: l.reportingRateIds ?? [],
  } as AppliedRate,
});

/**
 * Moves a commitment's encumbrance the way Phase 5 posted it: in the commitment's currency at the rates
 * stored on each funding line, pro rata by what each funding budget still has, and the movement that
 * clears a budget relieves exactly the budget amount still posted (no FX drift). Releasing what is left
 * goes through Phase 5, which returns event-funded lines to their funding source.
 */
@Injectable()
export class CommitmentRelief {
  constructor(
    private readonly posting: PostingSupport,
    private readonly spend: SpendCommitments,
    private readonly ledger: LedgerService,
    private readonly ledgerReads: LedgerReads,
  ) {}

  /** Funding budgets of a commitment (by budget id) with what each still has encumbered. */
  async remaining(tx: Tx, c: CommitmentRow): Promise<FundingRemainder[]> {
    const lines = await tx
      .select()
      .from(commitmentFundingLines)
      .where(eq(commitmentFundingLines.commitmentId, c.id))
      .orderBy(asc(commitmentFundingLines.budgetId), asc(commitmentFundingLines.id));
    const byBudget = new Map<string, LineRow | null>();
    for (const l of lines) if (!byBudget.has(l.budgetId)) byBudget.set(l.budgetId, l);
    if (byBudget.size === 0) byBudget.set(c.budgetId, null);
    const out: FundingRemainder[] = [];
    for (const [budgetId, line] of byBudget)
      out.push({
        budgetId,
        line,
        rem: await this.posting.remaining(tx, c.id, budgetId, 'encumbered', c.currency),
      });
    return out;
  }

  /** The commitment as first posted in its budgets' currency (the tolerance basis), when the lines record it. */
  async budgetTotal(tx: Tx, c: CommitmentRow): Promise<number | null> {
    const lines = await tx
      .select({ b: commitmentFundingLines.budgetAmountMinor })
      .from(commitmentFundingLines)
      .where(eq(commitmentFundingLines.commitmentId, c.id));
    if (lines.length === 0 || lines.some((l) => l.b === null)) return null;
    return lines.reduce((s, l) => s + (l.b ?? 0), 0);
  }

  /** A budget-currency amount in the commitment's currency, at the ratio the commitment was posted with. */
  toCommitmentMinor(c: CommitmentRow, budgetTotal: number, budgetMinor: number): number {
    if (budgetTotal === 0) return 0;
    return half(BigInt(c.amountMinor) * BigInt(budgetMinor), BigInt(budgetTotal));
  }

  toBudgetMinor(c: CommitmentRow, budgetTotal: number, commitmentMinor: number): number {
    if (c.amountMinor === 0) return 0;
    return half(BigInt(budgetTotal) * BigInt(commitmentMinor), BigInt(c.amountMinor));
  }

  /**
   * Drafts moving `amount` (commitment currency, or everything left) out of encumbered. The caller has
   * locked the budgets and passes their current balances; nothing is posted here.
   */
  async drafts(
    tx: Tx,
    actor: Actor,
    c: CommitmentRow,
    rems: FundingRemainder[],
    kind: 'consume' | 'release_encumbrance',
    amount: number | 'all',
    provenance: { actualId?: string | null },
    accountingDate: string,
    balancesOf: (budgetId: string) => BucketBalances,
  ): Promise<ReliefDraft[]> {
    const live = rems.filter((r) => r.rem.transactionMinor > 0);
    const totalTx = live.reduce((s, r) => s + r.rem.transactionMinor, 0);
    const want = amount === 'all' ? totalTx : Math.min(amount, totalTx);
    if (want <= 0) return [];
    const parts = unwrap(
      splitByWeights(
        want,
        live.map((r) => r.rem.transactionMinor),
      ),
    );
    const rows = await this.ledgerReads.budgetRows(
      tx,
      live.map((r) => r.budgetId),
    );
    const out: ReliefDraft[] = [];
    for (const [i, r] of live.entries()) {
      if (parts[i] === 0) continue;
      const budget = toPostingBudget(rows.get(r.budgetId)!);
      const moved = unwrap(
        postSpendMovement(
          {
            kind,
            budget: { ...budget, balances: balancesOf(budget.id) },
            amount: { amountMinor: parts[i], currency: c.currency as CurrencyCode },
            journalType: 'commitment',
            rates: r.line ? storedRates(c, r.line) : undefined,
            remaining: r.rem,
            provenance: {
              commitmentId: c.id,
              requestId: c.requestId,
              eventId: c.eventId,
              contributionId: r.line?.contributionRequestId ?? null,
              actualId: provenance.actualId ?? null,
            },
          },
          {
            reportingCurrency: actor.reportingCurrency,
            rates: await this.ledgerReads.planRates(tx, budget.fiscalYearId),
            accountingDate,
          },
        ),
      );
      out.push({
        budget,
        transactionMinor: parts[i],
        budgetMinor: moved.budgetAmount.amountMinor,
        journals: moved.journals,
      });
    }
    return out;
  }

  /** Posts drafts in order and returns the journal ids. */
  async post(tx: Tx, actor: Actor, drafts: ReliefDraft[], opts: PostOpts): Promise<string[]> {
    const ids: string[] = [];
    for (const d of drafts)
      for (const j of d.journals)
        ids.push(
          await this.ledger.post(tx, j, {
            actor,
            command: opts.command,
            fiscalYearId: d.budget.fiscalYearId,
            requestId: opts.requestId,
            idempotencyKey: opts.idempotencyKey,
          }),
        );
    return ids;
  }

  /**
   * Releases everything still encumbered and marks the commitment released (Phase 5's release when it
   * has funding lines, so event-funded lines go back to their source's hold).
   */
  async releaseRest(
    tx: Tx,
    actor: Actor,
    c: CommitmentRow,
    accountingDate: string,
    opts: PostOpts,
  ): Promise<string[]> {
    const rems = await this.remaining(tx, c);
    if (rems.every((r) => r.rem.transactionMinor <= 0)) return [];
    if (rems.some((r) => r.line)) {
      const r = await this.spend.release(
        tx,
        {
          actor,
          command: opts.command,
          requestId: opts.requestId,
          idempotencyKey: opts.idempotencyKey,
        },
        c.id,
      );
      return r.journalIds;
    }
    await this.ledgerReads.lockBudgets(tx, [c.budgetId]);
    const balances = await this.ledgerReads.balances(tx, [c.budgetId]);
    const drafts = await this.drafts(
      tx,
      actor,
      c,
      rems,
      'release_encumbrance',
      'all',
      {},
      accountingDate,
      (id) => balances.get(id)!.budget,
    );
    const released = drafts.reduce((s, d) => s + d.transactionMinor, 0);
    const ids = await this.post(tx, actor, drafts, opts);
    await tx
      .update(commitments)
      .set({ releasedMinor: c.releasedMinor + released, updatedAt: new Date() })
      .where(eq(commitments.id, c.id));
    return ids;
  }

  /**
   * Recognizes every deposit of the commitment still outstanding as a prepaid (a deposit already paid is
   * spent once the commitment closes). Returns the journal ids and the budget-currency amount consumed.
   */
  async consumeOutstandingPrepaids(
    tx: Tx,
    actor: Actor,
    c: CommitmentRow,
    accountingDate: string,
    opts: PostOpts,
  ): Promise<{ journalIds: string[]; budgetMinor: number; transactionMinor: number }> {
    const pp = await tx
      .select()
      .from(prepaids)
      .where(eq(prepaids.commitmentId, c.id))
      .orderBy(asc(prepaids.id))
      .for('update');
    const outstanding = pp.reduce((s, p) => s + Math.max(p.amountMinor - p.consumedMinor, 0), 0);
    if (outstanding <= 0) return { journalIds: [], budgetMinor: 0, transactionMinor: 0 };
    const rems = await this.remaining(tx, c);
    const total =
      (await this.budgetTotal(tx, c)) ?? rems.reduce((s, r) => s + r.rem.budgetMinor, 0);
    const budgetIds = rems.map((r) => r.budgetId);
    await this.ledgerReads.lockBudgets(tx, budgetIds);
    const balances = await this.ledgerReads.balances(tx, budgetIds);
    const drafts = await this.drafts(
      tx,
      actor,
      c,
      rems,
      'consume',
      this.toCommitmentMinor(c, total, outstanding),
      {},
      accountingDate,
      (id) => balances.get(id)!.budget,
    );
    for (const p of pp)
      if (p.amountMinor > p.consumedMinor)
        await tx
          .update(prepaids)
          .set({ consumedMinor: p.amountMinor, recognizedThrough: accountingDate })
          .where(eq(prepaids.id, p.id));
    const journalIds = await this.post(tx, actor, drafts, opts);
    return {
      journalIds,
      budgetMinor: drafts.reduce((s, d) => s + d.budgetMinor, 0),
      transactionMinor: drafts.reduce((s, d) => s + d.transactionMinor, 0),
    };
  }
}

/** Budget-line deltas of a set of drafts on one budget (for availability checks). */
export function journalDeltas(journals: JournalDraft[], budgetId: string) {
  return journals.flatMap((d) =>
    d.lines
      .filter((l) => l.budgetId === budgetId)
      .map((l) => ({ account: l.account, budgetAmountMinor: l.budget!.amountMinor })),
  );
}

export function applyJournals(
  balances: BucketBalances,
  journals: JournalDraft[],
  budgetId: string,
) {
  return applyDelta(balances, journalDeltas(journals, budgetId));
}
