import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type RequestActor,
} from '@bf/api/core';
import {
  fiscalPeriods,
  fiscalYears,
  ledgerJournals,
  ledgerLines,
  legalEntities,
  periodCloseAcknowledgements,
  periodCloseSnapshots,
  periodReopenRequests,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  AcknowledgeCheckRequest,
  ClosePeriodDetail,
  ClosePeriodSummary,
  CloseCheck,
  LateItem,
  PeriodSnapshot,
  ReopenRequest,
} from '@bf/contracts';
import {
  canAcknowledge,
  changePeriodStatus,
  closeCheckKind,
  isBlocking,
  closeConfirmationFor,
  closeReadiness,
  requireConfirmation,
  requireSecondPerson,
  type CloseCheckCode,
  type PeriodEvent,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  assertTenant,
  CloseReads,
  todayUtc,
  type CommandContext,
  type LegalEntityRow,
  type PeriodRow,
} from './close-reads';
import { PeriodCloseChecks, type CheckResult } from './period-close-checks';

type AckRow = typeof periodCloseAcknowledgements.$inferSelect;
type SnapshotRow = typeof periodCloseSnapshots.$inferSelect;
type ReopenRow = typeof periodReopenRequests.$inferSelect;

interface SnapshotBalances {
  authorizedMinor: number;
  allocatedOutMinor: number;
  heldMinor: number;
  preEncumberedMinor: number;
  encumberedMinor: number;
  actualMinor: number;
  accruedMinor: number;
}

const EMPTY: SnapshotBalances = {
  authorizedMinor: 0,
  allocatedOutMinor: 0,
  heldMinor: 0,
  preEncumberedMinor: 0,
  encumberedMinor: 0,
  actualMinor: 0,
  accruedMinor: 0,
};

const BUCKET_ACCOUNTS = [
  'authorized',
  'allocated_out',
  'held',
  'pre_encumbered',
  'encumbered',
  'actual',
  'accrued',
] as const;

const BUCKET_FIELD: Record<string, keyof SnapshotBalances> = {
  authorized: 'authorizedMinor',
  allocated_out: 'allocatedOutMinor',
  held: 'heldMinor',
  pre_encumbered: 'preEncumberedMinor',
  encumbered: 'encumberedMinor',
  actual: 'actualMinor',
  accrued: 'accruedMinor',
};

/** Working day 3 after the period ends: the date finance aims to have the close done by. */
function targetCloseDate(endDate: string): string {
  const d = new Date(`${endDate}T00:00:00Z`);
  let added = 0;
  while (added < 3) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d.toISOString().slice(0, 10);
}

const CHECK_TITLES: Record<CloseCheckCode, string> = {
  gl_tieout_signed_off: 'GL tie-out signed off',
  journals_balanced: 'No unbalanced journals',
  ledger_check_clean: 'Nightly ledger check clean',
  audit_chain_verified: 'Audit chain verified',
  actuals_imported: 'Actuals imported for every source',
  unmatched_actuals_cleared: 'Unmatched actuals cleared or carried',
  accruals_reviewed: 'Accrual proposals reviewed',
  prepaids_recognized: 'Prepaids recognized through the period end',
  commitments_accrued: 'Commitments past their service date accrued',
};

/**
 * Period close: the per-entity checklist, acknowledgements, the status changes (soft close, close,
 * lock) with the immutable as-of snapshots, and break-glass reopen and unlock that two different
 * people decide. Closing never rewrites anything: corrections after a close are reversals posted in
 * an open period, and the database itself refuses an insert into a closed or locked period.
 */
