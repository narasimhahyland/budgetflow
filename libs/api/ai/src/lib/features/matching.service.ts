import { budgetResource } from '@bf/api/budgets';
import { DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  actuals,
  aiSuggestions,
  budgets,
  commitments,
  costCenters,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  AiMatchSuggestion,
  AiMatchSuggestionList,
  AiMatchSuggestionRunRequest,
  AiMatchSuggestionTarget,
  AiSourceRef,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AiGateway } from '../ai-gateway.service';
import type { Fact } from '../provider/ai-provider';
import { AiQueryLogService } from '../query-log.service';
import { AiRetrieval } from '../retrieval.service';
import { AiSettingsService } from '../settings.service';
import { AiSuggestionsService } from '../suggestions.service';

const RankOutput = z
  .object({
    ranking: z.array(z.string()).max(20),
    reasons: z.record(z.string(), z.array(z.string().max(200)).max(6)),
    confidence: z.record(z.string(), z.enum(['high', 'medium', 'low'])),
  })
  .strict();

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 080f: ranks candidate targets for spend lines the deterministic matching steps could not place.
 * It never matches anything. The suggestion carries the exact body a person submits to the normal
 * match endpoint, where `actuals.manage` is checked and the match writes its own journal and audit entry.
 */
@Injectable()
export class AiMatchingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly settings: AiSettingsService,
    private readonly retrieval: AiRetrieval,
    private readonly gateway: AiGateway,
    private readonly suggestions: AiSuggestionsService,
    private readonly log: AiQueryLogService,
  ) {}

  run(actor: RequestActor, req: AiMatchSuggestionRunRequest): Promise<AiMatchSuggestionList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      await this.settings.assertEnabled(tx, actor.tenantId, 'matching');
      this.policy.assert(
        actor,
        'actuals.read',
        { kind: 'tenant', tenantId: actor.tenantId },
        'spend lines',
      );
      const unmatched = await tx
        .select()
        .from(actuals)
        .where(
          and(
            eq(actuals.tenantId, actor.tenantId),
            eq(actuals.matchStatus, 'unmatched'),
            req.actualIds?.length ? inArray(actuals.id, [...req.actualIds]) : undefined,
          ),
        )
        .orderBy(actuals.transactionDate, actuals.id);
      const scoped = await this.retrieval.budgetFacts(tx, actor, { limit: 25 });
      const visibleBudgets = new Map(scoped.rows.map((b) => [b.id, b]));
      const open = visibleBudgets.size
        ? await tx
            .select()
            .from(commitments)
            .where(
              and(
                eq(commitments.tenantId, actor.tenantId),
                inArray(commitments.budgetId, [...visibleBudgets.keys()]),
                inArray(commitments.status, ['pre_encumbered', 'encumbered', 'partially_consumed']),
              ),
            )
            .orderBy(commitments.description, commitments.id)
        : [];
      const centres = new Map(
        (
          await tx
            .select({ id: costCenters.id, code: costCenters.code })
            .from(costCenters)
            .where(eq(costCenters.tenantId, actor.tenantId))
        ).map((c) => [c.id, c.code]),
      );
      const budgetRows = new Map(
        (await tx.select().from(budgets).where(eq(budgets.tenantId, actor.tenantId)))
          .filter((b) => this.policy.can(actor, 'budget.read', budgetResource(b)).allowed)
          .map((b) => [b.id, b]),
      );

      for (const line of unmatched.slice(0, 50)) {
        const candidates = open
          .filter((c) => c.currency === (line.budgetCurrency ?? line.transactionCurrency))
          .slice(0, 8);
        const candidateBudgets = [...budgetRows.values()]
          .filter((b) => b.costCenterId && b.costCenterId === line.costCenterId)
          .slice(0, 3);
        if (!candidates.length && !candidateBudgets.length) continue;
        const budgetAmountMinor = line.budgetAmountMinor ?? line.transactionAmountMinor;
        const lineFact: Fact = {
          type: 'actual',
          id: line.id,
          label: line.merchant ?? line.sourceRef,
          fields: {
            merchant: line.merchant,
            memo: line.memo,
            postedDate: line.transactionDate,
            amountMinor: line.transactionAmountMinor,
            budgetAmountMinor,
            currency: line.transactionCurrency,
            eventCode: line.eventCode,
            costCenterCode: line.costCenterId ? (centres.get(line.costCenterId) ?? null) : null,
            source: line.source,
          },
        };
        const candidateFacts: Fact[] = [
          ...candidates.map((c) => ({
            type: 'commitment',
            id: c.id,
            label: c.description,
            fields: {
              currency: c.currency,
              totalMinor: c.amountMinor,
              remainingMinor: c.amountMinor - c.consumedMinor - c.releasedMinor,
              amountDifferenceMinor: Math.abs(
                c.amountMinor - c.consumedMinor - c.releasedMinor - budgetAmountMinor,
              ),
              daysApart: daysApart(line.transactionDate, c.serviceStart),
              costCenterCode: c.costCenterId ? (centres.get(c.costCenterId) ?? null) : null,
              eventCode: null,
            },
          })),
          ...candidateBudgets.map((b) => ({
            type: 'budget',
            id: b.id,
            label: b.name,
            fields: {
              currency: b.currency,
              costCenterCode: b.costCenterId ? (centres.get(b.costCenterId) ?? null) : null,
              amountDifferenceMinor: 0,
              daysApart: 0,
            },
          })),
        ];
        const sources: AiSourceRef[] = [
          { type: 'actual', id: line.id, label: line.merchant ?? line.sourceRef },
          ...candidates.map((c) => ({
            type: 'commitment' as const,
            id: c.id,
            label: c.description,
          })),
          ...candidateBudgets.map((b) => ({ type: 'budget' as const, id: b.id, label: b.name })),
        ];
        const result = await this.gateway.run({
          tx,
          actor,
          feature: 'matching',
          channel: 'system',
          task: 'match_rank',
          facts: [lineFact, ...candidateFacts],
          sources,
          scope: {
            action: 'actuals.read',
            scope: this.retrieval.scopeKind(actor, 'actuals.read'),
            consideredCount: candidateFacts.length,
            permittedCount: candidateFacts.length,
          },
          schema: RankOutput,
          successOutcome: 'suggested',
          narrative: (out) => Object.values(out.reasons).flat(),
        });
        if (!result.output?.ranking.length) continue;
        const ranked = result.output.ranking
          .map((id) => candidateFacts.find((f) => f.id === id))
          .filter((f): f is Fact => Boolean(f));
        if (!ranked.length) continue;
        const targets = ranked.map<AiMatchSuggestionTarget>((fact) => {
          const commitment = candidates.find((c) => c.id === fact.id);
          const budget = commitment
            ? budgetRows.get(commitment.budgetId)
            : candidateBudgets.find((b) => b.id === fact.id);
          return {
            targetType: commitment ? 'commitment' : 'budget',
            targetId: fact.id,
            targetLabel: fact.label,
            budgetId: budget?.id ?? '',
            budgetName: budget?.name ?? '',
            confidence: result.output?.confidence[fact.id] ?? 'low',
            reasons: result.output?.reasons[fact.id] ?? [],
          };
        });
        const best = targets[0];
        await this.suggestions.upsert(tx, {
          tenantId: actor.tenantId,
          feature: 'matching',
          subjectType: 'actual',
          subjectId: line.id,
          budgetId: best.budgetId || null,
          confidence: best.confidence,
          payload: {
            suggested: best,
            candidates: targets.slice(1),
            source: line.source,
            merchant: line.merchant,
            memo: line.memo,
            postedDate: line.transactionDate,
            transactionAmountMinor: line.transactionAmountMinor,
            transactionCurrency: line.transactionCurrency,
            budgetAmountMinor,
            budgetCurrency: line.budgetCurrency ?? line.transactionCurrency,
            queryLogId: result.queryLogId,
            latencyMs: result.provenance.latencyMs,
          },
          sources,
          createdByPersonId: actor.personId,
          provider: this.gateway.providerId,
          modelId: this.gateway.modelId,
          modelVersion: this.gateway.modelVersion,
        });
      }
      return this.listInTx(tx, actor, {});
    });
  }

  list(
    actor: RequestActor,
    query: { status?: AiMatchSuggestion['status'] },
  ): Promise<AiMatchSuggestionList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.listInTx(tx, actor, query),
    );
  }

  private async listInTx(
    tx: Tx,
    actor: RequestActor,
    query: { status?: AiMatchSuggestion['status'] },
  ): Promise<AiMatchSuggestionList> {
    this.policy.assert(
      actor,
      'actuals.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'spend lines',
    );
    const rows = await tx
      .select({ suggestion: aiSuggestions, actual: actuals })
      .from(aiSuggestions)
      .innerJoin(actuals, eq(actuals.id, aiSuggestions.subjectId))
      .where(
        and(
          eq(aiSuggestions.tenantId, actor.tenantId),
          eq(aiSuggestions.feature, 'matching'),
          eq(aiSuggestions.status, query.status ?? 'open'),
        ),
      );
    // A suggestion that points at a budget the reviewer cannot read is not shown to them.
    const readable = new Set(
      (await this.retrieval.budgetFacts(tx, actor, { limit: 25 })).rows.map((b) => b.id),
    );
    const visible = rows.filter(
      (r) => !r.suggestion.budgetId || readable.has(r.suggestion.budgetId),
    );
    const counts = await this.log.acceptanceCounts(tx, actor.tenantId, 'matching');
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return {
      items: visible
        .map((r) => this.toSuggestion(r.suggestion, r.actual))
        .sort(
          (a, b) =>
            rank[a.suggested.confidence] - rank[b.suggested.confidence] ||
            (a.merchant ?? '').localeCompare(b.merchant ?? '') ||
            a.id.localeCompare(b.id),
        ),
      acceptedLast30Days: counts.accepted,
      shownLast30Days: counts.shown,
    };
  }

  private toSuggestion(
    row: typeof aiSuggestions.$inferSelect,
    line: typeof actuals.$inferSelect,
  ): AiMatchSuggestion {
    const payload = row.payload as {
      suggested: AiMatchSuggestionTarget;
      candidates: AiMatchSuggestionTarget[];
      budgetAmountMinor: number;
      budgetCurrency: string;
      queryLogId: string;
      latencyMs: number;
    };
    const suggested = payload.suggested;
    return {
      id: row.id,
      actualId: line.id,
      source: line.source,
      merchant: line.merchant,
      memo: line.memo,
      postedDate: line.transactionDate,
      transactionAmount: {
        amountMinor: line.transactionAmountMinor,
        currency: line.transactionCurrency,
      },
      budgetAmount: {
        amountMinor: payload.budgetAmountMinor,
        currency: payload.budgetCurrency,
      },
      suggested,
      candidates: payload.candidates ?? [],
      status: row.status as AiMatchSuggestion['status'],
      decisionReason: row.decisionReason,
      applyWith: {
        endpoint: 'matchActual',
        actualId: line.id,
        parts: [
          suggested.targetType === 'commitment'
            ? {
                commitmentId: suggested.targetId,
                budgetId: null,
                amountMinor: payload.budgetAmountMinor,
              }
            : {
                commitmentId: null,
                budgetId: suggested.targetId,
                amountMinor: payload.budgetAmountMinor,
              },
        ],
      },
      sources: (row.sources as AiSourceRef[]) ?? [],
      provenance: {
        suggestionId: row.id,
        queryLogId: payload.queryLogId,
        provider: row.provider,
        modelId: row.modelId,
        modelVersion: row.modelVersion,
        generatedAt: row.createdAt.toISOString().replace(/\.\d+Z$/, 'Z'),
        latencyMs: payload.latencyMs ?? 0,
      },
    };
  }
}

function daysApart(a: string, b: string | null): number {
  if (!b) return 0;
  return Math.round(
    Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / DAY_MS,
  );
}
