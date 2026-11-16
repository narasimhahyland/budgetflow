import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  todayUtc,
  type RequestActor,
} from '@bf/api/core';
import {
  budgets,
  burnRateAlerts,
  burnRateRuns,
  outboxMessages,
  tenants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads } from '@bf/api/ledger';
import { formatMoney, noticeEmail, NotificationsService } from '@bf/api/notifications';
import type {
  BurnRateAlert,
  BurnRateAlertList,
  BurnRateRun,
  CreateBurnRateRunRequest,
} from '@bf/contracts';
import {
  DEFAULT_BURN_RATE_THRESHOLDS,
  evaluateBurnRate,
  evenPhasedToDate,
  phasedToDate,
  type BurnRateLevel,
  type Resource,
} from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { CommandContext } from './close-reads';

/** Outbox topic and worker queue for one burn-rate run. */
export const BURN_RATE_TOPIC = 'budgets.burn_rate_sweep';
/** Nightly schedule: one run per tenant at the worker's today. */
export const BURN_RATE_NIGHTLY = 'budgets.burn_rate_nightly';

type RunRow = typeof burnRateRuns.$inferSelect;

const SKIPPED_STATUSES = ['draft', 'closed', 'cancelled', 'expired'];
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

/**
 * Burn-rate alerts (gap B4): owners hear when actual spend runs ahead of the budget's phasing. A run
 * is requested through the API (or nightly) and executed by the worker at a fixed as-of date. Every
 * alert is unique per budget, fiscal period and level, so running again finds nothing new; a run
 * that is no longer queued is never executed twice. Alerts reach the owner through the existing
 * notifications (in-app and the channels they chose, plus email). They never block anything.
 */
@Injectable()
export class BurnRateService {
  private readonly log = new Logger('BurnRate');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: LedgerReads,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private tenant(actor: RequestActor): Resource {
    return { kind: 'tenant', tenantId: actor.tenantId };
  }

  private view(r: RunRow): BurnRateRun {
    return {
      id: r.id,
      asOf: r.asOf,
      status: r.status as BurnRateRun['status'],
      trigger: r.trigger as BurnRateRun['trigger'],
      evaluatedCount: r.evaluatedCount,
      alertsRaised: r.alertsRaised,
      createdAt: iso(r.createdAt)!,
      completedAt: iso(r.completedAt),
    };
  }

