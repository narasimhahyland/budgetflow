import { AuditService } from '@bf/api/audit';
import {
  ActorResolver,
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  budgets,
  chatInstallations,
  memberships,
  outboxMessages,
  people,
  reportExports,
  reportScheduleRuns,
  reportSchedules,
  reportSavedViews,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  CreateExportRequest,
  CreateScheduleRequest,
  ReportExport,
  ReportFilters,
  ReportId,
  ReportSchedule,
  ScheduleChannel,
  ScheduleRecipient,
  ScheduleRun,
  UpdateScheduleRequest,
} from '@bf/contracts';
import { nextRunAt, validateCadence, type ScheduleCadence } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { REPORT_SPECS } from './report-definitions';
import type { CommandContext } from './saved-views.service';

export const REPORT_DELIVER_TOPIC = 'report.deliver';
export const REPORT_SWEEP_TOPIC = 'report.schedule_sweep';
const EXPORT_DAYS = 7;

type ScheduleRow = typeof reportSchedules.$inferSelect;
type RunRow = typeof reportScheduleRuns.$inferSelect;
type ExportRow = typeof reportExports.$inferSelect;

export interface ReportDeliverJob {
  tenantId: string;
  scheduleId: string;
  runId: string;
  trigger: 'scheduled' | 'manual';
}

const toRun = (r: RunRow): ScheduleRun => ({
  id: r.id,
  scheduleId: r.scheduleId,
  runAt: r.runAt.toISOString(),
  status: r.status as ScheduleRun['status'],
  trigger: r.trigger as ScheduleRun['trigger'],
  deliveredCount: r.deliveredCount,
  skippedCount: r.skippedCount,
  channelCount: r.channelCount,
  rowCount: r.rowCount,
  skipped: (r.skipped as ScheduleRun['skipped']) ?? [],
  exportIds: r.exportIds,
  error: r.error,
});

/**
 * Scheduled report delivery (screen 091). A schedule runs with its owner's scope; before an
 * attachment reaches a recipient their own `report.read` scope is checked again, so delivery can
 * never widen access. Channels get headline figures and a sign-in link, never a file.
 */
