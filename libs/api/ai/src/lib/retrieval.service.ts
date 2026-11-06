import { budgetResource, BudgetViews, type BudgetRow } from '@bf/api/budgets';
import { PolicyService, type RequestActor } from '@bf/api/core';
import { budgets, events, people, requests, type Tx } from '@bf/api/db';
import type { AiSourceRef, BudgetDetail } from '@bf/contracts';
import type { Action } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Fact } from './provider/ai-provider';
import type { ScopeKind, ScopeSummary } from './query-log.service';

export interface ScopedFacts<T> {
  rows: T[];
  facts: Fact[];
  sources: AiSourceRef[];
  scope: ScopeSummary;
}

const empty = <T>(action: Action, scope: ScopeKind): ScopedFacts<T> => ({
  rows: [],
  facts: [],
  sources: [],
  scope: { action, scope, consideredCount: 0, permittedCount: 0 },
});

/**
 * The only way the AI layer reads tenant data. Every candidate row goes through `PolicyService.can`
 * for the asking user before it becomes a fact, on top of the tenant RLS the transaction already
 * applies. A record the asker could not open in the UI is never retrieved, never sent to the model
 * and never cited, and the scope that was applied is recorded on the query-log row.
 */
@Injectable()
export class AiRetrieval {
  constructor(
    private readonly policy: PolicyService,
    private readonly views: BudgetViews,
  ) {}

  /** The widest scope the actor holds for an action, for the query log (not an authorization decision). */
  scopeKind(actor: RequestActor, action: Action): ScopeKind {
    if (this.policy.can(actor, action, { kind: 'tenant', tenantId: actor.tenantId }).allowed)
      return 'tenant';
    if (actor.ownedBudgetPaths.length > 0) return 'owned';
    if (actor.personId) return 'self';
    return 'none';
  }

  /**
   * Every budget id the actor may read. Visibility filters use this rather than `budgetFacts`, whose
   * limit is about how much a model is given, not about what a person is allowed to see.
   */
  async readableBudgetIds(tx: Tx, actor: RequestActor): Promise<Set<string>> {
    const rows = await tx.select().from(budgets).where(eq(budgets.tenantId, actor.tenantId));
    return new Set(
      rows
        .filter((row) => this.policy.can(actor, 'budget.read', budgetResource(row)).allowed)
        .map((row) => row.id),
    );
  }

