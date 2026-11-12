import { PeriodCloseService } from '@bf/api/close';
import {
  ApiProblem,
  CommandRunner,
  DB,
  nowUtc,
  PolicyService,
  todayUtc,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { withTenant, type Db, type Tx } from '@bf/api/db';
import { AnalyticsService } from '@bf/api/tenancy';
import type {
  AlertDecisionRequest,
  AlertKind,
  AlertSeverity,
  AlertsOverview,
  AlertTab,
  BudgetAlert,
  ExceptionItem,
  ExceptionsOverview,
  ControlExceptionType,
  ExceptionTypeRow,
  FinanceOverview,
  FinanceQueueTile,
  Money,
} from '@bf/contracts';
import { deriveBudgetAlerts, SEVERITY_RANK, type DerivedAlert } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { HealthService } from './health.service';
import { ReportReads } from './report-reads.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const SNOOZE_DAYS = 7;
const RESOLVED_KEEP_DAYS = 30;
/** Post-spend exceptions above this (reporting minor units) need the controller, not the owner. */
const FINANCE_REVIEW_MINOR = 50_000;

/** How often each actual source is expected to deliver; a feed older than this is late. */
const FEED_INTERVAL_HOURS: Record<string, { label: string; hours: number }> = {
  file: { label: 'File upload', hours: 7 * 24 },
  card: { label: 'Card feed', hours: 24 },
  expense: { label: 'Expense feed', hours: 24 },
  erp: { label: 'ERP feed', hours: 24 },
  travel: { label: 'Travel feed', hours: 24 },
};

const LEDGER_FLAG_KINDS = [
  'ledger_drift',
  'journal_unbalanced',
  'negative_bucket',
  'over_allocated',
  'triplet_mismatch',
  'audit_chain_broken',
];

const n = (v: unknown): number => Number(v ?? 0);
const days = (from: Date | string | null, now: Date): number | null =>
  from ? Math.max(Math.floor((now.getTime() - new Date(from).getTime()) / DAY_MS), 0) : null;
const iso = (v: Date | string | null): string | null => (v ? new Date(v).toISOString() : null);

interface DecisionEvent {
  key: string;
  decision: 'acknowledge' | 'snooze';
  at: Date;
}

/**
 * Gap package B2 dashboards (012, 017, 017a). Each read asks `PolicyService` first, runs under the
 * tenant's RLS context and filters in SQL; the pages only arrange what comes back.
 */
@Injectable()
export class DashboardsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly reads: ReportReads,
    private readonly health: HealthService,
    private readonly close: PeriodCloseService,
    private readonly commands: CommandRunner,
    private readonly analytics: AnalyticsService,
  ) {}

  private tenant(actor: RequestActor) {
    return { kind: 'tenant' as const, tenantId: actor.tenantId };
  }

  private assertTenantReports(actor: RequestActor, what: string): void {
    if (!this.reads.tenantWide(actor)) throw ApiProblem.forbidden(`${what} is for finance roles.`);
  }

  // 012 -------------------------------------------------------------------------------------------

  async finance(actor: RequestActor): Promise<FinanceOverview> {
    this.assertTenantReports(actor, 'The finance overview');
    const integrityAllowed = this.policy.can(actor, 'integrity.read', this.tenant(actor)).allowed;
    const close = await this.close.closing(actor);
    const periodIds = close.map((c) => c.period.id);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const now = nowUtc();
      const today = todayUtc();
      const currency = actor.reportingCurrency;
      const money = (amountMinor: number): Money => ({ amountMinor, currency });
      const [tiles, recharges, integrity, feeds, fx] = await Promise.all([
        this.financeTiles(tx, actor, now, today, money),
        this.rechargeStatus(tx, periodIds),
        integrityAllowed ? this.integrity(tx) : Promise.resolve(null),
        this.feeds(tx, now),
        this.fxEffect(tx, today, money),
      ]);
      const allClear =
        close.length > 0 &&
        close.every((c) => c.entities.every((e) => e.checks.every((k) => k.status === 'pass')));
      return {
        generatedAt: now.toISOString(),
        asOf: today,
        currency,
        close,
        recharges,
        allClear,
        tiles,
        integrity,
        feeds,
        fx,
      };
    });
  }

  private async financeTiles(
    tx: Tx,
    actor: RequestActor,
    now: Date,
    today: string,
    money: (m: number) => Money,
  ): Promise<FinanceQueueTile[]> {
    const fmt = (m: number) => formatMoney(m, money(0).currency);
    const [unmatched] = (
      await tx.execute<{ n: string; amount: string; oldest: string | null }>(sql`
        select count(*)::text as n,
               coalesce(sum(case when a.match_status = 'unmatched' then a.reporting_amount_minor
                 else (a.reporting_amount_minor * (abs(a.transaction_amount_minor) - abs(a.matched_minor)))
                      / nullif(abs(a.transaction_amount_minor), 0) end), 0)::text as amount,
               min(a.transaction_date)::text as oldest
        from actuals a
        where a.match_status in ('unmatched', 'partially_matched')
          and (a.import_batch_id is null
               or a.import_batch_id in (select id from import_batches where status = 'posted'))`)
    ).rows;
    const [exceptions] = (
      await tx.execute<{ n: string; big: string; oldest: string | null; amount: string }>(sql`
        select count(*)::text as n,
               count(*) filter (where reporting_amount_minor > ${FINANCE_REVIEW_MINOR})::text as big,
               min(created_at)::text as oldest,
               coalesce(sum(reporting_amount_minor), 0)::text as amount
        from post_spend_exceptions where status in ('open', 'explained')`)
    ).rows;
    const [accruals] = (
      await tx.execute<{ n: string; amount: string; oldest: string | null }>(sql`
        select count(*)::text as n, coalesce(sum(amount_minor), 0)::text as amount,
               min(accrual_date)::text as oldest
        from accruals where status = 'proposed'`)
    ).rows;
    const [recharges] = (
      await tx.execute<{ n: string; amount: string; oldest: string | null }>(sql`
        select count(*)::text as n, coalesce(sum(amount_minor + markup_minor), 0)::text as amount,
               min(created_at)::text as oldest
        from recharge_schedules where status = 'pending_tax_approval'`)
    ).rows;
    const [stale] = (
      await tx.execute<{ n: string; amount: string; oldest: string | null }>(sql`
        select count(*)::text as n,
               coalesce(sum(greatest(amount_minor - consumed_minor - released_minor, 0)), 0)::text as amount,
               min(service_end)::text as oldest
        from commitments
        where status in ('pre_encumbered', 'encumbered', 'partially_consumed')
          and service_end is not null and service_end < ${today}::date`)
    ).rows;
    const [escalated] = actor.personId
      ? (
          await tx.execute<{ n: string; oldest: string | null }>(sql`
            select count(*)::text as n, min(created_at)::text as oldest
            from approval_tasks
            where status = 'pending' and escalated_from_task_id is not null
              and assignee_person_id = ${actor.personId}::uuid`)
        ).rows
      : [{ n: '0', oldest: null }];

    const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
    return [
      {
        key: 'unmatched_actuals',
        label: 'Unmatched actuals',
        count: n(unmatched.n),
        amount: money(n(unmatched.amount)),
        oldestDays: days(unmatched.oldest, now),
        detail: `${plural(n(unmatched.n), 'line')}, ${fmt(n(unmatched.amount))}${unmatched.oldest ? `, oldest ${days(unmatched.oldest, now)} days` : ''}.`,
        link: '/finance/actuals/queue',
      },
      {
        key: 'post_spend_exceptions',
        label: 'Post-spend exceptions',
        count: n(exceptions.n),
        amount: money(n(exceptions.amount)),
        oldestDays: days(exceptions.oldest, now),
        detail: `${n(exceptions.n)} open, ${n(exceptions.big)} above ${fmt(FINANCE_REVIEW_MINOR)} need you.`,
        link: '/admin/rules/exceptions',
      },
      {
        key: 'accrual_proposals',
        label: 'Accrual proposals',
        count: n(accruals.n),
        amount: money(n(accruals.amount)),
        oldestDays: days(accruals.oldest, now),
        detail: `${plural(n(accruals.n), 'proposal')}, ${fmt(n(accruals.amount))}.`,
        link: '/finance/actuals/accruals',
      },
      {
        key: 'recharges_pending_tax',
        label: 'Recharges awaiting tax approval',
        count: n(recharges.n),
        amount: money(n(recharges.amount)),
        oldestDays: days(recharges.oldest, now),
        detail: `${plural(n(recharges.n), 'recharge')}, ${fmt(n(recharges.amount))}.`,
        link: '/finance/recharges',
      },
      {
        key: 'stale_commitments',
        label: 'Stale commitments',
        count: n(stale.n),
        amount: money(n(stale.amount)),
        oldestDays: days(stale.oldest, now),
        detail: `${plural(n(stale.n), 'commitment')}, ${fmt(n(stale.amount))} past service end.`,
        link: '/finance/actuals/commitments',
      },
      {
        key: 'escalated_approvals',
        label: 'Approvals escalated to you',
        count: n(escalated.n),
        amount: null,
        oldestDays: days(escalated.oldest, now),
        detail: `${plural(n(escalated.n), 'approval')} escalated to you.`,
        link: '/approvals',
      },
    ];
  }

  private async rechargeStatus(tx: Tx, periodIds: readonly string[]) {
    if (!periodIds.length) return [];
    const res = await tx.execute<{
      entity: string;
      pending: string;
      waiting: string;
      posted: string;
    }>(sql`
      select e.entity,
        count(*) filter (where r.status = 'pending_tax_approval')::text as pending,
        count(*) filter (where r.status in ('proposed', 'approved', 'scheduled', 'exported'))::text as waiting,
        count(*) filter (where r.status = 'posted')::text as posted
      from recharge_schedules r
      cross join lateral (values (r.from_legal_entity_id), (r.to_legal_entity_id)) as e(entity)
      where r.due_period_id in (${sql.join(
        periodIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      group by e.entity
      order by e.entity`);
    return res.rows.map((r) => ({
      legalEntityId: r.entity,
      pendingTaxApproval: n(r.pending),
      awaitingPosting: n(r.waiting),
      posted: n(r.posted),
    }));
  }

  private async integrity(tx: Tx): Promise<FinanceOverview['integrity']> {
    const [run] = (
      await tx.execute<{
        id: string;
        status: 'queued' | 'running' | 'clean' | 'drift_detected' | 'failed';
        trigger: string;
        requested_at: string;
        finished_at: string | null;
        summary: {
          budgetsChecked?: number;
          auditChain?: { valid: boolean; checked: number; firstBrokenSeq: number | null };
        } | null;
        flags_raised: number;
      }>(sql`
        select id, status, trigger, requested_at, finished_at, summary, flags_raised
        from integrity_check_runs where kind = 'ledger_rebuild'
        order by requested_at desc limit 1`)
    ).rows;
    const [open] = (
      await tx.execute<{ n: string }>(sql`
        select count(*)::text as n from integrity_flags
        where status = 'open' and kind::text in (${sql.join(
          LEDGER_FLAG_KINDS.map((k) => sql`${k}`),
          sql`, `,
        )})`)
    ).rows;
    const chain = run?.summary?.auditChain;
    return {
      lastRun: run
        ? {
            id: run.id,
            status: run.status,
            trigger: run.trigger,
            requestedAt: iso(run.requested_at)!,
            finishedAt: iso(run.finished_at),
            budgetsChecked: run.summary?.budgetsChecked ?? null,
            driftCount: n(run.flags_raised),
          }
        : null,
      auditChain: chain
        ? { valid: chain.valid, checked: chain.checked, brokenAt: chain.firstBrokenSeq ?? null }
        : null,
      openLedgerFlags: n(open.n),
    };
  }

  private async feeds(tx: Tx, now: Date): Promise<FinanceOverview['feeds']> {
    const res = await tx.execute<{ source: string; last: string | null }>(sql`
      select source::text as source, max(at)::text as last from (
        select source, coalesce(posted_at, created_at) as at from import_batches where status = 'posted'
        union all
        select source, created_at as at from actuals where import_batch_id is null
      ) f group by source order by source`);
    return res.rows.map((r) => {
      const meta = FEED_INTERVAL_HOURS[r.source] ?? { label: r.source, hours: 24 };
      const ageHours = r.last
        ? Math.floor((now.getTime() - new Date(r.last).getTime()) / 3_600_000)
        : null;
      return {
        source: r.source,
        label: meta.label,
        lastImportAt: iso(r.last),
        expectedEveryHours: meta.hours,
        lateByHours: ageHours !== null && ageHours > meta.hours ? ageHours - meta.hours : null,
      };
    });
  }

  private async fxEffect(tx: Tx, today: string, money: (m: number) => Money) {
    const fy = await this.reads.fiscalYearWindow(tx, undefined, today);
    if (!fy) return { total: money(0), byCurrency: [], fiscalYearLabel: null };
    const res = await tx.execute<{ currency: string; fx: string }>(sql`
      select transaction_currency as currency, sum(fx_effect_minor)::text as fx
      from actuals
      where accounting_date between ${fy.startDate}::date and ${fy.endDate}::date
        and fx_effect_minor <> 0
      group by transaction_currency order by transaction_currency`);
    const byCurrency = res.rows.map((r) => ({ currency: r.currency, effect: money(n(r.fx)) }));
    return {
      total: money(byCurrency.reduce((s, r) => s + r.effect.amountMinor, 0)),
      byCurrency,
      fiscalYearLabel: fy.label,
    };
  }

  // 017 -------------------------------------------------------------------------------------------

  private assertCanSeeAlerts(actor: RequestActor): void {
    if (!this.reads.tenantWide(actor) && this.reads.scopePaths(actor) === 'none')
      throw ApiProblem.forbidden('Alerts are for budget owners and finance roles.');
  }

  /** Every alert on the viewer's budgets right now, before tab and filters. */
  private async currentAlerts(tx: Tx, actor: RequestActor, today: string, now: Date) {
    const { dataset, evaluated, subtree } = await this.health.evaluate(tx, actor, {}, today);
    const ids = dataset.budgets.map((b) => b.row.id);
    const overdue = await this.overdueApprovals(tx, ids, now);
    const currency = dataset.currency;
    const owned = new Set(actor.ownedBudgetPaths);
    const out: { alert: DerivedAlert; budget: (typeof dataset.budgets)[number] }[] = [];
    for (const e of evaluated) {
      const sub = subtree.get(e.budget.row.id);
      const derived = deriveBudgetAlerts(
        {
          budgetId: e.budget.row.id,
          name: e.budget.row.name,
          status: e.budget.row.status,
          controlMode: e.budget.row.controlMode,
          authorizedMinor: e.budget.balances.authorized,
          committedMinor: e.outcome.committedMinor,
          actualMinor: sub?.actual ?? 0,
          monthsLeft: dataset.fiscalYear?.monthsLeft ?? 0,
          fiscalYearEnd: dataset.fiscalYear?.endDate ?? null,
          overdueApprovals: overdue.get(e.budget.row.id) ?? 0,
          health: e.outcome,
        },
        (m) => formatMoney(m, currency),
      );
      for (const alert of derived) out.push({ alert, budget: e.budget });
    }
    return { dataset, alerts: out, owned };
  }

  private async overdueApprovals(tx: Tx, ids: readonly string[], now: Date) {
    const out = new Map<string, number>();
    if (!ids.length) return out;
    const res = await tx.execute<{ budget_id: string; n: string }>(sql`
      select coalesce(r.budget_id, c.giver_budget_id) as budget_id, count(*)::text as n
      from approval_tasks t
      join approval_instances i on i.id = t.instance_id
      left join requests r on i.subject_type = 'request' and r.id = i.subject_id
      left join contribution_requests c on i.subject_type = 'contribution' and c.id = i.subject_id
      where t.status = 'pending' and t.due_at is not null and t.due_at < ${now.toISOString()}::timestamptz
        and coalesce(r.budget_id, c.giver_budget_id) in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
      group by 1`);
    for (const r of res.rows) out.set(r.budget_id, n(r.n));
    return out;
  }

  private async decisions(tx: Tx, actor: RequestActor, now: Date): Promise<DecisionEvent[]> {
    if (!actor.personId) return [];
    const since = new Date(now.getTime() - RESOLVED_KEEP_DAYS * DAY_MS).toISOString();
    const res = await tx.execute<{ key: string; name: string; at: string }>(sql`
      select properties->>'alertKey' as key, name, occurred_at::text as at
      from product_analytics_events
      where name in ('alert.acknowledged', 'alert.snoozed')
        and actor_person_id = ${actor.personId}::uuid
        and occurred_at >= ${since}::timestamptz
      order by occurred_at desc`);
    return res.rows.map((r) => ({
      key: r.key,
      decision: r.name === 'alert.snoozed' ? 'snooze' : 'acknowledge',
      at: new Date(r.at),
    }));
  }

  async alerts(
    actor: RequestActor,
    q: { tab?: AlertTab; kind?: AlertKind; severity?: AlertSeverity; ownedOnly?: 'true' | 'false' },
  ): Promise<AlertsOverview> {
    this.assertCanSeeAlerts(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const now = nowUtc();
      const today = todayUtc();
      const { dataset, alerts, owned } = await this.currentAlerts(tx, actor, today, now);
      const decisions = await this.decisions(tx, actor, now);
      const latest = new Map<string, DecisionEvent>();
      for (const d of decisions) if (!latest.has(d.key)) latest.set(d.key, d);

      const toDto = (a: (typeof alerts)[number]): BudgetAlert => {
        const d = latest.get(a.alert.key);
        const snoozedUntil =
          d?.decision === 'snooze' && a.alert.snoozable
            ? new Date(d.at.getTime() + SNOOZE_DAYS * DAY_MS)
            : null;
        return {
          key: a.alert.key,
          kind: a.alert.kind,
          severity: a.alert.severity,
          tone: a.alert.tone,
          budgetId: a.budget.row.id,
          budgetName: a.budget.row.name,
          budgetStatus: a.budget.row.status,
          ownerName: a.budget.ownerName,
          text: a.alert.text,
          rule: a.alert.rule,
          raisedAt: null,
          action: a.alert.action,
          snoozable: a.alert.snoozable,
          acknowledgedAt: d?.decision === 'acknowledge' ? d.at.toISOString() : null,
          snoozedUntil: snoozedUntil && snoozedUntil > now ? snoozedUntil.toISOString() : null,
          resolvedAt: null,
          owned: owned.has(a.budget.row.path),
        };
      };
      const current = alerts.map(toDto);
      const isAcknowledged = (a: BudgetAlert) => Boolean(a.acknowledgedAt || a.snoozedUntil);
      const live = new Set(current.map((a) => a.key));
      const byId = new Map(dataset.budgets.map((b) => [b.row.id, b]));
      const resolved: BudgetAlert[] = [...latest.values()]
        .filter((d) => !live.has(d.key))
        .flatMap((d) => {
          const [kind, budgetId] = d.key.split(':');
          const b = byId.get(budgetId);
          if (!b) return [];
          const k = kind as AlertKind;
          return [
            {
              key: d.key,
              kind: k,
              severity: (k === 'hard_block'
                ? 'hard_block'
                : ['frozen', 'set_to_zero'].includes(k)
                  ? 'information'
                  : 'warning') as AlertSeverity,
              tone: 'info' as const,
              budgetId,
              budgetName: b.row.name,
              budgetStatus: b.row.status,
              ownerName: b.ownerName,
              text: `${b.row.name}: the condition behind this alert no longer applies.`,
              rule: RESOLVED_RULES[k] ?? 'Alert',
              raisedAt: null,
              action: { label: 'Open budget', link: `/budgets/${budgetId}` },
              snoozable: false,
              acknowledgedAt: d.decision === 'acknowledge' ? d.at.toISOString() : null,
              snoozedUntil: null,
              resolvedAt: d.at.toISOString(),
              owned: owned.has(b.row.path),
            },
          ];
        });

      const tabs = {
        open: current.filter((a) => !isAcknowledged(a)),
        acknowledged: current.filter(isAcknowledged),
        resolved,
      };
      const tab = q.tab ?? 'open';
      const items = tabs[tab]
        .filter((a) => (q.kind ? a.kind === q.kind : true))
        .filter((a) => (q.severity ? a.severity === q.severity : true))
        .filter((a) => (q.ownedOnly === 'true' ? a.owned : true))
        .sort(
          (a, b) =>
            SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            a.budgetName.localeCompare(b.budgetName) ||
            a.key.localeCompare(b.key),
        );
      const openFiltered = tabs.open
        .filter((a) => (q.kind ? a.kind === q.kind : true))
        .filter((a) => (q.ownedOnly === 'true' ? a.owned : true));
      return {
        generatedAt: now.toISOString(),
        asOf: today,
        currency: dataset.currency,
        scope: {
          tenantWide: dataset.tenantWide,
          label: dataset.scopeLabel,
          budgetIds: dataset.budgets.length,
          note: dataset.tenantWide ? null : 'Showing budgets you can see.',
        },
        tab,
        counts: {
          open: tabs.open.length,
          acknowledged: tabs.acknowledged.length,
          resolved: tabs.resolved.length,
        },
        severity: {
          hardBlock: openFiltered.filter((a) => a.severity === 'hard_block').length,
          warning: openFiltered.filter((a) => a.severity === 'warning').length,
          information: openFiltered.filter((a) => a.severity === 'information').length,
        },
        items,
      };
    });
  }

  /**
   * Acknowledge or snooze one alert for the viewer. Product analytics, not audit (017): it changes
   * nothing about the budget, and the alert key carries ids only. Idempotent on the key.
   */
  decideAlert(
    actor: RequestActor,
    req: AlertDecisionRequest,
    ctx: { idempotencyKey: string },
  ): Promise<CommandResult<BudgetAlert>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'dashboards.alert_decision',
        request: req,
        status: 200,
      },
      async (tx) => {
        this.assertCanSeeAlerts(actor);
        if (!actor.personId)
          throw ApiProblem.forbidden('Only people in the tenant can acknowledge alerts.');
        const now = nowUtc();
        const { alerts, owned } = await this.currentAlerts(tx, actor, todayUtc(), now);
        const hit = alerts.find((a) => a.alert.key === req.key);
        if (!hit) throw ApiProblem.notFound('alert');
        if (req.decision === 'snooze' && !hit.alert.snoozable)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Hard-block alerts cannot be snoozed; acknowledge it or clear the block.',
          );
        await this.analytics.track(
          tx,
          actor,
          req.decision === 'snooze' ? 'alert.snoozed' : 'alert.acknowledged',
          { alertKey: req.key, kind: hit.alert.kind },
          now,
        );
        return {
          key: hit.alert.key,
          kind: hit.alert.kind,
          severity: hit.alert.severity,
          tone: hit.alert.tone,
          budgetId: hit.budget.row.id,
          budgetName: hit.budget.row.name,
          budgetStatus: hit.budget.row.status,
          ownerName: hit.budget.ownerName,
          text: hit.alert.text,
          rule: hit.alert.rule,
          raisedAt: null,
          action: hit.alert.action,
          snoozable: hit.alert.snoozable,
          acknowledgedAt: req.decision === 'acknowledge' ? now.toISOString() : null,
          snoozedUntil:
            req.decision === 'snooze'
              ? new Date(now.getTime() + SNOOZE_DAYS * DAY_MS).toISOString()
              : null,
          resolvedAt: null,
          owned: owned.has(hit.budget.row.path),
        };
      },
    );
  }

  // 017a ------------------------------------------------------------------------------------------

  async exceptions(
    actor: RequestActor,
    q: { type?: ControlExceptionType },
  ): Promise<ExceptionsOverview> {
    this.assertTenantReports(actor, 'The exceptions dashboard');
    const integrityAllowed = this.policy.can(actor, 'integrity.read', this.tenant(actor)).allowed;
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const now = nowUtc();
      const today = todayUtc();
      const currency = actor.reportingCurrency;
      const money = (amountMinor: number): Money => ({ amountMinor, currency });
      const fy = await this.reads.fiscalYearWindow(tx, undefined, today);
      const fyStart = fy?.startDate ?? `${today.slice(0, 4)}-01-01`;
      const items = await this.exceptionItems(tx, now, fyStart, currency, integrityAllowed);
      const informational = await this.informationalCounts(tx, fyStart);

      const types: ExceptionTypeRow[] = EXCEPTION_META.filter(
        (m) => integrityAllowed || !m.integrity,
      ).map((m) => {
        if (m.informational)
          return {
            type: m.type,
            label: m.label,
            source: m.source,
            informational: true,
            open: informational[m.type as 'approved_over_budget' | 'approved_after_escalation'],
            oldestDays: null,
            atStake: null,
            queue: m.queue,
            bands: { d0to7: 0, d8to30: 0, d31to60: 0, over60: 0 },
          };
        const mine = items.filter((i) => i.type === m.type);
        const stake = mine.reduce((s, i) => s + (i.atStake?.amountMinor ?? 0), 0);
        return {
          type: m.type,
          label: m.label,
          source: m.source,
          informational: false,
          open: mine.length,
          oldestDays: mine.length ? Math.max(...mine.map((i) => i.ageDays)) : null,
          atStake: mine.some((i) => i.atStake) ? money(stake) : null,
          queue: m.queue,
          bands: {
            d0to7: mine.filter((i) => i.ageDays <= 7).length,
            d8to30: mine.filter((i) => i.ageDays >= 8 && i.ageDays <= 30).length,
            d31to60: mine.filter((i) => i.ageDays >= 31 && i.ageDays <= 60).length,
            over60: mine.filter((i) => i.ageDays > 60).length,
          },
        };
      });

      const work = types.filter((t) => !t.informational);
      const stakeTotal = items.reduce((s, i) => s + (i.atStake?.amountMinor ?? 0), 0);
      const monthStart = `${today.slice(0, 7)}-01`;
      const [resolved] = (
        await tx.execute<{ n: string }>(sql`
          select count(*)::text as n from post_spend_exceptions
          where status = 'resolved' and resolved_at >= ${monthStart}::date`)
      ).rows;

      const locations = new Map<string, { open: number; stake: number }>();
      for (const i of items) {
        const key = i.location ?? 'Not location-specific';
        const cur = locations.get(key) ?? { open: 0, stake: 0 };
        cur.open += 1;
        cur.stake += i.atStake?.amountMinor ?? 0;
        locations.set(key, cur);
      }

      return {
        generatedAt: now.toISOString(),
        asOf: today,
        currency,
        fiscalYearLabel: fy?.label ?? null,
        kpis: {
          open: work.reduce((s, t) => s + t.open, 0),
          informational: types.filter((t) => t.informational).reduce((s, t) => s + t.open, 0),
          olderThan14Days: items.filter((i) => i.ageDays > 14).length,
          resolvedThisMonth: n(resolved.n),
          atStake: money(stakeTotal),
        },
        integrityFlagOpen: items.some((i) => i.type === 'ledger_integrity'),
        withheld: integrityAllowed
          ? []
          : EXCEPTION_META.filter((m) => m.integrity).map((m) => m.type),
        types,
        trend: await this.trend(tx, today, integrityAllowed),
        byLocation: [...locations.entries()]
          .map(([location, v]) => ({ location, open: v.open, atStake: money(v.stake) }))
          .sort((a, b) => b.open - a.open || a.location.localeCompare(b.location)),
        items: q.type
          ? items
              .filter((i) => i.type === q.type)
              .sort((a, b) => b.ageDays - a.ageDays || a.reference.localeCompare(b.reference))
          : [],
      };
    });
  }

  private async exceptionItems(
    tx: Tx,
    now: Date,
    fyStart: string,
    currency: string,
    integrityAllowed: boolean,
  ): Promise<ExceptionItem[]> {
    const money = (amountMinor: number): Money => ({ amountMinor, currency });
    const out: ExceptionItem[] = [];
    const postSpend = await tx.execute<{
      id: string;
      type: string;
      source_ref: string;
      summary: string;
      location: string;
      raised_at: string;
      amount: string;
    }>(sql`
      select id, type, source_ref, summary, location, created_at::text as raised_at, reporting_amount_minor::text as amount
      from post_spend_exceptions where status in ('open', 'explained')`);
    for (const r of postSpend.rows)
      out.push({
        id: r.id,
        type: 'post_spend_breach',
        reference: r.source_ref,
        summary: r.summary,
        location: r.location,
        raisedAt: iso(r.raised_at)!,
        ageDays: days(r.raised_at, now) ?? 0,
        atStake: money(n(r.amount)),
        link: '/admin/rules/exceptions',
      });

    if (integrityAllowed) {
      const flags = await tx.execute<{
        id: string;
        kind: string;
        resource_type: string;
        resource_id: string;
        raised_at: string;
        amount: string | null;
        location: string | null;
        ref: string | null;
      }>(sql`
        select f.id, f.kind::text as kind, f.resource_type, f.resource_id, f.raised_at::text as raised_at,
               coalesce(a.reporting_amount_minor, r.budget_amount_minor)::text as amount,
               coalesce(ou.name, null) as location,
               coalesce(a.source_ref, r.ref) as ref
        from integrity_flags f
        left join actuals a on f.resource_type = 'actual' and a.id::text = f.resource_id
        left join requests r on f.resource_type = 'request' and r.id::text = f.resource_id
        left join budgets b on b.id = r.budget_id
        left join org_units ou on ou.id = b.org_unit_id
        where f.status in ('open', 'acknowledged')`);
      for (const f of flags.rows) {
        const type = FLAG_TYPE[f.kind];
        if (!type) continue;
        out.push({
          id: f.id,
          type,
          reference: f.ref ?? f.resource_id,
          summary: FLAG_SUMMARY[f.kind] ?? f.kind.replace(/_/g, ' '),
          location: f.location,
          raisedAt: iso(f.raised_at)!,
          ageDays: days(f.raised_at, now) ?? 0,
          atStake:
            type === 'just_under_threshold' || type === 'ledger_integrity'
              ? null
              : f.amount
                ? money(n(f.amount))
                : null,
          link: EXCEPTION_META.find((m) => m.type === type)!.queue.link,
        });
      }
    }

    const late = await tx.execute<{ id: string; ref: string; at: string; amount: string }>(sql`
      select j.id, coalesce(j.reason, j.journal_type::text) as ref, j.created_at::text as at,
             coalesce(sum(l.reporting_amount_minor) filter (where l.reporting_amount_minor > 0), 0)::text as amount
      from ledger_journals j
      left join ledger_lines l on l.journal_id = j.id
      where j.original_period_id is not null and j.accounting_date >= ${fyStart}::date
      group by j.id`);
    for (const r of late.rows)
      out.push({
        id: r.id,
        type: 'late_posting',
        reference: r.ref,
        summary: 'Posted into the next open period after its own period closed.',
        location: null,
        raisedAt: iso(r.at)!,
        ageDays: days(r.at, now) ?? 0,
        atStake: money(n(r.amount)),
        link: '/finance/close',
      });

    const missing = await tx.execute<{
      id: string;
      ref: string;
      at: string;
      amount: string;
      currency: string;
    }>(sql`
      select c.id, c.ref, coalesce(c.decided_at, c.created_at)::text as at,
             coalesce(c.approved_minor, c.requested_minor)::text as amount, c.currency
      from contribution_requests c
      join budgets g on g.id = c.giver_budget_id
      join budgets rb on rb.id = c.receiver_budget_id
      where c.status in ('approved_full', 'approved_partial', 'earmarked', 'transferred', 'settled')
        and g.legal_entity_id <> rb.legal_entity_id
        and c.recharge_schedule_id is null`);
    for (const r of missing.rows)
      out.push({
        id: r.id,
        type: 'missing_recharge',
        reference: r.ref,
        summary: 'Cross-entity Inter-Director Budget Contribution Request without a recharge.',
        location: null,
        raisedAt: iso(r.at)!,
        ageDays: days(r.at, now) ?? 0,
        atStake: r.currency === currency ? money(n(r.amount)) : null,
        link: '/finance/recharges',
      });
    return out;
  }

  private async informationalCounts(tx: Tx, fyStart: string) {
    const [over] = (
      await tx.execute<{ n: string }>(sql`
        select count(*)::text as n from requests
        where (over_budget or kind = 'over_budget')
          and status in ('approved', 'partially_approved')
          and coalesce(decided_at, created_at) >= ${fyStart}::date`)
    ).rows;
    const [escalated] = (
      await tx.execute<{ n: string }>(sql`
        select count(*)::text as n from approval_tasks
        where escalated_from_task_id is not null
          and status in ('approved', 'partially_approved')
          and coalesce(decided_at, created_at) >= ${fyStart}::date`)
    ).rows;
    return { approved_over_budget: n(over.n), approved_after_escalation: n(escalated.n) };
  }

  /** Work items opened and resolved per ISO week (Monday start), the last 8 weeks. */
  private async trend(tx: Tx, today: string, integrityAllowed: boolean) {
    const res = await tx.execute<{ week: string; opened: string; resolved: string }>(sql`
      with weeks as (
        select generate_series(date_trunc('week', ${today}::date) - interval '7 weeks',
                               date_trunc('week', ${today}::date), interval '1 week')::date as week
      ),
      ev as (
        select date_trunc('week', created_at)::date as week, 1 as opened, 0 as resolved from post_spend_exceptions
        union all
        select date_trunc('week', resolved_at)::date, 0, 1 from post_spend_exceptions where resolved_at is not null
        ${integrityAllowed ? sql`union all select date_trunc('week', raised_at)::date, 1, 0 from integrity_flags` : sql``}
      )
      select w.week::text as week, coalesce(sum(ev.opened), 0)::text as opened,
             coalesce(sum(ev.resolved), 0)::text as resolved
      from weeks w left join ev on ev.week = w.week
      group by w.week order by w.week`);
    return res.rows.map((r) => ({
      weekStart: r.week,
      opened: n(r.opened),
      resolved: n(r.resolved),
    }));
  }
}

