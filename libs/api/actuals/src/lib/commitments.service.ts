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
import { BenefitsService } from '@bf/api/finance';
import { LedgerReads } from '@bf/api/ledger';
import type { CommitmentHygieneItem, CommitmentHygieneList } from '@bf/contracts';
import {
  AGING_BUCKETS,
  AUTO_RELEASE_PROMPT_DAYS,
  cancellationFee,
  commitmentAging,
  commitmentMachine,
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
import { CommitmentRelief } from './commitment-relief';
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
    private readonly engine: MatchEngine,
    private readonly relief: CommitmentRelief,
    private readonly audit: AuditService,
    private readonly benefits: BenefitsService,
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
    const accountingDate = todayUtc();
    const opts = {
      command: `actuals.commitment.${o.kind}`,
      requestId: ctx.requestId,
      idempotencyKey: ctx.idempotencyKey,
    };
    const journals: string[] = [];
    // A deposit already paid (prepaid not yet recognized) is spent either way: consume it now.
    const deposit = await this.relief.consumeOutstandingPrepaids(
      tx,
      actor,
      c,
      accountingDate,
      opts,
    );
    journals.push(...deposit.journalIds);
    let fee = 0;
    let feeTx = 0;
    if (o.kind === 'cancel') {
      const total = await this.engine.budgetTotalOf(tx, actor, c);
      const rems = await this.relief.remaining(tx, c);
      const remaining = rems.reduce((s, r) => s + r.rem.budgetMinor, 0);
      const nonRefundable = this.relief.toBudgetMinor(c, total, c.nonRefundableDepositMinor);
      fee = unwrap(
        cancellationFee({
          feeMinor: o.feeMinor,
          nonRefundableDepositMinor: Math.max(nonRefundable - deposit.budgetMinor, 0),
          remainingMinor: remaining,
        }),
      );
      if (fee > 0) {
        const ids = rems.map((r) => r.budgetId);
        await this.ledgerReads.lockBudgets(tx, ids);
        const balances = await this.ledgerReads.balances(tx, ids);
        const drafts = await this.relief.drafts(
          tx,
          actor,
          c,
          rems,
          'consume',
          fee === remaining ? 'all' : this.relief.toCommitmentMinor(c, total, fee),
          {},
          accountingDate,
          (id) => balances.get(id)!.budget,
        );
        feeTx = drafts.reduce((s, d) => s + d.transactionMinor, 0);
        journals.push(...(await this.relief.post(tx, actor, drafts, opts)));
      }
    }
    const consumed = c.consumedMinor + deposit.transactionMinor + feeTx;
    await tx
      .update(commitments)
      .set({ consumedMinor: consumed, feesMinor: c.feesMinor + feeTx, updatedAt: new Date() })
      .where(eq(commitments.id, c.id));
    Object.assign(c, { consumedMinor: consumed, feesMinor: c.feesMinor + feeTx });
    journals.push(...(await this.relief.releaseRest(tx, actor, c, accountingDate, opts)));
    journals.push(
      ...(await this.engine.reverseAccruals(
        tx,
        actor,
        c.id,
        { sourceRef: '', accountingDate },
        opts,
        'release',
      )),
    );
    await tx
      .update(commitments)
      .set({
        status: nextStatus,
        releasedMinor: Math.max(c.amountMinor - consumed, 0),
        updatedAt: new Date(),
      })
      .where(eq(commitments.id, c.id));
    // Gap B3 (080h): a request released before anything was spent gave nobody a benefit, so its
    // benefit entries are reversed (append-only negating entries) in this command.
    const benefitReversals =
      c.requestId && consumed === 0
        ? await this.benefits.reverseSource(
            tx,
            actor,
            'request',
            c.requestId,
            `Commitment ${o.kind === 'release' ? 'released' : 'cancelled'} before any spend`,
          )
        : [];
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
        depositConsumedMinor: { from: 0, to: deposit.budgetMinor },
        journals: { from: null, to: journals },
        ...(benefitReversals.length
          ? { benefitReversals: { from: null, to: benefitReversals } }
          : {}),
      },
    });
    const [after] = await tx.select().from(commitments).where(eq(commitments.id, c.id));
    return (await this.items(tx, actor, [after], todayUtc()))[0];
  }
}
