import { budgetResource, type BudgetRow } from '@bf/api/budgets';
import { PolicyService, type RequestActor } from '@bf/api/core';
import { budgets, events, requests, type Tx } from '@bf/api/db';
import { Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';

/**
 * The only way an ecosystem surface reads tenant records. Every candidate row goes through
 * `PolicyService.can` for the connecting person before it leaves the server, on top of the tenant
 * row level security the transaction already applies. A record the person could not open in the app
 * is never in a BI feed, an assistant answer, an automation reply or a widget.
 *
 * Ordering is always name then id, so a page boundary is stable and two reads of the same data come
 * back in the same order.
 */
@Injectable()
export class EcosystemScopedReads {
  constructor(private readonly policy: PolicyService) {}

  /** Budgets the actor may read, name then id. */
  async budgets(tx: Tx, actor: RequestActor, search?: string): Promise<BudgetRow[]> {
    const rows = await tx
      .select()
      .from(budgets)
      .where(
        search
          ? sql`${budgets.tenantId} = ${actor.tenantId} and ${budgets.name} ilike ${`%${search}%`}`
          : eq(budgets.tenantId, actor.tenantId),
      )
      .orderBy(asc(budgets.name), asc(budgets.id));
    return rows.filter((row) => this.policy.can(actor, 'budget.read', budgetResource(row)).allowed);
  }

  /** Events the actor may read: the ones they organize, or funded from a budget they may read. */
  async events(tx: Tx, actor: RequestActor, search?: string) {
    const readable = new Map((await this.budgets(tx, actor)).map((b) => [b.id, b] as const));
    const rows = await tx
      .select()
      .from(events)
      .where(
        search
          ? sql`${events.tenantId} = ${actor.tenantId} and ${events.name} ilike ${`%${search}%`}`
          : eq(events.tenantId, actor.tenantId),
      )
      .orderBy(asc(events.name), asc(events.id));
    return rows.filter(
      (e) =>
        (actor.personId !== null && e.organizerPersonId === actor.personId) ||
        (e.budgetId !== null && readable.has(e.budgetId)),
    );
  }

  /** Requests the actor may read: their own, or those on a budget they may read. */
  async requests(tx: Tx, actor: RequestActor) {
    const readable = new Set((await this.budgets(tx, actor)).map((b) => b.id));
    const rows = await tx
      .select()
      .from(requests)
      .where(eq(requests.tenantId, actor.tenantId))
      .orderBy(asc(requests.ref), asc(requests.id));
    return rows.filter(
      (r) =>
        (actor.personId !== null && r.requesterPersonId === actor.personId) ||
        (r.budgetId !== null && readable.has(r.budgetId)),
    );
  }

  /** One budget, or undefined when the actor may not read it. Never tells the two apart. */
  async budget(tx: Tx, actor: RequestActor, id: string): Promise<BudgetRow | undefined> {
    const [row] = await tx.select().from(budgets).where(eq(budgets.id, id));
    if (!row) return undefined;
    return this.policy.can(actor, 'budget.read', budgetResource(row)).allowed ? row : undefined;
  }
}