@Injectable()
export class PeriodCloseService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reads: CloseReads,
    private readonly checks: PeriodCloseChecks,
  ) {}

  list(actor: RequestActor, query: { fiscalYearId?: string }) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'ledger.read');
      const rows = await tx
        .select()
        .from(fiscalPeriods)
        .where(query.fiscalYearId ? eq(fiscalPeriods.fiscalYearId, query.fiscalYearId) : sql`true`)
        .orderBy(asc(fiscalPeriods.startDate));
      const years = await tx.select().from(fiscalYears);
      const labels = new Map(years.map((y) => [y.id, y.label]));
      const items: ClosePeriodSummary[] = [];
      for (const p of rows) items.push(await this.summary(tx, p, labels.get(p.fiscalYearId) ?? ''));
      return { items };
    });
  }

  get(actor: RequestActor, periodId: string) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'ledger.read');
      return this.detail(tx, actor, await this.reads.period(tx, periodId));
    });
  }

  /**
   * The period each fiscal calendar in use is closing (012): the oldest open or soft-closed period
   * that has already ended, else the period containing today, with its per-entity checklist. Read
   * only; the same checks the close command runs.
   */
  closing(actor: RequestActor) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'ledger.read');
      const today = todayUtc();
      const used = await tx
        .selectDistinct({ calendarId: legalEntities.fiscalCalendarId })
        .from(legalEntities);
      const out: { period: ClosePeriodSummary; entities: ClosePeriodDetail['entities'] }[] = [];
      for (const { calendarId } of used) {
        if (!calendarId) continue;
        const periods = await this.reads.calendarPeriods(tx, calendarId);
        const period =
          periods.find(
            (p) => (p.status === 'open' || p.status === 'soft_closed') && p.endDate < today,
          ) ?? periods.find((p) => p.startDate <= today && p.endDate >= today);
        if (!period) continue;
        const year = await this.reads.fiscalYear(tx, period.fiscalYearId);
        const entities = await this.reads.entitiesOfPeriod(tx, period);
        out.push({
          period: await this.summary(tx, period, year.label),
          entities: await this.checklist(tx, period, entities),
        });
      }
      return out.sort(
        (a, b) =>
          a.period.endDate.localeCompare(b.period.endDate) ||
          (a.entities[0]?.legalEntityCode ?? '').localeCompare(
            b.entities[0]?.legalEntityCode ?? '',
          ),
      );
    });
  }

  snapshots(actor: RequestActor, periodId: string) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'ledger.read');
      const period = await this.reads.period(tx, periodId);
      return { items: await this.snapshotDtos(tx, period) };
    });
  }

  /**
   * Postings dated inside this period that landed in a later open one. They are the only way a
   * number can arrive after a close, and they never touch the closed period's snapshot.
   */
  lateItems(actor: RequestActor, periodId: string) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'ledger.read');
      const period = await this.reads.period(tx, periodId);
      const rows = await tx
        .select()
        .from(ledgerJournals)
        .where(and(eq(ledgerJournals.originalPeriodId, period.id), eq(ledgerJournals.late, true)))
        .orderBy(desc(ledgerJournals.createdAt));
      if (!rows.length) return { items: [] as LateItem[] };
      const periods = await tx.select().from(fiscalPeriods);
      const label = new Map(periods.map((p) => [p.id, p.label]));
      const totals = await tx
        .select({
          journalId: ledgerLines.journalId,
          amount: sql<string>`coalesce(sum(case when ${ledgerLines.transactionAmountMinor} > 0 then ${ledgerLines.transactionAmountMinor} else 0 end), 0)`,
        })
        .from(ledgerLines)
        .where(
          inArray(
            ledgerLines.journalId,
            rows.map((r) => r.id),
          ),
        )
        .groupBy(ledgerLines.journalId);
      const amount = new Map(totals.map((t) => [t.journalId, Number(t.amount)]));
      const items: LateItem[] = rows.map((j) => ({
        journalId: j.id,
        journalType: j.journalType,
        accountingDate: j.accountingDate,
        originalPeriodId: j.originalPeriodId,
        originalPeriodLabel: j.originalPeriodId ? (label.get(j.originalPeriodId) ?? null) : null,
        postedPeriodId: j.fiscalPeriodId,
        postedPeriodLabel: label.get(j.fiscalPeriodId) ?? '',
        command: j.command,
        amount: {
          amountMinor: amount.get(j.id) ?? 0,
          currency: j.transactionCurrency,
        },
        createdAt: j.createdAt.toISOString(),
      }));
      return { items };
    });
  }

  acknowledge(
    actor: RequestActor,
    periodId: string,
    req: AcknowledgeCheckRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.periods.acknowledge:${periodId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<ClosePeriodDetail> => {
        const period = await this.reads.period(tx, periodId, true);
        assertTenant(this.policy, actor, 'period.prepare');
        unwrap(canAcknowledge(req.code as CloseCheckCode));
        if (period.status === 'closed' || period.status === 'locked') {
          throw new ApiProblem(
            409,
            'PERIOD_CLOSED',
            `${period.label} is ${period.status}; reopen it before changing the checklist.`,
          );
        }
        const [entity] = await tx
          .select()
          .from(legalEntities)
          .where(eq(legalEntities.id, req.legalEntityId));
        if (!entity || entity.fiscalCalendarId !== period.fiscalCalendarId) {
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            "That legal entity does not use this period's fiscal calendar.",
            { field: 'legalEntityId' },
          );
        }
        const attempt = await this.closeAttempt(tx, period);
        const [row] = await tx
          .insert(periodCloseAcknowledgements)
          .values({
            tenantId: actor.tenantId,
            fiscalPeriodId: period.id,
            legalEntityId: req.legalEntityId,
            checkCode: req.code,
            reasonCode: req.reasonCode,
            reason: req.reason,
            acknowledgedBy: actor.personId,
            closeAttempt: attempt,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'period.check_acknowledged',
          resourceType: 'fiscal_period',
          resourceId: period.id,
          legalEntityId: req.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            check: { from: null, to: req.code },
            reasonCode: { from: null, to: req.reasonCode },
            closeAttempt: { from: null, to: attempt },
            acknowledgementId: { from: null, to: row.id },
          },
        });
        return this.detail(tx, actor, period);
      },
    );
  }

  softClose(actor: RequestActor, periodId: string, req: { reason?: string }, ctx: CommandContext) {
    return this.statusChange(actor, periodId, 'soft_close', req, ctx, 'period.prepare');
  }

  lock(actor: RequestActor, periodId: string, req: { reason?: string }, ctx: CommandContext) {
    return this.statusChange(actor, periodId, 'lock', req, ctx, 'period.manage');
  }

  /**
   * Close the period: every entity's hard checks must pass and every failing soft check must be
   * acknowledged, the typed confirmation must match, and one immutable as-of snapshot per entity is
   * written in the same transaction as the status change and the single audit entry.
   */
  close(actor: RequestActor, periodId: string, req: { confirmation: string }, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.periods.close:${periodId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<ClosePeriodDetail> => {
        const period = await this.reads.period(tx, periodId, true);
        assertTenant(this.policy, actor, 'period.manage');
        unwrap(requireConfirmation(req.confirmation, closeConfirmationFor(period.label)));
        const all = await this.reads.calendarPeriods(tx, period.fiscalCalendarId, true);
        const next = unwrap(changePeriodStatus(all, period.id, 'close', null));
        const entities = await this.reads.entitiesOfPeriod(tx, period);
        const checklist = await this.checklist(tx, period, entities);
        unwrap(
          closeReadiness(
            checklist.map((e) => ({
              legalEntityCode: e.legalEntityCode,
              checks: e.checks.map((c) => ({
                code: c.code as CloseCheckCode,
                status: c.status,
                acknowledged: Boolean(c.acknowledgement),
              })),
            })),
          ),
        );
        const attempt = await this.closeAttempt(tx, period);
        const snapshotIds: string[] = [];
        for (const entity of entities) {
          const totals = await this.asOfBalances(tx, period, entity.id);
          const [row] = await tx
            .insert(periodCloseSnapshots)
            .values({
              tenantId: actor.tenantId,
              fiscalPeriodId: period.id,
              legalEntityId: entity.id,
              balances: totals.balances,
              takenBy: actor.personId,
              version: attempt,
              currency: actor.reportingCurrency,
              budgetCount: totals.budgetCount,
            })
            .returning({ id: periodCloseSnapshots.id });
          snapshotIds.push(row.id);
        }
        const [updated] = await tx
          .update(fiscalPeriods)
          .set({ status: next, statusChangedAt: new Date(), statusChangedBy: actor.personId })
          .where(eq(fiscalPeriods.id, period.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'period.close',
          resourceType: 'fiscal_period',
          resourceId: period.id,
          requestId: ctx.requestId,
          reason: null,
          changes: {
            status: { from: period.status, to: next },
            label: { from: null, to: period.label },
            snapshotVersion: { from: null, to: attempt },
            snapshotIds: { from: null, to: snapshotIds },
            acknowledgedChecks: {
              from: null,
              to: checklist.flatMap((e) =>
                e.checks
                  .filter((c) => c.acknowledgement)
                  .map((c) => `${e.legalEntityCode}:${c.code}`),
              ),
            },
          },
        });
        return this.detail(tx, actor, updated);
      },
    );
  }

  /** Break-glass: a Finance Controller asks, a different Finance Admin decides. Never silent. */
  requestReopen(
    actor: RequestActor,
    periodId: string,
    req: { action: 'reopen' | 'unlock'; reasonCode: string; reason: string },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.periods.reopen_request:${periodId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<ReopenRequest> => {
        const period = await this.reads.period(tx, periodId, true);
        assertTenant(this.policy, actor, 'period.prepare');
        const all = await this.reads.calendarPeriods(tx, period.fiscalCalendarId);
        // Fails now for the same reasons it would fail on approval, so nobody waits for nothing.
        unwrap(changePeriodStatus(all, period.id, req.action, req.reason));
        const [pending] = await tx
          .select()
          .from(periodReopenRequests)
          .where(
            and(
              eq(periodReopenRequests.fiscalPeriodId, period.id),
              eq(periodReopenRequests.status, 'pending'),
            ),
          );
        if (pending) {
          throw new ApiProblem(
            409,
            'REOPEN_ALREADY_REQUESTED',
            `${period.label} already has a reopen request waiting for a decision.`,
          );
        }
        const [row] = await tx
          .insert(periodReopenRequests)
          .values({
            tenantId: actor.tenantId,
            fiscalPeriodId: period.id,
            action: req.action,
            reasonCode: req.reasonCode,
            reason: req.reason,
            requestedBy: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `period.${req.action}_requested`,
          resourceType: 'fiscal_period',
          resourceId: period.id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            action: { from: null, to: req.action },
            reasonCode: { from: null, to: req.reasonCode },
            requestId: { from: null, to: row.id },
            status: { from: null, to: period.status },
          },
        });
        return this.reopenDto(tx, row, period);
      },
    );
  }

  decideReopen(
    actor: RequestActor,
    requestId: string,
    req: { decision: 'approve' | 'decline'; reason: string },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.reopen_requests.decide:${requestId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<ReopenRequest> => {
        const [row] = await tx
          .select()
          .from(periodReopenRequests)
          .where(eq(periodReopenRequests.id, requestId))
          .for('update');
        if (!row) throw ApiProblem.notFound('reopen request');
        assertTenant(this.policy, actor, 'period.manage');
        if (row.status !== 'pending') {
          throw new ApiProblem(
            409,
            'REOPEN_NOT_PENDING',
            `This request was already ${row.status}.`,
          );
        }
        unwrap(requireSecondPerson(row.requestedBy, actor.personId));
        const period = await this.reads.period(tx, row.fiscalPeriodId, true);
        let status = period.status;
        if (req.decision === 'approve') {
          const all = await this.reads.calendarPeriods(tx, period.fiscalCalendarId, true);
          status = unwrap(changePeriodStatus(all, period.id, row.action, row.reason));
          await tx
            .update(fiscalPeriods)
            .set({ status, statusChangedAt: new Date(), statusChangedBy: actor.personId })
            .where(eq(fiscalPeriods.id, period.id));
        }
        const [decided] = await tx
          .update(periodReopenRequests)
          .set({
            status: req.decision === 'approve' ? 'approved' : 'declined',
            decidedBy: actor.personId,
            decidedAt: new Date(),
            decisionReason: req.reason,
          })
          .where(eq(periodReopenRequests.id, row.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `period.${row.action}_${req.decision === 'approve' ? 'approved' : 'declined'}`,
          resourceType: 'fiscal_period',
          resourceId: period.id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            status: { from: period.status, to: status },
            requestId: { from: null, to: row.id },
            requestedBy: { from: null, to: row.requestedBy },
            requestReason: { from: null, to: row.reason },
          },
        });
        return this.reopenDto(tx, decided, period);
      },
    );
  }

  // Internals ------------------------------------------------------------------------------------

  private statusChange(
    actor: RequestActor,
    periodId: string,
    event: PeriodEvent,
    req: { reason?: string },
    ctx: CommandContext,
    action: 'period.manage' | 'period.prepare',
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.periods.${event}:${periodId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<ClosePeriodDetail> => {
        const period = await this.reads.period(tx, periodId, true);
        assertTenant(this.policy, actor, action);
        const all = await this.reads.calendarPeriods(tx, period.fiscalCalendarId, true);
        const next = unwrap(changePeriodStatus(all, period.id, event, req.reason ?? null));
        const [updated] = await tx
          .update(fiscalPeriods)
          .set({ status: next, statusChangedAt: new Date(), statusChangedBy: actor.personId })
          .where(eq(fiscalPeriods.id, period.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `period.${event}`,
          resourceType: 'fiscal_period',
          resourceId: period.id,
          requestId: ctx.requestId,
          reason: req.reason ?? null,
          changes: {
            status: { from: period.status, to: next },
            label: { from: null, to: period.label },
          },
        });
        return this.detail(tx, actor, updated);
      },
    );
  }

  /**
   * Which close attempt the period is on: the first close is version 1, and every re-close after a
   * reopen takes the next version. Acknowledgements belong to an attempt, so reopening a period
   * makes the checklist judge the re-close on fresh evidence without rewriting the earlier answers.
   */
  private async closeAttempt(tx: Tx, period: PeriodRow): Promise<number> {
    const [row] = await tx
      .select({ max: sql<string | null>`max(${periodCloseSnapshots.version})` })
      .from(periodCloseSnapshots)
      .where(eq(periodCloseSnapshots.fiscalPeriodId, period.id));
    return Number(row?.max ?? 0) + 1;
  }

  private async checklist(
    tx: Tx,
    period: PeriodRow,
    entities: readonly LegalEntityRow[],
  ): Promise<ClosePeriodDetail['entities']> {
    const attempt = await this.closeAttempt(tx, period);
    const acks = await tx
      .select()
      .from(periodCloseAcknowledgements)
      .where(
        and(
          eq(periodCloseAcknowledgements.fiscalPeriodId, period.id),
          eq(periodCloseAcknowledgements.closeAttempt, attempt),
        ),
      )
      .orderBy(desc(periodCloseAcknowledgements.acknowledgedAt));
    const names = await this.reads.names(
      tx,
      acks.map((a) => a.acknowledgedBy),
    );
    const out: ClosePeriodDetail['entities'] = [];
    for (const entity of entities) {
      const results = await this.checks.run(tx, {
        tenantId: period.tenantId,
        period,
        legalEntityId: entity.id,
        legalEntityCode: entity.code,
      });
      const checks = results.map((r) =>
        this.checkDto(
          r,
          acks.find((a) => a.legalEntityId === entity.id && a.checkCode === r.code),
          names,
        ),
      );
      out.push({
        legalEntityId: entity.id,
        legalEntityCode: entity.code,
        legalEntityName: entity.name,
        checks,
        blocking: checks.some((c) => c.blocking),
      });
    }
    return out;
  }

  private checkDto(
    r: CheckResult,
    ack: AckRow | undefined,
    names: Map<string, string>,
  ): CloseCheck {
    const kind = closeCheckKind(r.code);
    const acknowledged = Boolean(ack);
    return {
      code: r.code,
      kind,
      status: r.status,
      title: CHECK_TITLES[r.code] ?? r.title,
      detail: r.detail,
      count: r.count,
      amount:
        r.amountMinor !== null && r.currency
          ? { amountMinor: r.amountMinor, currency: r.currency }
          : null,
      blocking: isBlocking({ code: r.code, status: r.status, acknowledged }),
      acknowledgement: ack
        ? {
            id: ack.id,
            reasonCode: ack.reasonCode,
            reason: ack.reason,
            acknowledgedByName: ack.acknowledgedBy ? (names.get(ack.acknowledgedBy) ?? null) : null,
            acknowledgedAt: ack.acknowledgedAt.toISOString(),
          }
        : null,
    };
  }

  private async detail(tx: Tx, actor: RequestActor, period: PeriodRow): Promise<ClosePeriodDetail> {
    const year = await this.reads.fiscalYear(tx, period.fiscalYearId);
    const entities = await this.reads.entitiesOfPeriod(tx, period);
    const checklist = await this.checklist(tx, period, entities);
    const readiness = closeReadiness(
      checklist.map((e) => ({
        legalEntityCode: e.legalEntityCode,
        checks: e.checks.map((c) => ({
          code: c.code as CloseCheckCode,
          status: c.status,
          acknowledged: Boolean(c.acknowledgement),
        })),
      })),
    );
    const all = await this.reads.calendarPeriods(tx, period.fiscalCalendarId);
    const manage = this.policy.can(actor, 'period.manage', {
      kind: 'tenant',
      tenantId: actor.tenantId,
    }).allowed;
    const prepare = this.policy.can(actor, 'period.prepare', {
      kind: 'tenant',
      tenantId: actor.tenantId,
    }).allowed;
    const allowed = (['soft_close', 'close', 'lock', 'reopen', 'unlock'] as const).filter((e) => {
      if (!changePeriodStatus(all, period.id, e, 'check').ok) return false;
      if (e === 'soft_close') return prepare || manage;
      if (e === 'reopen' || e === 'unlock') return prepare || manage;
      return manage;
    });
    const blockingReasons = readiness.ok ? [] : [readiness.error.message];
    const [pending] = await tx
      .select()
      .from(periodReopenRequests)
      .where(
        and(
          eq(periodReopenRequests.fiscalPeriodId, period.id),
          eq(periodReopenRequests.status, 'pending'),
        ),
      );
    return {
      period: await this.summary(tx, period, year.label),
      entities: checklist,
      blockingReasons,
      allowedActions: readiness.ok ? allowed : allowed.filter((a) => a !== 'close'),
      snapshots: await this.snapshotDtos(tx, period),
      reopenRequest: pending ? await this.reopenDto(tx, pending, period) : null,
      closeConfirmation: closeConfirmationFor(period.label),
    };
  }

  private async summary(
    tx: Tx,
    period: PeriodRow,
    fiscalYearLabel: string,
  ): Promise<ClosePeriodSummary> {
    const [counts] = await tx
      .select({ n: sql<string>`count(*)` })
      .from(periodCloseSnapshots)
      .where(eq(periodCloseSnapshots.fiscalPeriodId, period.id));
    const [late] = await tx
      .select({ n: sql<string>`count(*)` })
      .from(ledgerJournals)
      .where(eq(ledgerJournals.originalPeriodId, period.id));
    const [reopen] = await tx
      .select({ n: sql<string>`count(*)` })
      .from(periodReopenRequests)
      .where(
        and(
          eq(periodReopenRequests.fiscalPeriodId, period.id),
          eq(periodReopenRequests.status, 'pending'),
        ),
      );
    return {
      id: period.id,
      fiscalYearId: period.fiscalYearId,
      fiscalYearLabel,
      label: period.label,
      periodNumber: period.periodNumber,
      startDate: period.startDate,
      endDate: period.endDate,
      status: period.status,
      targetCloseDate: targetCloseDate(period.endDate),
      snapshotCount: Number(counts.n),
      lateItemCount: Number(late.n),
      reopenRequestPending: Number(reopen.n) > 0,
    };
  }

  /**
   * As-of balances for one entity: every bucket summed over the ledger lines of that entity up to
   * and including this period. Cumulative, so the snapshot answers "where did this entity stand when
   * the period closed" and never moves afterwards.
   */
  private async asOfBalances(
    tx: Tx,
    period: PeriodRow,
    legalEntityId: string,
  ): Promise<{ balances: SnapshotBalances; budgetCount: number }> {
    const rows = await tx
      .select({
        bucket: ledgerLines.account,
        amount: sql<string>`coalesce(sum(${ledgerLines.reportingAmountMinor}), 0)`,
        budgets: sql<string>`count(distinct ${ledgerLines.budgetId})`,
      })
      .from(ledgerLines)
      .innerJoin(fiscalPeriods, eq(fiscalPeriods.id, ledgerLines.fiscalPeriodId))
      .where(
        and(
          eq(ledgerLines.legalEntityId, legalEntityId),
          lte(fiscalPeriods.endDate, period.endDate),
          inArray(ledgerLines.account, BUCKET_ACCOUNTS),
        ),
      )
      .groupBy(ledgerLines.account);
    const balances: SnapshotBalances = { ...EMPTY };
    let budgetCount = 0;
    for (const r of rows) {
      const field = BUCKET_FIELD[r.bucket];
      if (!field) continue;
      // Debit-normal buckets store positive debits; the snapshot reports natural (positive) amounts.
      balances[field] = Math.abs(Number(r.amount));
      budgetCount = Math.max(budgetCount, Number(r.budgets));
    }
    return { balances, budgetCount };
  }

  private async snapshotDtos(tx: Tx, period: PeriodRow): Promise<PeriodSnapshot[]> {
    const rows = await tx
      .select()
      .from(periodCloseSnapshots)
      .where(eq(periodCloseSnapshots.fiscalPeriodId, period.id))
      .orderBy(asc(periodCloseSnapshots.version), asc(periodCloseSnapshots.takenAt));
    if (!rows.length) return [];
    const entities = await tx.select().from(legalEntities);
    const codes = new Map(entities.map((e) => [e.id, e.code]));
    const names = await this.reads.names(
      tx,
      rows.map((r) => r.takenBy),
    );
    return rows.map((r: SnapshotRow) => ({
      id: r.id,
      fiscalPeriodId: r.fiscalPeriodId,
      periodLabel: period.label,
      legalEntityId: r.legalEntityId ?? '',
      legalEntityCode: r.legalEntityId ? (codes.get(r.legalEntityId) ?? '') : '',
      version: r.version,
      currency: r.currency ?? 'USD',
      budgetCount: r.budgetCount,
      totals: { ...EMPTY, ...(r.balances as Partial<SnapshotBalances>) },
      takenByName: r.takenBy ? (names.get(r.takenBy) ?? null) : null,
      takenAt: r.takenAt.toISOString(),
    }));
  }

  private async reopenDto(
    tx: Tx,
    row: ReopenRow,
    period: Pick<PeriodRow, 'label'>,
  ): Promise<ReopenRequest> {
    const names = await this.reads.names(tx, [row.requestedBy, row.decidedBy]);
    return {
      id: row.id,
      fiscalPeriodId: row.fiscalPeriodId,
      periodLabel: period.label,
      action: row.action,
      reasonCode: row.reasonCode,
      reason: row.reason,
      requestedByPersonId: row.requestedBy,
      requestedByName: row.requestedBy ? (names.get(row.requestedBy) ?? null) : null,
      requestedAt: row.requestedAt.toISOString(),
      status: row.status,
      decidedByName: row.decidedBy ? (names.get(row.decidedBy) ?? null) : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionReason: row.decisionReason,
    };
  }
}
