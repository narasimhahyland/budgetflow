import { budgetResource } from '@bf/api/budgets';
import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { aiSuggestions, budgets, events, requests, withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  AiSourceRef,
  AnomalyFlag,
  AnomalyFlagList,
  AnomalyKind,
  AnomalyScanRequest,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AiGateway } from '../ai-gateway.service';
import { ANOMALY_THRESHOLDS } from '../anomaly-thresholds';
import { AiEvaluationsService } from '../evals/evaluations.service';
import type { Fact } from '../provider/ai-provider';
import { AiRetrieval } from '../retrieval.service';
import { AiSettingsService } from '../settings.service';
import { AiSuggestionsService } from '../suggestions.service';

const AnomalyOutput = z
  .object({ finding: z.string().min(1).max(600), confidence: z.enum(['high', 'medium', 'low']) })
  .strict();

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 017c: advisory flags on records that look unusual before money is committed. A flag never blocks,
 * holds, approves or rejects anything; a person clears it with a reason or follows it up through the
 * exception path. A kind whose measured precision falls below its threshold stops raising new flags.
 */
@Injectable()
export class AiAnomalyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly settings: AiSettingsService,
    private readonly retrieval: AiRetrieval,
    private readonly gateway: AiGateway,
    private readonly suggestions: AiSuggestionsService,
    private readonly evaluations: AiEvaluationsService,
  ) {}

  scan(actor: RequestActor, req: AnomalyScanRequest): Promise<AnomalyFlagList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      await this.settings.assertEnabled(tx, actor.tenantId, 'anomaly_flags');
      this.policy.assert(
        actor,
        'integrity.read',
        { kind: 'tenant', tenantId: actor.tenantId },
        'anomaly flags',
      );
      const paused = new Set(
        (await this.evaluations.pausedKinds(tx, actor.tenantId)).map((p) => p.kind),
      );
      const wanted = (
        req.kinds ?? ['possible_split', 'possible_duplicate', 'unusual_cost_per_head']
      )
        .filter((k) => !paused.has(k))
        .sort();
      if (req.kinds?.length && wanted.length === 0)
        throw new ApiProblem(
          409,
          'AI_FLAG_KIND_PAUSED',
          'Every kind you asked for is paused because its measured precision is below its threshold.',
        );
      const scoped = await this.retrieval.budgetFacts(tx, actor, { limit: 25 });
      const budgetIds = scoped.rows.map((b) => b.id);
      if (budgetIds.length) {
        if (wanted.includes('possible_split')) await this.scanSplits(tx, actor, budgetIds);
        if (wanted.includes('unusual_cost_per_head'))
          await this.scanCostPerHead(tx, actor, budgetIds);
        if (wanted.includes('possible_duplicate')) await this.scanDuplicates(tx, actor, budgetIds);
      }
      return this.listInTx(tx, actor, {});
    });
  }

  private async raise(
    tx: Tx,
    actor: RequestActor,
    input: {
      kind: AnomalyKind;
      subjectType: AnomalyFlag['subjectType'];
      subjectId: string;
      subjectLabel: string;
      budgetId: string | null;
      amountMinor: number | null;
      currency: string;
      stage: AnomalyFlag['stage'];
      evidence: { label: string; value: string }[];
      fact: Fact;
      sources: AiSourceRef[];
    },
  ): Promise<void> {
    const result = await this.gateway.run({
      tx,
      actor,
      feature: 'anomaly_flags',
      channel: 'system',
      task: 'anomaly_explain',
      facts: [input.fact],
      sources: input.sources,
      scope: {
        action: 'integrity.read',
        scope: this.retrieval.scopeKind(actor, 'integrity.read'),
        consideredCount: 1,
        permittedCount: 1,
      },
      schema: AnomalyOutput,
      successOutcome: 'suggested',
      narrative: (out) => [out.finding],
    });
    if (!result.output) return;
    await this.suggestions.upsert(tx, {
      tenantId: actor.tenantId,
      feature: 'anomaly_flags',
      subjectType: `anomaly:${input.kind}`,
      subjectId: input.subjectId,
      budgetId: input.budgetId,
      confidence: result.output.confidence,
      payload: {
        kind: input.kind,
        subjectType: input.subjectType,
        subjectLabel: input.subjectLabel,
        stage: input.stage,
        amountMinor: input.amountMinor,
        currency: input.currency,
        finding: result.output.finding,
        evidence: input.evidence,
        queryLogId: result.queryLogId,
      },
      sources: input.sources,
      createdByPersonId: null,
      provider: this.gateway.providerId,
      modelId: this.gateway.modelId,
      modelVersion: this.gateway.modelVersion,
    });
  }

  /** Two requests by the same person on the same budget, close together, that together cross a limit. */
  private async scanSplits(tx: Tx, actor: RequestActor, budgetIds: string[]): Promise<void> {
    const rows = await tx
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.tenantId, actor.tenantId),
          inArray(requests.budgetId, budgetIds),
          inArray(requests.status, ['submitted', 'pending_approval', 'approved']),
        ),
      )
      .orderBy(requests.ref, requests.id);
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (a.requesterPersonId !== b.requesterPersonId || a.budgetId !== b.budgetId) continue;
        if (a.currency !== b.currency) continue;
        const days = Math.round(Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) / DAY_MS);
        if (days > ANOMALY_THRESHOLDS.splitWindowDays) continue;
        const combined = a.amountMinor + b.amountMinor;
        if (combined < ANOMALY_THRESHOLDS.splitCombinedMinor) continue;
        const label = `${a.ref} and ${b.ref}`;
        await this.raise(tx, actor, {
          kind: 'possible_split',
          subjectType: 'request',
          subjectId: a.id,
          subjectLabel: label,
          budgetId: a.budgetId,
          amountMinor: combined,
          currency: a.currency,
          stage: a.status === 'approved' ? 'after_approval' : 'before_approval',
          evidence: [
            { label: 'Requests', value: label },
            { label: 'Days apart', value: String(days) },
            { label: 'Combined', value: `${a.currency} ${(combined / 100).toFixed(2)}` },
          ],
          fact: {
            type: 'request',
            id: a.id,
            label,
            fields: {
              kind: 'possible_split',
              currency: a.currency,
              combinedMinor: combined,
              limitMinor: ANOMALY_THRESHOLDS.splitCombinedMinor,
              daysApart: days,
              amountMinor: a.amountMinor,
            },
          },
          sources: [
            { type: 'request', id: a.id, label: a.ref },
            { type: 'request', id: b.id, label: b.ref },
          ],
        });
      }
    }
  }

  /** An event whose cost per head is far above the median of its peer group in the same category. */
  private async scanCostPerHead(tx: Tx, actor: RequestActor, budgetIds: string[]): Promise<void> {
    const rows = await tx
      .select()
      .from(events)
      .where(and(eq(events.tenantId, actor.tenantId), inArray(events.budgetId, budgetIds)))
      .orderBy(events.name, events.id);
    const perHead = rows
      .filter((e) => (e.expectedAttendance ?? 0) > 0 && e.estimateMinor > 0)
      .map((e) => ({ event: e, value: Math.round(e.estimateMinor / (e.expectedAttendance ?? 1)) }));
    if (perHead.length < ANOMALY_THRESHOLDS.minimumPeerGroup) return;
    const sorted = [...perHead].map((p) => p.value).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const { event, value } of perHead) {
      if (value < median * ANOMALY_THRESHOLDS.costPerHeadFactor) continue;
      await this.raise(tx, actor, {
        kind: 'unusual_cost_per_head',
        subjectType: 'request',
        subjectId: event.id,
        subjectLabel: event.name,
        budgetId: event.budgetId,
        amountMinor: event.estimateMinor,
        currency: event.currency,
        stage: 'before_approval',
        evidence: [
          { label: 'Per head', value: `${event.currency} ${(value / 100).toFixed(2)}` },
          { label: 'Peer median', value: `${event.currency} ${(median / 100).toFixed(2)}` },
          { label: 'Peer group', value: String(perHead.length) },
        ],
        fact: {
          type: 'request',
          id: event.id,
          label: event.name,
          fields: {
            kind: 'unusual_cost_per_head',
            currency: event.currency,
            perHeadMinor: value,
            peerMedianMinor: median,
            peerGroupSize: perHead.length,
            attendees: event.expectedAttendance,
            amountMinor: event.estimateMinor,
          },
        },
        sources: [{ type: 'event', id: event.id, label: event.name }],
      });
    }
  }

  /** The same amount requested twice on the same budget within a week. */
  private async scanDuplicates(tx: Tx, actor: RequestActor, budgetIds: string[]): Promise<void> {
    const rows = await tx
      .select()
      .from(requests)
      .where(and(eq(requests.tenantId, actor.tenantId), inArray(requests.budgetId, budgetIds)))
      .orderBy(requests.ref, requests.id);
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const a = rows[i];
        const b = rows[j];
        if (a.amountMinor !== b.amountMinor || a.currency !== b.currency) continue;
        if (a.budgetId !== b.budgetId || a.requesterPersonId !== b.requesterPersonId) continue;
        const days = Math.round(Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) / DAY_MS);
        if (days > ANOMALY_THRESHOLDS.splitWindowDays) continue;
        await this.raise(tx, actor, {
          kind: 'possible_duplicate',
          subjectType: 'request',
          subjectId: b.id,
          subjectLabel: `${a.ref} and ${b.ref}`,
          budgetId: b.budgetId,
          amountMinor: b.amountMinor,
          currency: b.currency,
          stage: b.status === 'approved' ? 'after_approval' : 'before_approval',
          evidence: [
            { label: 'Requests', value: `${a.ref} and ${b.ref}` },
            { label: 'Amount', value: `${a.currency} ${(a.amountMinor / 100).toFixed(2)}` },
            { label: 'Days apart', value: String(days) },
          ],
          fact: {
            type: 'request',
            id: b.id,
            label: `${a.ref} and ${b.ref}`,
            fields: {
              kind: 'possible_duplicate',
              currency: b.currency,
              amountMinor: b.amountMinor,
              daysApart: days,
            },
          },
          sources: [
            { type: 'request', id: a.id, label: a.ref },
            { type: 'request', id: b.id, label: b.ref },
          ],
        });
      }
    }
  }

  list(
    actor: RequestActor,
    query: { status?: AnomalyFlag['status']; kind?: AnomalyKind },
  ): Promise<AnomalyFlagList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.listInTx(tx, actor, query),
    );
  }

  private async listInTx(
    tx: Tx,
    actor: RequestActor,
    query: { status?: AnomalyFlag['status']; kind?: AnomalyKind },
  ): Promise<AnomalyFlagList> {
    this.policy.assert(
      actor,
      'integrity.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'anomaly flags',
    );
    const statusMap: Record<string, AnomalyFlag['status']> = {
      open: 'open',
      dismissed: 'resolved',
      rejected: 'resolved',
      accepted: 'acknowledged',
    };
    const rows = await tx
      .select()
      .from(aiSuggestions)
      .where(
        and(eq(aiSuggestions.tenantId, actor.tenantId), eq(aiSuggestions.feature, 'anomaly_flags')),
      );
    const readable = new Set(
      (await tx.select().from(budgets).where(eq(budgets.tenantId, actor.tenantId)))
        .filter((b) => this.policy.can(actor, 'budget.read', budgetResource(b)).allowed)
        .map((b) => b.id),
    );
    const items = rows
      .filter((r) => !r.budgetId || readable.has(r.budgetId))
      .map((row) => this.toFlag(row, statusMap[row.status] ?? 'open'))
      .filter(
        (f) =>
          (!query.status || f.status === query.status) && (!query.kind || f.kind === query.kind),
      )
      .sort(
        (a, b) =>
          a.raisedAt.localeCompare(b.raisedAt) ||
          a.subjectLabel.localeCompare(b.subjectLabel) ||
          a.id.localeCompare(b.id),
      );
    return { items, pausedKinds: await this.evaluations.pausedKinds(tx, actor.tenantId) };
  }

  private toFlag(
    row: typeof aiSuggestions.$inferSelect,
    status: AnomalyFlag['status'],
  ): AnomalyFlag {
    const payload = row.payload as {
      kind: AnomalyKind;
      subjectType: AnomalyFlag['subjectType'];
      subjectLabel: string;
      stage: AnomalyFlag['stage'];
      amountMinor: number | null;
      currency: string;
      finding: string;
      evidence: { label: string; value: string }[];
      queryLogId: string;
    };
    return {
      id: row.id,
      kind: payload.kind,
      confidence: row.confidence as AnomalyFlag['confidence'],
      stage: payload.stage,
      subjectType: payload.subjectType,
      subjectId: row.subjectId,
      subjectLabel: payload.subjectLabel,
      budgetId: row.budgetId,
      budgetName: null,
      amount:
        payload.amountMinor === null
          ? null
          : { amountMinor: payload.amountMinor, currency: payload.currency },
      finding: payload.finding,
      evidence: payload.evidence ?? [],
      sources: (row.sources as AiSourceRef[]) ?? [],
      status,
      resolutionReasonCode: row.decisionReasonCode,
      resolutionReason: row.decisionReason,
      raisedAt: row.createdAt.toISOString().replace(/\.\d+Z$/, 'Z'),
      provenance: {
        suggestionId: row.id,
        queryLogId: payload.queryLogId,
        provider: row.provider,
        modelId: row.modelId,
        modelVersion: row.modelVersion,
        generatedAt: row.createdAt.toISOString().replace(/\.\d+Z$/, 'Z'),
        latencyMs: 0,
      },
    };
  }
}
