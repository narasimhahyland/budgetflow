import { BudgetViews } from '@bf/api/budgets';
import { ApiProblem, DB, type RequestActor } from '@bf/api/core';
import { aiOutlookSnapshots, budgets, fiscalYears, withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  AiSourceRef,
  BudgetDetail,
  BudgetOutlook,
  Money,
  OutlookList,
  OutlookRunRequest,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AiGateway } from '../ai-gateway.service';
import type { Fact } from '../provider/ai-provider';
import { AiRetrieval } from '../retrieval.service';
import { AiSettingsService } from '../settings.service';
import { AiSuggestionsService } from '../suggestions.service';

const DriversOutput = z
  .object({
    drivers: z
      .array(z.object({ label: z.string().max(60), detail: z.string().max(300) }).strict())
      .max(6),
    confidence: z.enum(['high', 'medium', 'low']),
  })
  .strict();

/** An outlook needs at least this much of the year behind it; below that no figure is shown (016b). */
const MIN_MONTHS_OBSERVED = 3;
/** Width of the range around the most likely value, in basis points. */
const RANGE_BPS = 800;

/**
 * 016b: where a budget is heading, from run rate, open commitments and the request pipeline. The
 * numbers come from the ledger read models and a fixed statistical rule, so the same data always
 * gives the same range; the model only writes the driver sentences. Nothing is reduced or released.
 */
