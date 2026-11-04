import {
  accruals,
  actualMatches,
  actuals,
  commitments,
  ledgerLines,
  prepaids,
  requests,
  type Tx,
} from '@bf/api/db';
import { ApiProblem, unwrap, type RequestActor } from '@bf/api/core';
import { LedgerReads, LedgerService, toPostingBudget, type PostingBudget } from '@bf/api/ledger';
import {
  acceptsNewActivity,
  allowsCommitmentCompletion,
  applyDelta,
  availableOf,
  buildTriplet,
  checkFit,
  checkMatchable,
  checkMatchAvailability,
  checkNotOverdrawn,
  classifyFit,
  commitmentMachine,
  DEFAULT_MATCH_TOLERANCE_BPS,
  divRoundHalfEven,
  postActualCharge,
  postCommitmentMovement,
  postFxEffect,
  reverseJournal,
  type BucketBalances,
  type CommitmentStatus,
  type CurrencyCode,
  type JournalDraft,
  type JournalLine,
  type PostingContext,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { ActualsReads, type ActualRow, type CommitmentRow } from './actuals-reads';

export interface MatchPartInput {
  commitmentId?: string;
  budgetId?: string;
  amountMinor?: number;
  final?: boolean;
}

export interface MatchOptions {
  rule:
    | 'reference'
    | 'event_cost_center'
    | 'vendor_amount'
    | 'mapping_rule'
    | 'original_reference'
    | 'manual';
  prepaid?: { serviceStart: string; serviceEnd: string; nonRefundable?: boolean };
  confirmNotDuplicate?: boolean;
  toleranceBps?: number;
  /** Run every check without writing (batch posting: the ledger guards reject journals written in savepoints). */
  dryRun?: boolean;
  command: string;
  idempotencyKey: string;
  requestId: string | null;
}

type Actor = Pick<RequestActor, 'tenantId' | 'personId' | 'subject' | 'reportingCurrency'>;

const half = (num: bigint, den: bigint) => Number(divRoundHalfEven(num, den));

/** Journal line rows to domain lines (for reversals). */
function domainLines(rows: (typeof ledgerLines.$inferSelect)[]): (JournalLine & { id: string })[] {
  return rows.map((l) => ({
    id: l.id,
    budgetId: l.budgetId,
    account: l.account,
    legalEntityId: l.legalEntityId,
    costCenterId: l.costCenterId,
    glAccountId: l.glAccountId,
    eventCode: l.eventCode,
    transaction: {
      amountMinor: l.transactionAmountMinor,
      currency: l.transactionCurrency as CurrencyCode,
    },
    budget:
      l.budgetCurrency && l.budgetAmountMinor !== null
        ? { amountMinor: l.budgetAmountMinor, currency: l.budgetCurrency as CurrencyCode }
        : null,
    reporting: {
      amountMinor: l.reportingAmountMinor,
      currency: l.reportingCurrency as CurrencyCode,
    },
    budgetRate:
      l.budgetRateType && l.budgetRate && l.budgetCurrency
        ? {
            type: l.budgetRateType,
            from: l.transactionCurrency as CurrencyCode,
            to: l.budgetCurrency as CurrencyCode,
            value: l.budgetRate,
            rateIds: l.budgetRateIds ?? [],
          }
        : null,
    reportingRate: {
      type: l.reportingRateType,
      from: l.transactionCurrency as CurrencyCode,
      to: l.reportingCurrency as CurrencyCode,
      value: l.reportingRate,
      rateIds: l.reportingRateIds,
    },
    planVersionId: l.planVersionId,
    commitmentId: l.commitmentId,
    eventId: l.eventId,
    contributionId: l.contributionId,
    actualId: l.actualId,
    requestId: l.requestId,
    approvalId: l.approvalId,
    importLineId: l.importLineId,
  }));
}

/**
 * Posts and reverses matches inside the caller's transaction (callers own the idempotency key and the
 * audit entry). Ordered locks: the actual, commitments by id, then budgets parent-before-child.
 * - Charge: Dr actual / Cr obligations in the transaction currency at the locked plan rate.
 * - Relief: Dr obligations / Cr encumbered in the budget currency, never more than the commitment
 *   still has encumbered, so relief reuses the amounts posted on the commitment (no FX drift).
 * - FX effect (actual rate minus plan rate) on counter accounts only, proportional to the part matched.
 * - Matching a commitment auto-reverses its posted accruals (an accrual never consumes twice).
 */
@Injectable()
export class MatchEngine {
  constructor(
    private readonly ledger: LedgerService,
    private readonly ledgerReads: LedgerReads,
    private readonly reads: ActualsReads,
  ) {}

  async lockActual(tx: Tx, actualId: string): Promise<ActualRow> {
    const [a] = await tx.select().from(actuals).where(eq(actuals.id, actualId)).for('update');
    if (!a) throw ApiProblem.notFound('actual');
    return a;
  }

  /** Commitment amount in the budget currency at the locked plan rate (the tolerance basis). */
  commitmentTotal(
    c: CommitmentRow,
    budget: PostingBudget,
    ctx: Pick<PostingContext, 'reportingCurrency' | 'rates'>,
  ): number {
    const t = buildTriplet(
      { amountMinor: c.amountMinor, currency: c.currency as CurrencyCode },
      {
        budgetCurrency: budget.currency,
        reportingCurrency: ctx.reportingCurrency,
        rates: ctx.rates,
      },
    );
    return t.ok ? t.value.budget.amountMinor : c.amountMinor;
  }

  /** A budget-currency amount expressed in the commitment's own currency (for its consumed and released figures). */
  async toCommitmentMinor(
    tx: Tx,
    actor: Actor,
    c: CommitmentRow,
    budgetMinor: number,
  ): Promise<number> {
    const row = (await this.ledgerReads.budgetRows(tx, [c.budgetId])).get(c.budgetId)!;
    const budget = toPostingBudget(row);
    const total = this.commitmentTotal(c, budget, {
      reportingCurrency: actor.reportingCurrency,
      rates: await this.ledgerReads.planRates(tx, budget.fiscalYearId),
    });
    return total === 0 ? 0 : half(BigInt(c.amountMinor) * BigInt(budgetMinor), BigInt(total));
  }

  /** An amount in the commitment's currency expressed in its budget's currency at the locked plan rate. */
  async toBudgetMinor(
    tx: Tx,
    actor: Actor,
    c: CommitmentRow,
    commitmentMinor: number,
  ): Promise<number> {
    if (commitmentMinor === 0 || c.amountMinor === 0) return 0;
    const row = (await this.ledgerReads.budgetRows(tx, [c.budgetId])).get(c.budgetId)!;
    const budget = toPostingBudget(row);
    const total = this.commitmentTotal(c, budget, {
      reportingCurrency: actor.reportingCurrency,
      rates: await this.ledgerReads.planRates(tx, budget.fiscalYearId),
    });
    return half(BigInt(total) * BigInt(commitmentMinor), BigInt(c.amountMinor));
  }

  /** Deposits matched as prepaids and not yet recognized, per commitment (budget currency). */
  async prepaidOutstanding(tx: Tx, commitmentIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (commitmentIds.length === 0) return out;
    const rows = await tx
      .select()
      .from(prepaids)
      .where(inArray(prepaids.commitmentId, [...commitmentIds]));
    for (const p of rows)
      out.set(p.commitmentId, (out.get(p.commitmentId) ?? 0) + p.amountMinor - p.consumedMinor);
    return out;
  }

  /** Approved over-budget amount for this actual on a budget (0 when none). */
  private async approvedExcess(tx: Tx, a: ActualRow, budgetId: string): Promise<number> {
    if (!a.overBudgetRequestId) return 0;
    const [r] = await tx.select().from(requests).where(eq(requests.id, a.overBudgetRequestId));
    return r && r.status === 'approved' && r.budgetId === budgetId ? (r.approvedMinor ?? 0) : 0;
  }

  async match(
    tx: Tx,
    actor: Actor,
    actualId: string,
    parts: MatchPartInput[],
    opts: MatchOptions,
  ): Promise<{ journalIds: string[] }> {
    const a = await this.lockActual(tx, actualId);
    if (a.duplicateOfActualId && !opts.confirmNotDuplicate) {
      throw new ApiProblem(
        409,
        'ACTUAL_DUPLICATE_FLAGGED',
        'This line looks like a duplicate of an actual from another source. Confirm it is not a duplicate before matching.',
        { duplicateOfActualId: a.duplicateOfActualId },
      );
    }
    const sign = a.transactionAmountMinor < 0 ? -1 : 1;
    const totalAbs = Math.abs(a.transactionAmountMinor);
    const currency = a.transactionCurrency as CurrencyCode;
    const commitmentIds = [
      ...new Set(parts.map((p) => p.commitmentId).filter((x): x is string => Boolean(x))),
    ].sort();
    const cRows = commitmentIds.length
      ? await tx
          .select()
          .from(commitments)
          .where(inArray(commitments.id, commitmentIds))
          .orderBy(asc(commitments.id))
          .for('update')
      : [];
    const cById = new Map(cRows.map((c) => [c.id, c]));
    for (const id of commitmentIds) if (!cById.has(id)) throw ApiProblem.notFound('commitment');
    const budgetIds = parts.map((p) =>
      p.commitmentId ? cById.get(p.commitmentId)!.budgetId : p.budgetId!,
    );
    await this.ledgerReads.lockBudgets(tx, budgetIds);
    const bRows = await this.ledgerReads.budgetRows(tx, budgetIds);
    for (const id of budgetIds) if (!bRows.has(id)) throw ApiProblem.notFound('budget');
    const balances = new Map<string, BucketBalances>(
      [...(await this.ledgerReads.balances(tx, budgetIds)).entries()].map(([k, v]) => [
        k,
        v.budget,
      ]),
    );
    const cBal = await this.reads.commitmentBalances(tx, commitmentIds);
    const relieved = await this.prepaidOutstanding(tx, commitmentIds);
    const tolerance = opts.toleranceBps ?? DEFAULT_MATCH_TOLERANCE_BPS;
    let matchedAbs = Math.abs(a.matchedMinor);
    let status = a.matchStatus;
    const matchedBefore = matchedAbs;
    const journalIds: string[] = [];
    let lastMatchId: string | null = null;
    let budgetSum = a.budgetAmountMinor ?? 0;
    let firstBudget: { id: string; currency: string; commitmentId: string | null } | null = null;

    for (const [i, p] of parts.entries()) {
      const left = totalAbs - matchedAbs;
      const amountAbs = p.amountMinor ?? left;
      unwrap(
        checkMatchable({
          matchStatus: status,
          amountMinor: a.transactionAmountMinor,
          matchedMinor: matchedAbs,
          requestedMinor: amountAbs,
        }),
      );
      const row = bRows.get(budgetIds[i])!;
      const budget = toPostingBudget(row);
      if (budget.legalEntityId !== a.legalEntityId) {
        throw new ApiProblem(
          409,
          'ACTUAL_ENTITY_MISMATCH',
          'The actual belongs to a different legal entity than the budget. Cross-entity spend goes through an intercompany recharge.',
          { actualEntityId: a.legalEntityId, budgetEntityId: budget.legalEntityId },
        );
      }
      const c = p.commitmentId ? cById.get(p.commitmentId)! : null;
      if (c) {
        if (!allowsCommitmentCompletion(budget.status))
          throw new ApiProblem(409, 'BUDGET_CLOSED', 'This budget no longer accepts actuals.');
      } else if (sign > 0) {
        unwrap(acceptsNewActivity(budget.status));
      }
      const ctx: PostingContext = {
        reportingCurrency: actor.reportingCurrency,
        rates: await this.ledgerReads.planRates(tx, budget.fiscalYearId),
        accountingDate: a.accountingDate,
      };
      const dims = {
        actualId: a.id,
        costCenterId: a.costCenterId,
        glAccountId: a.glAccountId,
        eventCode: a.eventCode,
      };
      const charge = unwrap(
        postActualCharge(
          {
            budget,
            amount: { amountMinor: sign * amountAbs, currency },
            dims,
            commitmentId: c?.id ?? null,
          },
          ctx,
        ),
      );
      const budgetMinor = charge.budgetAmount.amountMinor;
      let fit: string = sign < 0 ? 'refund' : 'direct';
      let relief = 0;
      let released = 0;
      let excess = sign > 0 && !c ? budgetMinor : 0;
      let closes = false;
      let overBudgetApproved = false;
      if (c && sign > 0) {
        if (c.status !== 'encumbered' && c.status !== 'partially_consumed') {
          throw new ApiProblem(
            409,
            'COMMITMENT_NOT_OPEN',
            `This commitment is ${c.status.replace(/_/g, ' ')} and cannot take more actuals.`,
            {
              status: c.status,
            },
          );
        }
        const remaining = (cBal.get(c.id)?.encumberedMinor ?? 0) - (relieved.get(c.id) ?? 0);
        const f = classifyFit({
          actualMinor: budgetMinor,
          remainingMinor: remaining,
          commitmentTotalMinor: this.commitmentTotal(c, budget, ctx),
          toleranceBps: tolerance,
          final: p.final,
        });
        const approved = await this.approvedExcess(tx, a, budget.id);
        unwrap(checkFit(f, approved));
        if (opts.prepaid && f.excessMinor > 0) {
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'A deposit cannot be more than what is still encumbered on the commitment.',
          );
        }
        fit = f.fit;
        relief = opts.prepaid ? 0 : f.reliefMinor;
        released = opts.prepaid ? 0 : f.releasedMinor;
        excess = f.excessMinor;
        closes = f.closesCommitment;
        overBudgetApproved = approved > 0 && approved >= f.excessMinor;
        relieved.set(
          c.id,
          (relieved.get(c.id) ?? 0) + (opts.prepaid ? budgetMinor : f.reliefMinor),
        );
      } else if (!c && sign > 0) {
        const approved = await this.approvedExcess(tx, a, budget.id);
        const shortfall =
          budgetMinor - Math.max(availableOf(balances.get(budget.id)!, budget.control.basis), 0);
        overBudgetApproved = approved > 0 && approved >= shortfall;
      }
      const drafts: JournalDraft[] = [];
      if (!opts.prepaid) {
        drafts.push(charge.journal);
        if (relief > 0) {
          drafts.push(
            unwrap(
              postCommitmentMovement(
                {
                  kind: 'release_encumbrance',
                  budget: { ...budget, balances: balances.get(budget.id)! },
                  amount: { amountMinor: relief, currency: budget.currency },
                  provenance: { commitmentId: c!.id, actualId: a.id },
                },
                ctx,
              ),
            ),
          );
        }
      }
      const deltas = drafts.flatMap((d) =>
        d.lines
          .filter((l) => l.budgetId === budget.id)
          .map((l) => ({ account: l.account, budgetAmountMinor: l.budget!.amountMinor })),
      );
      unwrap(
        checkMatchAvailability({
          budgetId: budget.id,
          balances: balances.get(budget.id)!,
          control: budget.control,
          deltas,
          overBudgetApproved,
        }),
      );
      if (opts.dryRun) {
        balances.set(budget.id, applyDelta(balances.get(budget.id)!, deltas));
        matchedAbs += amountAbs;
        status = matchedAbs === totalAbs ? 'matched' : 'partially_matched';
        continue;
      }
      const partJournals: string[] = [];
      for (const d of drafts) {
        partJournals.push(
          await this.ledger.post(tx, d, {
            actor,
            command: opts.command,
            fiscalYearId: budget.fiscalYearId,
            requestId: opts.requestId,
            idempotencyKey: opts.idempotencyKey,
          }),
        );
      }
      balances.set(budget.id, applyDelta(balances.get(budget.id)!, deltas));
      if (c && sign > 0 && !opts.prepaid) {
        await this.applyCommitmentProgress(tx, c, {
          relief,
          released,
          closes,
          partialFinal: fit === 'partial' && closes,
          budget,
          ctx,
        });
        partJournals.push(...(await this.reverseAccruals(tx, actor, c.id, a, opts)));
      }
      if (opts.prepaid && c) {
        await tx.insert(prepaids).values({
          tenantId: actor.tenantId,
          commitmentId: c.id,
          amountMinor: budgetMinor,
          currency: budget.currency,
          serviceStart: opts.prepaid.serviceStart,
          serviceEnd: opts.prepaid.serviceEnd,
          nonRefundable: Boolean(opts.prepaid.nonRefundable),
          actualId: a.id,
          budgetId: budget.id,
        });
      }
      const [m] = await tx
        .insert(actualMatches)
        .values({
          tenantId: actor.tenantId,
          actualId: a.id,
          commitmentId: c?.id ?? null,
          budgetId: budget.id,
          transactionAmountMinor: sign * amountAbs,
          transactionCurrency: currency,
          budgetAmountMinor: budgetMinor,
          budgetCurrency: budget.currency,
          reliefMinor: relief,
          releasedMinor: released,
          excessMinor: excess,
          fit,
          rule: opts.rule,
          prepaid: Boolean(opts.prepaid),
          journalIds: partJournals,
          createdBy: actor.personId,
        })
        .returning({ id: actualMatches.id });
      lastMatchId = m.id;
      journalIds.push(...partJournals);
      matchedAbs += amountAbs;
      budgetSum += budgetMinor;
      status = matchedAbs === totalAbs ? 'matched' : 'partially_matched';
      firstBudget ??= { id: budget.id, currency: budget.currency, commitmentId: c?.id ?? null };
    }
    if (opts.dryRun) return { journalIds: [] };

    const fx = await this.postFxPart(tx, actor, a, matchedBefore, matchedAbs, opts);
    if (fx && lastMatchId) {
      journalIds.push(fx);
      const [m] = await tx.select().from(actualMatches).where(eq(actualMatches.id, lastMatchId));
      await tx
        .update(actualMatches)
        .set({ journalIds: [...m.journalIds, fx] })
        .where(eq(actualMatches.id, lastMatchId));
    }
    await tx
      .update(actuals)
      .set({
        matchStatus: status,
        matchedMinor: sign * matchedAbs,
        matchedBudgetId: a.matchedBudgetId ?? firstBudget?.id ?? null,
        matchedCommitmentId: a.matchedCommitmentId ?? firstBudget?.commitmentId ?? null,
        budgetCurrency: a.budgetCurrency ?? firstBudget?.currency ?? null,
        budgetAmountMinor: budgetSum,
        matchNote: null,
        matchedAt: new Date(),
        matchedBy: actor.personId,
      })
      .where(eq(actuals.id, a.id));
    return { journalIds };
  }

  /** FX effect for the part of the actual matched now (largest-remainder style, so parts sum to the whole). */
  private async postFxPart(
    tx: Tx,
    actor: Actor,
    a: ActualRow,
    before: number,
    after: number,
    opts: MatchOptions,
  ): Promise<string | null> {
    const total = Math.abs(a.transactionAmountMinor);
    if (!a.fxEffectMinor || total === 0) return null;
    const fx = BigInt(a.fxEffectMinor);
    const part = half(fx * BigInt(after), BigInt(total)) - half(fx * BigInt(before), BigInt(total));
    const draft = unwrap(
      postFxEffect(
        {
          legalEntityId: a.legalEntityId,
          fxMinor: part,
          dims: {
            actualId: a.id,
            costCenterId: a.costCenterId,
            glAccountId: a.glAccountId,
            eventCode: a.eventCode,
          },
        },
        { reportingCurrency: actor.reportingCurrency, accountingDate: a.accountingDate },
      ),
    );
    if (!draft) return null;
    return this.ledger.post(tx, draft, {
      actor,
      command: opts.command,
      fiscalYearId: null,
      requestId: opts.requestId,
      idempotencyKey: opts.idempotencyKey,
    });
  }

  /** Commitment consumed and released amounts (its own currency) and lifecycle status after a match. */
  async applyCommitmentProgress(
    tx: Tx,
    c: CommitmentRow,
    m: {
      relief: number;
      released: number;
      closes: boolean;
      partialFinal: boolean;
      budget: PostingBudget;
      ctx: PostingContext;
    },
  ): Promise<void> {
    const total = this.commitmentTotal(c, m.budget, m.ctx);
    const toCommit = (minor: number) =>
      total === 0 ? 0 : half(BigInt(c.amountMinor) * BigInt(minor), BigInt(total));
    let consumed = c.consumedMinor + toCommit(m.relief - m.released);
    let released = c.releasedMinor;
    let status: CommitmentStatus = c.status;
    if (m.closes) {
      consumed = Math.min(consumed, c.amountMinor - c.releasedMinor - c.feesMinor);
      released = c.amountMinor - consumed - c.feesMinor;
      status = m.partialFinal
        ? unwrap(
            commitmentMachine.next(
              unwrap(commitmentMachine.next(status, 'match_partial')),
              'release',
            ),
          )
        : unwrap(commitmentMachine.next(status, 'match_full'));
    } else {
      status = unwrap(commitmentMachine.next(status, 'match_partial'));
    }
    await tx
      .update(commitments)
      .set({ consumedMinor: consumed, releasedMinor: released, status, updatedAt: new Date() })
      .where(eq(commitments.id, c.id));
    c.consumedMinor = consumed;
    c.releasedMinor = released;
    c.status = status;
  }

  /** Reverses the posted accruals of a commitment when its actual arrives (trigger 'actual'). */
  async reverseAccruals(
    tx: Tx,
    actor: Actor,
    commitmentId: string,
    a: Pick<ActualRow, 'sourceRef' | 'accountingDate'>,
    opts: Pick<MatchOptions, 'command' | 'idempotencyKey' | 'requestId'>,
    trigger: 'actual' | 'period' | 'release' = 'actual',
  ): Promise<string[]> {
    const live = await tx
      .select()
      .from(accruals)
      .where(and(eq(accruals.commitmentId, commitmentId), eq(accruals.status, 'posted')))
      .for('update');
    const ids: string[] = [];
    for (const acc of live) {
      if (!acc.journalId) continue;
      const reason =
        trigger === 'actual'
          ? `Actual ${a.sourceRef} arrived`
          : trigger === 'release'
            ? 'Commitment released or cancelled'
            : 'Reversal period started';
      const rid = await this.reverseJournalTx(tx, actor, acc.journalId, {
        reasonCode: 'ACCRUAL-AUTO-REVERSE',
        reason,
        accountingDate: a.accountingDate,
        command: opts.command,
        idempotencyKey: opts.idempotencyKey,
        requestId: opts.requestId,
      });
      await tx
        .update(accruals)
        .set({
          status: 'reversed',
          reversalJournalId: rid,
          reversalTrigger: trigger === 'release' ? 'actual' : trigger,
        })
        .where(eq(accruals.id, acc.id));
      ids.push(rid);
    }
    return ids;
  }

  /** Posts the exact negation of a journal in an open period (never edits), checking no bucket goes negative. */
  async reverseJournalTx(
    tx: Tx,
    actor: Actor,
    journalId: string,
    o: {
      reasonCode: string;
      reason: string;
      accountingDate: string;
      command: string;
      idempotencyKey: string;
      requestId: string | null;
    },
  ): Promise<string> {
    const original = await this.ledger.journalRow(tx, journalId);
    if (!original) throw ApiProblem.notFound('journal');
    const lines = await this.ledger.linesOf(tx, journalId);
    const budgetIds = [
      ...new Set(lines.map((l) => l.budgetId).filter((b): b is string => Boolean(b))),
    ];
    await this.ledgerReads.lockBudgets(tx, budgetIds);
    const draft = unwrap(
      reverseJournal(
        {
          id: original.id,
          type: original.journalType,
          reversalOfJournalId: original.reversalOfJournalId,
          transactionCurrency: original.transactionCurrency as CurrencyCode,
          reportingCurrency: original.reportingCurrency as CurrencyCode,
          lines: domainLines(lines),
        },
        {
          accountingDate: o.accountingDate,
          reasonCode: o.reasonCode,
          reason: o.reason,
          alreadyReversed: (await this.ledger.reversedBy(tx, journalId)) !== null,
        },
      ),
    );
    const rows = await this.ledgerReads.budgetRows(tx, budgetIds);
    const balances = await this.ledgerReads.balances(tx, budgetIds);
    for (const id of budgetIds) {
      const b = toPostingBudget(rows.get(id)!);
      const deltas = draft.lines
        .filter((l) => l.budgetId === id)
        .map((l) => ({ account: l.account, budgetAmountMinor: l.budget!.amountMinor }));
      unwrap(
        checkNotOverdrawn(
          applyDelta(balances.get(id)!.budget, deltas),
          { ...b.control, mode: 'track' },
          id,
          'REVERSAL_WOULD_OVERDRAW',
        ),
      );
    }
    return this.ledger.post(tx, draft, {
      actor,
      command: o.command,
      fiscalYearId: budgetIds.length ? rows.get(budgetIds[0])!.fiscalYearId : null,
      requestId: o.requestId,
      idempotencyKey: o.idempotencyKey,
      allowSoftClosed: true,
    });
  }

  /**
   * Undoes every live match of an actual with linked reversals of its journals; commitments get back
   * what the match relieved. Prepaids already recognized cannot be unmatched.
   */
  async unmatch(
    tx: Tx,
    actor: Actor,
    actualId: string,
    o: {
      reasonCode: string;
      reason: string;
      command: string;
      idempotencyKey: string;
      requestId: string | null;
      accountingDate: string;
    },
  ): Promise<{ journalIds: string[]; parts: number }> {
    const a = await this.lockActual(tx, actualId);
    const live = await tx
      .select()
      .from(actualMatches)
      .where(and(eq(actualMatches.actualId, a.id), isNull(actualMatches.reversedAt)))
      .orderBy(asc(actualMatches.createdAt))
      .for('update');
    if (live.length === 0)
      throw new ApiProblem(409, 'INVALID_TRANSITION', 'This actual has no match to undo.');
    const journalIds: string[] = [];
    for (const m of live) {
      if (m.prepaid) {
        const [pp] = await tx
          .select()
          .from(prepaids)
          .where(and(eq(prepaids.actualId, a.id), eq(prepaids.commitmentId, m.commitmentId!)));
        if (pp && pp.consumedMinor > 0)
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'Part of this deposit is already recognized; post a refund or credit note instead.',
          );
        if (pp)
          await tx
            .update(prepaids)
            .set({ amountMinor: 0, serviceEnd: pp.serviceStart })
            .where(eq(prepaids.id, pp.id));
      }
      const reversals: string[] = [];
      for (const j of m.journalIds) {
        // Accrual reversals triggered by the match stay: the accrual is spent and can be proposed again.
        if ((await this.ledger.linesOf(tx, j)).some((l) => l.account === 'accrued')) continue;
        reversals.push(await this.reverseJournalTx(tx, actor, j, { ...o }));
      }
      if (m.commitmentId && !m.prepaid && m.reliefMinor > 0) {
        const [c] = await tx
          .select()
          .from(commitments)
          .where(eq(commitments.id, m.commitmentId))
          .for('update');
        const consumed = Math.max(
          0,
          c.consumedMinor -
            (await this.toCommitmentMinor(tx, actor, c, m.reliefMinor - m.releasedMinor)),
        );
        const released = Math.max(
          0,
          c.releasedMinor - (await this.toCommitmentMinor(tx, actor, c, m.releasedMinor)),
        );
        await tx
          .update(commitments)
          .set({
            consumedMinor: consumed,
            releasedMinor: released,
            // A correction restores the encumbrance the reversed match relieved (ledger and row stay in step).
            status: consumed > 0 ? 'partially_consumed' : 'encumbered',
            updatedAt: new Date(),
          })
          .where(eq(commitments.id, c.id));
      }
      await tx
        .update(actualMatches)
        .set({
          reversedAt: new Date(),
          reversalJournalIds: reversals,
          reversalReason: `${o.reasonCode}: ${o.reason}`,
        })
        .where(eq(actualMatches.id, m.id));
      journalIds.push(...reversals);
    }
    await tx
      .update(actuals)
      .set({
        matchStatus: 'unmatched',
        matchedMinor: 0,
        matchedBudgetId: null,
        matchedCommitmentId: null,
        budgetCurrency: null,
        budgetAmountMinor: null,
        matchedAt: null,
        matchedBy: null,
        matchNote: `Match undone: ${o.reason}`,
      })
      .where(eq(actuals.id, a.id));
    return { journalIds, parts: live.length };
  }
}
