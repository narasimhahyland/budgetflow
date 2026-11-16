import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  nowUtc,
  PolicyService,
  todayUtc,
  type RequestActor,
} from '@bf/api/core';
import {
  aiScanRuns,
  outboxMessages,
  people,
  tenants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type { AiScanFeature, AiScanRun, AiScanRunList, AiScanRunRequest } from '@bf/contracts';
import { AI_SCAN_FEATURES } from '@bf/contracts';
import type { Action } from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AiGateway } from './ai-gateway.service';
import { AiAnomalyService } from './features/anomaly.service';
import { AiOutlookService, type ScanStats } from './features/outlook.service';
import type { CommandContext } from './settings.service';
import { AiSettingsService } from './settings.service';

/**
 * Outbox topic for a requested run. Its worker only hands the run to `AI_SCAN_EXECUTE`, keyed by
 * the run id, so however a run is queued (API, sweep, redelivery) it has one live job at a time.
 */
export const AI_SCAN_TOPIC = 'ai.scan';
/** The execution queue: `exclusive` policy, singleton key = run id, retries, dead letter. */
export const AI_SCAN_EXECUTE = 'ai.scan.execute';
/** Nightly removal of reported-answer text past its 90 days (gap B9), separate from the scans. */
export const AI_REPORT_TEXT_NIGHTLY = 'ai.report_text_retention';
/** Nightly schedule: creates each tenant's runs for the night and queues them. */
export const AI_SCAN_NIGHTLY = 'ai.scan_nightly';
/** Retries after the first attempt before the job moves to the dead-letter queue. */
export const AI_SCAN_RETRY_LIMIT = 3;

/** The worker's subject on every query-log row a scan writes, so the log shows "system". */
const SCAN_SUBJECT = 'system:ai-scan';

type RunRow = typeof aiScanRuns.$inferSelect;
type Outcome = 'completed' | 'skipped' | 'retrying' | 'noop';

const iso = (d: Date | null) => (d ? d.toISOString().replace(/\.\d+Z$/, 'Z') : null);

/** What a caller needs to read the runs of a feature: the same as reading that feature's screen. */
const READ_ACTION: Record<AiScanFeature, Action> = {
  outlook: 'tenant.read',
  anomaly_flags: 'integrity.read',
};

/** Raised when every model call of an attempt failed: an outage, so the worker retries the run. */
export class ScanProviderOutage extends Error {
  constructor(readonly runId: string) {
    super('The model provider was unavailable for every call in this scan.');
  }
}

/**
 * Gap B9: the outlook (016b) and anomaly (017c) scans as worker jobs. The nightly sweep iterates
 * tenants explicitly and creates one run per tenant, feature and date (a unique index), so a
 * redelivered or replayed job finds its run and changes nothing. Each run sets the tenant context,
 * honours the feature's kill switch, and calls the same scan the on-demand path uses, with a
 * read-only, tenant-wide worker identity. A scan writes outlook snapshots and advisory flags only:
 * never a ledger line, an approval, a rule or a limit.
 */