@Injectable()
export class AiOutlookService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: AiSettingsService,
    private readonly retrieval: AiRetrieval,
    private readonly views: BudgetViews,
    private readonly gateway: AiGateway,
    private readonly suggestions: AiSuggestionsService,
  ) {}

  run(actor: RequestActor, req: OutlookRunRequest): Promise<OutlookList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      await this.settings.assertEnabled(tx, actor.tenantId, 'outlook');
      const asOfDate = req.asOfDate ?? new Date().toISOString().slice(0, 10);
      const scoped = await this.retrieval.budgetFacts(tx, actor, {
        ids: req.budgetIds,
        limit: 25,
      });
      const settings = await this.settings.settings(tx, actor.tenantId);
      const years = await this.fiscalYears(tx, scoped.rows);
      for (const detail of scoped.rows) {
        const year = years.get(detail.fiscalYearId);
        if (!year) continue;
        const computed = computeOutlook(detail, year, asOfDate, {
          minimumMinor: settings.nudgeMinimumAmount.amountMinor,
          minimumPct: settings.nudgeMinimumPct,
        });
        const fact: Fact = {
          type: 'budget',
          id: detail.id,
          label: detail.name,
          fields: {
            status: detail.status,
            currency: detail.currency,
            authorizedMinor: computed.authorizedMinor,
            actualMinor: computed.actualMinor,
            encumberedMinor: computed.openCommitmentsMinor,
            toDateMinor: computed.toDateMinor,
            likelyMinor: computed.likelyMinor ?? 0,
            lowMinor: computed.lowMinor ?? 0,
            highMinor: computed.highMinor ?? 0,
            monthsObserved: computed.monthsObserved,
            monthlyRunRateMinor: computed.monthlyRunRateMinor,
            openCommitmentsMinor: computed.openCommitmentsMinor,
            pendingRequestsMinor: computed.pendingRequestsMinor,
            monthsRemaining: computed.monthsRemaining,
            ownerName: detail.display.ownerName,
          },
        };
        const sources: AiSourceRef[] = [{ type: 'budget', id: detail.id, label: detail.name }];
        const result =
          computed.category === 'no_history'
            ? null
            : await this.gateway.run({
                tx,
                actor,
                feature: 'outlook',
                channel: 'system',
                task: 'outlook_drivers',
                facts: [fact],
                sources,
                scope: scoped.scope,
                schema: DriversOutput,
                successOutcome: 'suggested',
                narrative: (out) => out.drivers.map((d) => d.detail),
              });
        const nudgeWorthy =
          computed.category !== 'on_track' &&
          computed.category !== 'no_history' &&
          result?.output !== null &&
          !['frozen', 'set_to_zero'].includes(detail.status);
        const suggestion = nudgeWorthy
          ? await this.suggestions.upsert(tx, {
              tenantId: actor.tenantId,
              feature: 'outlook',
              subjectType: 'budget',
              subjectId: detail.id,
              budgetId: detail.id,
              confidence: result?.output?.confidence ?? 'low',
              payload: {
                category: computed.category,
                gapMinor: computed.gapMinor,
                currency: detail.currency,
                actions:
                  computed.category === 'likely_unused'
                    ? ['Plan an event', 'Release to the parent budget']
                    : ['Request an increase', 'Review phasing', 'Review open commitments'],
              },
              sources,
              createdByPersonId: actor.personId,
              provider: this.gateway.providerId,
              modelId: this.gateway.modelId,
              modelVersion: this.gateway.modelVersion,
            })
          : null;
        await tx
          .insert(aiOutlookSnapshots)
          .values({
            tenantId: actor.tenantId,
            budgetId: detail.id,
            asOfDate,
            currency: detail.currency,
            authorizedMinor: computed.authorizedMinor,
            toDateMinor: computed.toDateMinor,
            likelyMinor: computed.likelyMinor,
            lowMinor: computed.lowMinor,
            highMinor: computed.highMinor,
            gapMinor: computed.gapMinor,
            category: computed.category,
            confidence: result?.output?.confidence ?? null,
            drivers: (result?.output?.drivers ?? []) as unknown as object,
            sources: sources as unknown as object,
            modelId: this.gateway.modelId,
            modelVersion: this.gateway.modelVersion,
            suggestionId: suggestion?.id ?? null,
            nudgeSentAt: suggestion ? new Date() : null,
          })
          .onConflictDoUpdate({
            target: [
              aiOutlookSnapshots.tenantId,
              aiOutlookSnapshots.budgetId,
              aiOutlookSnapshots.asOfDate,
            ],
            set: {
              likelyMinor: computed.likelyMinor,
              lowMinor: computed.lowMinor,
              highMinor: computed.highMinor,
              gapMinor: computed.gapMinor,
              category: computed.category,
              confidence: result?.output?.confidence ?? null,
              drivers: (result?.output?.drivers ?? []) as unknown as object,
              suggestionId: suggestion?.id ?? null,
            },
          });
      }
      return this.listInTx(tx, actor, {});
    });
  }

  list(
    actor: RequestActor,
    query: { category?: BudgetOutlook['category']; ownedOnly?: boolean },
  ): Promise<OutlookList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.listInTx(tx, actor, query),
    );
  }

  private async listInTx(
    tx: Tx,
    actor: RequestActor,
    query: { category?: BudgetOutlook['category']; ownedOnly?: boolean },
  ): Promise<OutlookList> {
    const scoped = await this.retrieval.budgetFacts(tx, actor, { limit: 25 });
    const visible = new Set(scoped.rows.map((b) => b.id));
    const rows = visible.size
      ? await tx
          .select({ snapshot: aiOutlookSnapshots, budget: budgets })
          .from(aiOutlookSnapshots)
          .innerJoin(budgets, eq(budgets.id, aiOutlookSnapshots.budgetId))
          .where(
            and(
              eq(aiOutlookSnapshots.tenantId, actor.tenantId),
              inArray(aiOutlookSnapshots.budgetId, [...visible]),
              query.category ? eq(aiOutlookSnapshots.category, query.category) : undefined,
            ),
          )
          .orderBy(desc(aiOutlookSnapshots.asOfDate), budgets.name, budgets.id)
      : [];
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) if (!latest.has(row.budget.id)) latest.set(row.budget.id, row);
    const owned = (budgetId: string) =>
      actor.ownedBudgetPaths.some((p) =>
        rows.find((r) => r.budget.id === budgetId)?.budget.path.startsWith(p),
      );
    const items = [...latest.values()]
      .filter((r) => !query.ownedOnly || owned(r.budget.id))
      .map((r) =>
        this.toOutlook(
          r.snapshot,
          r.budget.name,
          scoped.rows.find((b) => b.id === r.budget.id),
        ),
      )
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category) ||
          a.budgetName.localeCompare(b.budgetName) ||
          a.budgetId.localeCompare(b.budgetId),
      );
    const currency = actor.reportingCurrency;
    const sum = (category: BudgetOutlook['category']) =>
      items
        .filter((i) => i.category === category)
        .reduce((total, i) => total + Math.abs(i.gap?.amountMinor ?? 0), 0);
    return {
      asOfDate: items[0]?.asOfDate ?? new Date().toISOString().slice(0, 10),
      summary: {
        likelyOverspend: items.filter((i) => i.category === 'likely_overspend').length,
        likelyUnused: items.filter((i) => i.category === 'likely_unused').length,
        onTrack: items.filter((i) => i.category === 'on_track').length,
        noHistory: items.filter((i) => i.category === 'no_history').length,
        overspendTotal: { amountMinor: sum('likely_overspend'), currency },
        unusedTotal: { amountMinor: sum('likely_unused'), currency },
      },
      items,
    };
  }

  async forBudget(actor: RequestActor, budgetId: string): Promise<BudgetOutlook> {
    const list = await this.list(actor, {});
    const found = list.items.find((i) => i.budgetId === budgetId);
    if (!found) throw ApiProblem.notFound('outlook');
    return found;
  }

  private toOutlook(
    row: typeof aiOutlookSnapshots.$inferSelect,
    budgetName: string,
    detail: BudgetDetail | undefined,
  ): BudgetOutlook {
    const currency = row.currency;
    const money = (minor: number | null): Money | null =>
      minor === null ? null : { amountMinor: minor, currency };
    const payload = (row.drivers as { label: string; detail: string }[]) ?? [];
    return {
      id: row.id,
      budgetId: row.budgetId,
      budgetName,
      ownerName: detail?.display.ownerName ?? null,
      asOfDate: row.asOfDate,
      currency,
      authorized: { amountMinor: row.authorizedMinor, currency },
      toDate: { amountMinor: row.toDateMinor, currency },
      likely: money(row.likelyMinor),
      low: money(row.lowMinor),
      high: money(row.highMinor),
      gap: money(row.gapMinor),
      category: row.category as BudgetOutlook['category'],
      confidence: (row.confidence as BudgetOutlook['confidence']) ?? null,
      drivers: payload,
      sources: (row.sources as AiSourceRef[]) ?? [],
      nudge: row.suggestionId
        ? {
            message:
              row.category === 'likely_unused'
                ? `${budgetName} may not use all of its budget this year.`
                : `${budgetName} may exceed its budget this year.`,
            suggestionId: row.suggestionId,
            actions:
              row.category === 'likely_unused'
                ? [
                    { label: 'Plan an event', resourceType: 'event', resourceId: null },
                    {
                      label: 'Release to the parent budget',
                      resourceType: 'budget-reduce',
                      resourceId: row.budgetId,
                    },
                  ]
                : [
                    {
                      label: 'Request an increase',
                      resourceType: 'budget-revise',
                      resourceId: row.budgetId,
                    },
                    {
                      label: 'Review phasing',
                      resourceType: 'budget-phasing',
                      resourceId: row.budgetId,
                    },
                  ],
            sentAt: row.nudgeSentAt ? row.nudgeSentAt.toISOString().replace(/\.\d+Z$/, 'Z') : null,
            snoozedUntil: row.snoozedUntil,
          }
        : null,
      modelId: row.modelId,
      modelVersion: row.modelVersion,
    };
  }

  private async fiscalYears(
    tx: Tx,
    details: readonly BudgetDetail[],
  ): Promise<Map<string, { startDate: string; endDate: string }>> {
    const ids = [...new Set(details.map((d) => d.fiscalYearId))];
    if (!ids.length) return new Map();
    const rows = await tx
      .select({
        id: fiscalYears.id,
        startDate: fiscalYears.startDate,
        endDate: fiscalYears.endDate,
      })
      .from(fiscalYears)
      .where(inArray(fiscalYears.id, ids));
    return new Map(rows.map((r) => [r.id, { startDate: r.startDate, endDate: r.endDate }]));
  }
}