@Injectable()
export class SchedulesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly actors: ActorResolver,
  ) {}

  private tx<T>(actor: RequestActor, body: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, body);
  }

  private assertCanSchedule(actor: RequestActor, filters: ReportFilters): void {
    if (
      this.policy.can(actor, 'report.schedule', { kind: 'tenant', tenantId: actor.tenantId })
        .allowed
    )
      return;
    const owned = actor.ownedBudgetPaths.length > 0;
    if (!owned)
      throw ApiProblem.forbidden('Scheduling reports is for finance roles and budget owners.');
    if (!filters.rootBudgetId)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Choose a budget scope: owners schedule reports of their own subtree.',
      );
  }

  /** The scope a schedule delivers, as a policy resource, so recipients can be checked against it. */
  private async scopeResource(tx: Tx, tenantId: string, filters: ReportFilters) {
    if (!filters.rootBudgetId) return { kind: 'tenant' as const, tenantId };
    const [row] = await tx.select().from(budgets).where(eq(budgets.id, filters.rootBudgetId));
    if (!row) throw ApiProblem.notFound('budget');
    return { kind: 'budget' as const, tenantId, id: row.id, path: row.path };
  }

  /**
   * Each recipient re-checked against the scope the schedule delivers. People who cannot see the
   * same data in BudgetFlow are kept on the schedule but marked, and skipped at every run.
   */
  private async checkRecipients(
    tx: Tx,
    actor: RequestActor,
    personIds: readonly string[],
    filters: ReportFilters,
  ): Promise<ScheduleRecipient[]> {
    if (!personIds.length) return [];
    const rows = await tx
      .select({ id: people.id, name: people.displayName, email: people.email })
      .from(people)
      .where(inArray(people.id, [...new Set(personIds)]));
    const missing = personIds.filter((id) => !rows.some((r) => r.id === id));
    if (missing.length)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Recipients must be people in the directory; external addresses are not allowed.',
      );
    const resource = await this.scopeResource(tx, actor.tenantId, filters);
    const out: ScheduleRecipient[] = [];
    for (const r of rows) {
      const [m] = await tx
        .select({ subject: memberships.idpSubject })
        .from(memberships)
        .where(and(eq(memberships.personId, r.id), eq(memberships.status, 'active')));
      const recipientActor = m
        ? await this.actors.resolve(m.subject, actor.tenantId, undefined).catch(() => null)
        : null;
      const allowed = recipientActor
        ? this.policy.can(recipientActor, 'report.read', resource).allowed
        : false;
      out.push({
        personId: r.id,
        name: r.name,
        email: r.email,
        hasAccess: allowed,
        skipReason: allowed
          ? null
          : `${r.name} cannot see ${resource.kind === 'tenant' ? 'these budgets' : 'this budget scope'}`,
      });
    }
    return out;
  }

  private async checkChannels(tx: Tx, channels: readonly ScheduleChannel[]): Promise<void> {
    if (!channels.length) return;
    const installs = await tx.select().from(chatInstallations);
    for (const c of channels) {
      const install = installs.find((i) => i.provider === c.provider);
      if (!install || install.status !== 'connected')
        throw new ApiProblem(
          422,
          'CHAT_INSTALLATION_NOT_CONNECTED',
          `The ${c.provider === 'slack' ? 'Slack' : 'Microsoft Teams'} app is not connected.`,
        );
      if (!install.allowedChannels.includes(c.channel))
        throw new ApiProblem(
          422,
          'VALIDATION_FAILED',
          `${c.channel} is not an allowed channel. Ask an Integration Admin to allow more.`,
        );
    }
  }

  private cadenceOf(row: {
    frequency: string;
    weekday: number | null;
    dayOfMonth: number | null;
    sendTime: string;
    timezone: string;
  }): ScheduleCadence {
    return {
      frequency: row.frequency as ScheduleCadence['frequency'],
      weekday: row.weekday,
      dayOfMonth: row.dayOfMonth,
      sendTime: row.sendTime,
      timezone: row.timezone,
    };
  }

  private async toSchedule(tx: Tx, actor: RequestActor, row: ScheduleRow): Promise<ReportSchedule> {
    const filters = row.filters as ReportFilters;
    const recipients = await this.checkRecipients(tx, actor, row.recipientPersonIds, filters);
    const owner = row.ownerPersonId
      ? (
          await tx
            .select({ name: people.displayName })
            .from(people)
            .where(eq(people.id, row.ownerPersonId))
        )[0]
      : undefined;
    return {
      id: row.id,
      name: row.name,
      reportId: row.reportId as ReportId,
      reportName: REPORT_SPECS[row.reportId as ReportId]?.name ?? row.reportId,
      savedViewId: row.savedViewId,
      filters,
      formats: row.formats as ReportSchedule['formats'],
      frequency: row.frequency as ReportSchedule['frequency'],
      weekday: row.weekday,
      dayOfMonth: row.dayOfMonth,
      sendTime: row.sendTime,
      timezone: row.timezone,
      message: row.message,
      recipients,
      channels: (row.channels as ScheduleChannel[]) ?? [],
      ownerPersonId: row.ownerPersonId,
      ownerName: owner?.name ?? null,
      active: row.active,
      pausedReason: row.pausedReason,
      nextRunAt: row.nextRunAt?.toISOString() ?? null,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      lastRunStatus: (row.lastRunStatus as ReportSchedule['lastRunStatus']) ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  list(actor: RequestActor): Promise<{ items: ReportSchedule[] }> {
    return this.tx(actor, async (tx) => {
      const tenantWide = this.policy.can(actor, 'report.read', {
        kind: 'tenant',
        tenantId: actor.tenantId,
      }).allowed;
      const rows = await tx.select().from(reportSchedules).orderBy(desc(reportSchedules.createdAt));
      const mine = tenantWide
        ? rows
        : rows.filter((r) => r.ownerPersonId && r.ownerPersonId === actor.personId);
      const items: ReportSchedule[] = [];
      for (const r of mine) items.push(await this.toSchedule(tx, actor, r));
      return { items };
    });
  }

  create(
    actor: RequestActor,
    body: CreateScheduleRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<ReportSchedule>> {
    this.assertCanSchedule(actor, body.filters);
    const recipientIds = body.recipientPersonIds ?? [];
    const channels = body.channels ?? [];
    if (!recipientIds.length && !channels.length)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'Add at least one recipient or channel.');
    const cadence: ScheduleCadence = {
      frequency: body.frequency,
      weekday: body.weekday ?? null,
      dayOfMonth: body.dayOfMonth ?? null,
      sendTime: body.sendTime,
      timezone: body.timezone ?? 'UTC',
    };
    const problem = validateCadence(cadence);
    if (problem) throw new ApiProblem(422, 'VALIDATION_FAILED', problem.message);
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'createReportSchedule',
        request: body,
        status: 201,
      },
      async (tx) => {
        if (body.savedViewId) {
          const [view] = await tx
            .select()
            .from(reportSavedViews)
            .where(eq(reportSavedViews.id, body.savedViewId));
          if (!view) throw ApiProblem.notFound('saved view');
        }
        await this.checkChannels(tx, channels);
        const recipients = await this.checkRecipients(tx, actor, recipientIds, body.filters);
        const [row] = await tx
          .insert(reportSchedules)
          .values({
            tenantId: actor.tenantId,
            name: body.name,
            reportId: body.reportId,
            savedViewId: body.savedViewId ?? null,
            filters: body.filters,
            formats: body.formats,
            frequency: body.frequency,
            weekday: body.weekday ?? null,
            dayOfMonth: body.dayOfMonth ?? null,
            sendTime: body.sendTime,
            timezone: cadence.timezone,
            recipientPersonIds: recipientIds,
            channels,
            message: body.message ?? null,
            ownerPersonId: actor.personId,
            active: true,
            nextRunAt: nextRunAt(cadence, new Date()),
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'report.schedule_created',
          resourceType: 'report_schedule',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            reportId: body.reportId,
            name: body.name,
            formats: body.formats,
            frequency: body.frequency,
            recipients: recipients.length,
            recipientsWithoutAccess: recipients.filter((r) => !r.hasAccess).length,
            channels: channels.map((c) => `${c.provider}:${c.channel}`),
            filters: body.filters,
          },
        });
        return this.toSchedule(tx, actor, row);
      },
    );
  }

  update(
    actor: RequestActor,
    scheduleId: string,
    body: UpdateScheduleRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<ReportSchedule>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'updateReportSchedule',
        request: { scheduleId, ...body },
        status: 200,
      },
      async (tx) => {
        const row = await this.ownedRow(tx, actor, scheduleId);
        const filters = body.filters ?? (row.filters as ReportFilters);
        this.assertCanSchedule(actor, filters);
        const channels = body.channels ?? (row.channels as ScheduleChannel[]) ?? [];
        const recipientIds = body.recipientPersonIds ?? row.recipientPersonIds;
        if (!recipientIds.length && !channels.length)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'Add at least one recipient or channel.');
        await this.checkChannels(tx, channels);
        await this.checkRecipients(tx, actor, recipientIds, filters);
        const cadence = this.cadenceOf({
          frequency: body.frequency ?? row.frequency,
          weekday: body.weekday === undefined ? row.weekday : body.weekday,
          dayOfMonth: body.dayOfMonth === undefined ? row.dayOfMonth : body.dayOfMonth,
          sendTime: body.sendTime ?? row.sendTime,
          timezone: body.timezone ?? row.timezone,
        });
        const problem = validateCadence(cadence);
        if (problem) throw new ApiProblem(422, 'VALIDATION_FAILED', problem.message);
        const active = body.active ?? row.active;
        const [updated] = await tx
          .update(reportSchedules)
          .set({
            name: body.name ?? row.name,
            filters,
            formats: body.formats ?? row.formats,
            frequency: cadence.frequency,
            weekday: cadence.weekday,
            dayOfMonth: cadence.dayOfMonth,
            sendTime: cadence.sendTime,
            timezone: cadence.timezone,
            recipientPersonIds: recipientIds,
            channels,
            message: body.message === undefined ? row.message : body.message,
            active,
            pausedReason: active ? null : row.pausedReason,
            nextRunAt: active ? nextRunAt(cadence, new Date()) : null,
            updatedAt: new Date(),
          })
          .where(eq(reportSchedules.id, scheduleId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action:
            active === row.active
              ? 'report.schedule_updated'
              : active
                ? 'report.schedule_resumed'
                : 'report.schedule_paused',
          resourceType: 'report_schedule',
          resourceId: scheduleId,
          requestId: ctx.requestId,
          changes: { ...body },
        });
        return this.toSchedule(tx, actor, updated);
      },
    );
  }

  remove(
    actor: RequestActor,
    scheduleId: string,
    ctx: CommandContext,
  ): Promise<CommandResult<{ items: ReportSchedule[] }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'deleteReportSchedule',
        request: { scheduleId },
        status: 200,
      },
      async (tx) => {
        const row = await this.ownedRow(tx, actor, scheduleId);
        await tx
          .update(reportExports)
          .set({ scheduleId: null })
          .where(eq(reportExports.scheduleId, scheduleId));
        await tx.delete(reportScheduleRuns).where(eq(reportScheduleRuns.scheduleId, scheduleId));
        await tx.delete(reportSchedules).where(eq(reportSchedules.id, scheduleId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'report.schedule_deleted',
          resourceType: 'report_schedule',
          resourceId: scheduleId,
          requestId: ctx.requestId,
          changes: { name: row.name, reportId: row.reportId },
        });
        const rest = await tx
          .select()
          .from(reportSchedules)
          .orderBy(desc(reportSchedules.createdAt));
        const items: ReportSchedule[] = [];
        for (const r of rest) items.push(await this.toSchedule(tx, actor, r));
        return { items };
      },
    );
  }

  /** Queues a run now; the worker renders and delivers it, then writes the outcome on the run row. */
  runNow(
    actor: RequestActor,
    scheduleId: string,
    ctx: CommandContext,
  ): Promise<CommandResult<ScheduleRun>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'runReportSchedule',
        request: { scheduleId },
        status: 202,
      },
      async (tx) => {
        const row = await this.ownedRow(tx, actor, scheduleId);
        const [run] = await tx
          .insert(reportScheduleRuns)
          .values({
            tenantId: actor.tenantId,
            scheduleId: row.id,
            trigger: 'manual',
            status: 'queued',
          })
          .returning();
        await tx.insert(outboxMessages).values({
          tenantId: actor.tenantId,
          topic: REPORT_DELIVER_TOPIC,
          payload: { scheduleId: row.id, runId: run.id, trigger: 'manual' },
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'report.schedule_run_requested',
          resourceType: 'report_schedule',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: { runId: run.id, reportId: row.reportId, trigger: 'manual' },
        });
        return toRun(run);
      },
    );
  }

  runs(actor: RequestActor, scheduleId: string): Promise<{ items: ScheduleRun[] }> {
    return this.tx(actor, async (tx) => {
      await this.ownedRow(tx, actor, scheduleId, { read: true });
      const rows = await tx
        .select()
        .from(reportScheduleRuns)
        .where(eq(reportScheduleRuns.scheduleId, scheduleId))
        .orderBy(desc(reportScheduleRuns.runAt))
        .limit(50);
      return { items: rows.map(toRun) };
    });
  }

  private async ownedRow(
    tx: Tx,
    actor: RequestActor,
    scheduleId: string,
    opts: { read?: boolean } = {},
  ): Promise<ScheduleRow> {
    const [row] = await tx.select().from(reportSchedules).where(eq(reportSchedules.id, scheduleId));
    if (!row) throw ApiProblem.notFound('schedule');
    const action = opts.read ? 'report.read' : 'report.schedule';
    const tenantWide = this.policy.can(actor, action, {
      kind: 'tenant',
      tenantId: actor.tenantId,
    }).allowed;
    if (tenantWide) return row;
    if (row.ownerPersonId && row.ownerPersonId === actor.personId) return row;
    throw ApiProblem.forbidden('Only the schedule owner or finance can change this schedule.');
  }

  // Exports ------------------------------------------------------------------------------------

  listExports(actor: RequestActor): Promise<{ items: ReportExport[] }> {
    this.policy.assert(
      actor,
      'report.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'reports',
    );
    return this.tx(actor, async (tx) => {
      const rows = await tx
        .select()
        .from(reportExports)
        .orderBy(desc(reportExports.requestedAt))
        .limit(50);
      const names = await this.personNames(
        tx,
        rows.map((r) => r.requestedByPersonId),
      );
      return {
        items: rows.map((r) => toExport(r, names.get(r.requestedByPersonId ?? '') ?? null)),
      };
    });
  }

  createExport(
    actor: RequestActor,
    reportId: ReportId,
    body: CreateExportRequest,
    ctx: CommandContext,
    rowCount: number,
  ): Promise<CommandResult<ReportExport>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'createReportExport',
        request: { reportId, ...body },
        status: 201,
      },
      async (tx) => {
        const expiresAt = new Date(Date.now() + EXPORT_DAYS * 24 * 60 * 60 * 1000);
        const [row] = await tx
          .insert(reportExports)
          .values({
            tenantId: actor.tenantId,
            reportId,
            format: body.format,
            filters: body.filters,
            rowCount,
            status: 'ready',
            requestedByPersonId: actor.personId,
            expiresAt,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'report.exported',
          resourceType: 'report_export',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: { reportId, format: body.format, filters: body.filters, rowCount },
        });
        return toExport(row, actor.displayName);
      },
    );
  }

  private async personNames(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!list.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, list));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

function toExport(r: ExportRow, requestedByName: string | null): ReportExport {
  return {
    id: r.id,
    reportId: r.reportId as ReportId,
    reportName: REPORT_SPECS[r.reportId as ReportId]?.name ?? r.reportId,
    format: r.format as ReportExport['format'],
    filters: r.filters as ReportFilters,
    rowCount: r.rowCount,
    status: r.expiresAt.getTime() < Date.now() ? 'expired' : (r.status as ReportExport['status']),
    sizeBytes: r.sizeBytes,
    requestedByName,
    requestedAt: r.requestedAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    scheduleId: r.scheduleId,
  };
}
