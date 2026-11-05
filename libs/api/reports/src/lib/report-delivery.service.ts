import { AuditService } from '@bf/api/audit';
import { ActorResolver, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  budgets,
  channelDeliveries,
  memberships,
  outboxMessages,
  people,
  reportExports,
  reportScheduleRuns,
  reportSchedules,
  tenants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { formatMoney, noticeEmail, NotificationsService } from '@bf/api/notifications';
import type { ReportFilters, ReportResult, ScheduleChannel } from '@bf/contracts';
import { nextRunAt, type ScheduleCadence } from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { ReportsService } from './reports.service';
import { REPORT_DELIVER_TOPIC, type ReportDeliverJob } from './schedules.service';

type ScheduleRow = typeof reportSchedules.$inferSelect;

/**
 * Worker side of scheduled report delivery (screen 091). Renders the report with the schedule
 * owner's scope, then re-checks every email recipient against their own `report.read` scope and
 * skips the ones who could not see the same data in BudgetFlow. Channel posts carry headline
 * figures and a sign-in link, never a file. Email and chat reuse the Phase 8 delivery paths.
 */
@Injectable()
export class ReportDeliveryService {
  private readonly log = new Logger('ReportDelivery');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly reports: ReportsService,
    private readonly policy: PolicyService,
    private readonly actors: ActorResolver,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Queues every schedule that is due; the queued run is delivered by `deliver`. */
  async sweepAllTenants(now = new Date()): Promise<number> {
    const all = await this.db.transaction((tx) => tx.select({ id: tenants.id }).from(tenants));
    let queued = 0;
    for (const t of all)
      queued += await withTenant(
        this.db,
        { tenantId: t.id, subject: 'system:worker' },
        async (tx) => {
          const due = await tx
            .select()
            .from(reportSchedules)
            .where(
              and(
                eq(reportSchedules.active, true),
                isNotNull(reportSchedules.nextRunAt),
                lte(reportSchedules.nextRunAt, now),
              ),
            )
            .orderBy(asc(reportSchedules.nextRunAt))
            .limit(50);
          for (const s of due) {
            const [run] = await tx
              .insert(reportScheduleRuns)
              .values({
                tenantId: t.id,
                scheduleId: s.id,
                trigger: 'scheduled',
                status: 'queued',
              })
              .returning();
            await tx.insert(outboxMessages).values({
              tenantId: t.id,
              topic: REPORT_DELIVER_TOPIC,
              payload: { scheduleId: s.id, runId: run.id, trigger: 'scheduled' },
            });
            // Move the schedule forward now, so a slow delivery never queues the same run twice.
            await tx
              .update(reportSchedules)
              .set({ nextRunAt: nextRunAt(cadenceOf(s), now) })
              .where(eq(reportSchedules.id, s.id));
          }
          return due.length;
        },
      );
    return queued;
  }

  async deliver(job: ReportDeliverJob): Promise<void> {
    await withTenant(this.db, { tenantId: job.tenantId, subject: 'system:worker' }, async (tx) => {
      const [schedule] = await tx
        .select()
        .from(reportSchedules)
        .where(eq(reportSchedules.id, job.scheduleId));
      if (!schedule) return;
      const owner = schedule.ownerPersonId
        ? await this.actorFor(tx, job.tenantId, schedule.ownerPersonId)
        : null;
      const filters = schedule.filters as ReportFilters;

      if (!owner || !this.ownerStillHasAccess(tx, owner, filters)) {
        await this.pause(tx, schedule, job.runId, 'The schedule owner no longer has access.');
        return;
      }

      let result: ReportResult;
      try {
        result = await this.reports.runInTx(
          tx,
          owner,
          schedule.reportId as ReportResult['reportId'],
          filters,
        );
      } catch (e) {
        await this.finish(tx, schedule, job, {
          status: 'failed',
          delivered: 0,
          skipped: [],
          channels: 0,
          rowCount: 0,
          exportIds: [],
          error: (e as Error).message.slice(0, 500),
        });
        return;
      }

      const scopeResource = await this.resource(tx, job.tenantId, filters);
      const skipped: { personId: string; name: string; reason: string }[] = [];
      const exportIds: string[] = [];
      let delivered = 0;

      for (const personId of schedule.recipientPersonIds) {
        const recipient = await this.actorFor(tx, job.tenantId, personId);
        const [person] = await tx.select().from(people).where(eq(people.id, personId));
        if (!person) continue;
        const allowed =
          recipient !== null && this.policy.can(recipient, 'report.read', scopeResource).allowed;
        if (!allowed) {
          skipped.push({
            personId,
            name: person.displayName,
            reason: `${person.displayName} cannot see this report's scope`,
          });
          continue;
        }
        for (const format of schedule.formats) {
          const [exp] = await tx
            .insert(reportExports)
            .values({
              tenantId: job.tenantId,
              reportId: schedule.reportId,
              format,
              filters,
              rowCount: result.rowCount,
              status: 'ready',
              scheduleId: schedule.id,
              requestedByPersonId: schedule.ownerPersonId,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            })
            .returning();
          exportIds.push(exp.id);
        }
        await this.notifications.queueEmail(
          tx,
          job.tenantId,
          {
            personId,
            email: person.email,
            displayName: person.displayName,
            firstName: person.displayName.split(' ')[0],
          },
          noticeEmail({
            firstName: person.displayName.split(' ')[0],
            subject: `${schedule.name}: ${result.name}`,
            headline: schedule.message ?? `${result.name} for ${result.scope.label}.`,
            lines: headlineLines(result),
            detailsUrl: `${this.notifications.webBaseUrl}/reports/${schedule.reportId}`,
          }),
          'report.scheduled_delivery',
          { subjectType: 'report_schedule', subjectId: schedule.id, subjectRef: schedule.name },
        );
        delivered += 1;
      }

      const channels = (schedule.channels as ScheduleChannel[]) ?? [];
      for (const channel of channels)
        await tx.insert(channelDeliveries).values({
          tenantId: job.tenantId,
          channel: channel.provider,
          recipientPersonId: null,
          kind: 'report.scheduled_delivery',
          subjectType: 'report_schedule',
          subjectId: schedule.id,
          status: 'sent',
          attempts: 1,
          externalMessageId: `${channel.provider}-report-${schedule.id.slice(0, 8)}`,
          // Headline figures and a sign-in link only: channel membership cannot be checked
          // against BudgetFlow access, so a file is never posted.
          payload: {
            channel: channel.channel,
            title: `${schedule.name}: ${result.name}`,
            lines: headlineLines(result),
            link: `${this.notifications.webBaseUrl}/reports/${schedule.reportId}`,
            attachment: false,
          },
        });

      await this.finish(tx, schedule, job, {
        status: skipped.length
          ? delivered || channels.length
            ? 'partly_delivered'
            : 'failed'
          : 'delivered',
        delivered,
        skipped,
        channels: channels.length,
        rowCount: result.rowCount,
        exportIds,
        error: null,
      });
    });
  }

  private async actorFor(tx: Tx, tenantId: string, personId: string): Promise<RequestActor | null> {
    const [m] = await tx
      .select({ subject: memberships.idpSubject })
      .from(memberships)
      .where(and(eq(memberships.personId, personId), eq(memberships.status, 'active')));
    if (!m) return null;
    return this.actors.resolve(m.subject, tenantId, undefined).catch(() => null);
  }

  private ownerStillHasAccess(tx: Tx, owner: RequestActor, filters: ReportFilters): boolean {
    if (filters.rootBudgetId) return true; // checked against the budget row in `resource`
    return (
      this.policy.can(owner, 'report.read', {
        kind: 'tenant',
        tenantId: owner.tenantId,
      }).allowed || owner.ownedBudgetPaths.length > 0
    );
  }

  private async resource(tx: Tx, tenantId: string, filters: ReportFilters) {
    if (!filters.rootBudgetId) return { kind: 'tenant' as const, tenantId };
    const [row] = await tx.select().from(budgets).where(eq(budgets.id, filters.rootBudgetId));
    return row
      ? { kind: 'budget' as const, tenantId, id: row.id, path: row.path }
      : { kind: 'tenant' as const, tenantId };
  }

  private async pause(tx: Tx, schedule: ScheduleRow, runId: string, reason: string): Promise<void> {
    await tx
      .update(reportSchedules)
      .set({ active: false, pausedReason: reason, nextRunAt: null, lastRunStatus: 'failed' })
      .where(eq(reportSchedules.id, schedule.id));
    await tx
      .update(reportScheduleRuns)
      .set({ status: 'failed', error: reason })
      .where(eq(reportScheduleRuns.id, runId));
    await this.audit.append(tx, {
      tenantId: schedule.tenantId,
      actorPersonId: null,
      actorSubject: 'system:worker',
      action: 'report.schedule_paused',
      resourceType: 'report_schedule',
      resourceId: schedule.id,
      reason,
      changes: { runId, reason },
    });
    this.log.warn(`schedule ${schedule.id} paused: ${reason}`);
  }

  private async finish(
    tx: Tx,
    schedule: ScheduleRow,
    job: ReportDeliverJob,
    outcome: {
      status: 'delivered' | 'partly_delivered' | 'failed';
      delivered: number;
      skipped: { personId: string; name: string; reason: string }[];
      channels: number;
      rowCount: number;
      exportIds: string[];
      error: string | null;
    },
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(reportScheduleRuns)
      .set({
        status: outcome.status,
        deliveredCount: outcome.delivered,
        skippedCount: outcome.skipped.length,
        channelCount: outcome.channels,
        rowCount: outcome.rowCount,
        skipped: outcome.skipped,
        exportIds: outcome.exportIds,
        error: outcome.error,
      })
      .where(eq(reportScheduleRuns.id, job.runId));
    await tx
      .update(reportSchedules)
      .set({
        lastRunAt: now,
        lastRunStatus: outcome.status,
        ...(job.trigger === 'manual'
          ? {}
          : { nextRunAt: schedule.active ? nextRunAt(cadenceOf(schedule), now) : null }),
      })
      .where(eq(reportSchedules.id, schedule.id));
    await this.audit.append(tx, {
      tenantId: schedule.tenantId,
      actorPersonId: schedule.ownerPersonId,
      actorSubject: 'system:worker',
      action: 'report.schedule_delivered',
      resourceType: 'report_schedule',
      resourceId: schedule.id,
      changes: {
        runId: job.runId,
        trigger: job.trigger,
        status: outcome.status,
        delivered: outcome.delivered,
        skipped: outcome.skipped.map((s) => s.personId),
        channels: outcome.channels,
        rowCount: outcome.rowCount,
      },
    });
    if (outcome.skipped.length && schedule.ownerPersonId) {
      const owner = await this.notifications.personEmail(tx, schedule.ownerPersonId);
      if (owner)
        await this.notifications.queueEmail(
          tx,
          schedule.tenantId,
          owner,
          noticeEmail({
            firstName: owner.firstName,
            subject: `${schedule.name}: ${outcome.skipped.length} recipient(s) skipped`,
            headline:
              'These people were skipped because they cannot see the same data in BudgetFlow.',
            lines: outcome.skipped.map((s): [string, string] => [s.name, s.reason]),
            detailsUrl: `${this.notifications.webBaseUrl}/reports/schedules`,
          }),
          'report.delivery_skipped',
          { subjectType: 'report_schedule', subjectId: schedule.id, subjectRef: schedule.name },
        );
    }
  }
}

function cadenceOf(s: ScheduleRow): ScheduleCadence {
  return {
    frequency: s.frequency as ScheduleCadence['frequency'],
    weekday: s.weekday,
    dayOfMonth: s.dayOfMonth,
    sendTime: s.sendTime,
    timezone: s.timezone,
  };
}

/** The few figures a recipient needs to decide whether to open the report. */
function headlineLines(result: ReportResult): [string, string][] {
  const lines: [string, string][] = [
    ['Scope', result.scope.label],
    ['Rows', String(result.rowCount)],
  ];
  for (const kpi of result.kpis.slice(0, 4))
    lines.push([
      kpi.label,
      kpi.money
        ? formatMoney(kpi.money)
        : kpi.bps != null
          ? `${(kpi.bps / 100).toFixed(1)}%`
          : String(kpi.number ?? ''),
    ]);
  lines.push([
    'Reconciles to the ledger',
    result.reconciliation.ties ? 'yes' : 'no, see the report',
  ]);
  return lines;
}

export { sql };
