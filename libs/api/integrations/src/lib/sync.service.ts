import { ImportsService } from '@bf/api/actuals';
import { AuditService } from '@bf/api/audit';
import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  integrationConnections,
  integrationMessages,
  syncRuns,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { HeadcountService } from '@bf/api/org';
import type {
  IntegrationProvider,
  RunSyncRequest,
  SyncDirection,
  SyncObject,
  SyncRunList,
  SyncRunsQuery,
  SyncRunView,
  SyncStatus,
} from '@bf/contracts';
import type { Action } from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { MAX_RETRY_ATTEMPTS, RETRY_BACKOFF_MINUTES } from './config';
import {
  objectSpec,
  recordsFrom,
  toActualsCsv,
  type ActualLine,
  type InboundRecord,
  type ObjectSpec,
} from './connectors';
import {
  ConnectionsService,
  tenantOf,
  type CommandContext,
  type ConnectorContext,
} from './connections.service';
import { redact } from './crypto';
import { classifyError, isRetryable, OutboundHttp, providerMessage } from './http';

const DAY_MS = 24 * 60 * 60 * 1000;
const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * The identity a connector applies records with. A person authorizes the run; the records themselves
 * are applied by the connector, which holds exactly the actions the review paths need and nothing
 * that approves, applies a control or posts to the ledger.
 */
const CONNECTOR_SCOPES: Action[] = [
  'tenant.read',
  'integration.read',
  'integration.manage',
  'actuals.read',
  'actuals.manage',
  'headcount.import',
  'org.read',
];

const connectorActor = (actor: RequestActor, provider: string): RequestActor => ({
  ...actor,
  subject: `connector:${provider}`,
  roles: [],
  ownedBudgetPaths: [],
  serviceScopes: CONNECTOR_SCOPES,
});

interface ApplyOutcome {
  applied: number;
  duplicates: number;
  failed: number;
  importBatchId: string | null;
  note: string | null;
}

/**
 * Runs one synchronization: read from the provider, de-duplicate, then apply through the paths a
 * person would use. Money-bearing records are uploaded into the Phase 6 actuals review (080a); they
 * only reach the ledger when that batch is posted, under its own idempotency key and ordered row
 * locks. Nothing here writes a ledger table.
 */
@Injectable()
export class SyncService {
  private readonly log = new Logger(SyncService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly connections: ConnectionsService,
    private readonly http: OutboundHttp,
    private readonly imports: ImportsService,
    private readonly headcount: HeadcountService,
    private readonly audit: AuditService,
  ) {}

  // Reads ---------------------------------------------------------------------------------------

