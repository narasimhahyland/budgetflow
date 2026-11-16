import { ApiProblem, DB, nowUtc, PolicyService, todayUtc, type RequestActor } from '@bf/api/core';
import { withTenant, type Db } from '@bf/api/db';
import type { ProductAnalytics } from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { percentile } from './approvals-dashboards.service';
import { ReportReads } from './report-reads.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Plan defaults for the product KPIs (018b); KPIs guide improvement, they never gate work. */
const TARGETS = { activation: 70, monthlyActive: 70, approveHours: 24, autoMatch: 80 };
const MIN_DAYS = 14;
const MIN_OWNERS = 20;

const round1 = (n: number) => Math.round(n * 10) / 10;
const median = (v: number[]) => {
  const m = percentile(
    [...v].sort((a, b) => a - b),
    50,
  );
  return m === null ? null : round1(m);
};
const share = (part: number, whole: number) => (whole > 0 ? round1((part * 100) / whole) : null);
const n = (v: unknown) => Number(v ?? 0);

/**
 * Product analytics (018b): whether BudgetFlow works as a product, from the analytics events
 * (counts and flags only, never names or amounts) joined with ownership counts, plus the ledger's
 * unused share. No figure drills down to a person.
 */
@Injectable()
export class ProductAnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly reads: ReportReads,
  ) {}

  async kpis(actor: RequestActor, q: { period?: '30' | '90' | 'fy' }): Promise<ProductAnalytics> {
    const settings = this.policy.can(actor, 'tenant.settings.manage', {
      kind: 'tenant',
      tenantId: actor.tenantId,
    }).allowed;
    if (!settings && !this.reads.tenantWide(actor))
      throw ApiProblem.forbidden('Product analytics are for administrators and finance leaders.');
    const period = q.period ?? '30';
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const now = nowUtc();
      const today = todayUtc();
      const fy = await this.reads.fiscalYearWindow(tx, undefined, today);
      const from =
        period === 'fy' && fy
          ? fy.startDate
          : new Date(now.getTime() - Number(period === 'fy' ? 365 : period) * DAY_MS)
              .toISOString()
              .slice(0, 10);
      const to = today;
      const windowDays = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

      const owners = (
        await tx.execute<{ person: string; first: string }>(sql`
          select owner_person_id as person, min(created_at)::text as first from budgets
          where owner_person_id is not null and status::text not in ('closed', 'cancelled')
          group by owner_person_id`)
      ).rows;
      const ownerIds = owners.map((o) => o.person);
      const ownerSet = sql.join(
        (ownerIds.length ? ownerIds : ['00000000-0000-0000-0000-000000000000']).map(
          (id) => sql`${id}::uuid`,
        ),
        sql`, `,
      );
      const active = (
        await tx.execute<{
          person: string;
          first_alloc: string | null;
          first_any: string | null;
        }>(sql`
          select actor_person_id as person,
                 min(occurred_at) filter (where name = 'allocation.created')::text as first_alloc,
                 min(occurred_at) filter (where name in ('allocation.created', 'approval.decided'))::text as first_any
          from product_analytics_events
          where actor_person_id in (${ownerSet})
          group by actor_person_id`)
      ).rows;
      const byOwner = new Map(active.map((a) => [a.person, a]));
      const activated = owners.filter((o) => {
        const a = byOwner.get(o.person)?.first_any;
        return a && Date.parse(a) - Date.parse(o.first) <= 14 * DAY_MS;
      }).length;
      const toFirstAllocation = owners
        .map((o) => byOwner.get(o.person)?.first_alloc)
        .map((a, i) => (a ? (Date.parse(a) - Date.parse(owners[i].first)) / DAY_MS : null))
        .filter((d): d is number => d !== null && d >= 0);

      const [weekly] = (
        await tx.execute<{ week: string; month: string }>(sql`
          select count(distinct actor_person_id) filter (where occurred_at >= ${new Date(now.getTime() - 7 * DAY_MS).toISOString()}::timestamptz)::text as week,
                 count(distinct actor_person_id) filter (where occurred_at >= ${new Date(now.getTime() - 30 * DAY_MS).toISOString()}::timestamptz)::text as month
          from product_analytics_events where actor_person_id in (${ownerSet})`)
      ).rows;

      const approve = (
        await tx.execute<{ hours: string; channel: string }>(sql`
          select (extract(epoch from (a.created_at - t.created_at)) / 3600)::text as hours,
                 a.channel::text as channel
          from approval_actions a join approval_tasks t on t.id = a.task_id
          where a.created_at >= ${from}::date and a.created_at < (${to}::date + 1)`)
      ).rows;
      const approveHours = approve.map((r) => Math.max(Number(r.hours), 0));

      const matches = (
        await tx.execute<{ source: string; matched: string; automatic: string }>(sql`
          select source::text as source, count(*)::text as matched,
                 count(*) filter (where coalesce(match_rule, 'manual') <> 'manual')::text as automatic
          from actuals
          where match_status = 'matched' and matched_at >= ${from}::date and matched_at < (${to}::date + 1)
          group by source order by source`)
      ).rows;
      const matched = matches.reduce((s, r) => s + n(r.matched), 0);
      const automatic = matches.reduce((s, r) => s + n(r.automatic), 0);

      const [unused] = (
        await tx.execute<{ label: string | null; allot: string; used: string }>(sql`
          with p as (
            select fp.id, fp.label from fiscal_periods fp
            join fiscal_years fy on fy.id = fp.fiscal_year_id
            where fp.end_date < ${today}::date and fy.id = ${fy?.id ?? '00000000-0000-0000-0000-000000000000'}::uuid
            order by fp.end_date desc limit 1)
          select (select label from p) as label,
                 coalesce((select sum(a.amount_minor) from budget_period_allotments a where a.fiscal_period_id = (select id from p)), 0)::text as allot,
                 coalesce((select sum(l.budget_amount_minor) from ledger_lines l
                   join budget_period_allotments a on a.budget_id = l.budget_id and a.fiscal_period_id = l.fiscal_period_id
                   where l.fiscal_period_id = (select id from p) and l.account in ('actual', 'encumbered')), 0)::text as used`)
      ).rows;
      const allot = n(unused?.allot);
      const unusedPct =
        allot > 0 ? round1((Math.max(allot - n(unused.used), 0) * 100) / allot) : null;

      const funnel = (
        await tx.execute<{ invited: string; signed: string; viewed: string; acted: string }>(sql`
          with invited as (
            select distinct p.id from owner_invites i left join people p on lower(p.email) = lower(i.email)
            where i.created_at >= ${fy?.startDate ?? from}::date),
          ev as (select actor_person_id, name, properties from product_analytics_events)
          select (select count(*) from owner_invites where created_at >= ${fy?.startDate ?? from}::date)::text as invited,
                 (select count(distinct actor_person_id) from ev where name = 'session.started' and actor_person_id in (select id from invited))::text as signed,
                 (select count(distinct actor_person_id) from ev where name = 'page.viewed' and properties->>'route' like '/budgets/%' and actor_person_id in (select id from invited))::text as viewed,
                 (select count(distinct actor_person_id) from ev where name in ('allocation.created', 'approval.decided') and actor_person_id in (select id from invited))::text as acted`)
      ).rows[0];

      const weeklyActive = (
        await tx.execute<{ week: string; owners: string; employees: string }>(sql`
          with weeks as (
            select generate_series(date_trunc('week', ${today}::date) - interval '7 weeks',
                                   date_trunc('week', ${today}::date), interval '1 week')::date as week)
          select w.week::text as week,
                 count(distinct e.actor_person_id) filter (where e.actor_person_id in (${ownerSet}))::text as owners,
                 count(distinct e.actor_person_id) filter (where e.actor_person_id not in (${ownerSet}))::text as employees
          from weeks w left join product_analytics_events e
            on date_trunc('week', e.occurred_at)::date = w.week and e.actor_person_id is not null
          group by w.week order by w.week`)
      ).rows;

      const channels = new Map<string, number>();
      for (const r of approve) channels.set(r.channel, (channels.get(r.channel) ?? 0) + 1);

      const insufficient = windowDays < MIN_DAYS || owners.length < MIN_OWNERS;
      const status = (value: number | null, target: number, cmp: 'at_least' | 'at_most') =>
        insufficient || value === null
          ? ('insufficient' as const)
          : (cmp === 'at_least' ? value >= target : value <= target)
            ? ('on_target' as const)
            : ('below_target' as const);
      const activationPct = share(activated, owners.length);
      const weeklyPct = share(n(weekly?.week), owners.length);
      const monthlyPct = share(n(weekly?.month), owners.length);
      const approveMedian = median(approveHours);
      const autoPct = share(automatic, matched);

      return {
        generatedAt: now.toISOString(),
        period,
        from,
        to,
        insufficient,
        owners: owners.length,
        kpis: [
          {
            key: 'owner_activation',
            label: 'Owner activation',
            value: activationPct,
            unit: 'percent',
            detail: `${activated} of ${owners.length} budget owners allocated or decided within 14 days of getting a budget.`,
            target: {
              value: TARGETS.activation,
              comparison: 'at_least',
              text: `Target ${TARGETS.activation}%`,
            },
            status: status(activationPct, TARGETS.activation, 'at_least'),
            definition:
              'Budget owners whose first allocation or approval decision came within 14 days of their first budget.',
            events: ['allocation.created', 'approval.decided'],
          },
          {
            key: 'weekly_active_owners',
            label: 'Weekly active owners',
            value: weeklyPct,
            unit: 'percent',
            detail: `${n(weekly?.week)} of ${owners.length} owners active this week; ${n(weekly?.month)} in the last 30 days.`,
            target: {
              value: TARGETS.monthlyActive,
              comparison: 'at_least',
              text: `Target ${TARGETS.monthlyActive}% monthly active`,
            },
            status: status(monthlyPct, TARGETS.monthlyActive, 'at_least'),
            definition:
              'Owners with any recorded product event in the last 7 days (target measured over 30 days).',
            events: ['session.started', 'page.viewed', 'allocation.created', 'approval.decided'],
          },
          {
            key: 'time_to_first_allocation',
            label: 'Time to first allocation',
            value: median(toFirstAllocation),
            unit: 'days',
            detail: `Median over ${toFirstAllocation.length} owners who have allocated.`,
            target: null,
            status: insufficient ? 'insufficient' : 'no_target',
            definition: "Days from an owner's first budget to their first allocation.",
            events: ['allocation.created'],
          },
          {
            key: 'time_to_approve',
            label: 'Time to approve',
            value: approveMedian,
            unit: 'hours',
            detail: `Median over ${approveHours.length} decisions in the period.`,
            target: {
              value: TARGETS.approveHours,
              comparison: 'at_most',
              text: `Target under ${TARGETS.approveHours} hours`,
            },
            status: status(approveMedian, TARGETS.approveHours, 'at_most'),
            definition: 'Hours from an approval step opening to its decision.',
            events: ['approval.decided'],
          },
          {
            key: 'auto_match_rate',
            label: 'Auto-match rate',
            value: autoPct,
            unit: 'percent',
            detail: `${automatic} of ${matched} matched actuals were matched without a person.`,
            target: {
              value: TARGETS.autoMatch,
              comparison: 'at_least',
              text: `Target ${TARGETS.autoMatch}%`,
            },
            status: status(autoPct, TARGETS.autoMatch, 'at_least'),
            definition: 'Imported actuals matched by a rule rather than by hand.',
            events: ['actual.imported', 'actual.matched'],
          },
          {
            key: 'unused_at_period_end',
            label: 'Unused budget at period end',
            value: unusedPct,
            unit: 'percent',
            detail: !unused?.label
              ? 'No period has ended in this fiscal year yet.'
              : allot > 0
                ? `Share of the phased allotment left unused in ${unused.label}.`
                : `No budget was phased into ${unused.label}.`,
            target: null,
            status: insufficient ? 'insufficient' : 'no_target',
            definition:
              'Phased allotment of the last ended period minus actual and encumbered, from the ledger.',
            events: [],
          },
        ],
        funnel: [
          { step: 'Invited', count: n(funnel?.invited) },
          { step: 'Signed in', count: n(funnel?.signed) },
          { step: 'Viewed a budget', count: n(funnel?.viewed) },
          { step: 'Allocated or decided', count: n(funnel?.acted) },
        ],
        weeklyActive: weeklyActive.map((w) => ({
          weekStart: w.week,
          owners: n(w.owners),
          employees: n(w.employees),
        })),
        decisionsByChannel: [...channels.entries()]
          .map(([channel, decisions]) => ({ channel, decisions }))
          .sort((a, b) => b.decisions - a.decisions || a.channel.localeCompare(b.channel)),
        autoMatchBySource: matches.map((r) => ({
          source: r.source,
          matched: n(r.matched),
          automatic: n(r.automatic),
        })),
      };
    });
  }
}
