import { AuditService } from '@bf/api/audit';
import { BudgetViews, ControlsService, type BudgetRow } from '@bf/api/budgets';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  todayUtc,
  unwrap,
  type RequestActor,
} from '@bf/api/core';
import {
  budgets,
  legalEntities,
  outboxMessages,
  people,
  reasonCodes,
  reclaimCampaigns,
  reclaimExecutions,
  reclaimNotices,
  reclaimReminders,
  tenants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads, toPostingBudget } from '@bf/api/ledger';
import { formatMoney, noticeEmail, NotificationsService } from '@bf/api/notifications';
import type {
  CreateReclaimCampaignRequest,
  EscalateReclaimNoticeRequest,
  ExecuteReclaimPoolRequest,
  ReclaimCampaign,
  ReclaimCampaignDetail,
  ReclaimCampaignList,
  ReclaimCandidate,
  ReclaimCandidateList,
  ReclaimExecution,
  ReclaimLeg,
  ReclaimNotice,
  ReclaimNoticeList,
  ReclaimPool,
  ReclaimPoolPreview,
  ReclaimPoolPreviewRequest,
  RespondReclaimNoticeRequest,
  ReclaimReminderRun,
  RunReclaimRemindersRequest,
} from '@bf/contracts';
import {
  allocationAvailable,
  acceptsNewActivity,
  maxReclaimable,
  planPoolRedistribution,
  reclaimCandidate,
  reclaimReminderDue,
  reductionFloor,
  runRateAmount,
  validateReclaimResponse,
  type ReclaimReminderKind,
  type BucketBalances,
  type PoolLeg,
  type Resource,
} from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { CommandContext } from './close-reads';

type CampaignRow = typeof reclaimCampaigns.$inferSelect;
type NoticeRow = typeof reclaimNotices.$inferSelect;
type ExecutionRow = typeof reclaimExecutions.$inferSelect;
type StoredCriteria = {
  minUnusedBps: number;
  minUnusedReportingMinor: number;
  reportingCurrency: string;
  maxDaysLeft: number;
};
type StoredLeg = {
  sourceBudgetId: string;
  destination: 'reallocation' | 'parent';
  targetBudgetId: string;
  amountMinor: number;
  journalId: string;
};

const DAY = 86_400_000;
const dayNo = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
const money = (amountMinor: number, currency: string) => ({ amountMinor, currency });
const tenantResource = (tenantId: string): Resource => ({ kind: 'tenant', tenantId });
const budgetRes = (b: BudgetRow): Resource => ({
  kind: 'budget',
  tenantId: b.tenantId,
  id: b.id,
  path: b.path,
});
const iso = (d: Date | null) => (d ? d.toISOString().replace(/\+00:00$/, 'Z') : null);
const PENDING_CARRY_MODES = ['carry_full', 'carry_with_approval'];
const NOTICE_KIND = 'budget.reclaim_notice';
/** Outbox topic and worker queue that send the deadline reminders due on a day. */
export const RECLAIM_REMINDER_TOPIC = 'reclaim.reminders';
/** Nightly schedule: the reminders due today, for every tenant. */
export const RECLAIM_REMINDER_NIGHTLY = 'reclaim.reminders_nightly';

/**
 * Reclaim and redistribute campaigns (086a). Finance starts a campaign; owners release all, part,
 * or keep the money; after the deadline finance may send an unanswered notice to the parent owner,
 * never reclaiming anything on its own. Released money moves per legal entity pool in one
 * idempotent command: reductions with a destination (targets in the same entity, the rest back to
 * each source's parent), floored at allocated out + held + encumbered + actual, under ordered locks,
 * with one audit entry per command.
 */
