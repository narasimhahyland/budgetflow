// Helpers for the Phase 15 scenarios. Every scenario builds its own budget tree through the API, so
// none of them depends on another's state or on a shared fixture another scenario can consume.
import { expect, type APIRequestContext } from '@playwright/test';
import {
  AuditEventList,
  Scenario,
  ScenarioImpact,
  type BudgetDetail,
  type Money,
} from '@bf/contracts';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { allocateOk, createChild, createRoot, getBudget } from '../support/factory';
import type { SeedUserId } from '@bf/seed';

export const reason = (what: string) => `Phase 15 scenario: ${what}.`;

export const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD' });

/** A root with one funded child, which is the smallest tree a reduction can be modelled against. */
export async function fundedTree(
  request: APIRequestContext,
  opts: { rootMinor: number; childMinor: number; owner?: SeedUserId },
): Promise<{ root: BudgetDetail; child: BudgetDetail }> {
  const root = await createRoot(request, { amountMinor: opts.rootMinor });
  const child = await createChild(request, root.id, { currency: 'USD', owner: opts.owner });
  await allocateOk(request, root.id, child.id, usd(opts.childMinor));
  return { root, child };
}

export async function createScenario(
  request: APIRequestContext,
  opts: { name?: string; as?: SeedUserId; collaborators?: string[] } = {},
) {
  return expectContract(
    await request.post('/api/scenarios', {
      headers: await mutate(opts.as ?? 'finance-admin'),
      data: {
        name: opts.name ?? `What-if ${randomUUID().slice(0, 8)}`,
        note: reason('modelling a mid-year reallocation'),
        ...(opts.collaborators ? { collaboratorPersonIds: opts.collaborators } : {}),
      },
    }),
    201,
    Scenario,
  );
}

export async function addChange(
  request: APIRequestContext,
  scenarioId: string,
  data: Record<string, unknown>,
  user: SeedUserId = 'finance-admin',
) {
  return request.post(`/api/scenarios/${scenarioId}/changes`, {
    headers: await mutate(user),
    data,
  });
}

export async function impactOf(
  request: APIRequestContext,
  scenarioId: string,
  user: SeedUserId = 'finance-admin',
) {
  return expectContract(
    await request.get(`/api/scenarios/${scenarioId}/impact`, { headers: await as(user) }),
    200,
    ScenarioImpact,
  );
}

/** Every bucket of a budget, so a scenario can assert that nothing moved at all. */
export async function buckets(request: APIRequestContext, budgetId: string) {
  const detail = await getBudget(request, budgetId);
  const b = detail.balances.budgetCurrency;
  return {
    status: detail.status,
    authorized: b.authorized.amountMinor,
    allocatedOut: b.allocatedOut.amountMinor,
    held: b.held.amountMinor,
    preEncumbered: b.preEncumbered.amountMinor,
    encumbered: b.encumbered.amountMinor,
    actual: b.actual.amountMinor,
  };
}

/** Audit entries for one record, newest first; used to prove exactly one entry per mutation. */
export async function auditFor(
  request: APIRequestContext,
  resourceType: string,
  resourceId: string,
  user: SeedUserId = 'finance-admin',
) {
  const body = await expectContract(
    await request.get(
      `/api/audit/events?resourceType=${resourceType}&resourceId=${resourceId}&limit=50`,
      { headers: await as(user) },
    ),
    200,
    AuditEventList,
  );
  return body.items;
}

export function expectNothingMoved(
  before: Awaited<ReturnType<typeof buckets>>,
  after: Awaited<ReturnType<typeof buckets>>,
): void {
  expect(after, 'modelling a scenario changes no bucket and no status').toEqual(before);
}
