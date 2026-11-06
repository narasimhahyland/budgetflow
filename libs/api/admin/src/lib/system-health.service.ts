import { AuditService } from '@bf/api/audit';
import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { S3DocumentStore } from '@bf/api/documents';
import {
  chatInstallations,
  integrationConnections,
  integrityCheckRuns,
  maintenanceNotices,
  outboxMessages,
  retentionRuns,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  CancelMaintenanceNoticeRequest,
  CreateMaintenanceNoticeRequest,
  HealthJobRun,
  HealthQueue,
  HealthService as HealthServiceView,
  HealthServiceStatus,
  MaintenanceNotice,
  MaintenanceNoticeList,
  SystemHealth,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { assertAnyTenant, assertTenant, personNames, type CommandContext } from './admin-reads';

type NoticeRow = typeof maintenanceNotices.$inferSelect;

const QUEUE_NAMES = [
  'email',
  'notifications',
  'integration-sync',
  'webhook-delivery',
  'digests',
] as const;

/** A queue backlog this old counts as degraded rather than busy. */
const BACKLOG_WARNING_SECONDS = 600;

/** Contract timestamps are UTC; accept them with or without the trailing Z. */
const utc = (value: string): Date => new Date(value.endsWith('Z') ? value : `${value}Z`);

const worst = (statuses: readonly HealthServiceStatus[]): HealthServiceStatus => {
  if (statuses.includes('down')) return 'down';
  if (statuses.includes('degraded')) return 'degraded';
  return 'healthy';
};

/**
 * System health (114) and maintenance notices. Deliberately free of financial data: the platform
 * operator can watch the platform without seeing Hyland's money, so no break-glass grant is needed.
 */
@Injectable()
export class SystemHealthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly documents: S3DocumentStore,
  ) {}

  private async queues(tx: Tx): Promise<{ queues: HealthQueue[]; readable: boolean }> {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await tx.execute<{
        name: string;
        waiting: string;
        active: string;
        failed: string;
        oldest_seconds: string | null;
      }>(sql`
        select name,
               count(*) filter (where state = 'created' or state = 'retry') as waiting,
               count(*) filter (where state = 'active') as active,
               count(*) filter (where state = 'failed' and created_on >= ${since}) as failed,
               extract(epoch from (now() - min(created_on) filter (where state = 'created' or state = 'retry')))::int as oldest_seconds
        from pgboss.job
        group by name
      `);
      const byName = new Map(result.rows.map((r) => [r.name, r]));
      return {
        readable: true,
        queues: [...new Set([...QUEUE_NAMES, ...result.rows.map((r) => r.name)])]
          .map((name) => {
            const row = byName.get(name);
            return {
              name,
              waiting: Number(row?.waiting ?? 0),
              active: Number(row?.active ?? 0),
              failedLast24h: Number(row?.failed ?? 0),
              oldestWaitingSeconds:
                row?.oldest_seconds === null || row?.oldest_seconds === undefined
                  ? null
                  : Number(row.oldest_seconds),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    } catch {
      // The job tables belong to the worker; if this deployment cannot read them, say so instead of
      // reporting zeros that look healthy.
      return { readable: false, queues: [] };
    }
  }

  private async nightlyJobs(tx: Tx): Promise<HealthJobRun[]> {
    const [retention] = await tx
      .select()
      .from(retentionRuns)
      .where(eq(retentionRuns.mode, 'apply'))
      .orderBy(desc(retentionRuns.startedAt))
      .limit(1);
    const [integrity] = await tx
      .select()
      .from(integrityCheckRuns)
      .orderBy(desc(integrityCheckRuns.startedAt))
      .limit(1);
    const jobs: HealthJobRun[] = [
      {
        job: 'retention_run',
        name: 'Retention run',
        schedule: 'Nightly at 01:00',
        lastRunAt: retention?.startedAt.toISOString() ?? null,
        durationMs:
          retention?.finishedAt && retention?.startedAt
            ? retention.finishedAt.getTime() - retention.startedAt.getTime()
            : null,
        result: retention
          ? retention.status === 'completed'
            ? `Completed over ${retention.categories.length} categor${retention.categories.length === 1 ? 'y' : 'ies'}.`
            : (retention.error ?? 'The last run failed; nothing was deleted.')
          : 'Has not run yet.',
        status: !retention ? 'never_run' : retention.status === 'completed' ? 'ok' : 'failed',
      },
      {
        job: 'integrity_check',
        name: 'Ledger rebuild and audit chain check',
        schedule: 'Nightly at 02:00',
        lastRunAt: integrity?.startedAt?.toISOString() ?? null,
        durationMs:
          integrity?.finishedAt && integrity?.startedAt
            ? integrity.finishedAt.getTime() - integrity.startedAt.getTime()
            : null,
        result: integrity
          ? `${integrity.status}: ${integrity.flagsRaised} flag(s) raised.`
          : 'Has not run yet.',
        status: !integrity
          ? 'never_run'
          : integrity.status === 'clean'
            ? 'ok'
            : integrity.status === 'failed'
              ? 'failed'
              : 'attention',
      },
    ];
    return jobs.sort((a, b) => a.name.localeCompare(b.name) || a.job.localeCompare(b.job));
  }

  private async identityProviderStatus(): Promise<HealthServiceView> {
    const url = process.env['KEYCLOAK_JWKS_URL'] ?? process.env['KEYCLOAK_ISSUER'];
    const checkedAt = new Date().toISOString();
    if (!url)
      return {
        key: 'identity_provider',
        name: 'Identity provider',
        status: 'degraded',
        detail: 'No identity provider URL is configured for this deployment.',
        checkedAt,
      };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return {
        key: 'identity_provider',
        name: 'Identity provider',
        status: res.ok ? 'healthy' : 'degraded',
        detail: res.ok ? 'Answering sign-in requests.' : `Answered HTTP ${res.status}.`,
        checkedAt,
      };
    } catch {
      return {
        key: 'identity_provider',
        name: 'Identity provider',
        status: 'down',
        detail: 'Did not answer within two seconds.',
        checkedAt,
      };
    }
  }

  private async documentStoreStatus(): Promise<HealthServiceView> {
    const checkedAt = new Date().toISOString();
    try {
      // A missing object answers null; only an unreachable store throws.
      await this.documents.head('health/probe');
      return {
        key: 'document_store',
        name: 'Document store',
        status: 'healthy',
        detail: 'Answering read requests.',
        checkedAt,
      };
    } catch {
      return {
        key: 'document_store',
        name: 'Document store',
        status: 'down',
        detail: 'Did not answer a read request.',
        checkedAt,
      };
    }
  }

  health(actor: RequestActor): Promise<SystemHealth> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      // Super Admin holds no tenant grants, so the platform operator reaches this page through the
      // same check as the Organization Admin: `tenant.read` or `integrity.read`.
      assertAnyTenant(this.policy, actor, ['tenant.read', 'integrity.read']);
      const checkedAt = new Date().toISOString();
      const { queues, readable } = await this.queues(tx);
      const [unpublished] = await tx
        .select({
          n: sql<string>`count(*)`,
          oldest: sql<
            string | null
          >`extract(epoch from (now() - min(${outboxMessages.createdAt})))::int`,
        })
        .from(outboxMessages)
        .where(isNull(outboxMessages.publishedAt));
      const outboxUnpublished = Number(unpublished?.n ?? 0);
      const outboxLagSeconds =
        unpublished?.oldest === null || unpublished?.oldest === undefined
          ? null
          : Number(unpublished.oldest);

      const connectors = await tx
        .select({
          status: integrationConnections.status,
          attention: integrationConnections.attention,
        })
        .from(integrationConnections);
      const chat = await tx
        .select({ provider: chatInstallations.provider, status: chatInstallations.status })
        .from(chatInstallations);
      const needsAttention = connectors.filter((c) => c.status !== 'connected').length;

      const backlog = queues.some((q) => (q.oldestWaitingSeconds ?? 0) > BACKLOG_WARNING_SECONDS);
      const services: HealthServiceView[] = (
        [
          {
            key: 'api',
            name: 'API',
            status: 'healthy',
            detail: 'Answering requests.',
            checkedAt,
          },
          {
            key: 'database',
            name: 'Database',
            status: 'healthy',
            detail: 'Answering queries.',
            checkedAt,
          },
          {
            key: 'worker',
            name: 'Worker',
            status: !readable ? 'degraded' : backlog ? 'degraded' : 'healthy',
            detail: !readable
              ? 'Queue statistics are not readable from the API in this deployment.'
              : backlog
                ? `A job has been waiting more than ${Math.round(BACKLOG_WARNING_SECONDS / 60)} minutes.`
                : `${queues.reduce((n, q) => n + q.waiting, 0)} job(s) waiting.`,
            checkedAt,
          },
          await this.identityProviderStatus(),
          await this.documentStoreStatus(),
          {
            key: 'integrations',
            name: 'Integrations',
            status: needsAttention ? 'degraded' : 'healthy',
            detail: needsAttention
              ? `${needsAttention} connection(s) need attention.`
              : `${connectors.length} connection(s) working.`,
            checkedAt,
          },
          {
            key: 'chat_apps',
            name: 'Chat apps',
            status: chat.some((c) => c.status === 'connected') ? 'healthy' : 'not_enabled',
            detail: chat.length
              ? chat
                  .map((c) => `${c.provider}: ${c.status.replace('_', ' ')}`)
                  .sort()
                  .join(', ')
              : 'No chat app is connected.',
            checkedAt,
          },
        ] as HealthServiceView[]
      ).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

      const now = new Date();
      const [notice] = await tx
        .select()
        .from(maintenanceNotices)
        .where(and(eq(maintenanceNotices.status, 'scheduled'), gte(maintenanceNotices.endsAt, now)))
        .orderBy(asc(maintenanceNotices.startsAt), asc(maintenanceNotices.id))
        .limit(1);

      return {
        overall: worst(services.filter((s) => s.status !== 'not_enabled').map((s) => s.status)),
        environment: process.env['NODE_ENV'] ?? 'development',
        version: process.env['npm_package_version'] ?? process.env['BF_VERSION'] ?? 'unknown',
        checkedAt,
        services,
        queues,
        outboxUnpublished,
        outboxLagSeconds,
        nightlyJobs: await this.nightlyJobs(tx),
        activeMaintenanceNotice: notice && notice.showFrom <= now ? notice.message : null,
      };
    });
  }

  private noticeView(row: NoticeRow, names: Map<string, string>): MaintenanceNotice {
    return {
      id: row.id,
      message: row.message,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      showFrom: row.showFrom.toISOString(),
      status: row.status as MaintenanceNotice['status'],
      createdByName: row.createdByPersonId ? (names.get(row.createdByPersonId) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  listNotices(
    actor: RequestActor,
    query: { activeOnly?: 'true' | 'false' },
  ): Promise<MaintenanceNoticeList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const now = new Date();
      const rows = await tx
        .select()
        .from(maintenanceNotices)
        .where(
          query.activeOnly === 'true'
            ? and(eq(maintenanceNotices.status, 'scheduled'), gte(maintenanceNotices.endsAt, now))
            : undefined,
        )
        .orderBy(desc(maintenanceNotices.startsAt), asc(maintenanceNotices.id));
      const names = await personNames(
        tx,
        rows.map((r) => r.createdByPersonId),
      );
      return { items: rows.map((r) => this.noticeView(r, names)) };
    });
  }

  createNotice(actor: RequestActor, req: CreateMaintenanceNoticeRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.maintenance_notice',
        request: req,
        status: 201,
      },
      async (tx): Promise<MaintenanceNotice> => {
        assertTenant(this.policy, actor, 'tenant.settings.manage', 'maintenance notice');
        const startsAt = utc(req.startsAt);
        const endsAt = utc(req.endsAt);
        if (endsAt <= startsAt)
          throw new ApiProblem(
            422,
            'MAINTENANCE_WINDOW_INVALID',
            'The maintenance window must end after it starts.',
          );
        const showFrom = req.showFrom
          ? utc(req.showFrom)
          : new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
        if (showFrom > startsAt)
          throw new ApiProblem(
            422,
            'MAINTENANCE_WINDOW_INVALID',
            'The notice has to appear before the maintenance starts.',
          );
        const [row] = await tx
          .insert(maintenanceNotices)
          .values({
            tenantId: actor.tenantId,
            message: req.message,
            startsAt,
            endsAt,
            showFrom,
            createdByPersonId: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'admin.maintenance_notice.scheduled',
          resourceType: 'maintenance_notice',
          resourceId: row.id,
          requestId: ctx.requestId,
          reason: req.message,
          changes: {
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            showFrom: showFrom.toISOString(),
          },
        });
        const names = await personNames(tx, [actor.personId]);
        return this.noticeView(row, names);
      },
    );
  }

  cancelNotice(
    actor: RequestActor,
    noticeId: string,
    req: CancelMaintenanceNoticeRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `admin.maintenance_notice.cancel:${noticeId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<MaintenanceNotice> => {
        assertTenant(this.policy, actor, 'tenant.settings.manage', 'maintenance notice');
        const [row] = await tx
          .select()
          .from(maintenanceNotices)
          .where(eq(maintenanceNotices.id, noticeId))
          .for('update');
        if (!row) throw ApiProblem.notFound('maintenance notice');
        if (row.status !== 'scheduled')
          throw new ApiProblem(
            409,
            'NOTICE_NOT_SCHEDULED',
            'This notice has already been cancelled.',
          );
        await tx
          .update(maintenanceNotices)
          .set({
            status: 'cancelled',
            cancelledByPersonId: actor.personId,
            cancelledAt: new Date(),
          })
          .where(eq(maintenanceNotices.id, noticeId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'admin.maintenance_notice.cancelled',
          resourceType: 'maintenance_notice',
          resourceId: noticeId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: { status: { from: 'scheduled', to: 'cancelled' } },
        });
        const [after] = await tx
          .select()
          .from(maintenanceNotices)
          .where(eq(maintenanceNotices.id, noticeId));
        const names = await personNames(tx, [after.createdByPersonId]);
        return this.noticeView(after, names);
      },
    );
  }
}
