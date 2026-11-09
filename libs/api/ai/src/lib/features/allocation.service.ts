import { budgetResource, BudgetViews } from '@bf/api/budgets';
import { ApiProblem, DB, PolicyService, type RequestActor, todayUtc } from '@bf/api/core';
import { budgets, people, withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  AiSourceRef,
  AllocationSuggestion,
  AllocationSuggestionLine,
  AllocationSuggestionRequest,
  AllocationWeights,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AiGateway } from '../ai-gateway.service';
import type { Fact } from '../provider/ai-provider';
import { AiRetrieval } from '../retrieval.service';
import { AiSettingsService } from '../settings.service';
import { ROUNDING_MINOR, splitAmount } from '../allocation-math';
import { AiSuggestionsService } from '../suggestions.service';

const WeightsOutput = z
  .object({
    headcountPct: z.int().min(0).max(100),
    priorUsePct: z.int().min(0).max(100),
    participationPct: z.int().min(0).max(100),
    reason: z.string().max(400),
    lineReasons: z.record(z.string(), z.string().max(400)),
  })
  .strict()
  .refine((w) => w.headcountPct + w.priorUsePct + w.participationPct === 100, {
    message: 'Weights must total 100.',
  });

/**
 * 022d: a reproducible split. The model proposes the weights and writes the reasons; the amounts are
 * computed here from headcount and prior use, never by the model. Nothing is saved: the owner edits
 * the draft and submits it through the allocation commands, with their own checks and audit entry.
 */