const RESOLVED_RULES: Partial<Record<AlertKind, string>> = {
  threshold: 'Owner threshold',
  hard_block: 'Owner threshold 100%, hard control mode',
  pace: 'Health check: pace',
  forecast: 'Health check: forecast',
  lapse: 'Health check: unused',
  frozen: 'Budget control: freeze',
  set_to_zero: 'Budget control: set to zero',
  approvals_overdue: 'Approval SLA',
  stale_commitments: 'Health check: hygiene',
};

const EXCEPTION_META: {
  type: ControlExceptionType;
  label: string;
  source: string;
  informational: boolean;
  integrity: boolean;
  queue: { label: string; link: string };
}[] = [
  {
    type: 'post_spend_breach',
    label: 'Post-spend policy breach',
    source: 'Post-spend re-check',
    informational: false,
    integrity: false,
    queue: { label: 'Post-spend exceptions', link: '/admin/rules/exceptions' },
  },
  {
    type: 'split_request',
    label: 'Possible split request',
    source: 'Integrity flag: split request',
    informational: false,
    integrity: true,
    queue: { label: 'Post-spend exceptions', link: '/admin/rules/exceptions' },
  },
  {
    type: 'duplicate',
    label: 'Possible duplicate',
    source: 'Integrity flags: duplicate, cross-source duplicate, receipt reuse',
    informational: false,
    integrity: true,
    queue: { label: 'Duplicates', link: '/finance/actuals/duplicates' },
  },
  {
    type: 'approved_over_budget',
    label: 'Approved over budget',
    source: 'Approvals',
    informational: true,
    integrity: false,
    queue: { label: 'Approval history', link: '/approvals/history' },
  },
  {
    type: 'approved_after_escalation',
    label: 'Approved after escalation',
    source: 'Approvals',
    informational: true,
    integrity: false,
    queue: { label: 'Approval history', link: '/approvals/history' },
  },
  {
    type: 'late_posting',
    label: 'Late postings into the next period',
    source: 'Ledger (late flag)',
    informational: false,
    integrity: false,
    queue: { label: 'Period close', link: '/finance/close' },
  },
  {
    type: 'missing_recharge',
    label: 'Cross-entity contribution without recharge',
    source: 'Recharges',
    informational: false,
    integrity: false,
    queue: { label: 'Recharges', link: '/finance/recharges' },
  },
  {
    type: 'just_under_threshold',
    label: 'Just under an approval threshold',
    source: 'Integrity flag: just under threshold',
    informational: false,
    integrity: true,
    queue: { label: 'Post-spend exceptions', link: '/admin/rules/exceptions' },
  },
  {
    type: 'ledger_integrity',
    label: 'Ledger integrity',
    source: 'Integrity flags: drift, unbalanced journal, triplet mismatch, audit chain',
    informational: false,
    integrity: true,
    queue: { label: 'Finance overview', link: '/dashboards/finance' },
  },
];