  list(actor: RequestActor, q: SyncRunsQuery): Promise<SyncRunList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      const filters = [
        q.connectionId ? eq(syncRuns.connectionId, q.connectionId) : undefined,
        q.direction ? eq(syncRuns.direction, q.direction) : undefined,
        q.object ? eq(syncRuns.object, q.object) : undefined,
        q.status ? eq(syncRuns.status, q.status) : undefined,
      ].filter(Boolean);
      const rows = await tx
        .select({ run: syncRuns, provider: integrationConnections.provider })
        .from(syncRuns)
        .innerJoin(integrationConnections, eq(integrationConnections.id, syncRuns.connectionId))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(syncRuns.startedAt))
        .limit(q.limit ?? 100);
      const since = new Date(Date.now() - DAY_MS);
      const recent = await tx
        .select({
          status: syncRuns.status,
          direction: syncRuns.direction,
          n: sql<number>`count(*)::int`,
          applied: sql<number>`coalesce(sum(${syncRuns.recordsApplied}), 0)::int`,
        })
        .from(syncRuns)
        .where(gte(syncRuns.startedAt, since))
        .groupBy(syncRuns.status, syncRuns.direction);
      const count = (s: SyncStatus) =>
        recent.filter((r) => r.status === s).reduce((a, r) => a + r.n, 0);
      return {
        items: rows.map((r) => this.view(r.run, r.provider as IntegrationProvider)),
        summary: {
          runs24h: recent.reduce((a, r) => a + r.n, 0),
          succeeded: count('succeeded'),
          partlySucceeded: count('partly_succeeded'),
          failed: count('failed'),
          recordsIn: recent
            .filter((r) => r.direction === 'inbound')
            .reduce((a, r) => a + r.applied, 0),
          recordsOut: recent
            .filter((r) => r.direction === 'outbound')
            .reduce((a, r) => a + r.applied, 0),
        },
      };
    });
  }

  get(actor: RequestActor, runId: string): Promise<SyncRunView> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      const [row] = await tx
        .select({ run: syncRuns, provider: integrationConnections.provider })
        .from(syncRuns)
        .innerJoin(integrationConnections, eq(integrationConnections.id, syncRuns.connectionId))
        .where(eq(syncRuns.id, runId));
      if (!row) throw ApiProblem.notFound('sync run');
      return this.view(row.run, row.provider as IntegrationProvider);
    });
  }

  view(row: typeof syncRuns.$inferSelect, provider: IntegrationProvider): SyncRunView {
    return {
      id: row.id,
      connectionId: row.connectionId,
      provider,
      object: row.object as SyncObject,
      direction: row.direction as SyncDirection,
      mode: row.mode as SyncRunView['mode'],
      status: row.status as SyncStatus,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      durationMs: row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
      recordsRead: row.recordsRead,
      recordsApplied: row.recordsApplied,
      recordsSkippedDuplicate: row.recordsSkippedDuplicate,
      recordsFailed: row.recordsFailed,
      cursor: row.cursor,
      idempotencyKey: row.idempotencyKey,
      importBatchId: row.importBatchId,
      errorSummary: row.errorSummary,
      triggeredByName: null,
    };
  }

  // Run -------------------------------------------------------------------------------------------

  /**
   * "Run now". The provider call happens outside a transaction; applying the records uses the normal
   * commands, each with its own idempotency key, so a repeat never double-counts.
   */
  async run(
    actor: RequestActor,
    connectionId: string,
    req: RunSyncRequest,
    ctx: CommandContext,
  ): Promise<SyncRunView> {
    const prepared = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const row = await this.connections.rowOrFail(tx, connectionId);
        if (row.pausedAt) {
          throw new ApiProblem(
            409,
            'INTEGRATION_NOT_CONNECTED',
            `${row.displayName} is paused. Resume it before running a sync.`,
          );
        }
        const spec = objectSpec(row.provider as IntegrationProvider, req.object, req.direction);
        if (!spec || !spec.path) {
          throw new ApiProblem(
            422,
            'CONNECTOR_OBJECT_UNSUPPORTED',
            `${row.displayName} does not exchange ${req.object} ${req.direction}.`,
            { object: req.object, direction: req.direction },
          );
        }
        const context = await this.connections.contextFor(tx, row);
        const cursors = (row.cursors ?? {}) as Record<string, string>;
        const since = req.since ?? cursors[`${req.object}:${req.direction}`] ?? null;
        const [run] = await tx
          .insert(syncRuns)
          .values({
            tenantId: actor.tenantId,
            connectionId,
            object: req.object,
            direction: req.direction,
            mode: row.mode,
            status: 'running',
            cursor: since,
            idempotencyKey: `sync:${connectionId}:${req.object}:${req.direction}:${ctx.idempotencyKey}`,
            triggeredBy: actor.personId,
          })
          .returning();
        return { row, spec, context, since, run };
      },
    );

    const { spec, context, since, run } = prepared;
    let read = 0;
    let outcome: ApplyOutcome = {
      applied: 0,
      duplicates: 0,
      failed: 0,
      importBatchId: null,
      note: null,
    };
    let status: SyncStatus = 'succeeded';
    let errorSummary: string | null = null;
    let nextCursor = since;

    try {
      const url = new URL(`${context.baseUrl}${spec.path}`);
      if (since) url.searchParams.set('since', since);
      const res = await this.http.send({
        url: url.toString(),
        headers: { authorization: `Bearer ${context.credential}` },
      });
      if (!res.ok) throw this.providerProblem(res.statusCode || null, res.body);
      const rows = recordsFrom(JSON.parse(res.body), spec.envelope);
      read = rows.length;
      const records = rows.map((r) => spec.map(r, { mappings: context.mappings }));
      nextCursor = this.cursorFrom(rows, spec) ?? since;
      outcome = await this.apply(
        connectorActor(actor, String(prepared.row.provider)),
        context,
        spec,
        records,
        run.id,
        ctx,
      );
      if (outcome.failed > 0 || outcome.duplicates > 0) status = 'partly_succeeded';
      if (outcome.applied === 0 && outcome.failed > 0) status = 'failed';
    } catch (e) {
      status = 'failed';
      errorSummary = e instanceof ApiProblem ? e.detail : 'The sync could not be completed.';
      if (!(e instanceof ApiProblem))
        this.log.error(`sync ${run.id} failed`, e instanceof Error ? e.stack : String(e));
      await this.recordFailure(actor, {
        connectionId,
        syncRunId: run.id,
        direction: req.direction,
        item: `${spec.object} ${req.direction} sync`,
        error: errorSummary,
        statusCode: e instanceof ApiProblem ? Number(e.params?.statusCode ?? 0) || null : null,
        payload: { object: spec.object, since },
        idempotencyKey: `sync:${run.id}`,
      });
    }

    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [updated] = await tx
        .update(syncRuns)
        .set({
          status,
          finishedAt: new Date(),
          recordsRead: read,
          recordsApplied: outcome.applied,
          recordsSkippedDuplicate: outcome.duplicates,
          recordsFailed: outcome.failed,
          cursor: nextCursor,
          importBatchId: outcome.importBatchId,
          errorSummary: errorSummary ?? outcome.note,
        })
        .where(eq(syncRuns.id, run.id))
        .returning();
      const row = await this.connections.rowOrFail(tx, connectionId);
      await tx
        .update(integrationConnections)
        .set({
          lastSyncAt: new Date(),
          cursors: {
            ...((row.cursors ?? {}) as Record<string, string>),
            [`${req.object}:${req.direction}`]: nextCursor ?? '',
          },
          status: status === 'failed' ? 'needs_attention' : row.status,
          attention: status === 'failed' ? errorSummary : row.attention,
          updatedAt: new Date(),
        })
        .where(eq(integrationConnections.id, connectionId));
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: 'integration.sync_run',
        resourceType: 'sync_run',
        resourceId: run.id,
        requestId: ctx.requestId,
        changes: {
          object: { from: null, to: `${req.object} ${req.direction}` },
          status: { from: 'running', to: status },
          applied: { from: null, to: outcome.applied },
          duplicatesSkipped: { from: null, to: outcome.duplicates },
          importBatchId: { from: null, to: outcome.importBatchId },
        },
      });
      return this.view(updated, row.provider as IntegrationProvider);
    });
  }

  /**
   * Applies what the provider returned. Money-bearing records become an actuals review batch, which
   * de-duplicates by source reference; headcount goes through the Phase 3 import with its own
   * validation; the rest is read and reported.
   */
  private async apply(
    actor: RequestActor,
    context: ConnectorContext,
    spec: ObjectSpec,
    records: InboundRecord[],
    runId: string,
    ctx: CommandContext,
  ): Promise<ApplyOutcome> {
    const held = records.filter((r) => r.requiresMapping);
    for (const r of held) {
      await this.recordFailure(actor, {
        connectionId: context.connection.id,
        syncRunId: runId,
        direction: spec.direction,
        item: `${spec.object} ${r.externalId}`,
        error: `"${r.requiresMapping!.value}" has no mapping (${r.requiresMapping!.kind}); the record is held back.`,
        statusCode: null,
        payload: { externalId: r.externalId, missing: r.requiresMapping },
        idempotencyKey: `map:${context.connection.id}:${spec.object}:${r.externalId}`,
        errorClass: 'mapping',
      });
    }
    const usable = records.filter((r) => !r.requiresMapping);

    if (spec.source) {
      const lines = usable.map((r) => r.actual!).filter(Boolean) as ActualLine[];
      if (lines.length === 0)
        return { applied: 0, duplicates: 0, failed: held.length, importBatchId: null, note: null };
      try {
        const res = await this.imports.upload(
          actor,
          {
            source: spec.source,
            fileName: `${context.connection.provider}-${spec.object}-${runId.slice(0, 8)}.csv`,
            content: toActualsCsv(lines),
          },
          { idempotencyKey: `sync-import:${runId}`, requestId: ctx.requestId },
        );
        const summary = res.body.summary;
        return {
          applied: summary.imported,
          duplicates: summary.duplicatesSkipped + summary.crossSourceDuplicates,
          failed: summary.rejected + held.length,
          importBatchId: res.body.id,
          note:
            summary.crossSourceDuplicates > 0
              ? `${summary.crossSourceDuplicates} line(s) held as possible duplicates of another source.`
              : null,
        };
      } catch (e) {
        // Every line was seen before: the window overlapped, nothing is double-counted.
        if (e instanceof ApiProblem && e.code === 'IMPORT_INVALID' && e.params?.duplicates) {
          return {
            applied: 0,
            duplicates: Number(e.params.duplicates),
            failed: held.length,
            importBatchId: null,
            note: 'Every line was already imported; nothing was applied again.',
          };
        }
        if (e instanceof ApiProblem && e.code === 'IMPORT_ALREADY_UPLOADED') {
          return {
            applied: 0,
            duplicates: lines.length,
            failed: held.length,
            importBatchId: (e.params?.batchId as string) ?? null,
            note: 'This window was already imported; nothing was applied again.',
          };
        }
        throw e;
      }
    }

    if (spec.object === 'workers') {
      return this.applyWorkers(actor, usable, held.length, runId, ctx);
    }

    // Suppliers, purchase orders, calendar responses and plan rows are read and reported; they feed
    // review screens rather than changing data on their own.
    return {
      applied: usable.length,
      duplicates: 0,
      failed: held.length,
      importBatchId: null,
      note: this.describe(spec.object, usable),
    };
  }

  /** Workers become a headcount snapshot through the Phase 3 import, all-or-nothing per run (093). */
  private async applyWorkers(
    actor: RequestActor,
    records: InboundRecord[],
    heldBack: number,
    runId: string,
    ctx: CommandContext,
  ): Promise<ApplyOutcome> {
    const active = records.filter((r) => r.data && r.data['status'] !== 'leaver');
    const tally = new Map<string, number>();
    for (const r of active) {
      const key = `${r.data!['locationCode']}|${r.data!['employmentType'] || 'employee'}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const csv = [
      'location_code,employment_type,headcount',
      ...[...tally.entries()].map(([k, n]) => `${k.split('|')[0]},${k.split('|')[1]},${n}`),
    ].join('\n');
    const res = await this.headcount.import(
      actor,
      { asOfDate: todayUtc(), csv, dryRun: false },
      { idempotencyKey: `sync-headcount:${runId}`, requestId: ctx.requestId },
    );
    const leavers = records.length - active.length;
    return {
      applied: active.length,
      duplicates: 0,
      failed: heldBack,
      importBatchId: null,
      note: `Headcount snapshot created from ${active.length} worker(s); ${leavers} leaver(s) recorded. Snapshot ${res.body.snapshotId ?? ''}`.trim(),
    };
  }

  private describe(object: SyncObject, records: InboundRecord[]): string | null {
    if (object !== 'calendar_responses') return null;
    // 097: Accepted becomes Going, Declined becomes Can't go, Tentative stays No response.
    const by = (r: string) => records.filter((x) => x.data?.['response'] === r).length;
    return `Accepted ${by('accepted')}, Declined ${by('declined')}, Tentative ${by('tentative')} (Tentative counts as no response and gets one reminder).`;
  }

  private cursorFrom(rows: Record<string, unknown>[], spec: ObjectSpec): string | null {
    if (!spec.cursorField || rows.length === 0) return null;
    const values = rows
      .map((r) => String(r[spec.cursorField] ?? ''))
      .filter(Boolean)
      .sort();
    return values.at(-1) ?? null;
  }

  private providerProblem(statusCode: number | null, body: string): ApiProblem {
    const message = providerMessage(statusCode, body);
    const code =
      statusCode === 401 || statusCode === 403
        ? ('INTEGRATION_TEST_FAILED' as const)
        : statusCode === 429
          ? ('RATE_LIMIT_EXCEEDED' as const)
          : ('INTEGRATION_TEST_FAILED' as const);
    return new ApiProblem(422, code, message, { statusCode: statusCode ?? 0 });
  }

  /**
   * Records a failure in the retry queue (100). Retryable classes get a backoff schedule; signature
   * and authentication failures do not retry themselves and wait for a person.
   */
  async recordFailure(
    actor: RequestActor,
    input: {
      connectionId: string;
      syncRunId: string | null;
      direction: SyncDirection;
      item: string;
      error: string;
      statusCode: number | null;
      payload: unknown;
      idempotencyKey: string;
      errorClass?: ReturnType<typeof classifyError>;
    },
  ): Promise<void> {
    const errorClass = input.errorClass ?? classifyError(input.statusCode, input.error);
    const nextRetryAt = isRetryable(errorClass)
      ? new Date(Date.now() + RETRY_BACKOFF_MINUTES[0] * 60_000)
      : null;
    await withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      await this.upsertMessage(tx, actor.tenantId, {
        connectionId: input.connectionId,
        syncRunId: input.syncRunId,
        direction: input.direction,
        item: input.item,
        errorClass,
        lastError: input.error,
        nextRetryAt,
        payloadRedacted: redact(input.payload) as Record<string, unknown>,
        idempotencyKey: input.idempotencyKey,
      });
    });
  }

  /** One row per failing item: a repeat bumps the attempt count and moves on along the backoff. */
  async upsertMessage(
    tx: Tx,
    tenantId: string,
    input: {
      connectionId: string;
      syncRunId: string | null;
      direction: SyncDirection;
      item: string;
      errorClass: ReturnType<typeof classifyError>;
      lastError: string;
      nextRetryAt: Date | null;
      payloadRedacted: Record<string, unknown>;
      idempotencyKey: string;
    },
  ): Promise<void> {
    const [existing] = await tx
      .select()
      .from(integrationMessages)
      .where(eq(integrationMessages.idempotencyKey, input.idempotencyKey));
    if (!existing) {
      await tx.insert(integrationMessages).values({
        tenantId,
        connectionId: input.connectionId,
        syncRunId: input.syncRunId,
        direction: input.direction,
        item: input.item,
        errorClass: input.errorClass,
        lastError: input.lastError,
        attempts: 1,
        maxAttempts: MAX_RETRY_ATTEMPTS,
        nextRetryAt: input.nextRetryAt,
        status: 'retrying',
        payloadRedacted: input.payloadRedacted,
        idempotencyKey: input.idempotencyKey,
      });
      return;
    }
    const attempts = existing.attempts + 1;
    const exhausted = attempts >= existing.maxAttempts || !isRetryable(input.errorClass);
    await tx
      .update(integrationMessages)
      .set({
        attempts,
        lastError: input.lastError,
        errorClass: input.errorClass,
        status: exhausted ? 'dead_letter' : 'retrying',
        nextRetryAt: exhausted
          ? null
          : new Date(
              Date.now() +
                RETRY_BACKOFF_MINUTES[Math.min(attempts - 1, RETRY_BACKOFF_MINUTES.length - 1)] *
                  60_000,
            ),
        movedToDeadLetterAt: exhausted ? (existing.movedToDeadLetterAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(integrationMessages.id, existing.id));
  }
}