  /** Budgets the actor may read, with figures from the reconciled ledger read models. */
  async budgetFacts(
    tx: Tx,
    actor: RequestActor,
    opts: { ids?: readonly string[]; search?: string; limit?: number } = {},
  ): Promise<ScopedFacts<BudgetDetail>> {
    const action: Action = 'budget.read';
    const scope = this.scopeKind(actor, action);
    // Ask-style retrieval keeps the model's view small; a scan passes the ids it already scoped.
    const limit = Math.min(opts.limit ?? 8, 200);
    const candidates = await tx
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.tenantId, actor.tenantId),
          opts.ids?.length ? inArray(budgets.id, [...opts.ids]) : undefined,
          opts.search ? sql`${budgets.name} ilike ${`%${opts.search}%`}` : undefined,
        ),
      )
      .orderBy(budgets.name, budgets.id);
    const permitted = candidates.filter(
      (row: BudgetRow) => this.policy.can(actor, action, budgetResource(row)).allowed,
    );
    const chosen = permitted.slice(0, limit);
    const details = chosen.length ? await this.views.details(tx, actor, chosen) : [];
    return {
      rows: details,
      facts: details.map((d) => budgetFact(d, nameOf(chosen, d.id))),
      sources: details.map((d) => ({
        type: 'budget' as const,
        id: d.id,
        label: nameOf(chosen, d.id),
      })),
      scope: {
        action,
        scope,
        consideredCount: candidates.length,
        permittedCount: permitted.length,
      },
    };
  }

  /** Events the actor may read, filtered through the budget they are funded from. */
  async eventFacts(
    tx: Tx,
    actor: RequestActor,
    opts: { search?: string; budgetIds?: readonly string[]; limit?: number } = {},
  ): Promise<ScopedFacts<typeof events.$inferSelect>> {
    const action: Action = 'event.read';
    const scope = this.scopeKind(actor, action);
    if (scope === 'none') return empty(action, scope);
    const candidates = await tx
      .select()
      .from(events)
      .where(
        and(
          eq(events.tenantId, actor.tenantId),
          opts.budgetIds?.length ? inArray(events.budgetId, [...opts.budgetIds]) : undefined,
          opts.search ? sql`${events.name} ilike ${`%${opts.search}%`}` : undefined,
        ),
      )
      .orderBy(events.name, events.id);
    const budgetIds = [
      ...new Set(candidates.map((e) => e.budgetId).filter((id): id is string => Boolean(id))),
    ];
    const rows = budgetIds.length
      ? await tx.select().from(budgets).where(inArray(budgets.id, budgetIds))
      : [];
    const byId = new Map(rows.map((b) => [b.id, b]));
    const permitted = candidates.filter((e) => {
      if (e.organizerPersonId === actor.personId) return true;
      const budget = e.budgetId ? byId.get(e.budgetId) : undefined;
      return budget ? this.policy.can(actor, 'budget.read', budgetResource(budget)).allowed : false;
    });
    const chosen = permitted.slice(0, Math.min(opts.limit ?? 5, 25));
    return {
      rows: chosen,
      facts: chosen.map((e) => ({
        type: 'event',
        id: e.id,
        label: e.name,
        fields: {
          status: e.status,
          currency: e.currency,
          amountMinor: e.estimateMinor,
          eventDate: e.startsAt ? e.startsAt.toISOString().slice(0, 10) : null,
          reference: e.eventCode,
        },
      })),
      sources: chosen.map((e) => ({ type: 'event' as const, id: e.id, label: e.name })),
      scope: {
        action,
        scope,
        consideredCount: candidates.length,
        permittedCount: permitted.length,
      },
    };
  }

  /** Requests the actor may read: their own, or those on a budget they may read. */
  async requestFacts(
    tx: Tx,
    actor: RequestActor,
    opts: {
      ids?: readonly string[];
      ref?: string;
      budgetIds?: readonly string[];
      limit?: number;
    } = {},
  ): Promise<ScopedFacts<typeof requests.$inferSelect>> {
    const action: Action = 'request.create';
    const scope = this.scopeKind(actor, action);
    const candidates = await tx
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.tenantId, actor.tenantId),
          opts.ids?.length ? inArray(requests.id, [...opts.ids]) : undefined,
          opts.ref ? sql`upper(${requests.ref}) = ${opts.ref.toUpperCase()}` : undefined,
          opts.budgetIds?.length ? inArray(requests.budgetId, [...opts.budgetIds]) : undefined,
        ),
      )
      .orderBy(requests.ref, requests.id);
    const budgetIds = [
      ...new Set(candidates.map((r) => r.budgetId).filter((id): id is string => Boolean(id))),
    ];
    const rows = budgetIds.length
      ? await tx.select().from(budgets).where(inArray(budgets.id, budgetIds))
      : [];
    const byId = new Map(rows.map((b) => [b.id, b]));
    const permitted = candidates.filter((r) => {
      if (r.requesterPersonId === actor.personId) return true;
      const budget = r.budgetId ? byId.get(r.budgetId) : undefined;
      return budget ? this.policy.can(actor, 'budget.read', budgetResource(budget)).allowed : false;
    });
    const chosen = permitted.slice(0, Math.min(opts.limit ?? 5, 25));
    return {
      rows: chosen,
      facts: chosen.map((r) => ({
        type: 'request',
        id: r.id,
        label: r.ref,
        fields: {
          status: r.status,
          currency: r.currency,
          amountMinor: r.amountMinor,
          reference: r.ref,
          categoryCode: r.category,
        },
      })),
      sources: chosen.map((r) => ({ type: 'request' as const, id: r.id, label: r.ref })),
      scope: {
        action,
        scope,
        consideredCount: candidates.length,
        permittedCount: permitted.length,
      },
    };
  }

  /** Display names, only for people the answer actually needs (owners of budgets already in scope). */
  async nameOfPeople(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}

const nameOf = (rows: readonly BudgetRow[], id: string): string =>
  rows.find((r) => r.id === id)?.name ?? id;

/** Figures come straight from `BudgetViews`, which reads the ledger; nothing here is recomputed. */
export function budgetFact(detail: BudgetDetail, name: string): Fact {
  const b = detail.balances.budgetCurrency;
  return {
    type: 'budget',
    id: detail.id,
    label: name,
    fields: {
      status: detail.status,
      currency: detail.currency,
      budgetType: detail.budgetType,
      categoryCode: detail.categoryCode,
      authorizedMinor: b.authorized.amountMinor,
      allocatedOutMinor: b.allocatedOut.amountMinor,
      heldMinor: b.held.amountMinor,
      preEncumberedMinor: b.preEncumbered.amountMinor,
      encumberedMinor: b.encumbered.amountMinor,
      actualMinor: b.actual.amountMinor,
      availableMinor: detail.available.underRules.amountMinor,
      utilizationBps: detail.utilizationBps,
      childCount: detail.childCount,
      fiscalYearLabel: detail.display.fiscalYearLabel,
      ownerName: detail.display.ownerName,
    },
  };
}