  request(actor: RequestActor, req: CreateBurnRateRunRequest, ctx: CommandContext) {
    this.policy.assert(actor, 'burn_rate.run', this.tenant(actor));
    return this.commands.run(
      actor,
      { idempotencyKey: ctx.idempotencyKey, operation: 'burn_rate.run', request: req, status: 202 },
      async (tx) => {
        const asOf = req.asOf ?? todayUtc();
        // A future date would measure spend that has not happened and use up the once-per-period
        // alert of a period that has not started; a past date measures a period that did happen.
        if (asOf > todayUtc())
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'Choose today or an earlier date.', {
            field: 'asOf',
          });
        const [run] = await tx
          .insert(burnRateRuns)
          .values({
            tenantId: actor.tenantId,
            asOf,
            trigger: 'manual',
            requestedBy: actor.personId,
          })
          .returning();
        await tx
          .insert(outboxMessages)
          .values({ tenantId: actor.tenantId, topic: BURN_RATE_TOPIC, payload: { runId: run.id } });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'burn_rate.run_requested',
          resourceType: 'burn_rate_run',
          resourceId: run.id,
          legalEntityId: null,
          requestId: ctx.requestId,
          reason: `Burn-rate check as of ${asOf}`,
          changes: { status: { from: null, to: 'queued' }, asOf: { from: null, to: asOf } },
        });
        return this.view(run);
      },
    );
  }

  getRun(actor: RequestActor, runId: string): Promise<BurnRateRun> {
    if (
      !this.policy.can(actor, 'burn_rate.run', this.tenant(actor)).allowed &&
      !this.policy.can(actor, 'reclaim.read', this.tenant(actor)).allowed
    )
      throw ApiProblem.forbidden('Only finance can see burn-rate runs.');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [r] = await tx.select().from(burnRateRuns).where(eq(burnRateRuns.id, runId));
      if (!r) throw ApiProblem.notFound('burn-rate run');
      return this.view(r);
    });
  }

  alerts(
    actor: RequestActor,
    q: { budgetId?: string; runId?: string },
  ): Promise<BurnRateAlertList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      // Scope in SQL: a tenant-wide reader sees every alert, anyone else the subtrees they own.
      const tenantWide = this.policy.can(actor, 'budget.read', {
        kind: 'budget',
        tenantId: actor.tenantId,
        id: '',
        path: '/',
      }).allowed;
      const owned = actor.ownedBudgetPaths;
      if (!tenantWide && !owned.length) return { items: [] };
      const scope = tenantWide
        ? undefined
        : sql`(${sql.join(
            owned.map((p) => sql`left(${budgets.path}, ${p.length}) = ${p}`),
            sql` or `,
          )})`;
      const rows = await tx
        .select({ a: burnRateAlerts, b: budgets })
        .from(burnRateAlerts)
        .innerJoin(budgets, eq(budgets.id, burnRateAlerts.budgetId))
        .where(
          and(
            scope,
            q.budgetId ? eq(burnRateAlerts.budgetId, q.budgetId) : undefined,
            q.runId ? eq(burnRateAlerts.runId, q.runId) : undefined,
          ),
        )
        .orderBy(desc(burnRateAlerts.createdAt), desc(burnRateAlerts.id))
        .limit(200);
      const items: BurnRateAlert[] = rows.map(({ a, b }) => ({
        id: a.id,
        budgetId: a.budgetId,
        budgetName: b.name,
        fiscalPeriodId: a.fiscalPeriodId,
        level: a.level as BurnRateLevel,
        burnBps: a.burnBps,
        spent: { amountMinor: a.spentMinor, currency: a.currency },
        phased: { amountMinor: a.phasedMinor, currency: a.currency },
        asOf: a.asOf,
        runId: a.runId,
        createdAt: iso(a.createdAt)!,
      }));
      return { items };
    });
  }

  // Worker side -----------------------------------------------------------------------------------

  /**
   * Nightly check for every tenant at the worker's today. A tenant that already has a nightly run
   * for the day reuses it (a retried job never adds a second), and one tenant failing marks its run
   * failed and never stops the others.
   */
  async runNightly(): Promise<number> {
    const all = await this.db.transaction((tx) => tx.select({ id: tenants.id }).from(tenants));
    const asOf = todayUtc();
    let raised = 0;
    for (const t of all) {
      const run = await withTenant(
        this.db,
        { tenantId: t.id, subject: 'system:worker' },
        async (tx) => {
          const [existing] = await tx
            .select()
            .from(burnRateRuns)
            .where(and(eq(burnRateRuns.asOf, asOf), eq(burnRateRuns.trigger, 'nightly')));
          if (existing) return existing;
          const [created] = await tx
            .insert(burnRateRuns)
            .values({ tenantId: t.id, asOf, trigger: 'nightly' })
            .returning();
          return created;
        },
      );
      try {
        raised += await this.execute(t.id, run.id);
      } catch (e) {
        this.log.error(`nightly burn-rate run failed for a tenant: ${(e as Error).message}`);
        await this.fail(t.id, run.id, (e as Error).message);
      }
    }
    return raised;
  }

  /**
   * Executes one queued run: measures every open budget whose fiscal year contains the as-of date,
   * records an alert per new level reached in the current period and notifies the owner. A run that
   * is not queued any more was executed before, so a redelivered job does nothing.
   */
  async execute(tenantId: string, runId: string): Promise<number> {
    return withTenant(this.db, { tenantId, subject: 'system:worker' }, async (tx) => {
      const [run] = await tx
        .select()
        .from(burnRateRuns)
        .where(eq(burnRateRuns.id, runId))
        .for('update');
      if (!run || run.status !== 'queued') return 0;
      const facts = await this.facts(tx, run.asOf);
      let raised = 0;
      for (const f of facts) {
        const own = f.authorized - f.allocatedOut;
        const phased =
          f.phasingCount > 0
            ? phasedToDate(f.periods, run.asOf)
            : evenPhasedToDate(own, { startDate: f.fyStart, endDate: f.fyEnd }, run.asOf);
        const outcome = evaluateBurnRate(f.spent, phased, DEFAULT_BURN_RATE_THRESHOLDS);
        if (!outcome.level) continue;
        if (outcome.level === 'ahead') {
          const [prior] = await tx
            .select({ id: burnRateAlerts.id })
            .from(burnRateAlerts)
            .where(
              and(eq(burnRateAlerts.budgetId, f.id), eq(burnRateAlerts.fiscalPeriodId, f.periodId)),
            );
          if (prior) continue;
        }
        const inserted = await tx
          .insert(burnRateAlerts)
          .values({
            tenantId,
            budgetId: f.id,
            fiscalPeriodId: f.periodId,
            level: outcome.level,
            burnBps: outcome.burnBps,
            spentMinor: f.spent,
            phasedMinor: phased,
            currency: f.currency,
            ownerPersonId: f.ownerPersonId,
            runId,
            asOf: run.asOf,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted.length) continue;
        raised++;
        if (f.ownerPersonId) await this.notify(tx, tenantId, f, inserted[0], phased);
      }
      await tx
        .update(burnRateRuns)
        .set({
          status: 'completed',
          evaluatedCount: facts.length,
          alertsRaised: raised,
          completedAt: new Date(),
        })
        .where(eq(burnRateRuns.id, runId));
      this.log.log(`burn-rate run ${runId}: ${facts.length} budget(s), ${raised} alert(s)`);
      return raised;
    });
  }

  /** Marks a run failed after its last retry, so the screen shows it rather than "queued" forever. */
  async fail(tenantId: string, runId: string, error: string): Promise<void> {
    await withTenant(this.db, { tenantId, subject: 'system:worker' }, (tx) =>
      tx
        .update(burnRateRuns)
        .set({ status: 'failed', error: error.slice(0, 500), completedAt: new Date() })
        .where(and(eq(burnRateRuns.id, runId), eq(burnRateRuns.status, 'queued'))),
    );
  }

  private async facts(tx: Tx, asOf: string) {
    const res = await tx.execute<{
      id: string;
      name: string;
      currency: string;
      owner_person_id: string | null;
      fy_start: string;
      fy_end: string;
      period_id: string;
      authorized: string;
      allocated_out: string;
      spent: string;
      phasing_count: string;
    }>(sql`
      select b.id, b.name, b.currency, b.owner_person_id,
        fy.start_date::text as fy_start, fy.end_date::text as fy_end, fp.id as period_id,
        coalesce((select -sum(lb.budget_amount_minor) from ledger_balances lb
                  where lb.budget_id = b.id and lb.bucket = 'authorized'), 0)::text as authorized,
        coalesce((select sum(lb.budget_amount_minor) from ledger_balances lb
                  where lb.budget_id = b.id and lb.bucket = 'allocated_out'), 0)::text as allocated_out,
        coalesce((select sum(l.budget_amount_minor) from ledger_lines l
                  where l.budget_id = b.id and l.account = 'actual'
                    and l.accounting_date <= ${asOf}::date), 0)::text as spent,
        (select count(*) from budget_period_allotments a where a.budget_id = b.id)::text as phasing_count
      from budgets b
      join fiscal_years fy on fy.id = b.fiscal_year_id
      join legal_entities le on le.id = b.legal_entity_id
      join fiscal_periods fp on fp.fiscal_year_id = fy.id
        and fp.fiscal_calendar_id = le.fiscal_calendar_id
        and fp.start_date <= ${asOf}::date and fp.end_date >= ${asOf}::date
      where fy.start_date <= ${asOf}::date and fy.end_date >= ${asOf}::date
        and b.status not in (${sql.join(
          SKIPPED_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})
      order by b.path, b.id`);
    const ids = res.rows.filter((r) => Number(r.phasing_count) > 0).map((r) => r.id);
    const periods = new Map<
      string,
      { startDate: string; endDate: string; amountMinor: number }[]
    >();
    if (ids.length) {
      const p = await tx.execute<{
        budget_id: string;
        start_date: string;
        end_date: string;
        amount: string;
      }>(sql`
        select a.budget_id, fp.start_date::text as start_date, fp.end_date::text as end_date,
          a.amount_minor::text as amount
        from budget_period_allotments a join fiscal_periods fp on fp.id = a.fiscal_period_id
        where a.budget_id in (${sql.join(
          ids.map((i) => sql`${i}::uuid`),
          sql`, `,
        )})`);
      for (const r of p.rows) {
        const list = periods.get(r.budget_id) ?? [];
        list.push({ startDate: r.start_date, endDate: r.end_date, amountMinor: Number(r.amount) });
        periods.set(r.budget_id, list);
      }
    }
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      currency: r.currency,
      ownerPersonId: r.owner_person_id,
      fyStart: r.fy_start,
      fyEnd: r.fy_end,
      periodId: r.period_id,
      authorized: Number(r.authorized),
      allocatedOut: Number(r.allocated_out),
      spent: Number(r.spent),
      phasingCount: Number(r.phasing_count),
      periods: periods.get(r.id) ?? [],
    }));
  }

  private async notify(
    tx: Tx,
    tenantId: string,
    f: { id: string; name: string; currency: string; ownerPersonId: string | null },
    alert: typeof burnRateAlerts.$inferSelect,
    phased: number,
  ): Promise<void> {
    const spent = formatMoney({ amountMinor: alert.spentMinor, currency: f.currency });
    const plan = formatMoney({ amountMinor: phased, currency: f.currency });
    const title =
      alert.level === 'well_ahead'
        ? `${f.name} is spending well ahead of plan: ${pct(alert.burnBps)} of phased to date`
        : `${f.name} is spending ahead of plan: ${pct(alert.burnBps)} of phased to date`;
    const detail = `Actual spend ${spent} against ${plan} phased to ${alert.asOf}.`;
    await tx.insert(outboxMessages).values({
      tenantId,
      topic: 'channel.deliver',
      payload: {
        kind: 'budget.burn_rate',
        recipientPersonId: f.ownerPersonId,
        subjectType: 'budget',
        subjectId: f.id,
        title,
        detail,
        tone: alert.level === 'well_ahead' ? 'important' : 'warning',
        amountMinor: alert.spentMinor,
        currency: f.currency,
      },
    });
    const to = await this.notifications.personEmail(tx, f.ownerPersonId!);
    if (!to) return;
    await this.notifications.queueEmail(
      tx,
      tenantId,
      to,
      noticeEmail({
        firstName: to.firstName,
        subject: title,
        headline: `${detail} Review upcoming spend or ask for more budget before the period ends.`,
        lines: [
          ['Budget', f.name],
          ['Actual spend to date', spent],
          ['Phased to date', plan],
          ['Burn rate', pct(alert.burnBps)],
        ],
        detailsUrl: `${this.notifications.webBaseUrl}/budgets/${f.id}`,
      }),
      'budget.burn_rate',
      { subjectType: 'budget', subjectId: f.id },
    );
  }
}