export interface ComputedOutlook {
  authorizedMinor: number;
  actualMinor: number;
  openCommitmentsMinor: number;
  pendingRequestsMinor: number;
  toDateMinor: number;
  monthsObserved: number;
  monthsRemaining: number;
  monthlyRunRateMinor: number;
  likelyMinor: number | null;
  lowMinor: number | null;
  highMinor: number | null;
  gapMinor: number | null;
  category: BudgetOutlook['category'];
}

const material = (
  gapMinor: number,
  authorizedMinor: number,
  thresholds: { minimumMinor: number; minimumPct: number },
): boolean =>
  Math.abs(gapMinor) >= thresholds.minimumMinor &&
  Math.abs(gapMinor) >= Math.round((authorizedMinor * thresholds.minimumPct) / 100);

const monthsBetween = (from: string, to: string): number => {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
};

/**
 * The statistical part of the outlook, kept pure and deterministic: run rate over the months of the
 * fiscal year already behind us, plus what is already committed and in the request pipeline.
 */
export function computeOutlook(
  detail: BudgetDetail,
  year: { startDate: string; endDate: string },
  asOfDate: string,
  /** A gap smaller than both of these is "on track": too small to be worth an owner's attention (016b). */
  thresholds: { minimumMinor: number; minimumPct: number },
): ComputedOutlook {
  const b = detail.balances.budgetCurrency;
  const authorizedMinor = b.authorized.amountMinor;
  const actualMinor = b.actual.amountMinor;
  const openCommitmentsMinor = b.encumbered.amountMinor;
  const pendingRequestsMinor = b.preEncumbered.amountMinor;
  const toDateMinor = actualMinor + openCommitmentsMinor;
  const monthsObserved = Math.max(0, Math.min(12, monthsBetween(year.startDate, asOfDate)));
  const monthsRemaining = Math.max(0, Math.min(12, monthsBetween(asOfDate, year.endDate)));
  const base = {
    authorizedMinor,
    actualMinor,
    openCommitmentsMinor,
    pendingRequestsMinor,
    toDateMinor,
    monthsObserved,
    monthsRemaining,
  };
  if (monthsObserved < MIN_MONTHS_OBSERVED || actualMinor <= 0)
    return {
      ...base,
      monthlyRunRateMinor: 0,
      likelyMinor: null,
      lowMinor: null,
      highMinor: null,
      gapMinor: null,
      category: 'no_history',
    };
  const monthlyRunRateMinor = Math.round(actualMinor / monthsObserved);
  const likelyMinor =
    actualMinor +
    openCommitmentsMinor +
    pendingRequestsMinor +
    monthlyRunRateMinor * monthsRemaining;
  const band = Math.round((likelyMinor * RANGE_BPS) / 10_000);
  const gapMinor = authorizedMinor - likelyMinor;
  return {
    ...base,
    monthlyRunRateMinor,
    likelyMinor,
    lowMinor: likelyMinor - band,
    highMinor: likelyMinor + band,
    gapMinor,
    category: material(gapMinor, authorizedMinor, thresholds)
      ? gapMinor < 0
        ? 'likely_overspend'
        : 'likely_unused'
      : 'on_track',
  };
}