@Injectable()
export class AiScanRunsService {
  private readonly log = new Logger('AiScanRuns');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly settings: AiSettingsService,
    private readonly gateway: AiGateway,
    private readonly outlook: AiOutlookService,
    private readonly anomalies: AiAnomalyService,
  ) {}

  private tenant(actor: RequestActor) {
    return { kind: 'tenant' as const, tenantId: actor.tenantId };
  }

  private canRead(actor: RequestActor, feature: AiScanFeature): boolean {
    return this.policy.can(actor, READ_ACTION[feature], this.tenant(actor)).allowed;
  }

  /**
   * Queuing a scan needs the AI administrator (Org Admin) or the Finance Admin who confirms finance
   * features. Readers such as the auditor see runs but do not start them.
   */
  private assertCanRequest(actor: RequestActor): void {
    if (
      this.policy.can(actor, 'tenant.settings.manage', this.tenant(actor)).allowed ||
      this.policy.can(actor, 'ai.confirm_finance', this.tenant(actor)).allowed
    )
      return;
    throw ApiProblem.forbidden('Queuing an AI scan needs AI administration or a Finance Admin.');
  }

  private async view(tx: Tx, rows: RunRow[]): Promise<AiScanRun[]> {
    const ids = [
      ...new Set(rows.map((r) => r.requestedByPersonId).filter((v): v is string => !!v)),
    ];
    const names = ids.length
      ? new Map(
          (
            await tx
              .select({ id: people.id, name: people.displayName })
              .from(people)
              .where(inArray(people.id, ids))
          ).map((p) => [p.id, p.name]),
        )
      : new Map<string, string>();
    return rows.map((r) => ({
      id: r.id,
      feature: r.feature as AiScanFeature,
      runDate: r.runDate,
      trigger: r.trigger as AiScanRun['trigger'],
      status: r.status as AiScanRun['status'],
      skipReason: (r.skipReason as AiScanRun['skipReason']) ?? null,
      scopeCount: r.budgetIds ? r.budgetIds.length : null,
      evaluatedCount: r.evaluatedCount,
      resultCount: r.resultCount,
      modelCalls: r.modelCalls,
      failedModelCalls: r.failedModelCalls,
      attempts: r.attempts,
      error: r.error,
      requestedByName: r.requestedByPersonId ? (names.get(r.requestedByPersonId) ?? null) : null,
      createdAt: iso(r.createdAt)!,
      completedAt: iso(r.completedAt),
    }));
  }

  // API side --------------------------------------------------------------------------------------

  list(
    actor: RequestActor,
    q: { feature?: AiScanFeature; limit?: number },
  ): Promise<AiScanRunList> {
    const features = AI_SCAN_FEATURES.filter(
      (f) => (!q.feature || f === q.feature) && this.canRead(actor, f),
    );
    if (!features.length) {
      if (q.feature || !AI_SCAN_FEATURES.some((f) => this.canRead(actor, f)))
        throw ApiProblem.forbidden('Reading AI scan runs needs access to that AI feature.');
    }
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = features.length
        ? await tx
            .select()
            .from(aiScanRuns)
            .where(inArray(aiScanRuns.feature, features))
            .orderBy(desc(aiScanRuns.runDate), desc(aiScanRuns.createdAt), desc(aiScanRuns.id))
            .limit(Math.min(q.limit ?? 30, 100))
        : [];
      const latest: RunRow[] = [];
      for (const feature of features) {
        const [row] = await tx
          .select()
          .from(aiScanRuns)
          .where(
            and(
              eq(aiScanRuns.feature, feature),
              eq(aiScanRuns.trigger, 'nightly'),
              eq(aiScanRuns.status, 'completed'),
            ),
          )
          .orderBy(desc(aiScanRuns.runDate), desc(aiScanRuns.completedAt), desc(aiScanRuns.id))
          .limit(1);
        if (row) latest.push(row);
      }
      return { items: await this.view(tx, rows), latestCompleted: await this.view(tx, latest) };
    });
  }

  get(actor: RequestActor, runId: string): Promise<AiScanRun> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [row] = await tx.select().from(aiScanRuns).where(eq(aiScanRuns.id, runId));
      if (!row || !this.canRead(actor, row.feature as AiScanFeature))
        throw ApiProblem.notFound('AI scan run');
      return (await this.view(tx, [row]))[0];
    });
  }

  /**
   * Queues the night's run now, or returns it when it already exists: a run that completed or was
   * skipped is final for its night, so asking again changes nothing. A failed run is queued again.
   * With `budgetIds` it is a manual run limited to those budgets, a new run each time.
   */
  request(actor: RequestActor, req: AiScanRunRequest, ctx: CommandContext) {
    this.assertCanRequest(actor);
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'ai.scan.request',
        request: req,
        status: 202,
      },
      async (tx) => {
        // Always tonight: a scan reads today's ledger, so a past night would be rewritten with
        // figures it never had.
        const runDate = todayUtc();
        let run: RunRow;
        let changed: { from: string | null; to: string } | null = null;
        if (req.budgetIds) {
          [run] = await tx
            .insert(aiScanRuns)
            .values({
              tenantId: actor.tenantId,
              feature: req.feature,
              runDate,
              trigger: 'manual',
              budgetIds: [...new Set(req.budgetIds)].sort(),
              requestedByPersonId: actor.personId,
            })
            .returning();
          changed = { from: null, to: 'queued' };
        } else {
          const ensured = await this.ensureNightly(
            tx,
            actor.tenantId,
            req.feature,
            runDate,
            actor.personId,
          );
          run = ensured.run;
          if (ensured.created) changed = { from: null, to: 'queued' };
          else if (run.status === 'failed') {
            // Conditional, so two requests racing on one failed run requeue it (and audit it) once.
            const [requeued] = await tx
              .update(aiScanRuns)
              .set({ status: 'queued', error: null, completedAt: null })
              .where(and(eq(aiScanRuns.id, run.id), eq(aiScanRuns.status, 'failed')))
              .returning();
            if (requeued) {
              run = requeued;
              changed = { from: 'failed', to: 'queued' };
            } else {
              [run] = await tx.select().from(aiScanRuns).where(eq(aiScanRuns.id, run.id));
            }
          }
        }
        if (changed) {
          await tx
            .insert(outboxMessages)
            .values({ tenantId: actor.tenantId, topic: AI_SCAN_TOPIC, payload: { runId: run.id } });
          await this.audit.append(tx, {
            tenantId: actor.tenantId,
            actorPersonId: actor.personId,
            actorSubject: actor.subject,
            action: 'ai.scan.requested',
            resourceType: 'ai_scan_run',
            resourceId: run.id,
            legalEntityId: null,
            requestId: ctx.requestId,
            reason: `AI scan (${req.feature}) for ${runDate}`,
            changes: { status: changed, runDate: { from: null, to: runDate } },
          });
        }
        return (await this.view(tx, [run]))[0];
      },
    );
  }

  private async ensureNightly(
    tx: Tx,
    tenantId: string,
    feature: AiScanFeature,
    runDate: string,
    requestedByPersonId: string | null,
  ): Promise<{ run: RunRow; created: boolean }> {
    const inserted = await tx
      .insert(aiScanRuns)
      .values({ tenantId, feature, runDate, trigger: 'nightly', requestedByPersonId })
      .onConflictDoNothing()
      .returning();
    if (inserted.length) return { run: inserted[0], created: true };
    const [existing] = await tx
      .select()
      .from(aiScanRuns)
      .where(
        and(
          eq(aiScanRuns.feature, feature),
          eq(aiScanRuns.runDate, runDate),
          eq(aiScanRuns.trigger, 'nightly'),
        ),
      );
    return { run: existing, created: false };
  }

  // Worker side -----------------------------------------------------------------------------------

  /**
   * The nightly sweep: for every tenant, explicitly and one at a time under its own tenant context,
   * the night's run of each scan feature. Returns the runs still to execute (new, or left queued or
   * retrying by an earlier sweep); the worker queues one job per run, keyed by the run id.
   */
  async ensureNightlyRuns(runDate = todayUtc()): Promise<{ tenantId: string; runId: string }[]> {
    const all = await this.db.transaction((tx) =>
      tx.select({ id: tenants.id }).from(tenants).orderBy(tenants.id),
    );
    const due: { tenantId: string; runId: string }[] = [];
    for (const t of all) {
      // One tenant failing never stops the others; its runs are picked up by the next sweep.
      try {
        await withTenant(this.db, { tenantId: t.id, subject: SCAN_SUBJECT }, async (tx) => {
          for (const feature of AI_SCAN_FEATURES) {
            const { run } = await this.ensureNightly(tx, t.id, feature, runDate, null);
            if (run.status === 'queued' || run.status === 'retrying')
              due.push({ tenantId: t.id, runId: run.id });
          }
        });
      } catch (e) {
        this.log.error(`nightly AI scan sweep failed for a tenant: ${(e as Error).message}`);
      }
    }
    return due;
  }

  /**
   * Executes one run. A run that completed, was skipped or failed for good is final, so a
   * redelivered job does nothing. A switched-off feature (or no provider) skips the run without a
   * model call. When every model call of an attempt fails, the attempt's work is kept (outlook
   * figures and the query log are still right) and the run is retried with backoff.
   */
  async execute(tenantId: string, runId: string): Promise<Outcome> {
    const outcome = await withTenant(this.db, { tenantId, subject: SCAN_SUBJECT }, async (tx) => {
      const [run] = await tx
        .select()
        .from(aiScanRuns)
        .where(eq(aiScanRuns.id, runId))
        .for('update');
      if (!run || !['queued', 'retrying'].includes(run.status)) return 'noop' as const;
      const feature = run.feature as AiScanFeature;
      const now = nowUtc();
      const skipReason = !this.gateway.configured
        ? 'provider_not_configured'
        : !(await this.settings.isEnabled(tx, tenantId, feature))
          ? 'feature_off'
          : null;
      if (skipReason) {
        await tx
          .update(aiScanRuns)
          .set({
            status: 'skipped',
            skipReason,
            attempts: run.attempts + 1,
            startedAt: now,
            completedAt: now,
          })
          .where(eq(aiScanRuns.id, runId));
        this.log.log(`AI scan ${runId} (${feature}): skipped, ${skipReason}`);
        return 'skipped' as const;
      }
      const actor = await this.workerActor(tx, tenantId);
      const scope = run.budgetIds ?? undefined;
      const stats: ScanStats =
        feature === 'outlook'
          ? await this.outlook.runInTx(tx, actor, { asOfDate: run.runDate, budgetIds: scope })
          : await this.anomalies.scanInTx(tx, actor, { budgetIds: scope });
      const outage = stats.modelCalls > 0 && stats.failedModelCalls === stats.modelCalls;
      await tx
        .update(aiScanRuns)
        .set({
          status: outage ? 'retrying' : 'completed',
          evaluatedCount: stats.evaluated,
          resultCount: stats.results,
          modelCalls: stats.modelCalls,
          failedModelCalls: stats.failedModelCalls,
          attempts: run.attempts + 1,
          error: outage ? new ScanProviderOutage(runId).message : null,
          startedAt: run.startedAt ?? now,
          completedAt: outage ? null : now,
        })
        .where(eq(aiScanRuns.id, runId));
      return outage ? ('retrying' as const) : ('completed' as const);
    });
    // Thrown after the commit, so the attempt is recorded and pg-boss retries with backoff.
    if (outcome === 'retrying') throw new ScanProviderOutage(runId);
    return outcome;
  }

  /** Records an attempt that threw before it could record itself (a database or code error). */
  async recordError(tenantId: string, runId: string, error: Error): Promise<void> {
    if (error instanceof ScanProviderOutage) return;
    await withTenant(this.db, { tenantId, subject: SCAN_SUBJECT }, async (tx) => {
      const [run] = await tx.select().from(aiScanRuns).where(eq(aiScanRuns.id, runId));
      if (!run || !['queued', 'retrying'].includes(run.status)) return;
      await tx
        .update(aiScanRuns)
        .set({
          status: 'retrying',
          attempts: run.attempts + 1,
          error: 'The scan stopped with an internal error; it will be retried.',
        })
        .where(eq(aiScanRuns.id, runId));
    });
  }

  /** After the last retry: the run shows failed (the job itself sits in the dead-letter queue). */
  async fail(tenantId: string, runId: string): Promise<void> {
    await withTenant(this.db, { tenantId, subject: SCAN_SUBJECT }, (tx) =>
      tx
        .update(aiScanRuns)
        .set({
          status: 'failed',
          error: 'Every retry failed. The previous results stay on the screens.',
          completedAt: nowUtc(),
        })
        .where(and(eq(aiScanRuns.id, runId), inArray(aiScanRuns.status, ['queued', 'retrying']))),
    );
  }

  /**
   * The scan reads tenant-wide and writes nothing but suggestions, so it runs as a read-only,
   * tenant-wide identity (the auditor's grants): it can read every budget and the integrity data
   * the flags need, and no command it could reach would accept it as an approver or a poster.
   */
  private async workerActor(tx: Tx, tenantId: string): Promise<RequestActor> {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    return {
      tenantId,
      personId: null,
      roles: ['auditor'],
      ownedBudgetPaths: [],
      subject: SCAN_SUBJECT,
      displayName: 'BudgetFlow nightly scan',
      tenantName: t?.name ?? '',
      reportingCurrency: (t?.reportingCurrency ?? 'USD') as RequestActor['reportingCurrency'],
      memberships: [],
    };
  }
}
