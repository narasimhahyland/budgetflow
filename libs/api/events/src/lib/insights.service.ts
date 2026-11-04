import { ApprovalsService, budgetResourceOf } from '@bf/api/approvals';
import { ContributionsService } from '@bf/api/contributions';
import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { budgets, contributionRequests, events, orgUnits, withTenant, type Db } from '@bf/api/db';
import { LedgerReads } from '@bf/api/ledger';
import { FundingSourcesService, RequestsService } from '@bf/api/spend';
import type { CofundingBoard, UtilizationReport } from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { desc, inArray, like, or } from 'drizzle-orm';
import { EventsService } from './events.service';

/** Live co-funding board (amounts per contributor, never balances) and utilization by location or team. */
@Injectable()
export class InsightsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly reads: LedgerReads,
    private readonly sources: FundingSourcesService,
    private readonly requests: RequestsService,
    private readonly contributions: ContributionsService,
    private readonly approvals: ApprovalsService,
    private readonly events: EventsService,
  ) {}

  board(actor: RequestActor): Promise<CofundingBoard> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const withContributions = await tx
        .selectDistinct({ e: contributionRequests.eventId })
        .from(contributionRequests);
      const ids = withContributions.map((r) => r.e).filter((x): x is string => Boolean(x));
      if (!ids.length) return { generatedAt: new Date().toISOString(), events: [] };
      const rows = (
        await tx.select().from(events).where(inArray(events.id, ids)).orderBy(desc(events.startsAt))
      ).slice(0, 50);
      const visible = [];
      for (const e of rows) if (await this.events.canRead(tx, actor, e)) visible.push(e);
      const contribs = await this.contributions.forEvents(
        tx,
        visible.map((e) => e.id),
      );
      const givers = await this.contributions.giverInfo(tx, contribs);
      const srcs = await this.sources.listForEvents(
        tx,
        visible.map((e) => e.id),
      );
      const out: CofundingBoard['events'] = [];
      for (const e of visible) {
        const m = (amountMinor: number) => ({ amountMinor, currency: e.currency });
        const mine = contribs.filter((c) => c.eventId === e.id);
        const own = srcs
          .filter((s) => s.eventId === e.id && s.kind === 'own')
          .reduce((a, s) => a + s.fundedMinor - s.returnedMinor, 0);
        const approved = srcs
          .filter((s) => s.eventId === e.id && s.kind === 'contribution')
          .reduce((a, s) => a + s.fundedMinor - s.returnedMinor, 0);
        const pending =
          mine
            .filter((c) => c.status === 'submitted' || c.status === 'pending_approval')
            .reduce((a, c) => a + c.requestedMinor, 0) +
          (await this.requests.pendingFunding(tx, e.id));
        const tol = Math.floor((e.estimateMinor * e.toleranceBps) / 10_000);
        const activity = await this.approvals.activity(
          tx,
          mine.map((c) => ({ type: 'contribution', id: c.id })),
        );
        out.push({
          id: e.id,
          name: e.name,
          eventCode: e.eventCode,
          status: e.status,
          startsAt: e.startsAt?.toISOString() ?? null,
          estimate: m(e.estimateMinor),
          cap: m(Math.min(own + approved, e.estimateMinor + tol)),
          ownFunds: m(own),
          approved: m(approved),
          pending: m(pending),
          gap: m(Math.max(e.estimateMinor - own - approved, 0)),
          fullyFunded: own + approved >= e.estimateMinor,
          contributions: mine.map((c) => ({
            id: c.id,
            ref: c.ref,
            giverBudgetName: givers.get(c.giverBudgetId)?.name ?? '',
            giverOwnerName: givers.get(c.giverBudgetId)?.ownerName ?? null,
            requested: { amountMinor: c.requestedMinor, currency: c.currency },
            approved:
              c.approvedMinor !== null
                ? { amountMinor: c.approvedMinor, currency: c.currency }
                : null,
            mode: c.mode,
            status: c.status,
            updatedAt: c.updatedAt.toISOString(),
          })),
          activity: activity.slice(0, 8).map((a) => ({
            at: a.at,
            text: `${a.actorName ?? 'BudgetFlow'}: ${a.summary}`,
          })),
        });
      }
      return { generatedAt: new Date().toISOString(), events: out };
    });
  }

  /** Utilization of the budgets the viewer may read, in the reporting currency; child allocations count once (net of allocated out). */
  utilization(
    actor: RequestActor,
    groupBy: 'location' | 'team' | 'budget',
  ): Promise<UtilizationReport> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const tenantWide = this.policy.can(actor, 'report.read', {
        kind: 'tenant',
        tenantId: actor.tenantId,
      }).allowed;
      if (!tenantWide && !actor.ownedBudgetPaths.length)
        throw ApiProblem.forbidden('Utilization is for budget owners and finance.');
      const rows = (
        await tx
          .select()
          .from(budgets)
          .where(
            actor.ownedBudgetPaths.length &&
              !this.policy.can(actor, 'budget.read', {
                kind: 'budget',
                tenantId: actor.tenantId,
                id: '',
                path: '/',
              }).allowed
              ? or(...actor.ownedBudgetPaths.map((p) => like(budgets.path, `${p}%`)))
              : undefined,
          )
      ).filter(
        (b) =>
          this.policy.can(actor, 'budget.read', budgetResourceOf(b)).allowed &&
          b.status !== 'cancelled',
      );
      const balances = await this.reads.balances(
        tx,
        rows.map((r) => r.id),
      );
      const unitIds = [
        ...new Set(rows.map((r) => r.orgUnitId).filter((x): x is string => Boolean(x))),
      ];
      const units = unitIds.length
        ? await tx.select().from(orgUnits).where(inArray(orgUnits.id, unitIds))
        : [];
      const groups = new Map<
        string,
        {
          id: string | null;
          name: string;
          budgets: number;
          a: number;
          h: number;
          p: number;
          c: number;
          act: number;
        }
      >();
      for (const b of rows) {
        const unit = units.find((u) => u.id === b.orgUnitId);
        const [key, id, name] =
          groupBy === 'budget'
            ? [b.id, b.id, b.name]
            : groupBy === 'location'
              ? unit &&
                (unit.kind === 'location' || unit.kind === 'region' || unit.kind === 'company')
                ? [unit.id, unit.id, unit.name]
                : ['none', null, 'Other']
              : unit &&
                  (unit.kind === 'team' ||
                    unit.kind === 'department' ||
                    unit.kind === 'business_unit')
                ? [unit.id, unit.id, unit.name]
                : ['none', null, 'No team'];
        const r = balances.get(b.id)!.reporting;
        const g = groups.get(key) ?? { id, name, budgets: 0, a: 0, h: 0, p: 0, c: 0, act: 0 };
        g.budgets += 1;
        g.a += r.authorized - r.allocated_out;
        g.h += r.held;
        g.p += r.pre_encumbered;
        g.c += r.encumbered;
        g.act += r.actual;
        groups.set(key, g);
      }
      const ccy = actor.reportingCurrency;
      const m = (amountMinor: number) => ({ amountMinor, currency: ccy });
      const toRow = (g: {
        id: string | null;
        name: string;
        budgets: number;
        a: number;
        h: number;
        p: number;
        c: number;
        act: number;
      }) => {
        const used = g.h + g.p + g.c + g.act;
        return {
          id: g.id,
          name: g.name,
          budgets: g.budgets,
          authorized: m(g.a),
          held: m(g.h),
          pending: m(g.p),
          committed: m(g.c),
          actual: m(g.act),
          available: m(g.a - used),
          utilizationBps: g.a > 0 ? Math.round((used * 10_000) / g.a) : 0,
        };
      };
      const list = [...groups.values()].sort((x, y) => y.a - x.a);
      const total = list.reduce(
        (t, g) => ({
          ...t,
          budgets: t.budgets + g.budgets,
          a: t.a + g.a,
          h: t.h + g.h,
          p: t.p + g.p,
          c: t.c + g.c,
          act: t.act + g.act,
        }),
        { id: null, name: 'Total', budgets: 0, a: 0, h: 0, p: 0, c: 0, act: 0 },
      );
      return {
        groupBy,
        currency: ccy,
        rows: list.map(toRow),
        totals: toRow(total),
        generatedAt: new Date().toISOString(),
      };
    });
  }
}
