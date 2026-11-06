import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { aiEvaluationRuns, withTenant, type Db, type Tx } from '@bf/api/db';
import type { AiAccuracyView, AiEvaluationResult, AiFeature, AnomalyKind } from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AiProvider } from '../provider/ai-provider';
import { EVAL_SETS, type EvalSet } from './fixtures';

/**
 * Quality is measured, not asserted (113a Accuracy). Each set runs against the configured provider -
 * the deterministic fake in functional runs and CI - and the result is stored next to its published
 * threshold. A flag kind below its threshold stops raising new flags until it is re-evaluated.
 */
@Injectable()
export class AiEvaluationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly provider: AiProvider,
  ) {}

  private tenant(actor: RequestActor) {
    return { kind: 'tenant' as const, tenantId: actor.tenantId };
  }

  async run(actor: RequestActor, feature?: AiFeature): Promise<AiAccuracyView> {
    this.policy.assert(actor, 'tenant.settings.manage', this.tenant(actor), 'AI evaluations');
    if (!this.provider.configured)
      throw new ApiProblem(
        409,
        'AI_PROVIDER_NOT_CONFIGURED',
        'No model provider is configured, so the evaluation sets cannot run.',
      );
    const sets = EVAL_SETS.filter((s) => !feature || s.feature === feature);
    const results: AiEvaluationResult[] = [];
    await withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      for (const set of sets) results.push(await this.runSet(tx, actor, set));
    });
    return this.view(results);
  }

  /** Seed only: runs every set for a tenant without an actor, so the accuracy tab starts populated. */
  async seedRun(tx: Tx, tenantId: string): Promise<void> {
    for (const set of EVAL_SETS) await this.store(tx, tenantId, set);
  }

  private runSet(tx: Tx, actor: RequestActor, set: EvalSet): Promise<AiEvaluationResult> {
    return this.store(tx, actor.tenantId, set);
  }

  private async store(tx: Tx, tenantId: string, set: EvalSet): Promise<AiEvaluationResult> {
    const failures: string[] = [];
    let passed = 0;
    for (const testCase of set.cases) {
      const ok = await testCase.run(this.provider);
      if (ok) passed += 1;
      else failures.push(testCase.name);
    }
    const resultBps =
      set.cases.length === 0 ? 10_000 : Math.round((passed / set.cases.length) * 10_000);
    const [row] = await tx
      .insert(aiEvaluationRuns)
      .values({
        tenantId,
        feature: set.feature,
        fixtureSet: set.fixtureSet,
        metric: set.metric,
        kind: set.kind ?? null,
        thresholdBps: set.thresholdBps,
        resultBps,
        passed: resultBps >= set.thresholdBps,
        cases: set.cases.length,
        failures: failures.sort() as unknown as object,
        provider: this.provider.id,
        modelId: this.provider.modelId,
        modelVersion: this.provider.modelVersion,
      })
      .returning();
    return this.toResult(row);
  }

  async accuracy(actor: RequestActor): Promise<AiAccuracyView> {
    this.policy.assert(actor, 'tenant.read', this.tenant(actor), 'AI accuracy');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(aiEvaluationRuns)
        .where(eq(aiEvaluationRuns.tenantId, actor.tenantId))
        .orderBy(desc(aiEvaluationRuns.runAt), desc(aiEvaluationRuns.id));
      return this.view(latestPerMetric(rows).map((r) => this.toResult(r)));
    });
  }

  /** Flag kinds whose latest measured precision is below their threshold (017c paused kinds). */
  async pausedKinds(
    tx: Tx,
    tenantId: string,
  ): Promise<{ kind: AnomalyKind; precisionBps: number; thresholdBps: number }[]> {
    const rows = await tx
      .select()
      .from(aiEvaluationRuns)
      .where(
        and(
          eq(aiEvaluationRuns.tenantId, tenantId),
          eq(aiEvaluationRuns.feature, 'anomaly_flags'),
          eq(aiEvaluationRuns.metric, 'flag_precision'),
        ),
      )
      .orderBy(desc(aiEvaluationRuns.runAt), desc(aiEvaluationRuns.id));
    return latestPerMetric(rows)
      .filter((r) => !r.passed && r.kind)
      .map((r) => ({
        kind: r.kind as AnomalyKind,
        precisionBps: r.resultBps,
        thresholdBps: r.thresholdBps,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }

  private view(results: AiEvaluationResult[]): AiAccuracyView {
    const ordered = [...results].sort(
      (a, b) =>
        a.feature.localeCompare(b.feature) ||
        a.metric.localeCompare(b.metric) ||
        (a.kind ?? '').localeCompare(b.kind ?? ''),
    );
    return { results: ordered, allPassed: ordered.every((r) => r.passed) };
  }

  private toResult(row: typeof aiEvaluationRuns.$inferSelect): AiEvaluationResult {
    return {
      id: row.id,
      feature: row.feature as AiFeature,
      fixtureSet: row.fixtureSet,
      metric: row.metric as AiEvaluationResult['metric'],
      kind: row.kind,
      thresholdBps: row.thresholdBps,
      resultBps: row.resultBps,
      passed: row.passed,
      cases: row.cases,
      failures: (row.failures as string[]) ?? [],
      provider: row.provider,
      modelId: row.modelId,
      modelVersion: row.modelVersion,
      runAt: row.runAt.toISOString().replace(/\.\d+Z$/, 'Z'),
    };
  }
}

/** Rows arrive newest first; keep the first row per (feature, metric, kind). */
function latestPerMetric<T extends { feature: string; metric: string; kind: string | null }>(
  rows: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = `${row.feature}|${row.metric}|${row.kind ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