@Injectable()
export class AiAllocationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly settings: AiSettingsService,
    private readonly retrieval: AiRetrieval,
    private readonly views: BudgetViews,
    private readonly gateway: AiGateway,
    private readonly suggestions: AiSuggestionsService,
  ) {}

  suggest(actor: RequestActor, req: AllocationSuggestionRequest): Promise<AllocationSuggestion> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.suggestInTx(tx, actor, req),
    );
  }

  private async suggestInTx(
    tx: Tx,
    actor: RequestActor,
    req: AllocationSuggestionRequest,
  ): Promise<AllocationSuggestion> {
    await this.settings.assertEnabled(tx, actor.tenantId, 'allocation_suggestions');
    const parentRow = await this.views.row(tx, req.parentBudgetId);
    this.policy.assert(actor, 'budget.allocate', budgetResource(parentRow), 'budget');
    const parent = await this.views.detail(tx, actor, parentRow);
    const amount = req.amount ?? parent.balances.allocationAvailable;
    if (amount.currency !== parent.currency)
      throw new ApiProblem(422, 'CURRENCY_MISMATCH', 'Split the amount in the parent currency.');
    if (amount.amountMinor <= 0)
      throw new ApiProblem(422, 'AMOUNT_NOT_POSITIVE', 'There is nothing left to allocate.');
    if (amount.amountMinor > parent.balances.allocationAvailable.amountMinor)
      throw new ApiProblem(
        422,
        'INSUFFICIENT_AVAILABLE',
        `That is more than ${parent.name} has available under its own rules.`,
      );

    const childRows = (
      await tx
        .select()
        .from(budgets)
        .where(and(eq(budgets.tenantId, actor.tenantId), eq(budgets.parentId, parent.id)))
        .orderBy(budgets.name, budgets.id)
    ).filter((c) => this.policy.can(actor, 'budget.read', budgetResource(c)).allowed);
    const requested = req.childBudgetIds?.length ? new Set(req.childBudgetIds) : null;
    const considered = childRows.filter((c) => !requested || requested.has(c.id));
    const excluded = considered
      .filter((c) => c.allocationDriver === 'per_head')
      .map((c) => ({
        budgetId: c.id,
        budgetName: c.name,
        reason: 'Driven by headcount (22a), so its amount follows the driver.',
      }));
    const included = considered.filter((c) => c.allocationDriver !== 'per_head');
    if (included.length === 0)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'There are no child budgets to split between that you can see.',
      );

    const details = await this.views.details(tx, actor, included);
    const headcounts = await this.headcounts(
      tx,
      actor.tenantId,
      included.map((c) => c.orgUnitId).filter((id): id is string => Boolean(id)),
    );
    const priorUse = await this.priorUse(
      tx,
      actor.tenantId,
      included.map((c) => c.code),
    );

    const facts: Fact[] = details.map((d) => {
      const row = included.find((c) => c.id === d.id)!;
      const prior = (row.code && priorUse.get(row.code)) || null;
      const priorUseBps = prior
        ? prior.authorizedMinor > 0
          ? Math.round((prior.consumedMinor / prior.authorizedMinor) * 10_000)
          : 0
        : d.utilizationBps;
      return {
        type: 'budget',
        id: d.id,
        label: row.name,
        fields: {
          status: d.status,
          currency: d.currency,
          eligibleHeadcount: (row.orgUnitId && headcounts.get(row.orgUnitId)) || 0,
          priorAuthorizedMinor: prior?.authorizedMinor ?? 0,
          priorConsumedMinor: prior?.consumedMinor ?? 0,
          priorUseBps,
          participationBps: 0,
          currentAllocationMinor: d.balances.budgetCurrency.authorized.amountMinor,
          amountToSplitMinor: amount.amountMinor,
          driver: row.allocationDriver,
        },
      };
    });
    const sources: AiSourceRef[] = [
      { type: 'budget', id: parent.id, label: parent.name },
      ...details.map((d) => ({
        type: 'budget' as const,
        id: d.id,
        label: included.find((c) => c.id === d.id)!.name,
      })),
    ];

    const result = await this.gateway.run({
      tx,
      actor,
      feature: 'allocation_suggestions',
      channel: 'web',
      task: 'allocation_weights',
      facts,
      sources,
      scope: {
        action: 'budget.allocate',
        scope: this.retrieval.scopeKind(actor, 'budget.allocate'),
        consideredCount: considered.length,
        permittedCount: included.length,
      },
      schema: WeightsOutput,
      successOutcome: 'suggested',
      narrative: (out) => [out.reason, ...Object.values(out.lineReasons)],
    });
    const weights: AllocationWeights = result.output
      ? {
          headcountPct: result.output.headcountPct,
          priorUsePct: result.output.priorUsePct,
          participationPct: result.output.participationPct,
        }
      : (req.weights ?? { headcountPct: 100, priorUsePct: 0, participationPct: 0 });
    const chosen = req.weights ?? weights;

    const lines = splitAmount(amount.amountMinor, facts, chosen).map<AllocationSuggestionLine>(
      (line) => {
        const detail = details.find((d) => d.id === line.budgetId)!;
        const fact = facts.find((f) => f.id === line.budgetId)!;
        const current = detail.balances.budgetCurrency.authorized.amountMinor;
        return {
          budgetId: line.budgetId,
          budgetName: fact.label,
          eligibleHeadcount: Number(fact.fields['eligibleHeadcount'] ?? 0),
          priorUseBps: Number(fact.fields['priorUseBps'] ?? 0),
          participationBps: null,
          currentAllocation: { amountMinor: current, currency: amount.currency },
          suggested: { amountMinor: line.amountMinor, currency: amount.currency },
          change: { amountMinor: line.amountMinor - current, currency: amount.currency },
          why:
            result.output?.lineReasons[line.budgetId] ??
            `${fact.label} is weighted on eligible headcount and prior use.`,
        };
      },
    );
    lines.sort(
      (a, b) => a.budgetName.localeCompare(b.budgetName) || a.budgetId.localeCompare(b.budgetId),
    );
    const total = lines.reduce((sum, l) => sum + l.suggested.amountMinor, 0);
    const suggestion = await this.suggestions.upsert(tx, {
      tenantId: actor.tenantId,
      feature: 'allocation_suggestions',
      subjectType: 'budget',
      subjectId: parent.id,
      budgetId: parent.id,
      confidence: result.output ? 'high' : 'low',
      payload: {
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        weights: chosen,
        lines,
      },
      sources,
      createdByPersonId: actor.personId,
      provider: this.gateway.providerId,
      modelId: this.gateway.modelId,
      modelVersion: this.gateway.modelVersion,
    });

    return {
      parentBudgetId: parent.id,
      amount,
      weights: chosen,
      weightsReason: result.output?.reason ?? null,
      roundingMinor: ROUNDING_MINOR,
      lines,
      excluded,
      total: { amountMinor: total, currency: amount.currency },
      sources,
      confidence: result.output ? 'high' : 'low',
      notes: [
        `Rounded to ${(ROUNDING_MINOR / 100).toFixed(2)} ${amount.currency}; the remainder goes to the largest line.`,
        'Nothing is saved until you submit the split through the allocation commands.',
      ],
      provenance: { ...result.provenance, suggestionId: suggestion.id },
    };
  }

  private async headcounts(
    tx: Tx,
    tenantId: string,
    orgUnitIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (!orgUnitIds.length) return new Map();
    const rows = await tx
      .select({ unit: people.locationOrgUnitId, n: sql<string>`count(*)::text` })
      .from(people)
      .where(
        and(
          eq(people.tenantId, tenantId),
          eq(people.employmentType, 'employee'),
          or(isNull(people.endDate), gte(people.endDate, todayUtc())),
        ),
      )
      .groupBy(people.locationOrgUnitId);
    return new Map(
      rows
        .filter((r): r is { unit: string; n: string } => Boolean(r.unit))
        .map((r) => [r.unit, Number(r.n)]),
    );
  }

  /** The same budget code in an earlier fiscal year: how much of last year's budget was used. */
  private async priorUse(
    tx: Tx,
    tenantId: string,
    codes: readonly (string | null)[],
  ): Promise<Map<string, { authorizedMinor: number; consumedMinor: number }>> {
    const wanted = codes.filter((c): c is string => Boolean(c));
    if (!wanted.length) return new Map();
    const res = await tx.execute<{ code: string; authorized: string; consumed: string }>(sql`
      select b.code,
             coalesce(sum(l.budget_amount_minor) filter (where l.account = 'authorized'), 0)::text as authorized,
             coalesce(sum(l.budget_amount_minor) filter (where l.account in ('encumbered', 'actual')), 0)::text as consumed
      from budgets b
      join fiscal_years fy on fy.id = b.fiscal_year_id
      left join ledger_lines l on l.budget_id = b.id
      where b.tenant_id = ${tenantId}
        and b.code in (${sql.join(
          wanted.map((c) => sql`${c}`),
          sql`, `,
        )})
        and fy.end_date < current_date
      group by b.code, fy.end_date
      order by fy.end_date desc`);
    const out = new Map<string, { authorizedMinor: number; consumedMinor: number }>();
    for (const row of res.rows)
      if (!out.has(row.code))
        out.set(row.code, {
          authorizedMinor: Number(row.authorized),
          consumedMinor: Number(row.consumed),
        });
    return out;
  }
}
