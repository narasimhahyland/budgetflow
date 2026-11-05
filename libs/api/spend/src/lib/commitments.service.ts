import { ApiProblem, unwrap } from '@bf/api/core';
import { budgets, commitmentFundingLines, commitments, vendors, type Tx } from '@bf/api/db';
import type { EventCommitment } from '@bf/contracts';
import {
  allocateConsumption,
  buildTriplet,
  commitmentMachine,
  postSpendMovement,
  remainingOf,
  splitByWeights,
  type AppliedRate,
  type CommitmentStatus,
  type CurrencyCode,
  type JournalDraft,
  type Money,
  type SpendMovement,
  type StoredRates,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { asFundingSource, FundingSourcesService, type SourceRow } from './funding-sources.service';
import { PostingSupport, type LockedBudget, type PostCtx } from './posting-support';

type CommitmentRow = typeof commitments.$inferSelect;
const KIND_ORDER = { own: 0, contribution: 1, budget: 2 } as const;
type LineRow = typeof commitmentFundingLines.$inferSelect;

export interface EventRef {
  id: string;
  budgetId: string | null;
  currency: string;
  legalEntityId: string;
  costCenterId: string | null;
  eventCode: string;
}

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
 * Commitment lifecycle (pre-encumbered → encumbered → partially consumed → consumed; released,
 * cancelled, expired, carried forward). Every movement after the first posting reuses the rates
 * stored on the commitment line and relieves exactly the budget amount still posted (true-up when
 * rounding left a difference), so a non-budget-currency commitment never drifts.
 *
 * Phase 6 consumes commitments through `consume` and `release`; Phase 5 creates them from requests
 * (`preEncumberForRequest`, `encumberApproved`) and from event funding (`createForEvent`).
 */
@Injectable()
export class CommitmentsService {
  constructor(
    private readonly posting: PostingSupport,
    private readonly sources: FundingSourcesService,
  ) {}

  async row(tx: Tx, id: string, lock = false): Promise<CommitmentRow | undefined> {
    const q = tx.select().from(commitments).where(eq(commitments.id, id));
    return (lock ? await q.for('update') : await q)[0];
  }

  lines(tx: Tx, commitmentId: string): Promise<LineRow[]> {
    return tx
      .select()
      .from(commitmentFundingLines)
      .where(eq(commitmentFundingLines.commitmentId, commitmentId))
      .orderBy(asc(commitmentFundingLines.id));
  }

  private transition(
    c: CommitmentRow,
    event: Parameters<typeof commitmentMachine.next>[1],
  ): CommitmentStatus {
    return unwrap(commitmentMachine.next(c.status, event));
  }

  /** Request submitted: pre-encumbers on the request's budget and records the commitment with its rates. */
  async preEncumberForRequest(
    tx: Tx,
    c: PostCtx,
    input: {
      budget: LockedBudget;
      requestId: string;
      eventId: string | null;
      description: string;
      amount: Money;
    },
  ): Promise<{ commitmentId: string; budgetAmount: Money; journalIds: string[] }> {
    const id = randomUUID();
    const ctx = await this.posting.context(tx, input.budget, c.actor.reportingCurrency);
    const moved = unwrap(
      postSpendMovement(
        {
          kind: 'pre_encumber',
          budget: input.budget,
          amount: input.amount,
          journalType: 'commitment',
          provenance: { commitmentId: id, requestId: input.requestId, eventId: input.eventId },
        },
        ctx,
      ),
    );
    await tx.insert(commitments).values({
      id,
      tenantId: c.actor.tenantId,
      budgetId: input.budget.id,
      requestId: input.requestId,
      eventId: input.eventId,
      status: 'pre_encumbered',
      legalEntityId: input.budget.legalEntityId,
      costCenterId: input.budget.costCenterId,
      description: input.description,
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
      createdByPersonId: c.actor.personId,
    });
    await tx
      .insert(commitmentFundingLines)
      .values(this.lineValues(c, id, input.budget.id, null, null, moved.triplet, input.amount));
    const journalIds = await this.posting.post(tx, moved.journals, input.budget.fiscalYearId, c);
    return { commitmentId: id, budgetAmount: moved.budgetAmount, journalIds };
  }

  private lineValues(
    c: PostCtx,
    commitmentId: string,
    budgetId: string,
    sourceId: string | null,
    contributionId: string | null,
    t: { budget: Money; budgetRate: AppliedRate; reportingRate: AppliedRate },
    amount: Money,
  ): typeof commitmentFundingLines.$inferInsert {
    return {
      tenantId: c.actor.tenantId,
      commitmentId,
      budgetId,
      fundingSourceId: sourceId,
      contributionRequestId: contributionId,
      amountMinor: amount.amountMinor,
      currency: amount.currency,
      budgetAmountMinor: t.budget.amountMinor,
      budgetCurrency: t.budget.currency,
      rateType: t.budgetRate.type,
      budgetRate: t.budgetRate.value,
      budgetRateIds: t.budgetRate.rateIds,
      reportingCurrency: t.reportingRate.to,
      reportingRate: t.reportingRate.value,
      reportingRateIds: t.reportingRate.rateIds,
    };
  }

  /** Moves `amountMinor` (commitment currency) out of `account` across the commitment's budgets, pro rata. */
  private async relieve(
    tx: Tx,
    c: PostCtx,
    commitment: CommitmentRow,
    account: 'pre_encumbered' | 'encumbered',
    amountMinor: number | 'all',
    kindFor: (line: LineRow) => SpendMovement,
    provenance: { actualId?: string | null } = {},
  ): Promise<{
    journalIds: string[];
    perLine: { line: LineRow; budgetMinor: number; transactionMinor: number }[];
  }> {
    const lines = await this.lines(tx, commitment.id);
    const byBudget = new Map<string, LineRow[]>();
    for (const l of lines) byBudget.set(l.budgetId, [...(byBudget.get(l.budgetId) ?? []), l]);
    const budgetIds = [...byBudget.keys()];
    const locked = await this.posting.lock(tx, budgetIds);
    const remaining = new Map<string, Awaited<ReturnType<PostingSupport['remaining']>>>();
    for (const b of budgetIds) {
      remaining.set(
        b,
        await this.posting.remaining(tx, commitment.id, b, account, commitment.currency),
      );
    }
    const totalTx = [...remaining.values()].reduce((a, r) => a + r.transactionMinor, 0);
    const want = amountMinor === 'all' ? totalTx : amountMinor;
    if (want <= 0) return { journalIds: [], perLine: [] };
    if (want > totalTx) {
      throw new ApiProblem(
        409,
        'INSUFFICIENT_AVAILABLE',
        'The commitment does not have that much left.',
        {
          remainingMinor: totalTx,
        },
      );
    }
    const live = budgetIds.filter((b) => remaining.get(b)!.transactionMinor > 0);
    const parts = unwrap(
      splitByWeights(
        want,
        live.map((b) => remaining.get(b)!.transactionMinor),
      ),
    );
    const journalIds: string[] = [];
    const perLine: { line: LineRow; budgetMinor: number; transactionMinor: number }[] = [];
    for (const [i, b] of live.entries()) {
      if (parts[i] === 0) continue;
      const budgetLines = byBudget.get(b)!;
      const budget = locked.get(b)!;
      const ctx = await this.posting.context(tx, budget, c.actor.reportingCurrency);
      const moved = unwrap(
        postSpendMovement(
          {
            kind: kindFor(budgetLines[0]),
            budget,
            amount: { amountMinor: parts[i], currency: commitment.currency as CurrencyCode },
            journalType: 'commitment',
            rates: storedRates(commitment, budgetLines[0]),
            remaining: remaining.get(b),
            provenance: {
              commitmentId: commitment.id,
              requestId: commitment.requestId,
              eventId: commitment.eventId,
              contributionId: budgetLines[0].contributionRequestId,
              ...provenance,
            },
          },
          ctx,
        ),
      );
      journalIds.push(...(await this.posting.post(tx, moved.journals, budget.fiscalYearId, c)));
      // Spread the budget amount back over the lines on this budget (sources), by their posted share.
      const shares = unwrap(
        splitByWeights(
          moved.budgetAmount.amountMinor,
          budgetLines.map((l) => l.budgetAmountMinor ?? l.amountMinor),
        ),
      );
      const txShares = unwrap(
        splitByWeights(
          parts[i],
          budgetLines.map((l) => l.amountMinor),
        ),
      );
      budgetLines.forEach((l, k) =>
        perLine.push({ line: l, budgetMinor: shares[k], transactionMinor: txShares[k] }),
      );
    }
    return { journalIds, perLine };
  }

  /** Approval: encumbers the approved part and releases the rest of the pre-encumbrance exactly. */
  async encumberApproved(
    tx: Tx,
    c: PostCtx,
    commitmentId: string,
    approvedMinor: number,
  ): Promise<{ journalIds: string[]; status: CommitmentStatus }> {
    const commitment = (await this.row(tx, commitmentId, true))!;
    const enc = await this.relieve(
      tx,
      c,
      commitment,
      'pre_encumbered',
      approvedMinor,
      () => 'encumber',
    );
    const rel = await this.relieve(
      tx,
      c,
      commitment,
      'pre_encumbered',
      'all',
      () => 'release_pre_encumbrance',
    );
    const status = this.transition(commitment, 'approve');
    await tx
      .update(commitments)
      .set({
        status,
        amountMinor: approvedMinor,
        releasedMinor: commitment.releasedMinor + (commitment.amountMinor - approvedMinor),
        updatedAt: new Date(),
      })
      .where(eq(commitments.id, commitmentId));
    return { journalIds: [...enc.journalIds, ...rel.journalIds], status };
  }

  /** Rejected, withdrawn, changes requested or cancelled by a budget control: releases the pre-encumbrance. */
  async releasePreEncumbrance(
    tx: Tx,
    c: PostCtx,
    commitmentId: string,
  ): Promise<{ journalIds: string[] }> {
    const commitment = (await this.row(tx, commitmentId, true))!;
    if (commitment.status !== 'pre_encumbered') return { journalIds: [] };
    const rel = await this.relieve(
      tx,
      c,
      commitment,
      'pre_encumbered',
      'all',
      () => 'release_pre_encumbrance',
    );
    await tx
      .update(commitments)
      .set({
        status: this.transition(commitment, 'reject'),
        releasedMinor: commitment.releasedMinor + commitment.amountMinor,
        updatedAt: new Date(),
      })
      .where(eq(commitments.id, commitmentId));
    return { journalIds: rel.journalIds };
  }

  /**
   * Event commitment within approved funding: drawn from the event's sources pro rata by funded share
   * (encumbered out of each source's earmark), checked against what each source still holds.
   */
  async createForEvent(
    tx: Tx,
    c: PostCtx,
    input: {
      event: EventRef;
      sources: SourceRow[];
      description: string;
      vendorId?: string | null;
      amount: Money;
      serviceStart?: string | null;
      serviceEnd?: string | null;
      nonRefundableDepositMinor?: number;
    },
  ): Promise<{ commitmentId: string; budgetAmount: Money; journalIds: string[] }> {
    const active = input.sources.filter(
      (s) => s.status === 'active' && remainingOf(asFundingSource(s)) > 0,
    );
    if (!active.length) {
      throw new ApiProblem(
        409,
        'EVENT_NOT_FUNDED',
        'The event has no approved funding to commit against.',
      );
    }
    const locked = await this.posting.lock(
      tx,
      active.map((s) => s.budgetId),
    );
    const home = locked.get(active[0].budgetId)!;
    const ctx = await this.posting.context(tx, home, c.actor.reportingCurrency);
    const total = unwrap(
      buildTriplet(input.amount, {
        budgetCurrency: input.event.currency as CurrencyCode,
        reportingCurrency: ctx.reportingCurrency,
        rates: ctx.rates,
      }),
    ).budget.amountMinor;
    const plan = unwrap(allocateConsumption(active.map(asFundingSource), total));
    const sourceById = new Map(active.map((s) => [s.id, s]));
    const txParts = unwrap(
      splitByWeights(
        input.amount.amountMinor,
        plan.map((p) => p.amountMinor),
      ),
    );
    const convertPart = (s: SourceRow, minor: number) =>
      unwrap(
        buildTriplet(
          { amountMinor: minor, currency: input.amount.currency as CurrencyCode },
          {
            budgetCurrency: locked.get(s.budgetId)!.currency,
            reportingCurrency: ctx.reportingCurrency,
            rates: ctx.rates,
          },
        ),
      ).budget.amountMinor;
    // Per-line rounding may push a nearly exhausted source over by a minor unit: move a little transaction amount to a source with room.
    const unit = Math.max(1, Math.ceil(input.amount.amountMinor / Math.max(total, 1)));
    for (let guard = 0; guard < 20; guard++) {
      const over = plan.findIndex(
        (p, i) =>
          convertPart(sourceById.get(p.id)!, txParts[i]) >
          remainingOf(asFundingSource(sourceById.get(p.id)!)),
      );
      if (over < 0) break;
      const spare = plan
        .map((p, i) => ({
          i,
          room:
            remainingOf(asFundingSource(sourceById.get(p.id)!)) -
            convertPart(sourceById.get(p.id)!, txParts[i]),
        }))
        .filter((x) => x.i !== over)
        .sort((a, b) => b.room - a.room)[0];
      if (!spare || spare.room <= 0 || txParts[over] <= unit) {
        throw new ApiProblem(
          409,
          'FUNDING_CAP_EXCEEDED',
          'The event does not have that much approved funding left.',
        );
      }
      txParts[over] -= unit;
      txParts[spare.i] += unit;
    }
    const id = randomUUID();
    await tx.insert(commitments).values({
      id,
      tenantId: c.actor.tenantId,
      budgetId: input.event.budgetId ?? active[0].budgetId,
      eventId: input.event.id,
      status: 'encumbered',
      vendorId: input.vendorId ?? null,
      legalEntityId: input.event.legalEntityId,
      costCenterId: input.event.costCenterId,
      description: input.description,
      serviceStart: input.serviceStart ?? null,
      serviceEnd: input.serviceEnd ?? null,
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
      nonRefundableDepositMinor: input.nonRefundableDepositMinor ?? 0,
      createdByPersonId: c.actor.personId,
    });
    const journals: { drafts: JournalDraft[]; fy: string }[] = [];
    let budgetTotal = 0;
    for (const [i, p] of plan.entries()) {
      if (txParts[i] <= 0) continue;
      const source = sourceById.get(p.id)!;
      const budget = locked.get(source.budgetId)!;
      const moved = unwrap(
        postSpendMovement(
          {
            kind: 'encumber_from_hold',
            budget,
            amount: { amountMinor: txParts[i], currency: input.amount.currency as CurrencyCode },
            journalType: 'commitment',
            provenance: {
              commitmentId: id,
              eventId: input.event.id,
              contributionId: source.contributionRequestId,
              requestId: source.requestId,
            },
          },
          ctx,
        ),
      );
      await tx.insert(commitmentFundingLines).values(
        this.lineValues(c, id, budget.id, source.id, source.contributionRequestId, moved.triplet, {
          amountMinor: txParts[i],
          currency: input.amount.currency,
        }),
      );
      await this.sources.adjust(tx, source.id, { consumedMinor: moved.budgetAmount.amountMinor });
      budgetTotal += moved.budgetAmount.amountMinor;
      journals.push({ drafts: moved.journals, fy: budget.fiscalYearId });
    }
    const journalIds: string[] = [];
    for (const j of journals) journalIds.push(...(await this.posting.post(tx, j.drafts, j.fy, c)));
    return {
      commitmentId: id,
      budgetAmount: { amountMinor: budgetTotal, currency: input.event.currency as CurrencyCode },
      journalIds,
    };
  }

  /**
   * Moves an event commitment's encumbrance onto a new split of its funding sources (47e). The
   * ledger is append-only, so this releases every posted encumbrance back to the holds and posts
   * fresh encumbrances by `weights`; the commitment itself stays encumbered. Only a commitment that
   * nothing has consumed yet can move, because consumed amounts are already actual spend.
   */
  async rebalanceEventFunding(
    tx: Tx,
    c: PostCtx,
    commitmentId: string,
    weights: ReadonlyMap<string, number>,
  ): Promise<{ journalIds: string[]; movedBudgetMinor: number }> {
    const commitment = await this.row(tx, commitmentId, true);
    if (!commitment) throw ApiProblem.notFound('commitment');
    if (commitment.status !== 'encumbered') return { journalIds: [], movedBudgetMinor: 0 };
    const released = await this.relieve(
      tx,
      c,
      commitment,
      'encumbered',
      'all',
      () => 'release_encumbrance_to_hold',
    );
    for (const p of released.perLine)
      if (p.line.fundingSourceId)
        await this.sources.adjust(tx, p.line.fundingSourceId, { consumedMinor: -p.budgetMinor });
    await tx
      .delete(commitmentFundingLines)
      .where(eq(commitmentFundingLines.commitmentId, commitment.id));

    const sources = await this.sources.list(tx, commitment.eventId!, { lock: true });
    const targets = sources.filter((s) => s.status === 'active' && (weights.get(s.id) ?? 0) > 0);
    if (!targets.length)
      throw new ApiProblem(
        409,
        'EVENT_NOT_FUNDED',
        'The event has no active funding source to carry this commitment.',
      );
    const transactionMinor = released.perLine.reduce((a, p) => a + p.transactionMinor, 0);
    const parts = unwrap(
      splitByWeights(
        transactionMinor,
        targets.map((s) => weights.get(s.id)!),
      ),
    );
    const locked = await this.posting.lock(
      tx,
      targets.map((s) => s.budgetId),
    );
    const ctx = await this.posting.context(
      tx,
      locked.get(targets[0].budgetId)!,
      c.actor.reportingCurrency,
    );
    const journalIds: string[] = [];
    let movedBudgetMinor = 0;
    for (const [i, source] of targets.entries()) {
      if (parts[i] <= 0) continue;
      const budget = locked.get(source.budgetId)!;
      const moved = unwrap(
        postSpendMovement(
          {
            kind: 'encumber_from_hold',
            budget,
            amount: { amountMinor: parts[i], currency: commitment.currency as CurrencyCode },
            journalType: 'commitment',
            provenance: {
              commitmentId: commitment.id,
              eventId: commitment.eventId,
              contributionId: source.contributionRequestId,
              requestId: source.requestId,
            },
            reason: 'Cost split re-posted from actual attendance',
          },
          ctx,
        ),
      );
      await tx
        .insert(commitmentFundingLines)
        .values(
          this.lineValues(
            c,
            commitment.id,
            budget.id,
            source.id,
            source.contributionRequestId,
            moved.triplet,
            { amountMinor: parts[i], currency: commitment.currency as CurrencyCode },
          ),
        );
      await this.sources.adjust(tx, source.id, { consumedMinor: moved.budgetAmount.amountMinor });
      movedBudgetMinor += moved.budgetAmount.amountMinor;
      journalIds.push(...(await this.posting.post(tx, moved.journals, budget.fiscalYearId, c)));
    }
    return { journalIds: [...released.journalIds, ...journalIds], movedBudgetMinor };
  }

  /**
   * Releases what is left of an encumbered commitment: event commitments return to their funding
   * sources' earmarks, request commitments to the budget (obligations).
   */
  async release(
    tx: Tx,
    c: PostCtx,
    commitmentId: string,
  ): Promise<{ journalIds: string[]; releasedBudgetMinor: number }> {
    const commitment = await this.row(tx, commitmentId, true);
    if (!commitment) throw ApiProblem.notFound('commitment');
    if (!['encumbered', 'partially_consumed'].includes(commitment.status)) {
      throw new ApiProblem(
        409,
        'INVALID_TRANSITION',
        `A ${commitment.status.replace(/_/g, ' ')} commitment cannot be released.`,
      );
    }
    const r = await this.relieve(tx, c, commitment, 'encumbered', 'all', (l) =>
      l.fundingSourceId ? 'release_encumbrance_to_hold' : 'release_encumbrance',
    );
    for (const p of r.perLine) {
      if (p.line.fundingSourceId)
        await this.sources.adjust(tx, p.line.fundingSourceId, { consumedMinor: -p.budgetMinor });
    }
    const releasedTx = r.perLine.reduce((a, p) => a + p.transactionMinor, 0);
    await tx
      .update(commitments)
      .set({
        status: this.transition(commitment, 'release'),
        releasedMinor: commitment.releasedMinor + releasedTx,
        updatedAt: new Date(),
      })
      .where(eq(commitments.id, commitmentId));
    return {
      journalIds: r.journalIds,
      releasedBudgetMinor: r.perLine.reduce((a, p) => a + p.budgetMinor, 0),
    };
  }

  /**
   * Phase 6: a matched actual consumes the commitment (encumbered → actual) at the commitment's stored
   * rates, pro rata across its budgets; the last remainder relieves exactly what was posted. Existing
   * commitments complete under every budget control (frozen, set to zero).
   */
  async consume(
    tx: Tx,
    c: PostCtx,
    input: { commitmentId: string; amount: Money; actualId?: string | null },
  ): Promise<{ journalIds: string[]; consumedBudgetMinor: number; status: CommitmentStatus }> {
    const commitment = await this.row(tx, input.commitmentId, true);
    if (!commitment) throw ApiProblem.notFound('commitment');
    if (input.amount.currency !== commitment.currency) {
      throw new ApiProblem(
        422,
        'CURRENCY_MISMATCH',
        `This commitment is in ${commitment.currency}.`,
      );
    }
    const r = await this.relieve(
      tx,
      c,
      commitment,
      'encumbered',
      input.amount.amountMinor,
      () => 'consume',
      {
        actualId: input.actualId ?? null,
      },
    );
    const consumed = commitment.consumedMinor + input.amount.amountMinor;
    const full = consumed + commitment.releasedMinor >= commitment.amountMinor;
    const status = this.transition(commitment, full ? 'match_full' : 'match_partial');
    await tx
      .update(commitments)
      .set({ status, consumedMinor: consumed, updatedAt: new Date() })
      .where(eq(commitments.id, commitment.id));
    return {
      journalIds: r.journalIds,
      consumedBudgetMinor: r.perLine.reduce((a, p) => a + p.budgetMinor, 0),
      status,
    };
  }

  /** Commitments of an event in the contract shape (amounts first posted, consumed, released). */
  async listForEvent(tx: Tx, eventId: string): Promise<EventCommitment[]> {
    const rows = await tx
      .select()
      .from(commitments)
      .where(eq(commitments.eventId, eventId))
      .orderBy(asc(commitments.createdAt));
    return this.views(
      tx,
      rows.filter((r) => !r.requestId),
    );
  }

  async views(tx: Tx, rows: CommitmentRow[]): Promise<EventCommitment[]> {
    if (!rows.length) return [];
    const lines = await tx
      .select()
      .from(commitmentFundingLines)
      .where(
        inArray(
          commitmentFundingLines.commitmentId,
          rows.map((r) => r.id),
        ),
      );
    const budgetNames = new Map(
      (
        await tx
          .select({ id: budgets.id, name: budgets.name })
          .from(budgets)
          .where(inArray(budgets.id, [...new Set(lines.map((l) => l.budgetId))]))
      ).map((b) => [b.id, b.name]),
    );
    const vendorIds = [
      ...new Set(rows.map((r) => r.vendorId).filter((v): v is string => Boolean(v))),
    ];
    const vendorNames = vendorIds.length
      ? new Map(
          (
            await tx
              .select({ id: vendors.id, name: vendors.name })
              .from(vendors)
              .where(inArray(vendors.id, vendorIds))
          ).map((v) => [v.id, v.name]),
        )
      : new Map<string, string>();
    return rows.map((r) => {
      const own = lines.filter((l) => l.commitmentId === r.id);
      const budgetCurrency = own[0]?.budgetCurrency ?? r.currency;
      const posted = own.reduce((a, l) => a + (l.budgetAmountMinor ?? 0), 0);
      return {
        id: r.id,
        description: r.description,
        vendorId: r.vendorId,
        vendorName: r.vendorId ? (vendorNames.get(r.vendorId) ?? null) : null,
        status: r.status,
        amount: { amountMinor: r.amountMinor, currency: r.currency },
        budgetAmount: { amountMinor: posted, currency: budgetCurrency },
        consumed: { amountMinor: r.consumedMinor, currency: r.currency },
        released: { amountMinor: r.releasedMinor, currency: r.currency },
        serviceStart: r.serviceStart,
        serviceEnd: r.serviceEnd,
        createdAt: r.createdAt.toISOString(),
        fundingLines: own
          .map((l) => ({
            budgetId: l.budgetId,
            budgetName: budgetNames.get(l.budgetId) ?? '',
            sourceKind: (l.fundingSourceId
              ? l.contributionRequestId
                ? 'contribution'
                : 'own'
              : 'budget') as keyof typeof KIND_ORDER,
            amount: {
              amountMinor: l.budgetAmountMinor ?? 0,
              currency: l.budgetCurrency ?? r.currency,
            },
          }))
          .sort(
            (a, b) =>
              KIND_ORDER[a.sourceKind] - KIND_ORDER[b.sourceKind] ||
              b.amount.amountMinor - a.amount.amountMinor,
          ),
      } satisfies EventCommitment;
    });
  }
}
