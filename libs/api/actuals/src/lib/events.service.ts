import {
  actuals,
  budgets,
  commitments,
  contributionRequests,
  events,
  rechargeSchedules,
  surplusReturns,
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
import type { EventReconciliation, EventReconciliationList } from '@bf/contracts';
import {
  checkEventClose,
  contributionMachine,
  eventMachine,
  postCommitmentMovement,
  type ContributionStatus,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ActualsReads, tenantOf, todayUtc, type CommandContext } from './actuals-reads';
import { CommitmentsService } from './commitments.service';

type EventRow = typeof events.$inferSelect;
const FUNDED: ContributionStatus[] = [
  'approved_full',
  'approved_partial',
  'earmarked',
  'transferred',
  'settled',
];

/**
 * Event reconciliation and close: no close while actuals are unmatched, a cross-entity contribution
 * lacks its recharge, or a commitment is open without an accrual. Closing releases what is still
 * earmarked on each contributor's budget (the surplus returned per contributor).
 */
@Injectable()
export class EventsCloseService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: ActualsReads,
    private readonly ledgerReads: LedgerReads,
    private readonly ledger: LedgerService,
    private readonly commitmentsSvc: CommitmentsService,
    private readonly audit: AuditService,
  ) {}

  list(actor: RequestActor): Promise<EventReconciliationList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const rows = await tx
        .select()
        .from(events)
        .where(inArray(events.status, ['in_progress', 'completed', 'reconciling', 'closed']))
        .orderBy(asc(events.status), asc(events.eventCode))
        .limit(200);
      const items: EventReconciliationList['items'] = [];
      for (const e of rows) {
        const r = await this.reconciliation(tx, actor, e);
        items.push({
          id: e.id,
          name: e.name,
          eventCode: e.eventCode,
          status: e.status,
          unmatchedActuals: r.actuals.unmatched,
          openCommitments: r.commitments.filter(
            (c) => c.status === 'encumbered' || c.status === 'partially_consumed',
          ).length,
          canClose: r.canClose,
        });
      }
      return { items };
    });
  }

  get(actor: RequestActor, eventId: string): Promise<EventReconciliation> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const [e] = await tx.select().from(events).where(eq(events.id, eventId));
      if (!e) throw ApiProblem.notFound('event');
      return this.reconciliation(tx, actor, e);
    });
  }

  close(
    actor: RequestActor,
    eventId: string,
    req: { reason: string },
    ctx: CommandContext,
  ): Promise<CommandResult<EventReconciliation>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.event.close:${eventId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const [e] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
        if (!e) throw ApiProblem.notFound('event');
        const before = await this.reconciliation(tx, actor, e);
        unwrap(
          checkEventClose({
            status: e.status,
            unmatchedActuals: before.actuals.unmatched,
            crossEntityContributionsWithoutRecharge:
              before.blockers.find((b) => b.code === 'EVENT_MISSING_RECHARGE')?.count ?? 0,
            unaccruedOpenCommitments:
              before.blockers.find((b) => b.code === 'EVENT_HAS_OPEN_COMMITMENTS')?.count ?? 0,
          }),
        );
        const contribs = await tx
          .select()
          .from(contributionRequests)
          .where(
            and(
              eq(contributionRequests.eventId, e.id),
              inArray(contributionRequests.status, FUNDED),
            ),
          )
          .orderBy(asc(contributionRequests.id))
          .for('update');
        const held = await this.reads.heldByContribution(
          tx,
          contribs.map((c) => c.id),
        );
        const giverIds = [...new Set(contribs.map((c) => c.giverBudgetId))];
        await this.ledgerReads.lockBudgets(tx, giverIds);
        const rows = await this.ledgerReads.budgetRows(tx, giverIds);
        const returns: {
          contributionId: string;
          budgetId: string;
          amountMinor: number;
          currency: string;
          journalId: string;
        }[] = [];
        for (const c of contribs) {
          const h = held.get(c.id);
          if (h && h.heldMinor > 0) {
            const budget = toPostingBudget(rows.get(h.budgetId)!);
            const balances = (await this.ledgerReads.balances(tx, [budget.id])).get(
              budget.id,
            )!.budget;
            const draft = unwrap(
              postCommitmentMovement(
                {
                  kind: 'release_hold',
                  budget: { ...budget, balances },
                  amount: { amountMinor: h.heldMinor, currency: budget.currency },
                  provenance: { contributionId: c.id, eventId: e.id },
                },
                {
                  reportingCurrency: actor.reportingCurrency,
                  rates: await this.ledgerReads.planRates(tx, budget.fiscalYearId),
                  accountingDate: todayUtc(),
                },
              ),
            );
            const journalId = await this.ledger.post(tx, draft, {
              actor,
              command: 'actuals.event.close',
              fiscalYearId: budget.fiscalYearId,
              requestId: ctx.requestId,
              idempotencyKey: ctx.idempotencyKey,
            });
            await tx.insert(surplusReturns).values({
              tenantId: actor.tenantId,
              eventId: e.id,
              contributionRequestId: c.id,
              budgetId: budget.id,
              amountMinor: h.heldMinor,
              currency: budget.currency,
              journalId,
            });
            returns.push({
              contributionId: c.id,
              budgetId: budget.id,
              amountMinor: h.heldMinor,
              currency: budget.currency,
              journalId,
            });
          }
          const settled = contributionMachine.next(c.status, 'settle');
          if (settled.ok)
            await tx
              .update(contributionRequests)
              .set({ status: settled.value, updatedAt: new Date() })
              .where(eq(contributionRequests.id, c.id));
        }
        const reconciling =
          e.status === 'completed' ? unwrap(eventMachine.next(e.status, 'reconcile')) : e.status;
        const closed = unwrap(eventMachine.next(reconciling, 'close'));
        await tx
          .update(events)
          .set({ status: closed, updatedAt: new Date() })
          .where(eq(events.id, e.id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'event.closed',
          resourceType: 'event',
          resourceId: e.id,
          legalEntityId: e.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            status: { from: e.status, to: closed },
            surplusReturns: {
              from: null,
              to: returns.map((r) => ({
                contributionId: r.contributionId,
                budgetId: r.budgetId,
                amountMinor: r.amountMinor,
              })),
            },
          },
        });
        const [after] = await tx.select().from(events).where(eq(events.id, e.id));
        return this.reconciliation(tx, actor, after);
      },
    );
  }

  private async reconciliation(
    tx: Tx,
    actor: RequestActor,
    e: EventRow,
  ): Promise<EventReconciliation> {
    const reporting = actor.reportingCurrency;
    const [stats] = await tx
      .select({
        matched: sql<number>`count(*) filter (where ${actuals.matchStatus} = 'matched')`,
        unmatched: sql<number>`count(*) filter (where ${actuals.matchStatus} in ('unmatched','partially_matched'))`,
        excluded: sql<number>`count(*) filter (where ${actuals.matchStatus} = 'excluded')`,
        matchedReporting: sql<string>`coalesce(sum(${actuals.reportingAmountMinor}) filter (where ${actuals.matchStatus} = 'matched'), 0)`,
        unmatchedReporting: sql<string>`coalesce(sum(${actuals.reportingAmountMinor}) filter (where ${actuals.matchStatus} in ('unmatched','partially_matched')), 0)`,
        fx: sql<string>`coalesce(sum(${actuals.fxEffectMinor}) filter (where ${actuals.matchStatus} = 'matched'), 0)`,
      })
      .from(actuals)
      .where(
        and(
          eq(actuals.eventCode, e.eventCode),
          or(
            isNull(actuals.importBatchId),
            sql`${actuals.importBatchId} in (select id from import_batches where status = 'posted')`,
          ),
        ),
      );
    const cRows = await tx
      .select()
      .from(commitments)
      .where(eq(commitments.eventId, e.id))
      .orderBy(asc(commitments.id));
    const items = await this.commitmentsSvc.items(tx, actor, cRows, todayUtc());
    const unaccrued = items.filter(
      (c) =>
        (c.status === 'encumbered' || c.status === 'partially_consumed') &&
        c.encumbered.amountMinor > 0 &&
        c.accrued.amountMinor === 0,
    ).length;
    const contribs = await tx
      .select({
        c: contributionRequests,
        giverName: budgets.name,
        giverEntity: budgets.legalEntityId,
        giverCurrency: budgets.currency,
      })
      .from(contributionRequests)
      .innerJoin(budgets, eq(budgets.id, contributionRequests.giverBudgetId))
      .where(
        and(eq(contributionRequests.eventId, e.id), inArray(contributionRequests.status, FUNDED)),
      );
    const held = await this.reads.heldByContribution(
      tx,
      contribs.map((c) => c.c.id),
    );
    const recharges = contribs.length
      ? await tx
          .select()
          .from(rechargeSchedules)
          .where(
            inArray(
              rechargeSchedules.contributionRequestId,
              contribs.map((c) => c.c.id),
            ),
          )
      : [];
    let missingRecharge = 0;
    const contributions = contribs.map(({ c, giverName, giverEntity, giverCurrency }) => {
      const cross = giverEntity !== e.legalEntityId;
      const rc = recharges.find(
        (r) =>
          r.contributionRequestId === c.id && r.status !== 'cancelled' && r.status !== 'blocked',
      );
      if (cross && !rc && c.status !== 'settled') missingRecharge++;
      const h = held.get(c.id)?.heldMinor ?? 0;
      return {
        id: c.id,
        giverBudgetId: c.giverBudgetId,
        giverBudgetName: giverName,
        mode: c.mode,
        status: c.status,
        approved: { amountMinor: c.approvedMinor ?? 0, currency: c.currency },
        held: { amountMinor: h, currency: giverCurrency },
        surplusShare: { amountMinor: e.status === 'closed' ? 0 : h, currency: giverCurrency },
        crossEntity: cross,
        rechargeStatus: rc?.status ?? null,
      };
    });
    const blockers: EventReconciliation['blockers'] = [];
    if (!['completed', 'reconciling', 'closed'].includes(e.status))
      blockers.push({
        code: 'INVALID_TRANSITION',
        message: 'The event is not completed yet.',
        count: 1,
      });
    if (Number(stats.unmatched) > 0)
      blockers.push({
        code: 'EVENT_HAS_UNMATCHED_ACTUALS',
        message: 'Match or exclude every actual before closing the event.',
        count: Number(stats.unmatched),
      });
    if (missingRecharge > 0)
      blockers.push({
        code: 'EVENT_MISSING_RECHARGE',
        message: 'Cross-entity contributions need their recharge before the event can close.',
        count: missingRecharge,
      });
    if (unaccrued > 0)
      blockers.push({
        code: 'EVENT_HAS_OPEN_COMMITMENTS',
        message: 'Release or accrue every open commitment before closing the event.',
        count: unaccrued,
      });
    const returned = await tx.select().from(surplusReturns).where(eq(surplusReturns.eventId, e.id));
    const names = await this.reads.budgetNames(
      tx,
      returned.map((r) => r.budgetId),
    );
    const [b] = e.budgetId
      ? await tx.select({ name: budgets.name }).from(budgets).where(eq(budgets.id, e.budgetId))
      : [];
    const surplus = contributions.reduce((s, c) => s + c.surplusShare.amountMinor, 0);
    return {
      event: {
        id: e.id,
        name: e.name,
        eventCode: e.eventCode,
        status: e.status,
        legalEntityId: e.legalEntityId,
        budgetId: e.budgetId,
        budgetName: b?.name ?? null,
      },
      actuals: {
        matched: Number(stats.matched),
        unmatched: Number(stats.unmatched),
        excluded: Number(stats.excluded),
        matchedReporting: { amountMinor: Number(stats.matchedReporting), currency: reporting },
        unmatchedReporting: { amountMinor: Number(stats.unmatchedReporting), currency: reporting },
        fxEffect: { amountMinor: Number(stats.fx), currency: reporting },
      },
      commitments: items,
      contributions,
      spent: { amountMinor: Number(stats.matchedReporting), currency: reporting },
      surplus: { amountMinor: surplus, currency: contributions[0]?.held.currency ?? reporting },
      blockers: e.status === 'closed' ? [] : blockers,
      canClose: e.status !== 'closed' && blockers.length === 0,
      surplusReturns: returned.map((r) => ({
        contributionId: r.contributionRequestId,
        budgetId: r.budgetId,
        budgetName: names.get(r.budgetId) ?? '',
        amount: { amountMinor: r.amountMinor, currency: r.currency },
        journalId: r.journalId,
      })),
    };
  }
}
