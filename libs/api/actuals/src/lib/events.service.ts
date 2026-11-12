import {
  actuals,
  budgets,
  commitments,
  contributionRequests,
  events,
  rechargeSchedules,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { IntercompanyService } from '@bf/api/contributions';
import { EventCloseChecks, EventsService } from '@bf/api/events';
import { FundingSourcesService } from '@bf/api/spend';
import type { EventReconciliation, EventReconciliationList } from '@bf/contracts';
import { needsAccrual } from '@bf/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ActualsReads, tenantOf, todayUtc } from './actuals-reads';
import { CommitmentsService } from './commitments.service';

type EventRow = typeof events.$inferSelect;

const UNMATCHED = 'Match or exclude every actual before closing the event.';
const UNACCRUED =
  'Release or accrue every commitment whose service has ended before closing the event.';

/**
 * Event reconciliation. The close itself is Phase 5's (`POST /api/events/{id}/close`: it releases open
 * commitments and returns each funding source's surplus); this service registers the Phase 6 checks that
 * block it - actuals with the event code still unmatched, and commitments past their service end with
 * neither an invoice nor an accrual - and shows everything the close depends on.
 */
@Injectable()
export class EventsCloseService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly reads: ActualsReads,
    private readonly commitmentsSvc: CommitmentsService,
    private readonly closeChecks: EventCloseChecks,
    private readonly events: EventsService,
    private readonly intercompany: IntercompanyService,
    private readonly sources: FundingSourcesService,
  ) {}

  onModuleInit(): void {
    this.closeChecks.register(async (tx, eventId) => {
      const [e] = await tx
        .select({ eventCode: events.eventCode })
        .from(events)
        .where(eq(events.id, eventId));
      const count = e ? (await this.actualStats(tx, e.eventCode, eventId)).unmatched : 0;
      return count > 0 ? { code: 'EVENT_HAS_UNMATCHED_ACTUALS', message: UNMATCHED, count } : null;
    });
    this.closeChecks.register(async (tx, eventId) => {
      const count = await this.unaccrued(tx, eventId);
      return count > 0 ? { code: 'EVENT_HAS_OPEN_COMMITMENTS', message: UNACCRUED, count } : null;
    });
  }

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

  /**
   * The event's actuals, from manual entries and posted imports: lines carrying the event code, and
   * lines matched to one of the event's commitments without it (a taxi receipt matched by hand from
   * the queue is still event spend, and the surplus at close already counts it).
   */
  private async actualStats(tx: Tx, eventCode: string, eventId: string) {
    const [s] = await tx
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
          or(
            eq(actuals.eventCode, eventCode),
            sql`${actuals.matchedCommitmentId} in (select id from commitments where event_id = ${eventId}::uuid)`,
            sql`${actuals.id} in (select m.actual_id from actual_matches m join commitments c on c.id = m.commitment_id where c.event_id = ${eventId}::uuid)`,
          ),
          or(
            isNull(actuals.importBatchId),
            sql`${actuals.importBatchId} in (select id from import_batches where status = 'posted')`,
          ),
        ),
      );
    return {
      matched: Number(s.matched),
      unmatched: Number(s.unmatched),
      excluded: Number(s.excluded),
      matchedReporting: Number(s.matchedReporting),
      unmatchedReporting: Number(s.unmatchedReporting),
      fx: Number(s.fx),
    };
  }

  /** Open commitments past their service end with encumbrance left and no live accrual. */
  private async unaccrued(tx: Tx, eventId: string): Promise<number> {
    const open = await tx
      .select({ id: commitments.id, serviceEnd: commitments.serviceEnd })
      .from(commitments)
      .where(
        and(
          eq(commitments.eventId, eventId),
          inArray(commitments.status, ['encumbered', 'partially_consumed']),
        ),
      );
    const balances = await this.reads.commitmentBalances(
      tx,
      open.map((c) => c.id),
    );
    const asOf = todayUtc();
    return open.filter((c) => {
      const b = balances.get(c.id);
      return needsAccrual({
        serviceEnd: c.serviceEnd,
        remainingMinor: b?.encumberedMinor ?? 0,
        hasLiveAccrual: (b?.accruedMinor ?? 0) > 0,
        asOf,
      });
    }).length;
  }

  private async reconciliation(
    tx: Tx,
    actor: RequestActor,
    e: EventRow,
  ): Promise<EventReconciliation> {
    const reporting = actor.reportingCurrency;
    const stats = await this.actualStats(tx, e.eventCode, e.id);
    const cRows = await tx
      .select()
      .from(commitments)
      .where(eq(commitments.eventId, e.id))
      .orderBy(asc(commitments.id));
    const items = await this.commitmentsSvc.items(tx, actor, cRows, todayUtc());
    const unaccrued = await this.unaccrued(tx, e.id);
    const missingRecharge = await this.intercompany.missingRecharges(tx, e.id);

    const srcs = await this.sources.list(tx, e.id);
    const names = await this.reads.budgetNames(
      tx,
      srcs.map((s) => s.originBudgetId),
    );
    const contributionIds = srcs
      .map((s) => s.contributionRequestId)
      .filter((x): x is string => Boolean(x));
    const contribs = contributionIds.length
      ? await tx
          .select({
            id: contributionRequests.id,
            recharge: contributionRequests.rechargeScheduleId,
            giverEntity: budgets.legalEntityId,
          })
          .from(contributionRequests)
          .innerJoin(budgets, eq(budgets.id, contributionRequests.giverBudgetId))
          .where(inArray(contributionRequests.id, contributionIds))
      : [];
    const rechargeIds = contribs.map((c) => c.recharge).filter((x): x is string => Boolean(x));
    const recharges = rechargeIds.length
      ? await tx
          .select({ id: rechargeSchedules.id, status: rechargeSchedules.status })
          .from(rechargeSchedules)
          .where(inArray(rechargeSchedules.id, rechargeIds))
      : [];
    const sources = srcs.map((s) => {
      const c = contribs.find((x) => x.id === s.contributionRequestId);
      const left =
        s.status === 'active' ? Math.max(0, s.fundedMinor - s.consumedMinor - s.returnedMinor) : 0;
      return {
        id: s.id,
        kind: s.kind === 'own' ? ('own' as const) : ('contribution' as const),
        budgetId: s.originBudgetId,
        budgetName: names.get(s.originBudgetId) ?? '',
        contributionId: s.contributionRequestId,
        mode: s.mode,
        status: s.status,
        funded: { amountMinor: s.fundedMinor, currency: s.currency },
        consumed: { amountMinor: s.consumedMinor, currency: s.currency },
        surplusShare: { amountMinor: left, currency: s.currency },
        returned: { amountMinor: s.returnedMinor, currency: s.currency },
        crossEntity: c ? c.giverEntity !== e.legalEntityId : false,
        rechargeStatus: recharges.find((r) => r.id === c?.recharge)?.status ?? null,
      };
    });

    const blockers: EventReconciliation['blockers'] = [];
    if (!['completed', 'reconciling', 'closed'].includes(e.status))
      blockers.push({
        code: 'INVALID_TRANSITION',
        message: 'The event is not completed yet.',
        count: 1,
      });
    if (stats.unmatched > 0)
      blockers.push({
        code: 'EVENT_HAS_UNMATCHED_ACTUALS',
        message: UNMATCHED,
        count: stats.unmatched,
      });
    if (missingRecharge > 0)
      blockers.push({
        code: 'EVENT_MISSING_RECHARGE',
        message:
          'Cross-entity contributions need their recharge approved before the event can close.',
        count: missingRecharge,
      });
    if (unaccrued > 0)
      blockers.push({ code: 'EVENT_HAS_OPEN_COMMITMENTS', message: UNACCRUED, count: unaccrued });

    const [b] = e.budgetId
      ? await tx.select({ name: budgets.name }).from(budgets).where(eq(budgets.id, e.budgetId))
      : [];
    const currency = srcs[0]?.currency ?? reporting;
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
        matched: stats.matched,
        unmatched: stats.unmatched,
        excluded: stats.excluded,
        matchedReporting: { amountMinor: stats.matchedReporting, currency: reporting },
        unmatchedReporting: { amountMinor: stats.unmatchedReporting, currency: reporting },
        fxEffect: { amountMinor: stats.fx, currency: reporting },
      },
      commitments: items,
      sources,
      spent: { amountMinor: stats.matchedReporting, currency: reporting },
      surplus: {
        amountMinor: sources.reduce((s, x) => s + x.surplusShare.amountMinor, 0),
        currency,
      },
      blockers: e.status === 'closed' ? [] : blockers,
      canClose: e.status !== 'closed' && blockers.length === 0,
      canManage: await this.events.canManage(tx, actor, e),
      surplusReturns: sources
        .filter((s) => s.returned.amountMinor > 0)
        .map((s) => ({
          sourceId: s.id,
          budgetId: s.budgetId,
          budgetName: s.budgetName,
          amount: s.returned,
        })),
    };
  }
}
