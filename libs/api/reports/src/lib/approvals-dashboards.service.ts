import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  nowUtc,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { notifications as notificationsTable, withTenant, type Db, type Tx } from '@bf/api/db';
import { noticeEmail, NotificationsService } from '@bf/api/notifications';
import type {
  ApprovalPerformance,
  Money,
  PendingApprovalItem,
  PendingApprovalsOverview,
  PendingKind,
  SlaState,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { formatMoney } from './dashboards.service';
import { ReportReads } from './report-reads.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** One reminder per task every four hours (018). */
const NUDGE_WINDOW_MS = 4 * HOUR_MS;
/** Approvers need this many decisions in the period to be ranked by name (018a). */
const RANK_MIN_DECISIONS = 10;
const SMALL_SAMPLE = 30;
const TARGET_HOURS = 24;

const STEP_LABELS: Record<string, string> = {
  budget_owner: 'Budget owner',
  parent_owner: 'Parent owner',
  finance: 'Finance',
  finance_controller: 'Finance Controller',
  finance_admin: 'Finance Admin',
  ceo: 'CEO',
  giving_director: 'Giving director (co-funding)',
};
export const stepLabel = (resolver: string): string =>
  STEP_LABELS[resolver] ?? resolver.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const round1 = (n: number) => Math.round(n * 10) / 10;
const n = (v: unknown) => Number(v ?? 0);

/** Nearest-rank percentile of a sorted list; null when empty. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const m = percentile(sorted, 50);
  return m === null ? null : round1(m);
};
const p90 = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const m = percentile(sorted, 90);
  return m === null ? null : round1(m);
};
const pct = (part: number, whole: number) => (whole > 0 ? round1((part * 100) / whole) : null);

type PendingRow = Record<string, unknown> & {
  task_id: string;
  step_no: number;
  resolver: string;
  assignee_person_id: string;
  approver_name: string;
  task_created_at: string;
  due_at: string | null;
  subject_type: 'request' | 'contribution';
  subject_id: string;
  ref: string | null;
  title: string | null;
  kind: string | null;
  requester_name: string | null;
  budget_id: string | null;
  budget_name: string | null;
  budget_path: string | null;
  amount_minor: string | null;
  currency: string | null;
  held_reporting: string | null;
  delegate_name: string | null;
  last_channel: string | null;
  last_nudged_at: string | null;
};

/**
 * Pending approvals (018) and approval performance (018a). Both read approval tasks and actions
 * under RLS; neither can decide anything. The only command is a reminder to an approver.
 */
@Injectable()
export class ApprovalsDashboardsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly reads: ReportReads,
    private readonly commands: CommandRunner,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private scope(actor: RequestActor): string[] | null {
    const paths = this.reads.scopePaths(actor);
    if (paths === 'none')
      throw ApiProblem.forbidden('Pending approvals are for finance roles and budget owners.');
    return paths;
  }

  // 018 -------------------------------------------------------------------------------------------

  private async pendingRows(
    tx: Tx,
    paths: string[] | null,
    taskId?: string,
  ): Promise<PendingRow[]> {
    const scoped = paths
      ? sql`and (${sql.join(
          paths.map((p) => sql`left(coalesce(b.path, ''), ${p.length}) = ${p}`),
          sql` or `,
        )})`
      : sql``;
    const res = await tx.execute<PendingRow>(sql`
      select t.id as task_id, t.step_no, t.resolver, t.assignee_person_id,
             ap.display_name as approver_name, t.created_at::text as task_created_at,
             t.due_at::text as due_at, i.subject_type, i.subject_id,
             coalesce(r.ref, c.ref) as ref,
             coalesce(r.title, r.purpose, c.purpose) as title,
             case when i.subject_type = 'contribution' then 'co_funding' else r.kind::text end as kind,
             rq.display_name as requester_name,
             b.id as budget_id, b.name as budget_name, b.path as budget_path,
             coalesce(r.amount_minor, c.requested_minor)::text as amount_minor,
             coalesce(r.currency, c.currency) as currency,
             (select sum(l.reporting_amount_minor)::text from ledger_lines l
               where i.subject_type = 'request' and l.request_id = r.id and l.account = 'pre_encumbered'
             ) as held_reporting,
             (select dp.display_name from approval_delegations d join people dp on dp.id = d.delegate_person_id
               where d.delegator_person_id = t.assignee_person_id and d.revoked_at is null
                 and d.valid_from <= ${nowUtc().toISOString()}::timestamptz
                 and (d.valid_to is null or d.valid_to >= ${nowUtc().toISOString()}::timestamptz)
               order by d.created_at desc limit 1) as delegate_name,
             (select cd.channel::text from channel_deliveries cd
               where cd.recipient_person_id = t.assignee_person_id and cd.subject_id = i.subject_id
               order by cd.created_at desc limit 1) as last_channel,
             (select max((a.changes->'nudgedAt'->>'to')::timestamptz)::text from audit_events a
               where a.action = 'approval.nudged' and a.resource_type = 'approval_task'
                 and a.resource_id = t.id::text) as last_nudged_at
      from approval_tasks t
      join approval_instances i on i.id = t.instance_id
      join people ap on ap.id = t.assignee_person_id
      left join requests r on i.subject_type = 'request' and r.id = i.subject_id
      left join contribution_requests c on i.subject_type = 'contribution' and c.id = i.subject_id
      left join budgets b on b.id = coalesce(r.budget_id, c.giver_budget_id)
      left join people rq on rq.id = coalesce(r.requester_person_id, c.requester_person_id)
      where t.status = 'pending' ${taskId ? sql`and t.id = ${taskId}::uuid` : sql``} ${scoped}
      order by t.created_at, t.id`);
    return res.rows;
  }

  private item(r: PendingRow, now: Date, currency: string): PendingApprovalItem {
    const waitingHours = round1((now.getTime() - new Date(r.task_created_at).getTime()) / HOUR_MS);
    const due = r.due_at ? new Date(r.due_at) : null;
    const sla: SlaState = !due
      ? 'within'
      : due < now
        ? 'breached'
        : due.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
          ? 'due_today'
          : 'within';
    const slaText =
      sla === 'breached'
        ? `Past SLA by ${round1((now.getTime() - due!.getTime()) / HOUR_MS)} hours`
        : sla === 'due_today'
          ? `Due today, in ${round1((due!.getTime() - now.getTime()) / HOUR_MS)} hours`
          : due
            ? `Within SLA, ${round1((due.getTime() - now.getTime()) / HOUR_MS)} hours left`
            : 'No SLA set';
    const held = r.subject_type === 'request' && n(r.held_reporting) > 0;
    const amount: Money | null = held
      ? { amountMinor: n(r.held_reporting), currency }
      : r.currency === currency && r.amount_minor !== null
        ? { amountMinor: n(r.amount_minor), currency }
        : null;
    const nudged = r.last_nudged_at ? new Date(r.last_nudged_at) : null;
    return {
      taskId: r.task_id,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      reference: r.ref ?? r.subject_id.slice(0, 8),
      title: r.title ?? '',
      kind: (r.kind ?? 'spending') as PendingKind,
      requesterName: r.requester_name,
      budgetId: r.budget_id,
      budgetName: r.budget_name,
      amount,
      transactionAmount:
        r.amount_minor !== null && r.currency
          ? { amountMinor: n(r.amount_minor), currency: r.currency }
          : null,
      held,
      step: stepLabel(r.resolver),
      stepNo: r.step_no,
      approverPersonId: r.assignee_person_id,
      approverName: r.approver_name,
      delegateName: r.delegate_name,
      waitingHours,
      dueAt: due?.toISOString() ?? null,
      sla,
      slaText,
      lastNotifiedChannel: r.last_channel,
      lastNudgedAt: nudged?.toISOString() ?? null,
      canNudge: !nudged || now.getTime() - nudged.getTime() >= NUDGE_WINDOW_MS,
    };
  }

  async pending(
    actor: RequestActor,
    q: { kind?: PendingKind; sla?: SlaState; approverPersonId?: string },
  ): Promise<PendingApprovalsOverview> {
    const paths = this.scope(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const now = nowUtc();
      const currency = actor.reportingCurrency;
      const all = (await this.pendingRows(tx, paths)).map((r) => this.item(r, now, currency));
      const items = all
        .filter((i) => (q.kind ? i.kind === q.kind : true))
        .filter((i) => (q.sla ? i.sla === q.sla : true))
        .filter((i) => (q.approverPersonId ? i.approverPersonId === q.approverPersonId : true));
      const money = (amountMinor: number): Money => ({ amountMinor, currency });
      const steps = new Map<
        string,
        { within: number; dueToday: number; breached: number; no: number }
      >();
      for (const i of items) {
        const s = steps.get(i.step) ?? { within: 0, dueToday: 0, breached: 0, no: i.stepNo };
        if (i.sla === 'within') s.within += 1;
        else if (i.sla === 'due_today') s.dueToday += 1;
        else s.breached += 1;
        steps.set(i.step, s);
      }
      const approvers = new Map<string, { name: string; items: PendingApprovalItem[] }>();
      for (const i of items) {
        const a = approvers.get(i.approverPersonId) ?? { name: i.approverName, items: [] };
        a.items.push(i);
        approvers.set(i.approverPersonId, a);
      }
      const band = (h: number) => (h < 24 ? 0 : h < 48 ? 1 : h < 120 ? 2 : 3);
      const tenantWide = paths === null;
      return {
        generatedAt: now.toISOString(),
        currency,
        scope: {
          tenantWide,
          label: tenantWide ? actor.tenantName || 'All budgets' : 'Your budgets and below',
          budgetIds: new Set(all.map((i) => i.budgetId).filter(Boolean)).size,
          note: tenantWide ? null : 'Showing approvals on budgets you can see.',
        },
        kpis: {
          pending: items.length,
          preEncumbered: money(
            items.filter((i) => i.held).reduce((s, i) => s + (i.amount?.amountMinor ?? 0), 0),
          ),
          coFundingRequested: money(
            items
              .filter((i) => i.kind === 'co_funding')
              .reduce((s, i) => s + (i.amount?.amountMinor ?? 0), 0),
          ),
          pastSla: items.filter((i) => i.sla === 'breached').length,
          medianWaitHours: median(items.map((i) => i.waitingHours)),
        },
        bySteps: [...steps.entries()]
          .sort((a, b) => a[1].no - b[1].no || a[0].localeCompare(b[0]))
          .map(([step, s]) => ({
            step,
            within: s.within,
            dueToday: s.dueToday,
            breached: s.breached,
          })),
        aging: [...approvers.entries()]
          .map(([approverPersonId, a]) => ({
            approverPersonId,
            approverName: a.name,
            bands: [0, 1, 2, 3].map((b) => {
              const inBand = a.items.filter((i) => band(i.waitingHours) === b);
              return {
                count: inBand.length,
                amount: money(inBand.reduce((s, i) => s + (i.amount?.amountMinor ?? 0), 0)),
              };
            }),
            pastSla: a.items.filter((i) => i.sla === 'breached').length,
          }))
          .sort((a, b) => b.pastSla - a.pastSla || a.approverName.localeCompare(b.approverName)),
        items: items.sort(
          (a, b) => b.waitingHours - a.waitingHours || a.reference.localeCompare(b.reference),
        ),
      };
    });
  }

  /**
   * Reminds the approver of one pending task through email and an in-app notification. Never
   * decides or reassigns; at most once per task every four hours; recorded in the request history
   * (one audit entry on the task).
   */
  nudge(
    actor: RequestActor,
    taskId: string,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<
    CommandResult<{
      taskId: string;
      approverName: string;
      channels: string[];
      nudgedAt: string;
      nextNudgeAt: string;
    }>
  > {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'dashboards.approval_nudge',
        request: { taskId },
        status: 200,
      },
      async (tx) => {
        const paths = this.scope(actor);
        const now = nowUtc();
        const [row] = await this.pendingRows(tx, paths, taskId);
        if (!row) throw ApiProblem.notFound('pending approval');
        const item = this.item(row, now, actor.reportingCurrency);
        if (!item.canNudge)
          throw new ApiProblem(
            409,
            'CONFLICT',
            `${item.approverName} was reminded less than 4 hours ago; you can remind them again after ${new Date(new Date(item.lastNudgedAt!).getTime() + NUDGE_WINDOW_MS).toISOString().slice(11, 16)} UTC.`,
          );
        const channels = ['in_app'];
        const link =
          row.subject_type === 'request'
            ? `/requests/${row.subject_id}`
            : `/contributions/${row.subject_id}`;
        const recipient = await this.notifications.personEmail(tx, row.assignee_person_id);
        if (recipient) {
          await this.notifications.queueEmail(
            tx,
            actor.tenantId,
            recipient,
            noticeEmail({
              firstName: recipient.firstName,
              subject: `Reminder: ${item.reference} is waiting for your decision`,
              headline: `${item.reference} has been waiting ${item.waitingHours} hours for your decision.`,
              lines: [
                ['Request', item.title || item.reference],
                ['Step', item.step],
                ['Waiting', `${item.waitingHours} hours`],
                ...(item.amount
                  ? ([['Amount', formatMoney(item.amount.amountMinor, item.amount.currency)]] as [
                      string,
                      string,
                    ][])
                  : []),
              ],
              detailsUrl: `${this.notifications.webBaseUrl}${link}`,
            }),
            'approval.nudge',
          );
          channels.push('email');
        }
        await tx.insert(notificationsTable).values({
          tenantId: actor.tenantId,
          recipientPersonId: row.assignee_person_id,
          area: 'approvals',
          type: 'approval.nudge',
          tone: 'info',
          title: `Reminder: ${item.reference} is waiting for your decision`,
          detail: `${actor.displayName} sent a reminder. It has been waiting ${item.waitingHours} hours.`,
          itemType: row.subject_type,
          itemId: row.subject_id,
          itemRef: item.reference,
          channelsDelivered: channels,
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'approval.nudged',
          resourceType: 'approval_task',
          resourceId: taskId,
          requestId: ctx.requestId,
          changes: {
            approverPersonId: { from: null, to: row.assignee_person_id },
            channels: { from: null, to: channels },
            // The application clock, which the four-hour window is measured on.
            nudgedAt: { from: null, to: now.toISOString() },
          },
        });
        // The request history (064) lists the subject's own entries, so the reminder is written there too.
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'approval.nudged',
          resourceType: row.subject_type,
          resourceId: row.subject_id,
          requestId: ctx.requestId,
          changes: { taskId: { from: null, to: taskId } },
        });
        return {
          taskId,
          approverName: item.approverName,
          channels,
          nudgedAt: now.toISOString(),
          nextNudgeAt: new Date(now.getTime() + NUDGE_WINDOW_MS).toISOString(),
        };
      },
    );
  }

  // 018a ------------------------------------------------------------------------------------------

  async performance(
    actor: RequestActor,
    q: { days?: '30' | '90' | '365' },
  ): Promise<ApprovalPerformance> {
    const tenant = { kind: 'tenant' as const, tenantId: actor.tenantId };
    const tenantWide = this.reads.tenantWide(actor);
    const named = tenantWide && this.policy.can(actor, 'doa.read', tenant).allowed;
    const approver =
      Boolean(actor.personId) && this.policy.can(actor, 'request.approve', tenant).allowed;
    if (!tenantWide && !approver)
      throw ApiProblem.forbidden('Approval performance is for finance roles and approvers.');
    const view: ApprovalPerformance['view'] = named ? 'named' : tenantWide ? 'aggregate' : 'own';
    const days = Number(q.days ?? '90');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const now = nowUtc();
      const since = new Date(now.getTime() - days * DAY_MS).toISOString();
      const res = await tx.execute<{
        actor_person_id: string;
        name: string;
        on_behalf: string | null;
        action: string;
        channel: string;
        resolver: string;
        hours: string;
        past_sla: boolean;
        week: string;
      }>(sql`
        select a.actor_person_id, p.display_name as name, a.on_behalf_of_person_id as on_behalf,
               a.action, a.channel::text as channel, t.resolver,
               (extract(epoch from (a.created_at - t.created_at)) / 3600)::text as hours,
               (t.due_at is not null and a.created_at > t.due_at) as past_sla,
               date_trunc('week', a.created_at)::date::text as week
        from approval_actions a
        join approval_tasks t on t.id = a.task_id
        join people p on p.id = a.actor_person_id
        where a.created_at >= ${since}::timestamptz
        order by a.created_at, a.id`);
      const rows = res.rows.map((r) => ({ ...r, hours: Math.max(Number(r.hours), 0) }));
      const hours = rows.map((r) => r.hours);
      const by = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
        const m = new Map<K, typeof rows>();
        for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
        return m;
      };
      const companyMedian = median(hours);
      const ownRows = actor.personId
        ? rows.filter((r) => r.actor_person_id === actor.personId)
        : [];

      let approvers: ApprovalPerformance['approvers'] = [];
      if (view === 'named') {
        const groups = [...by((r) => r.actor_person_id).entries()];
        const ranked = groups.filter(([, g]) => g.length >= RANK_MIN_DECISIONS);
        const others = groups
          .filter(([, g]) => g.length < RANK_MIN_DECISIONS)
          .flatMap(([, g]) => g);
        const perf = (id: string | null, name: string, g: typeof rows) => ({
          approverPersonId: id,
          approverName: name,
          step: [...new Set(g.map((r) => stepLabel(r.resolver)))].join(', '),
          decisions: g.length,
          medianHours: median(g.map((r) => r.hours)),
          p90Hours: p90(g.map((r) => r.hours)),
          pastSla: g.filter((r) => r.past_sla).length,
          delegationsUsed: g.filter((r) => r.on_behalf).length,
        });
        approvers = ranked
          .map(([id, g]) => perf(id, g[0].name, g))
          .sort(
            (a, b) =>
              (b.medianHours ?? 0) - (a.medianHours ?? 0) ||
              a.approverName.localeCompare(b.approverName),
          );
        if (others.length) approvers.push({ ...perf(null, 'Others', others), step: 'Various' });
      }
      const scoped = view === 'own' ? ownRows : rows;
      const scopedHours = scoped.map((r) => r.hours);
      const suggestions: ApprovalPerformance['suggestions'] = [];
      const slowest = approvers.find(
        (a) => a.approverPersonId && (a.medianHours ?? 0) > TARGET_HOURS,
      );
      if (slowest)
        suggestions.push({
          text: `${slowest.approverName} is the slowest approver (median ${slowest.medianHours} hours): consider a delegate during travel.`,
          link: '/approvals/delegations',
        });
      const compliance = pct(scoped.filter((r) => !r.past_sla).length, scoped.length);
      if (view !== 'own' && compliance !== null && compliance < 90)
        suggestions.push({
          text: `SLA compliance is ${compliance}%: review the routing thresholds and SLA policy.`,
          link: '/admin/rules/routing',
        });
      return {
        generatedAt: now.toISOString(),
        periodDays: days,
        view,
        kpis: {
          decisions: scoped.length,
          medianHours: median(scopedHours),
          p90Hours: p90(scopedHours),
          slaCompliancePct: compliance,
          changesRequestedPct: pct(
            scoped.filter((r) => r.action === 'request_changes').length,
            scoped.length,
          ),
          outsideWebPct: pct(scoped.filter((r) => r.channel !== 'web').length, scoped.length),
          targetHours: TARGET_HOURS,
        },
        smallSample: scoped.length < SMALL_SAMPLE,
        byStep:
          view === 'own'
            ? []
            : [...by((r) => stepLabel(r.resolver)).entries()]
                .map(([step, g]) => ({
                  step,
                  decisions: g.length,
                  medianHours: median(g.map((r) => r.hours)),
                  p90Hours: p90(g.map((r) => r.hours)),
                }))
                .sort((a, b) => a.step.localeCompare(b.step)),
        byChannel:
          view === 'own'
            ? []
            : [...by((r) => r.channel).entries()]
                .map(([channel, g]) => ({
                  channel,
                  decisions: g.length,
                  sharePct: pct(g.length, rows.length) ?? 0,
                  medianHours: median(g.map((r) => r.hours)),
                }))
                .sort((a, b) => b.decisions - a.decisions || a.channel.localeCompare(b.channel)),
        weekly: [...by((r) => r.week).entries()]
          .filter(() => view !== 'own')
          .map(([weekStart, g]) => ({
            weekStart,
            decisions: g.length,
            medianHours: median(g.map((r) => r.hours)),
            slaCompliancePct: pct(g.filter((r) => !r.past_sla).length, g.length),
          }))
          .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
        approvers,
        own:
          actor.personId && approver
            ? {
                decisions: ownRows.length,
                medianHours: median(ownRows.map((r) => r.hours)),
                companyMedianHours: companyMedian,
              }
            : null,
        suggestions: view === 'own' ? [] : suggestions,
      };
    });
  }
}