const FLAG_TYPE: Record<string, ControlExceptionType> = {
  split_request: 'split_request',
  duplicate: 'duplicate',
  cross_source_duplicate: 'duplicate',
  receipt_reuse: 'duplicate',
  just_under_threshold: 'just_under_threshold',
  ...Object.fromEntries(LEDGER_FLAG_KINDS.map((k) => [k, 'ledger_integrity' as const])),
};

const FLAG_SUMMARY: Record<string, string> = {
  split_request: 'Requests that together look like one split purchase.',
  duplicate: 'Possible duplicate actual.',
  cross_source_duplicate: 'The same spend arrived from two sources.',
  receipt_reuse: 'A receipt used on more than one claim.',
  just_under_threshold: 'Request just under an approval threshold.',
  ledger_drift: 'Cached balance differs from the ledger rebuild.',
  journal_unbalanced: 'A journal does not balance.',
  negative_bucket: 'A bucket balance is negative.',
  over_allocated: 'Children hold more than the parent allocated.',
  triplet_mismatch: 'Currency triplet does not match its stored rate.',
  audit_chain_broken: 'The audit hash chain is broken.',
};

/** "USD 1,234.56" for the sentences the API writes; the UI formats figures itself. */
export function formatMoney(minor: number, currency: string): string {
  const exp = currency === 'JPY' ? 0 : currency === 'KWD' ? 3 : 2;
  const v = minor / 10 ** exp;
  return `${currency} ${v.toLocaleString('en-US', {
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  })}`;
}
