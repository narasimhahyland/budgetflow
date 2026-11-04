import {
  actualMatches,
  actuals,
  budgets,
  commitments,
  events,
  prepaids,
  vendors,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { LedgerReads, LedgerService, toPostingBudget } from '@bf/api/ledger';
import type { CommitmentHygieneItem, CommitmentHygieneList } from '@bf/contracts';
import {
  AGING_BUCKETS,
  AUTO_RELEASE_PROMPT_DAYS,
  cancellationFee,
  commitmentAging,
  commitmentMachine,
  postCommitmentMovement,
  type CommitmentStatus,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, max, type SQL } from 'drizzle-orm';
import {
  ActualsReads,
  commitmentRef,
  tenantOf,
  todayUtc,
  type CommandContext,
  type CommitmentRow,
} from './actuals-reads';
import { MatchEngine } from './match-engine';

const OPEN: CommitmentStatus[] = ['encumbered', 'partially_consumed'];

/** Commitment hygiene: aging, auto-release prompts, release, cancellation fees and non-refundable deposits. */
@Injectable()
export class CommitmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: ActualsReads,
    private readonly ledgerReads: LedgerReads,
    private readonly ledger: LedgerService,
    private readonly engine: MatchEngine,
    private readonly audit: AuditService,
  ) {}

  list(
    actor: RequestActor,
    q: { status?: 'open' | 'all'; budgetId?: string; eventCode?: string; asOfDate?: string },
  ): Promise<CommitmentHygieneList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const asOf = q.asOfDate ?? todayUtc();
      const where: SQL[] = [];
      if ((q.status ?? 'open') === 'open') where.push(inArray(commitments.status, OPEN));
      if (q.budgetId) where.push(eq(commitments.budgetId, q.budgetId));
      if (q.eventCode) {
        const [e] = await tx
          .select({ id: events.id })
          .from(events)
          .where(eq(events.eventCode, q.eventCode));
        where.push(eq(commitments.eventId, e?.id ?? '00000000-0000-4000-8000-000000000000'));
      }
      const rows = await tx
        .select()
        .from(commitments)
        .where(and(...where))
        .orderBy(asc(commitments.serviceEnd), asc(commitments.id))
        .limit(500);
      const items = await this.items(tx, actor, rows, asOf);
      const open = items.filter((i) => OPEN.includes(i.status as CommitmentStatus));
      return {
        asOfDate: asOf,
        items,
        totals: {
          open: open.length,
          prompts: open.filter((i) => i.releasePrompt).length,
          encumbered: {
            amountMinor: open.reduce((s, i) => s + i.encumberedReporting.amountMinor, 0),
            currency: actor.reportingCurrency,
          },
          byBucket: AGING_BUCKETS.map((bucket) => {
            const inBucket = open.filter((i) => i.agingBucket === bucket);
            return {
              bucket,
              count: inBucket.length,
              encumberedMinor: inBucket.reduce((s, i) => s + i.encumberedReporting.amountMinor, 0),
            };
          }),
        },
      };
    });
  }

  async items(
    tx: Tx,
    actor: RequestActor,
    rows: CommitmentRow[],
    asOf: string,
  ): Promise<CommitmentHygieneItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [bal, budgetRows, vendorRows, eventRows, pp, last] = await Promise.all([
      this.reads.commitmentBalances(tx, ids),
      tx
        .select({ id: budgets.id, name: budgets.name, currency: budgets.currency })
        .from(budgets)
        .where(
          inArray(
            budgets.id,
            rows.map((r) => r.budgetId),
          ),
        ),
      tx.select({ id: vendors.id, name: vendors.name }).from(vendors),
      tx.select({ id: events.id, code: events.eventCode }).from(events),
      tx.select().from(prepaids).where(inArray(prepaids.commitmentId, ids)),
      tx
        .select({ id: actualMatches.commitmentId, last: max(actuals.transactionDate) })
        .from(actualMatches)
        .innerJoin(actuals, eq(actuals.id, actualMatches.actualId))
        .where(and(inArray(actualMatches.commitmentId, ids), isNull(actualMatches.reversedAt)))
        .groupBy(actualMatches.commitmentId),
    ]);
    const bById = new Map(budgetRows.map((b) => [b.id, b]));
    const vById = new Map(vendorRows.map((v) => [v.id, v.name]));
    const eById = new Map(eventRows.map((e) => [e.id, e.code]));
    const lastById = new Map(last.map((l) => [l.id!, l.last]));
    return rows.map((c) => {
      const b = bById.get(c.budgetId)!;
      const ccy = b.currency;
      const enc = bal.get(c.id)?.encumberedMinor ?? 0;
      const accrued = bal.get(c.id)?.accruedMinor ?? 0;
      const prepaid = pp
        .filter((p) => p.commitmentId === c.id)
        .reduce((s, p) => s + p.amountMinor - p.consumedMinor, 0);
      const aging = commitmentAging({
        serviceEnd: c.serviceEnd,
        createdOn: c.createdAt.toISOString().slice(0, 10),
        asOf,
      });
      const open = OPEN.includes(c.status);
      return {
        id: c.id,
        reference: commitmentRef(c.id),
        description: c.description,
        status: c.status,
        budgetId: c.budgetId,
        budgetName: b.name,
        legalEntityId: c.legalEntityId,
        eventId: c.eventId,
        eventCode: c.eventId ? (eById.get(c.eventId) ?? null) : null,
        vendorName: c.vendorId ? (vById.get(c.vendorId) ?? null) : null,
        serviceStart: c.serviceStart,
        serviceEnd: c.serviceEnd,
        amount: { amountMinor: c.amountMinor, currency: c.currency },
        encumbered: { amountMinor: enc, currency: ccy },
        encumberedReporting: {
          amountMinor: bal.get(c.id)?.encumberedReportingMinor ?? 0,
          currency: actor.reportingCurrency,
        },
        consumed: { amountMinor: c.consumedMinor, currency: c.currency },
        released: { amountMinor: c.releasedMinor, currency: c.currency },
        fees: { amountMinor: c.feesMinor, currency: c.currency },
        nonRefundableDeposit: { amountMinor: c.nonRefundableDepositMinor, currency: c.currency },
        accrued: { amountMinor: accrued, currency: ccy },
        prepaid: { amountMinor: prepaid, currency: ccy },
        daysPast: open ? aging.daysPast : 0,
        agingBucket: open ? aging.bucket : 'current',
        releasePrompt:
          open &&
          enc > 0 &&
          accrued === 0 &&
          aging.daysPast >= AUTO_RELEASE_PROMPT_DAYS &&
          c.serviceEnd !== null,
        lastActualOn: lastById.get(c.id) ?? null,
      };
    });
  }

  release(
    actor: RequestActor,
    id: string,
    req: { reasonCode: string; reason: string },
    ctx: CommandContext,
  ): Promise<CommandResult<CommitmentHygieneItem>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.commitment.release:${id}`,
        request: req,
        status: 200,
      },
      (tx) => this.close(tx, actor, id, { kind: 'release', feeMinor: 0, ...req }, ctx),
    );
  }

  cancel(
    actor: RequestActor,
    id: string,
    req: { feeMinor: number; reasonCode: string; reason: string },
    ctx: CommandContext,
  ): Promise<CommandResult<CommitmentHygieneItem>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.commitment.cancel:${id}`,
        request: req,
        status: 200,
      },
      (tx) => this.close(tx, actor, id, { kind: 'cancel', ...req }, ctx),
    );
  }

  /**
   * Release relieves what is left encumbered. Cancellation first consumes the fee (at least any
   * non-refundable deposit) and any deposit already paid as a prepaid, then releases the rest.
   */
  private async close(
    tx: Tx,
    actor: RequestActor,
    id: string,
    o: { kind: 'release' | 'cancel'; feeMinor: number; reasonCode: string; reason: string },
    ctx: CommandContext,
  ): Promise<CommitmentHygieneItem> {
    this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
    const [c] = await tx.select().from(commitments).where(eq(commitments.id, id)).for('update');
    if (!c) throw ApiProblem.notFound('commitment');
    const nextStatus = unwrap(
      commitmentMachine.next(c.status, o.kind === 'release' ? 'release' : 'cancel_with_fees'),
    );
    await this.ledgerReads.lockBudgets(tx, [c.budgetId]);
    const row = (await this.ledgerReads.budgetRows(tx, [c.budgetId])).get(c.budgetId)!;
    const budget = toPostingBudget(row);
    const ctxP = {
      reportingCurrency: actor.reportingCurrency,
      rates: await this.ledgerReads.planRates(tx, budget.fiscalYearId),
      accountingDate: todayUtc(),
    };
    let balances = (await this.ledgerReads.balances(tx, [budget.id])).get(budget.id)!.budget;
    const remaining =
      (await this.reads.commitmentBalances(tx, [c.id])).get(c.id)?.encumberedMinor ?? 0;
    const opts = {
      actor,
      command: `actuals.commitment.${o.kind}`,
      fiscalYearId: budget.fiscalYearId,
      requestId: ctx.requestId,
      idempotencyKey: ctx.idempotencyKey,
    };
    const journals: string[] = [];
    const post = async (kind: 'consume' | 'release_encumbrance', minor: number) => {
      if (minor <= 0) return;
      const d = unwrap(
        postCommitmentMovement(
          {
            kind,
            budget: { ...budget, balances },
            amount: { amountMinor: minor, currency: budget.currency },
            provenance: { commitmentId: c.id },
          },
          ctxP,
        ),
      );
      journals.push(await this.ledger.post(tx, d, opts));
      balances = (await this.ledgerReads.balances(tx, [budget.id])).get(budget.id)!.budget;
    };
    let fee = 0;
    // A deposit already paid (prepaid not yet recognized) is spent either way: consume it now.
    let deposit = 0;
    const pp = await tx
      .select()
      .from(prepaids)
      .where(eq(prepaids.commitmentId, c.id))
      .for('update');
    for (const p of pp) {
      const left = p.amountMinor - p.consumedMinor;
      if (left <= 0) continue;
      deposit += left;
      await tx
        .update(prepaids)
        .set({ consumedMinor: p.amountMinor, recognizedThrough: ctxP.accountingDate })
        .where(eq(prepaids.id, p.id));
    }
    if (o.kind === 'cancel') {
      const nonRefundable = await this.engine.toBudgetMinor(
        tx,
        actor,
        c,
        c.nonRefundableDepositMinor,
      );
      fee = unwrap(
        cancellationFee({
          feeMinor: o.feeMinor,
          nonRefundableDepositMinor: Math.max(nonRefundable - deposit, 0),
          remainingMinor: remaining - deposit,
        }),
      );
    }
    await post('consume', deposit + fee);
    await post('release_encumbrance', remaining - deposit - fee);
    journals.push(
      ...(await this.engine.reverseAccruals(
        tx,
        actor,
        c.id,
        { sourceRef: '', accountingDate: ctxP.accountingDate },
        { command: opts.command, idempotencyKey: ctx.idempotencyKey, requestId: ctx.requestId },
        'release',
      )),
    );
    const consumedNow = await this.engine.toCommitmentMinor(tx, actor, c, deposit + fee);
    const consumed = c.consumedMinor + consumedNow;
    await tx
      .update(commitments)
      .set({
        status: nextStatus,
        consumedMinor: consumed,
        feesMinor:
          c.feesMinor +
          (o.kind === 'cancel' ? await this.engine.toCommitmentMinor(tx, actor, c, fee) : 0),
        releasedMinor: Math.max(c.amountMinor - consumed, 0),
        updatedAt: new Date(),
      })
      .where(eq(commitments.id, c.id));
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      action: o.kind === 'release' ? 'commitment.released' : 'commitment.cancelled',
      resourceType: 'commitment',
      resourceId: c.id,
      legalEntityId: c.legalEntityId,
      requestId: ctx.requestId,
      reason: `${o.reasonCode}: ${o.reason}`,
      changes: {
        status: { from: c.status, to: nextStatus },
        releasedMinor: { from: c.releasedMinor, to: Math.max(c.amountMinor - consumed, 0) },
        feeMinor: { from: 0, to: fee },
        depositConsumedMinor: { from: 0, to: deposit },
        journals: { from: null, to: journals },
      },
    });
    const [after] = await tx.select().from(commitments).where(eq(commitments.id, c.id));
    return (await this.items(tx, actor, [after], todayUtc()))[0];
  }
}