@Injectable()
export class ReclaimService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: LedgerReads,
    private readonly views: BudgetViews,
    private readonly controls: ControlsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private tx<T>(actor: RequestActor, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, fn);
  }

  private can(
    actor: RequestActor,
    action: 'reclaim.read' | 'reclaim.manage' | 'reclaim.redistribute',
  ) {
    return this.policy.can(actor, action, tenantResource(actor.tenantId)).allowed;
  }

  private assert(
    actor: RequestActor,
    action: 'reclaim.read' | 'reclaim.manage' | 'reclaim.redistribute',
  ) {
    if (!this.can(actor, action))
      throw ApiProblem.forbidden(
        action === 'reclaim.redistribute'
          ? 'Only a Finance Admin can redistribute reclaimed money.'
          : action === 'reclaim.manage'
            ? 'Only finance or the CEO can run reclaim campaigns.'
            : 'You cannot see reclaim campaigns.',
      );
  }

  // Candidates ------------------------------------------------------------------------------------

  private async yearFacts(tx: Tx, fiscalYearId: string) {
    const fy = await this.reads.fiscalYear(tx, fiscalYearId);
    const today = todayUtc();
    const total = dayNo(fy.endDate) - dayNo(fy.startDate) + 1;
    const elapsed = Math.min(Math.max(dayNo(today) - dayNo(fy.startDate) + 1, 0), total);
    return {
      fy,
      today,
      elapsedBps: Math.round((elapsed * 10_000) / total),
      daysLeft: Math.max(dayNo(fy.endDate) - dayNo(today), 0),
    };
  }

  private async pendingCarry(tx: Tx, ids: readonly string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const res = await tx.execute<{ budget_id: string }>(sql`
      select distinct l.budget_id from year_end_run_lines l
      join budgets b on b.id = l.budget_id
      join rollover_policies p on p.id = b.rollover_policy_id
      where p.mode in (${sql.join(
        PENDING_CARRY_MODES.map((m) => sql`${m}`),
        sql`, `,
      )}) and l.status in ('planned', 'awaiting_approval')
        and l.budget_id in (${sql.join(
          ids.map((i) => sql`${i}::uuid`),
          sql`, `,
        )})`);
    return new Set(res.rows.map((r) => r.budget_id));
  }

  private async names(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!list.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, list));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async entityCodes(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
    const list = [...new Set(ids)];
    if (!list.length) return new Map();
    const rows = await tx
      .select({ id: legalEntities.id, code: legalEntities.code })
      .from(legalEntities)
      .where(inArray(legalEntities.id, list));
    return new Map(rows.map((r) => [r.id, r.code]));
  }

  private async candidatesIn(tx: Tx, actor: RequestActor, req: CreateReclaimCampaignRequest) {
    if (req.criteria.minUnused.currency !== actor.reportingCurrency)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        `Give the minimum amount in the reporting currency (${actor.reportingCurrency}).`,
        { field: 'criteria.minUnused.currency' },
      );
    const facts = await this.yearFacts(tx, req.fiscalYearId);
    const rows = (
      await tx.select().from(budgets).where(eq(budgets.fiscalYearId, req.fiscalYearId))
    ).filter((r) => r.parentId !== null);
    const ids = rows.map((r) => r.id);
    const [balances, carry] = await Promise.all([
      this.reads.balances(tx, ids),
      this.pendingCarry(tx, ids),
    ]);
    const criteria = {
      minUnusedBps: req.criteria.minUnusedBps,
      minUnusedReportingMinor: req.criteria.minUnused.amountMinor,
      maxDaysLeft: req.criteria.maxDaysLeft,
    };
    let frozenOrZero = 0;
    let pendingCarry = 0;
    const picked: { row: BudgetRow; b: BucketBalances; c: ReturnType<typeof reclaimCandidate> }[] =
      [];
    for (const row of [...rows].sort((a, b) => a.path.localeCompare(b.path))) {
      const pair = balances.get(row.id)!;
      const c = reclaimCandidate(
        {
          status: row.status,
          balances: pair.budget,
          authorizedReportingMinor: pair.reporting.authorized,
          elapsedBps: facts.elapsedBps,
          daysLeft: facts.daysLeft,
          pendingCarry: carry.has(row.id),
        },
        criteria,
      );
      if (c.exclusion === 'frozen' || c.exclusion === 'set_to_zero') frozenOrZero++;
      if (c.exclusion === 'pending_carry') pendingCarry++;
      if (c.eligible) picked.push({ row, b: pair.budget, c });
    }
    return { facts, picked, frozenOrZero, pendingCarry, criteria };
  }

  preview(actor: RequestActor, req: CreateReclaimCampaignRequest): Promise<ReclaimCandidateList> {
    this.assert(actor, 'reclaim.manage');
    return this.tx(actor, async (tx) => {
      const { facts, picked, frozenOrZero, pendingCarry } = await this.candidatesIn(tx, actor, req);
      const owners = await this.names(
        tx,
        picked.map((p) => p.row.ownerPersonId),
      );
      const codes = await this.entityCodes(
        tx,
        picked.map((p) => p.row.legalEntityId),
      );
      const items: ReclaimCandidate[] = picked.map(({ row, b, c }) => ({
        budgetId: row.id,
        budgetName: row.name,
        budgetCode: row.code,
        ownerName: row.ownerPersonId ? (owners.get(row.ownerPersonId) ?? null) : null,
        legalEntityId: row.legalEntityId,
        legalEntityCode: codes.get(row.legalEntityId) ?? '',
        authorized: money(b.authorized, row.currency),
        available: money(allocationAvailable(b, toPostingBudget(row).control), row.currency),
        forecastUnused: money(c.forecastUnusedMinor, row.currency),
        proposed: money(c.proposedMinor, row.currency),
        floor: money(c.floorMinor, row.currency),
        maxReclaimable: money(c.maxReclaimableMinor, row.currency),
      }));
      return {
        items,
        daysLeft: facts.daysLeft,
        excludedFrozenOrZero: frozenOrZero,
        excludedPendingCarry: pendingCarry,
      };
    });
  }

  create(actor: RequestActor, req: CreateReclaimCampaignRequest, ctx: CommandContext) {
    this.assert(actor, 'reclaim.manage');
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'reclaim.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        const { facts, picked, criteria } = await this.candidatesIn(tx, actor, req);
        if (req.respondBy < facts.today || req.respondBy > facts.fy.endDate)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Choose a response date between today and the end of the fiscal year.',
            { field: 'respondBy' },
          );
        if (!picked.length)
          throw new ApiProblem(422, 'RECLAIM_NO_CANDIDATES', 'No budget meets the criteria.');
        const stored: StoredCriteria = { ...criteria, reportingCurrency: actor.reportingCurrency };
        const [campaign] = await tx
          .insert(reclaimCampaigns)
          .values({
            tenantId: actor.tenantId,
            name: req.name,
            fiscalYearId: req.fiscalYearId,
            criteria: stored,
            startedOn: facts.today,
            respondBy: req.respondBy,
            createdBy: actor.personId,
          })
          .returning();
        const deciders = new Map<string, string | null>();
        for (const p of picked) deciders.set(p.row.id, await this.decider(tx, p.row));
        const notices = await tx
          .insert(reclaimNotices)
          .values(
            picked.map(({ row, c }) => ({
              tenantId: actor.tenantId,
              campaignId: campaign.id,
              budgetId: row.id,
              legalEntityId: row.legalEntityId,
              currency: row.currency,
              ownerPersonId: row.ownerPersonId,
              parentOwnerPersonId: deciders.get(row.id) ?? null,
              forecastUnusedMinor: c.forecastUnusedMinor,
              proposedMinor: c.proposedMinor,
              floorMinor: c.floorMinor,
              maxReclaimableMinor: c.maxReclaimableMinor,
            })),
          )
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'reclaim.campaign_started',
          resourceType: 'reclaim_campaign',
          resourceId: campaign.id,
          legalEntityId: null,
          requestId: ctx.requestId,
          reason: req.name,
          changes: {
            status: { from: null, to: 'collecting' },
            respondBy: { from: null, to: req.respondBy },
            criteria: { from: null, to: stored },
            notices: {
              from: null,
              to: notices.map((n) => ({
                noticeId: n.id,
                budgetId: n.budgetId,
                proposedMinor: n.proposedMinor,
                currency: n.currency,
              })),
            },
          },
        });
        const byId = new Map(picked.map((p) => [p.row.id, p.row]));
        for (const n of notices) {
          const row = byId.get(n.budgetId)!;
          if (!n.ownerPersonId) continue;
          await this.notify(tx, actor.tenantId, n.ownerPersonId, n, {
            title: `Release unused money from ${row.name} by ${req.respondBy}`,
            detail: `${formatMoney(money(n.proposedMinor, n.currency))} is forecast to lapse on ${facts.fy.endDate}.`,
            subject: `Reclaim: respond for ${row.name} by ${req.respondBy}`,
            headline: `${formatMoney(money(n.proposedMinor, n.currency))} of ${row.name} is forecast to lapse at year end. Release it, release part, or tell us your plans.`,
            lines: [
              ['Budget', row.name],
              ['Forecast unused', formatMoney(money(n.forecastUnusedMinor, n.currency))],
              ['Proposed release', formatMoney(money(n.proposedMinor, n.currency))],
              ['Respond by', req.respondBy],
            ],
            tone: 'warning',
          });
        }
        return this.detailIn(tx, actor, campaign.id);
      },
    );
  }

  /**
   * Who decides an unanswered notice after the deadline: the owner of the nearest ancestor who is
   * not the budget's own owner (someone who owns both a budget and its parent cannot approve their
   * own reclaim, so it goes one level further up).
   */
  async decider(tx: Tx, row: BudgetRow): Promise<string | null> {
    const chain = await this.views.chain(tx, row);
    for (const a of chain.slice(1))
      if (a.ownerPersonId && a.ownerPersonId !== row.ownerPersonId) return a.ownerPersonId;
    return null;
  }

  private async notify(
    tx: Tx,
    tenantId: string,
    personId: string,
    n: NoticeRow,
    m: {
      title: string;
      detail: string;
      subject: string;
      headline: string;
      lines: [string, string][];
      tone: 'warning' | 'info' | 'success';
    },
  ): Promise<void> {
    await tx.insert(outboxMessages).values({
      tenantId,
      topic: 'channel.deliver',
      payload: {
        kind: NOTICE_KIND,
        recipientPersonId: personId,
        subjectType: 'reclaim_notice',
        subjectId: n.id,
        title: m.title,
        detail: m.detail,
        tone: m.tone,
        amountMinor: n.proposedMinor,
        currency: n.currency,
      },
    });
    const to = await this.notifications.personEmail(tx, personId);
    if (!to) return;
    await this.notifications.queueEmail(
      tx,
      tenantId,
      to,
      noticeEmail({
        firstName: to.firstName,
        subject: m.subject,
        headline: m.headline,
        lines: m.lines,
        detailsUrl: `${this.notifications.webBaseUrl}/reclaim/${n.id}`,
      }),
      NOTICE_KIND,
      { subjectType: 'reclaim_notice', subjectId: n.id },
    );
  }

  // Reads -----------------------------------------------------------------------------------------

  list(actor: RequestActor): Promise<ReclaimCampaignList> {
    this.assert(actor, 'reclaim.read');
    return this.tx(actor, async (tx) => {
      const rows = await tx
        .select()
        .from(reclaimCampaigns)
        .orderBy(desc(reclaimCampaigns.createdAt), desc(reclaimCampaigns.id));
      const notices = rows.length
        ? await tx
            .select()
            .from(reclaimNotices)
            .where(
              inArray(
                reclaimNotices.campaignId,
                rows.map((r) => r.id),
              ),
            )
        : [];
      const executions = rows.length
        ? await tx
            .select()
            .from(reclaimExecutions)
            .where(
              inArray(
                reclaimExecutions.campaignId,
                rows.map((r) => r.id),
              ),
            )
        : [];
      return {
        items: rows.map((c) =>
          this.campaignView(
            c,
            notices.filter((n) => n.campaignId === c.id),
            executions.filter((e) => e.campaignId === c.id),
          ),
        ),
        canManage: this.can(actor, 'reclaim.manage'),
      };
    });
  }

  private campaignView(
    c: CampaignRow,
    notices: NoticeRow[],
    execs: ExecutionRow[],
  ): ReclaimCampaign {
    const crit = c.criteria as StoredCriteria;
    const sum = (rows: { currency: string; amount: number }[]) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.amount) m.set(r.currency, (m.get(r.currency) ?? 0) + r.amount);
      return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => money(v, k));
    };
    return {
      id: c.id,
      name: c.name,
      fiscalYearId: c.fiscalYearId,
      status: c.status as ReclaimCampaign['status'],
      startedOn: c.startedOn,
      respondBy: c.respondBy,
      criteria: {
        minUnusedBps: crit.minUnusedBps,
        minUnused: money(crit.minUnusedReportingMinor, crit.reportingCurrency),
        maxDaysLeft: crit.maxDaysLeft,
      },
      candidates: notices.length,
      answered: notices.filter((n) => n.status !== 'sent' && n.status !== 'parent_review').length,
      released: sum(notices.map((n) => ({ currency: n.currency, amount: n.releasedMinor }))),
      redistributed: sum(execs.map((e) => ({ currency: e.currency, amount: e.poolMinor }))),
    };
  }

  private async noticeViews(
    tx: Tx,
    actor: RequestActor,
    campaign: CampaignRow,
    notices: NoticeRow[],
  ): Promise<ReclaimNotice[]> {
    if (!notices.length) return [];
    const ids = notices.map((n) => n.budgetId);
    const rows = await this.reads.budgetRows(tx, ids);
    const parents = await this.reads.budgetRows(
      tx,
      [...rows.values()].map((r) => r.parentId).filter((p): p is string => Boolean(p)),
    );
    const balances = await this.reads.balances(tx, ids);
    const names = await this.names(
      tx,
      notices.flatMap((n) => [
        rows.get(n.budgetId)?.ownerPersonId ?? null,
        n.parentOwnerPersonId,
        n.respondedBy,
      ]),
    );
    const codes = await this.entityCodes(
      tx,
      notices.map((n) => n.legalEntityId),
    );
    const fy = await this.reads.fiscalYear(tx, campaign.fiscalYearId);
    const today = todayUtc();
    const manage = this.can(actor, 'reclaim.manage');
    const pending = new Map<string, number>();
    for (const n of notices)
      pending.set(n.budgetId, await this.controls.pendingMinor(tx, n.budgetId));
    const reminders = await tx
      .select({ noticeId: reclaimReminders.noticeId, kind: reclaimReminders.kind })
      .from(reclaimReminders)
      .where(
        inArray(
          reclaimReminders.noticeId,
          notices.map((n) => n.id),
        ),
      );
    return notices.map((n) => {
      const row = rows.get(n.budgetId)!;
      const parent = row.parentId ? parents.get(row.parentId) : undefined;
      const b = balances.get(n.budgetId)!.budget;
      const overdue = n.status === 'sent' && today > campaign.respondBy;
      const open = campaign.status !== 'completed';
      const canRespond =
        open &&
        ((n.status === 'sent' &&
          row.ownerPersonId === actor.personId &&
          this.policy.can(actor, 'budget.control', budgetRes(row)).allowed) ||
          (n.status === 'parent_review' &&
            Boolean(parent) &&
            n.parentOwnerPersonId === actor.personId &&
            this.policy.can(actor, 'budget.control', budgetRes(parent!)).allowed));
      const m = (v: number) => money(v, n.currency);
      return {
        id: n.id,
        campaignId: n.campaignId,
        campaignName: campaign.name,
        budgetId: n.budgetId,
        budgetName: row.name,
        budgetCode: row.code,
        ownerName: row.ownerPersonId ? (names.get(row.ownerPersonId) ?? null) : null,
        parentBudgetName: parent?.name ?? null,
        parentOwnerName: n.parentOwnerPersonId ? (names.get(n.parentOwnerPersonId) ?? null) : null,
        legalEntityId: n.legalEntityId,
        legalEntityCode: codes.get(n.legalEntityId) ?? '',
        forecastUnused: m(n.forecastUnusedMinor),
        proposed: m(n.proposedMinor),
        released: m(n.releasedMinor),
        kept: m(n.keptMinor),
        status: n.status as ReclaimNotice['status'],
        leftOut: n.status === 'released' && n.executionId !== null,
        choice: (n.choice as ReclaimNotice['choice']) ?? null,
        reason: n.reason,
        plan: n.plan,
        respondedAs: (n.respondedAs as ReclaimNotice['respondedAs']) ?? null,
        respondedByName: n.respondedBy ? (names.get(n.respondedBy) ?? null) : null,
        respondedAt: iso(n.respondedAt),
        respondBy: campaign.respondBy,
        overdue,
        yearEnd: fy.endDate,
        available: m(allocationAvailable(b, toPostingBudget(row).control)),
        floor: m(reductionFloor(b, false)),
        maxReclaimable: m(maxReclaimable(b)),
        pendingRequests: m(pending.get(n.budgetId) ?? 0),
        remindersSent: (['two_days', 'one_day'] as const).filter((k) =>
          reminders.some((r) => r.noticeId === n.id && r.kind === k),
        ),
        canRespond,
        canEscalate: open && overdue && manage,
      };
    });
  }

  private async detailIn(
    tx: Tx,
    actor: RequestActor,
    campaignId: string,
  ): Promise<ReclaimCampaignDetail> {
    const [c] = await tx.select().from(reclaimCampaigns).where(eq(reclaimCampaigns.id, campaignId));
    if (!c) throw ApiProblem.notFound('reclaim campaign');
    const notices = await tx
      .select()
      .from(reclaimNotices)
      .where(eq(reclaimNotices.campaignId, campaignId))
      .orderBy(asc(reclaimNotices.createdAt), asc(reclaimNotices.id));
    const execs = await tx
      .select()
      .from(reclaimExecutions)
      .where(eq(reclaimExecutions.campaignId, campaignId))
      .orderBy(asc(reclaimExecutions.executedAt), asc(reclaimExecutions.id));
    const views = await this.noticeViews(tx, actor, c, notices);
    const order = new Map(views.map((v, i) => [v.id, i]));
    views.sort(
      (a, b) =>
        a.legalEntityCode.localeCompare(b.legalEntityCode) ||
        a.budgetName.localeCompare(b.budgetName) ||
        order.get(a.id)! - order.get(b.id)!,
    );
    return {
      campaign: this.campaignView(c, notices, execs),
      notices: views,
      pools: await this.pools(tx, c, notices, execs),
      executions: await this.executionViews(tx, execs),
      canManage: this.can(actor, 'reclaim.manage'),
      canRedistribute: this.can(actor, 'reclaim.redistribute'),
    };
  }

  get(actor: RequestActor, campaignId: string): Promise<ReclaimCampaignDetail> {
    this.assert(actor, 'reclaim.read');
    return this.tx(actor, (tx) => this.detailIn(tx, actor, campaignId));
  }

  /** Released money per legal entity and currency, with budgets that need it as suggested targets. */
  private async pools(
    tx: Tx,
    c: CampaignRow,
    notices: NoticeRow[],
    execs: ExecutionRow[],
  ): Promise<ReclaimPool[]> {
    const keys = new Map<string, { le: string; ccy: string; minor: number; n: number }>();
    for (const n of notices) {
      if (n.releasedMinor <= 0 || (n.status !== 'released' && n.status !== 'reclaimed')) continue;
      const k = `${n.legalEntityId}:${n.currency}`;
      const e = keys.get(k) ?? { le: n.legalEntityId, ccy: n.currency, minor: 0, n: 0 };
      e.minor += n.releasedMinor;
      e.n++;
      keys.set(k, e);
    }
    const codes = await this.entityCodes(
      tx,
      [...keys.values()].map((k) => k.le),
    );
    const sourceIds = new Set(notices.map((n) => n.budgetId));
    const out: ReclaimPool[] = [];
    for (const k of [...keys.values()].sort((a, b) =>
      (codes.get(a.le) ?? '').localeCompare(codes.get(b.le) ?? ''),
    )) {
      const exec = execs.find((e) => e.legalEntityId === k.le && e.currency === k.ccy);
      out.push({
        legalEntityId: k.le,
        legalEntityCode: codes.get(k.le) ?? '',
        released: money(k.minor, k.ccy),
        sourceCount: k.n,
        executionId: exec?.id ?? null,
        suggestedTargets: exec
          ? []
          : await this.suggestions(tx, c.fiscalYearId, k.le, k.ccy, sourceIds),
      });
    }
    return out;
  }

  private async suggestions(
    tx: Tx,
    fiscalYearId: string,
    legalEntityId: string,
    currency: string,
    exclude: Set<string>,
  ) {
    const rows = (
      await tx
        .select()
        .from(budgets)
        .where(
          and(
            eq(budgets.fiscalYearId, fiscalYearId),
            eq(budgets.legalEntityId, legalEntityId),
            eq(budgets.currency, currency),
          ),
        )
    ).filter((r) => r.parentId && !exclude.has(r.id) && acceptsNewActivity(r.status).ok);
    const facts = await this.yearFacts(tx, fiscalYearId);
    const balances = await this.reads.balances(
      tx,
      rows.map((r) => r.id),
    );
    const out: {
      budgetId: string;
      budgetName: string;
      need: { amountMinor: number; currency: string };
      reason: string;
    }[] = [];
    for (const r of rows) {
      const b = balances.get(r.id)!.budget;
      const own = b.authorized - b.allocated_out;
      const forecast = runRateAmount({
        authorizedMinor: own,
        heldMinor: b.held,
        preEncumberedMinor: b.pre_encumbered,
        encumberedMinor: b.encumbered,
        actualMinor: b.actual,
        plannedEventsMinor: 0,
        elapsedBps: facts.elapsedBps,
      });
      const over = forecast - own;
      const pendingShort = b.pre_encumbered - Math.max(own - b.held - b.encumbered - b.actual, 0);
      const need = Math.max(over, pendingShort, 0);
      if (need <= 0) continue;
      out.push({
        budgetId: r.id,
        budgetName: r.name,
        need: money(need, currency),
        reason:
          over >= pendingShort
            ? `Forecast ${formatMoney(money(over, currency))} over its budget`
            : `Pending requests ${formatMoney(money(pendingShort, currency))} short`,
      });
    }
    return out
      .sort(
        (a, b) =>
          b.need.amountMinor - a.need.amountMinor || a.budgetName.localeCompare(b.budgetName),
      )
      .slice(0, 5);
  }

  private async executionViews(tx: Tx, execs: ExecutionRow[]): Promise<ReclaimExecution[]> {
    if (!execs.length) return [];
    const legs = execs.flatMap((e) => e.legs as StoredLeg[]);
    const rows = await this.reads.budgetRows(tx, [
      ...legs.map((l) => l.sourceBudgetId),
      ...legs.map((l) => l.targetBudgetId),
    ]);
    const names = await this.names(
      tx,
      execs.map((e) => e.executedBy),
    );
    const codes = await this.entityCodes(
      tx,
      execs.map((e) => e.legalEntityId),
    );
    return execs.map((e) => ({
      id: e.id,
      campaignId: e.campaignId,
      legalEntityId: e.legalEntityId,
      legalEntityCode: codes.get(e.legalEntityId) ?? '',
      pool: money(e.poolMinor, e.currency),
      allocated: money(e.allocatedMinor, e.currency),
      remainder: money(e.remainderMinor, e.currency),
      legs: (e.legs as StoredLeg[]).map((l) => ({
        sourceBudgetId: l.sourceBudgetId,
        sourceBudgetName: rows.get(l.sourceBudgetId)?.name ?? '',
        destination: l.destination,
        targetBudgetId: l.targetBudgetId,
        targetBudgetName: rows.get(l.targetBudgetId)?.name ?? '',
        amount: money(l.amountMinor, e.currency),
        journalId: l.journalId,
      })),
      journalIds: e.journalIds,
      reasonCode: e.reasonCode,
      reason: e.reason,
      executedByName: e.executedBy ? (names.get(e.executedBy) ?? null) : null,
      executedAt: iso(e.executedAt)!,
    }));
  }

  // Notices ---------------------------------------------------------------------------------------

  private async noticeRow(tx: Tx, noticeId: string, lock = false) {
    const q = tx.select().from(reclaimNotices).where(eq(reclaimNotices.id, noticeId));
    const [n] = lock ? await q.for('update') : await q;
    if (!n) throw ApiProblem.notFound('reclaim notice');
    const [c] = await tx
      .select()
      .from(reclaimCampaigns)
      .where(eq(reclaimCampaigns.id, n.campaignId));
    return { n, c };
  }

  /** Finance and auditors see every notice; owners their own; a parent owner the ones sent to them. */
  /**
   * Finance and auditors see every notice; the budget's owner sees it (the current owner, so a
   * budget that changes hands mid-campaign is answered by its new owner); a parent owner sees the
   * ones sent to them.
   */
  private visible(actor: RequestActor, n: NoticeRow, currentOwnerId: string | null): boolean {
    return (
      this.can(actor, 'reclaim.read') ||
      currentOwnerId === actor.personId ||
      (n.parentOwnerPersonId === actor.personId &&
        (n.status === 'parent_review' || n.respondedAs === 'parent_owner'))
    );
  }

  mine(actor: RequestActor): Promise<ReclaimNoticeList> {
    return this.tx(actor, async (tx) => {
      if (!actor.personId) return { items: [] };
      const rows = await tx
        .select()
        .from(reclaimNotices)
        .where(
          sql`exists (select 1 from budgets b where b.id = ${reclaimNotices.budgetId}
                        and b.owner_person_id = ${actor.personId}::uuid)
            or (${reclaimNotices.parentOwnerPersonId} = ${actor.personId}::uuid
                and (${reclaimNotices.status} = 'parent_review' or ${reclaimNotices.respondedAs} = 'parent_owner'))`,
        )
        .orderBy(asc(reclaimNotices.createdAt), asc(reclaimNotices.id));
      const items: ReclaimNotice[] = [];
      const campaigns = new Map<string, CampaignRow>();
      for (const n of rows) {
        if (!campaigns.has(n.campaignId)) {
          const [c] = await tx
            .select()
            .from(reclaimCampaigns)
            .where(eq(reclaimCampaigns.id, n.campaignId));
          campaigns.set(n.campaignId, c);
        }
        items.push(...(await this.noticeViews(tx, actor, campaigns.get(n.campaignId)!, [n])));
      }
      return { items };
    });
  }

  getNotice(actor: RequestActor, noticeId: string): Promise<ReclaimNotice> {
    return this.tx(actor, async (tx) => {
      const { n, c } = await this.noticeRow(tx, noticeId);
      const current = (await this.reads.budgetRows(tx, [n.budgetId])).get(n.budgetId);
      if (!this.visible(actor, n, current?.ownerPersonId ?? null))
        throw ApiProblem.notFound('reclaim notice');
      const [view] = await this.noticeViews(tx, actor, c, [n]);
      return view;
    });
  }

  respond(
    actor: RequestActor,
    noticeId: string,
    req: RespondReclaimNoticeRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `reclaim.respond:${noticeId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const { n: unlocked } = await this.noticeRow(tx, noticeId);
        const current = (await this.reads.budgetRows(tx, [unlocked.budgetId])).get(
          unlocked.budgetId,
        );
        if (!this.visible(actor, unlocked, current?.ownerPersonId ?? null))
          throw ApiProblem.notFound('reclaim notice');
        // Ordered locks: the budget row first (as every money command does), then the notice.
        await this.reads.lockBudgets(tx, [unlocked.budgetId]);
        const { n, c } = await this.noticeRow(tx, noticeId, true);
        const row = await this.views.row(tx, n.budgetId);
        if (c.status === 'completed')
          throw new ApiProblem(409, 'RECLAIM_CAMPAIGN_CLOSED', 'This campaign is completed.');
        await this.assertPoolOpen(tx, n);
        let respondedAs: 'owner' | 'parent_owner';
        if (n.status === 'sent') {
          if (
            row.ownerPersonId !== actor.personId ||
            !this.policy.can(actor, 'budget.control', budgetRes(row)).allowed
          )
            throw ApiProblem.forbidden('Only the owner of the budget can answer this notice.');
          respondedAs = 'owner';
        } else if (n.status === 'parent_review') {
          const parent = await this.views.row(tx, row.parentId!);
          if (
            n.parentOwnerPersonId !== actor.personId ||
            !this.policy.can(actor, 'budget.control', budgetRes(parent)).allowed
          )
            throw ApiProblem.forbidden(
              'After the deadline only the owner of the parent budget can decide this notice.',
            );
          respondedAs = 'parent_owner';
        } else
          throw new ApiProblem(
            409,
            'RECLAIM_NOTICE_ANSWERED',
            'This notice has already been answered.',
          );
        const b = (await this.reads.balances(tx, [row.id])).get(row.id)!.budget;
        const checked = validateReclaimResponse(n.proposedMinor, b, req);
        if (!checked.ok && checked.error.code === 'REDUCTION_BELOW_FLOOR')
          throw new ApiProblem(
            409,
            'REDUCTION_BELOW_FLOOR',
            `At most ${formatMoney(money(maxReclaimable(b), n.currency))} can be reclaimed (floor: committed + actual + children).`,
            checked.error.params,
          );
        const outcome = unwrap(checked);
        const now = new Date();
        const [updated] = await tx
          .update(reclaimNotices)
          .set({
            status: outcome.status,
            choice: req.choice,
            releasedMinor: outcome.releasedMinor,
            keptMinor: outcome.keptMinor,
            reason: req.reason ?? null,
            plan: req.plan ?? null,
            respondedAs,
            respondedBy: actor.personId,
            respondedAt: now,
          })
          .where(eq(reclaimNotices.id, n.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'reclaim.responded',
          resourceType: 'reclaim_notice',
          resourceId: n.id,
          legalEntityId: n.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason ?? (req.choice === 'release_all' ? 'Released all' : 'Released part'),
          changes: {
            status: { from: n.status, to: outcome.status },
            choice: { from: null, to: req.choice },
            releasedMinor: { from: 0, to: outcome.releasedMinor },
            keptMinor: { from: 0, to: outcome.keptMinor },
            respondedAs: { from: null, to: respondedAs },
            budgetId: { from: null, to: n.budgetId },
            campaignId: { from: null, to: n.campaignId },
            ...(req.plan ? { plan: { from: null, to: req.plan } } : {}),
          },
        });
        const [view] = await this.noticeViews(tx, actor, c, [updated]);
        return view;
      },
    );
  }

  escalate(
    actor: RequestActor,
    noticeId: string,
    req: EscalateReclaimNoticeRequest,
    ctx: CommandContext,
  ) {
    this.assert(actor, 'reclaim.manage');
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `reclaim.escalate:${noticeId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const { n, c } = await this.noticeRow(tx, noticeId, true);
        if (c.status === 'completed')
          throw new ApiProblem(409, 'RECLAIM_CAMPAIGN_CLOSED', 'This campaign is completed.');
        await this.assertPoolOpen(tx, n);
        if (n.status !== 'sent')
          throw new ApiProblem(
            409,
            'RECLAIM_NOTICE_ANSWERED',
            'Only an unanswered notice can go to the parent owner.',
          );
        if (todayUtc() <= c.respondBy)
          throw new ApiProblem(
            409,
            'RECLAIM_NOT_OVERDUE',
            `The owner has until ${c.respondBy} to answer.`,
            { respondBy: c.respondBy },
          );
        // Who decides is worked out now, from the budget's owners today: ownership may have
        // changed since the campaign started.
        const budgetRow = await this.views.row(tx, n.budgetId);
        const decider = await this.decider(tx, budgetRow);
        if (!decider)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'No budget above this one has an owner to decide this notice.',
          );
        const [updated] = await tx
          .update(reclaimNotices)
          .set({
            status: 'parent_review',
            parentOwnerPersonId: decider,
            escalatedBy: actor.personId,
            escalatedAt: new Date(),
          })
          .where(eq(reclaimNotices.id, n.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'reclaim.escalated',
          resourceType: 'reclaim_notice',
          resourceId: n.id,
          legalEntityId: n.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            status: { from: 'sent', to: 'parent_review' },
            decidedBy: { from: budgetRow.ownerPersonId, to: decider },
          },
        });
        const row = await this.views.row(tx, n.budgetId);
        await this.notify(tx, actor.tenantId, decider, updated, {
          title: `Decide the reclaim of ${row.name}: no answer from its owner`,
          detail: `${formatMoney(money(n.proposedMinor, n.currency))} proposed; the owner did not answer by ${c.respondBy}.`,
          subject: `Reclaim: decide for ${row.name}`,
          headline: `The owner of ${row.name} did not answer by ${c.respondBy}. As the owner of its parent budget, release the money or keep it with a reason.`,
          lines: [
            ['Budget', row.name],
            ['Proposed release', formatMoney(money(n.proposedMinor, n.currency))],
          ],
          tone: 'warning',
        });
        const [view] = await this.noticeViews(tx, actor, c, [updated]);
        return view;
      },
    );
  }

  /**
   * Once a legal entity's pool has been posted, its notices are closed: an answer arriving later
   * would release money that no execution can ever move, so it is refused instead.
   */
  private async assertPoolOpen(tx: Tx, n: NoticeRow): Promise<void> {
    const [done] = await tx
      .select({ id: reclaimExecutions.id })
      .from(reclaimExecutions)
      .where(
        and(
          eq(reclaimExecutions.campaignId, n.campaignId),
          eq(reclaimExecutions.legalEntityId, n.legalEntityId),
          eq(reclaimExecutions.currency, n.currency),
        ),
      );
    if (done)
      throw new ApiProblem(
        409,
        'RECLAIM_POOL_EXECUTED',
        'The money released in this legal entity has already been redistributed; this notice is closed.',
        { executionId: done.id },
      );
  }

  // Redistribution --------------------------------------------------------------------------------

  private async poolSources(
    tx: Tx,
    campaignId: string,
    legalEntityId: string,
    currency: string,
    lock: boolean,
    exclude: readonly string[] = [],
  ) {
    const [c] = await tx.select().from(reclaimCampaigns).where(eq(reclaimCampaigns.id, campaignId));
    if (!c) throw ApiProblem.notFound('reclaim campaign');
    const [done] = await tx
      .select({ id: reclaimExecutions.id })
      .from(reclaimExecutions)
      .where(
        and(
          eq(reclaimExecutions.campaignId, campaignId),
          eq(reclaimExecutions.legalEntityId, legalEntityId),
          eq(reclaimExecutions.currency, currency),
        ),
      );
    if (done)
      throw new ApiProblem(
        409,
        'RECLAIM_POOL_EXECUTED',
        'The money released in this legal entity has already been redistributed.',
        { executionId: done.id },
      );
    const q = tx
      .select()
      .from(reclaimNotices)
      .where(
        and(
          eq(reclaimNotices.campaignId, campaignId),
          eq(reclaimNotices.legalEntityId, legalEntityId),
          eq(reclaimNotices.currency, currency),
          eq(reclaimNotices.status, 'released'),
        ),
      )
      .orderBy(asc(reclaimNotices.budgetId));
    const released = lock ? await q.for('update') : await q;
    if (!released.length)
      throw new ApiProblem(
        409,
        'RECLAIM_POOL_EMPTY',
        'No money has been released in this legal entity yet.',
      );
    const unknown = exclude.filter((id) => !released.some((n) => n.budgetId === id));
    if (unknown.length)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Only budgets that released money into this pool can be left out of it.',
        { field: 'excludeBudgetIds', budgetId: unknown[0] },
      );
    // Left out (for example set to zero after releasing): nothing moves for them, and when the pool
    // is posted their notices close with it, the owner's answer kept on record.
    const left = released.filter((n) => exclude.includes(n.budgetId));
    const notices = released.filter((n) => !exclude.includes(n.budgetId));
    return { c, notices, left };
  }

  /** Resolves the legs to budget rows and checks every target against the pool's entity and tree. */
  private async resolve(
    tx: Tx,
    c: CampaignRow,
    notices: NoticeRow[],
    req: ReclaimPoolPreviewRequest,
  ) {
    const plan = unwrap(
      planPoolRedistribution(
        notices.map((n) => ({ budgetId: n.budgetId, releasedMinor: n.releasedMinor })),
        req.targets,
      ),
    );
    const sourceRows = await this.reads.budgetRows(
      tx,
      notices.map((n) => n.budgetId),
    );
    const targetRows = await this.reads.budgetRows(
      tx,
      req.targets.map((t) => t.budgetId),
    );
    const parentRows = await this.reads.budgetRows(
      tx,
      [...sourceRows.values()].map((r) => r.parentId!),
    );
    const root = (r: BudgetRow) => r.path.split('/')[1];
    const roots = new Set([...sourceRows.values()].map(root));
    for (const t of req.targets) {
      const row = targetRows.get(t.budgetId);
      if (!row) throw ApiProblem.notFound('target budget');
      const why =
        row.legalEntityId !== req.legalEntityId
          ? `${row.name} belongs to another legal entity; money stays within the entity (cross-entity money returns to the parent).`
          : row.currency !== req.currency
            ? `${row.name} is budgeted in ${row.currency}, not ${req.currency}.`
            : row.fiscalYearId !== c.fiscalYearId
              ? `${row.name} is in another fiscal year.`
              : !roots.has(root(row)) || roots.size > 1
                ? `${row.name} is not in the same budget tree as the released money.`
                : [...sourceRows.values()].some((s) => row.path.startsWith(s.path))
                  ? `${row.name} sits under a budget that released money.`
                  : null;
      if (why) throw new ApiProblem(422, 'TRANSFER_INVALID', why, { budgetId: row.id });
      const accepts = acceptsNewActivity(row.status);
      if (!accepts.ok)
        throw new ApiProblem(
          422,
          accepts.error.code as 'TRANSFER_INVALID',
          `${row.name}: ${accepts.error.message}`,
          { budgetId: row.id },
        );
    }
    const destOf = (leg: PoolLeg): BudgetRow =>
      leg.destination === 'reallocation'
        ? targetRows.get(leg.targetBudgetId!)!
        : parentRows.get(sourceRows.get(leg.sourceBudgetId)!.parentId!)!;
    return { plan, sourceRows, destOf };
  }

  private legViews(
    plan: { legs: PoolLeg[] },
    sourceRows: Map<string, BudgetRow>,
    destOf: (l: PoolLeg) => BudgetRow,
    currency: string,
    journals: string[] = [],
  ): ReclaimLeg[] {
    return plan.legs.map((l, i) => {
      const dest = destOf(l);
      return {
        sourceBudgetId: l.sourceBudgetId,
        sourceBudgetName: sourceRows.get(l.sourceBudgetId)!.name,
        destination: l.destination,
        targetBudgetId: dest.id,
        targetBudgetName: dest.name,
        amount: money(l.amountMinor, currency),
        journalId: journals[i] ?? null,
      };
    });
  }

  previewPool(
    actor: RequestActor,
    campaignId: string,
    req: ReclaimPoolPreviewRequest,
  ): Promise<ReclaimPoolPreview> {
    this.assert(actor, 'reclaim.redistribute');
    return this.tx(actor, async (tx) => {
      const { c, notices, left } = await this.poolSources(
        tx,
        campaignId,
        req.legalEntityId,
        req.currency,
        false,
        req.excludeBudgetIds ?? [],
      );
      const { plan, sourceRows, destOf } = await this.resolve(tx, c, notices, req);
      const leftRows = await this.reads.budgetRows(
        tx,
        left.map((n) => n.budgetId),
      );
      const balances = await this.reads.balances(
        tx,
        notices.map((n) => n.budgetId),
      );
      const codes = await this.entityCodes(tx, [req.legalEntityId]);
      const m = (v: number) => money(v, req.currency);
      let blocked: string | null = null;
      const sources = [];
      for (const n of notices) {
        const row = sourceRows.get(n.budgetId)!;
        const b = balances.get(n.budgetId)!.budget;
        const max = maxReclaimable(b);
        const within = n.releasedMinor <= max;
        if (!within && !blocked)
          blocked = `At most ${formatMoney(m(max))} can be reclaimed from ${row.name} (floor: committed + actual + children).`;
        sources.push({
          budgetId: row.id,
          budgetName: row.name,
          released: m(n.releasedMinor),
          authorizedBefore: m(b.authorized),
          authorizedAfter: m(b.authorized - n.releasedMinor),
          floor: m(reductionFloor(b, false)),
          maxReclaimable: m(max),
          pendingRequests: m(await this.controls.pendingMinor(tx, row.id)),
          withinFloor: within,
        });
      }
      return {
        legalEntityId: req.legalEntityId,
        legalEntityCode: codes.get(req.legalEntityId) ?? '',
        pool: m(plan.poolMinor),
        allocated: m(plan.allocatedMinor),
        remainder: m(plan.remainderMinor),
        legs: this.legViews(plan, sourceRows, destOf, req.currency),
        sources,
        excluded: left.map((n) => ({
          budgetId: n.budgetId,
          budgetName: leftRows.get(n.budgetId)?.name ?? '',
          released: m(n.releasedMinor),
        })),
        canConfirm: blocked === null && this.can(actor, 'reclaim.redistribute'),
        blockedReason: blocked,
      };
    });
  }

  executePool(
    actor: RequestActor,
    campaignId: string,
    req: ExecuteReclaimPoolRequest,
    ctx: CommandContext,
  ) {
    this.assert(actor, 'reclaim.redistribute');
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `reclaim.execute:${campaignId}:${req.legalEntityId}:${req.currency}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const [rc] = await tx
          .select()
          .from(reasonCodes)
          .where(and(eq(reasonCodes.code, req.reasonCode), eq(reasonCodes.category, 'reduction')));
        if (!rc)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Choose one of the reason codes for this change.',
            { field: 'reasonCode' },
          );
        const exclude = req.excludeBudgetIds ?? [];
        const first = await this.poolSources(
          tx,
          campaignId,
          req.legalEntityId,
          req.currency,
          false,
          exclude,
        );
        const pre = await this.resolve(tx, first.c, first.notices, req);
        // Ordered locks over every chain involved (sources, their parents, targets and ancestors),
        // parent before child then by id, before anything is re-read or posted.
        const lockIds = new Set<string>();
        for (const r of pre.sourceRows.values())
          for (const i of r.path.split('/').filter(Boolean)) lockIds.add(i);
        for (const l of pre.plan.legs)
          for (const i of pre.destOf(l).path.split('/').filter(Boolean)) lockIds.add(i);
        await this.reads.lockBudgets(tx, [...lockIds]);
        const { c, notices, left } = await this.poolSources(
          tx,
          campaignId,
          req.legalEntityId,
          req.currency,
          true,
          exclude,
        );
        // An answer committed between the first read and the locks would add a source whose chain
        // was never locked: refuse rather than post on it, and let the caller retry.
        const key = (list: NoticeRow[]) => list.map((x) => `${x.id}:${x.releasedMinor}`).join(',');
        if (key([...notices, ...left]) !== key([...first.notices, ...first.left]))
          throw new ApiProblem(
            409,
            'VERSION_CONFLICT',
            'Owners answered while this pool was being posted. Review the preview again.',
          );
        const { plan, sourceRows, destOf } = await this.resolve(tx, c, notices, req);
        const floors = new Map(req.confirmedFloors.map((f) => [f.budgetId, f.floorMinor]));
        const journalsByLeg = new Map<PoolLeg, string>();
        const perSource: Record<string, unknown> = {};
        for (const n of notices) {
          const legs = plan.legs.filter((l) => l.sourceBudgetId === n.budgetId);
          const posted = await this.controls.reclaimInTx(
            tx,
            actor,
            n.budgetId,
            legs.map((l) => ({
              destination: destOf(l),
              kind: l.destination,
              amountMinor: l.amountMinor,
            })),
            {
              reasonCode: req.reasonCode,
              reason: req.reason,
              confirmedFloorMinor: floors.get(n.budgetId),
            },
            ctx,
          );
          legs.forEach((l, i) => journalsByLeg.set(l, posted.journalIds[i]));
          perSource[n.budgetId] = {
            from: posted.authorizedBeforeMinor,
            to: posted.authorizedAfterMinor,
            floorMinor: posted.floorMinor,
            status: posted.status,
            unfitRequestIds: posted.unfitRequestIds,
          };
        }
        const journals = plan.legs.map((l) => journalsByLeg.get(l)!);
        const stored: StoredLeg[] = plan.legs.map((l, i) => ({
          sourceBudgetId: l.sourceBudgetId,
          destination: l.destination,
          targetBudgetId: destOf(l).id,
          amountMinor: l.amountMinor,
          journalId: journals[i],
        }));
        const [exec] = await tx
          .insert(reclaimExecutions)
          .values({
            tenantId: actor.tenantId,
            campaignId,
            legalEntityId: req.legalEntityId,
            currency: req.currency,
            poolMinor: plan.poolMinor,
            allocatedMinor: plan.allocatedMinor,
            remainderMinor: plan.remainderMinor,
            legs: stored,
            journalIds: journals,
            reasonCode: req.reasonCode,
            reason: req.reason,
            executedBy: actor.personId,
          })
          .returning();
        await tx
          .update(reclaimNotices)
          .set({ status: 'reclaimed', executionId: exec.id })
          .where(
            inArray(
              reclaimNotices.id,
              notices.map((n) => n.id),
            ),
          );
        if (left.length)
          await tx
            .update(reclaimNotices)
            .set({ executionId: exec.id })
            .where(
              inArray(
                reclaimNotices.id,
                left.map((n) => n.id),
              ),
            );
        const all = await tx
          .select()
          .from(reclaimNotices)
          .where(eq(reclaimNotices.campaignId, campaignId));
        const postedPools = await tx
          .select({ le: reclaimExecutions.legalEntityId, ccy: reclaimExecutions.currency })
          .from(reclaimExecutions)
          .where(eq(reclaimExecutions.campaignId, campaignId));
        const closed = new Set([
          ...postedPools.map((p) => `${p.le}:${p.ccy}`),
          `${req.legalEntityId}:${req.currency}`,
        ]);
        const open = all.some(
          (n) =>
            ['sent', 'parent_review', 'released'].includes(n.status) &&
            !closed.has(`${n.legalEntityId}:${n.currency}`),
        );
        const nextStatus = open ? 'redistributing' : 'completed';
        if (nextStatus !== c.status)
          await tx
            .update(reclaimCampaigns)
            .set({ status: nextStatus, updatedAt: new Date() })
            .where(eq(reclaimCampaigns.id, campaignId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'reclaim.pool_executed',
          resourceType: 'reclaim_campaign',
          resourceId: campaignId,
          legalEntityId: req.legalEntityId,
          requestId: ctx.requestId,
          reason: `${req.reasonCode}: ${req.reason}`,
          changes: {
            status: { from: c.status, to: nextStatus },
            executionId: { from: null, to: exec.id },
            currency: { from: null, to: req.currency },
            poolMinor: { from: null, to: plan.poolMinor },
            allocatedMinor: { from: null, to: plan.allocatedMinor },
            remainderMinor: { from: null, to: plan.remainderMinor },
            legs: { from: null, to: stored },
            authorized: { from: null, to: perSource },
            ...(left.length
              ? {
                  leftOut: {
                    from: null,
                    to: left.map((n) => ({ budgetId: n.budgetId, releasedMinor: n.releasedMinor })),
                  },
                }
              : {}),
          },
        });
        for (const n of notices) {
          const row = sourceRows.get(n.budgetId)!;
          if (!row.ownerPersonId) continue;
          const to = [
            ...new Set(
              plan.legs.filter((l) => l.sourceBudgetId === n.budgetId).map((l) => destOf(l).name),
            ),
          ].join(', ');
          await this.notify(tx, actor.tenantId, row.ownerPersonId, n, {
            title: `${formatMoney(money(n.releasedMinor, n.currency))} released from ${row.name} was redistributed`,
            detail: `Moved to ${to}.`,
            subject: `Reclaim completed for ${row.name}`,
            headline: `The ${formatMoney(money(n.releasedMinor, n.currency))} you released from ${row.name} now funds ${to}.`,
            lines: [
              ['Budget', row.name],
              ['Released', formatMoney(money(n.releasedMinor, n.currency))],
              ['Moved to', to],
            ],
            tone: 'success',
          });
        }
        const [view] = await this.executionViews(tx, [exec]);
        return view;
      },
    );
  }

  // Deadline reminders (086a: 2 days and 1 day before the response date) ---------------------

  private readonly log = new Logger('ReclaimReminders');

  /** Queues the reminders due on a day; the worker sends them. */
  requestReminders(actor: RequestActor, req: RunReclaimRemindersRequest, ctx: CommandContext) {
    this.assert(actor, 'reclaim.manage');
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'reclaim.reminders',
        request: req,
        status: 202,
      },
      async (tx): Promise<ReclaimReminderRun> => {
        const asOf = req.asOf ?? todayUtc();
        await tx
          .insert(outboxMessages)
          .values({ tenantId: actor.tenantId, topic: RECLAIM_REMINDER_TOPIC, payload: { asOf } });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'reclaim.reminders_requested',
          resourceType: 'reclaim_reminder_run',
          resourceId: randomUUID(),
          legalEntityId: null,
          requestId: ctx.requestId,
          reason: `Reclaim deadline reminders for ${asOf}`,
          changes: { asOf: { from: null, to: asOf } },
        });
        return { asOf, queued: true };
      },
    );
  }

  /**
   * Worker side: sends each unanswered notice the reminder due on `asOf`, at most once per notice
   * and kind (the unique index makes a rerun a no-op). Notices in a completed campaign or in a pool
   * already posted are closed and get none. Returns how many reminders went out.
   */
  async sendReminders(tenantId: string, asOf: string): Promise<number> {
    return withTenant(this.db, { tenantId, subject: 'system:worker' }, async (tx) => {
      const rows = await tx
        .select({ n: reclaimNotices, c: reclaimCampaigns })
        .from(reclaimNotices)
        .innerJoin(reclaimCampaigns, eq(reclaimCampaigns.id, reclaimNotices.campaignId))
        .where(
          and(eq(reclaimNotices.status, 'sent'), sql`${reclaimCampaigns.status} <> 'completed'`),
        )
        .orderBy(asc(reclaimNotices.createdAt), asc(reclaimNotices.id));
      if (!rows.length) return 0;
      const sent = await tx
        .select({ noticeId: reclaimReminders.noticeId, kind: reclaimReminders.kind })
        .from(reclaimReminders)
        .where(
          inArray(
            reclaimReminders.noticeId,
            rows.map((r) => r.n.id),
          ),
        );
      const posted = await tx
        .select({
          c: reclaimExecutions.campaignId,
          le: reclaimExecutions.legalEntityId,
          ccy: reclaimExecutions.currency,
        })
        .from(reclaimExecutions);
      const closed = new Set(posted.map((p) => `${p.c}:${p.le}:${p.ccy}`));
      let count = 0;
      for (const { n, c } of rows) {
        if (closed.has(`${n.campaignId}:${n.legalEntityId}:${n.currency}`)) continue;
        const kinds = sent
          .filter((x) => x.noticeId === n.id)
          .map((x) => x.kind as ReclaimReminderKind);
        const due = reclaimReminderDue(c.respondBy, asOf, kinds);
        if (!due) continue;
        const inserted = await tx
          .insert(reclaimReminders)
          .values({ tenantId, noticeId: n.id, kind: due, asOf })
          .onConflictDoNothing()
          .returning();
        if (!inserted.length) continue;
        count++;
        const row = await this.views.row(tx, n.budgetId);
        if (!row.ownerPersonId) continue;
        const when = due === 'one_day' ? 'tomorrow' : 'in 2 days';
        await this.notify(tx, tenantId, row.ownerPersonId, n, {
          title: `Reminder: answer the reclaim of ${row.name} by ${c.respondBy}`,
          detail: `${formatMoney(money(n.proposedMinor, n.currency))} proposed; responses close ${when}.`,
          subject: `Reminder: reclaim of ${row.name} closes ${when}`,
          headline: `Responses to the ${c.name} close ${when} (${c.respondBy}). Release the money, release part, or tell us your plans; nothing is reclaimed without an answer, but after the deadline the decision goes to the owner of a budget above yours.`,
          lines: [
            ['Budget', row.name],
            ['Proposed release', formatMoney(money(n.proposedMinor, n.currency))],
            ['Respond by', c.respondBy],
          ],
          tone: 'warning',
        });
      }
      this.log.log(`reclaim reminders for ${asOf}: ${count} sent`);
      return count;
    });
  }

  /** Nightly: the reminders due today for every tenant; one tenant failing never stops the others. */
  async sendRemindersNightly(): Promise<number> {
    const all = await this.db.transaction((tx) => tx.select({ id: tenants.id }).from(tenants));
    let total = 0;
    for (const t of all) {
      try {
        total += await this.sendReminders(t.id, todayUtc());
      } catch (e) {
        this.log.error(`reclaim reminders failed for a tenant: ${(e as Error).message}`);
      }
    }
    return total;
  }
}
