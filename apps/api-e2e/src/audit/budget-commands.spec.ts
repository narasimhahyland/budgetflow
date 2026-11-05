// Invariant 19 for every Phase 4 budget command: exactly one hash-chained audit entry per successful
// command, even when the command creates budgets, posts several journals or decides a request that moves
// money. Each request carries its own X-Request-Id and the entries written under it are counted.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { BudgetChangeRequest, BudgetDetail } from '@bf/contracts';
import { SEED, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { allocateOk, createChild, createRoot } from '../support/factory';
import { auditsOfRequest, budget, preview, USD } from '../budgets/p4';

async function traced(
  request: APIRequestContext,
  path: string,
  data: unknown,
  user: SeedUserId = 'finance-admin',
) {
  const requestId = `audit-${randomUUID()}`;
  const res = await request.post(path, {
    headers: { ...(await mutate(user)), 'x-request-id': requestId },
    data,
  });
  expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
  return { body: await res.json(), audits: await auditsOfRequest(requestId) };
}

test.describe('one audit entry per budget command', () => {
  test.beforeAll(async () => {
    for (const u of ['finance-admin', 'ceo', 'regional-manager', 'location-manager'] as const)
      await as(u);
  });

  test('allocation, grid, per-head, transfer, controls, requests and decisions each write one entry', async ({
    request,
  }) => {
    const actions: Record<string, string[]> = {};
    const run = async (name: string, path: string, data: unknown, user?: SeedUserId) => {
      const r = await traced(request, path, data, user);
      actions[name] = r.audits.map((a) => a.action);
      return r.body;
    };
    const root = await createRoot(request, { amountMinor: 1_000_000, owner: 'regional-manager' });
    const a = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'location-manager',
      as: 'finance-admin',
    });
    const b = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'location-manager',
      as: 'finance-admin',
    });

    await run('allocate', `/api/budgets/${root.id}/allocations`, {
      childBudgetId: a.id,
      amount: USD(100_000),
    });
    await run(
      'grid with an existing and a new child',
      `/api/budgets/${root.id}/allocations/batch`,
      {
        dryRun: false,
        lines: [
          { childBudgetId: b.id, amountMinor: 1_000 },
          {
            newChild: {
              name: `Grid child ${randomUUID().slice(0, 6)}`,
              ownerPersonId: a.ownerPersonId,
            },
            amountMinor: 2_000,
          },
        ],
      },
      'regional-manager',
    );
    await run(
      'transfer',
      `/api/budgets/${a.id}/transfers`,
      { toBudgetId: b.id, amountMinor: 1_000, reasonCode: 'TRF-REBALANCE', reason: 'Rebalance' },
      'regional-manager',
    );
    const pv = await preview(request, a.id, {
      action: 'reduce',
      amountMinor: 500,
      destination: 'parent',
    });
    await run('reduce', `/api/budgets/${a.id}/reduce`, {
      amountMinor: 500,
      destination: 'parent',
      reasonCode: 'RED-COST-SAVING',
      reason: 'Cost saving',
      confirmedFloorMinor: pv.floorMinor,
    });
    await run('freeze', `/api/budgets/${b.id}/freeze`, {
      reasonCode: 'FRZ-POLICY',
      reason: 'Policy review',
    });
    await run('unfreeze', `/api/budgets/${b.id}/unfreeze`, { reason: 'Review finished' });

    const hyd = await expectContract(
      await request.post('/api/budgets', {
        headers: await mutate('finance-admin'),
        data: {
          name: `Hyderabad audit ${randomUUID().slice(0, 6)}`,
          parentId: root.id,
          legalEntityId: SEED.legalEntities.acmeIndia,
          orgUnitId: SEED.orgUnits.hyderabad,
          fiscalYearId: SEED.fiscalYears.acmeFy2026,
        },
      }),
      201,
      BudgetDetail,
    );
    await run('per-head set', `/api/budgets/${root.id}/per-head`, {
      childBudgetId: hyd.id,
      rateMinor: 1_500,
      eligibleTypes: ['employee'],
      prorate: false,
      asOf: '2026-10-31',
      dryRun: false,
    });
    await run('per-head true-up', `/api/budgets/${hyd.id}/per-head/true-up`, {
      asOf: '2026-11-01',
      dryRun: false,
    });

    const inc = (await run(
      'increase request',
      `/api/budgets/${a.id}/increase-requests`,
      { amountMinor: 700, reason: 'Team offsite' },
      'location-manager',
    )) as BudgetChangeRequest;
    await run(
      'increase approval',
      `/api/budget-requests/${inc.id}/decision`,
      { decision: 'approve' },
      'regional-manager',
    );
    for (const [name, list] of Object.entries(actions)) expect(list, name).toHaveLength(1);
    expect(actions['grid with an existing and a new child']).toEqual([
      'budget.allocation_grid_applied',
    ]);
    expect(actions['per-head set']).toEqual(['budget.per_head_set']);
    expect(actions['increase approval']).toEqual(['budget.change_request_approved']);
    expect((await budget(request, root.id)).balances.budgetCurrency.allocatedOut.amountMinor).toBe(
      100_000 +
        1_000 +
        2_000 -
        500 +
        700 +
        (await budget(request, hyd.id)).balances.budgetCurrency.authorized.amountMinor,
    );
  });

  test('approving a contingency release writes one entry', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 100_000, owner: 'regional-manager' });
    const team = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'location-manager',
      as: 'finance-admin',
    });
    const reserve = await expectContract(
      await request.post('/api/budgets', {
        headers: await mutate('finance-admin'),
        data: {
          name: `Reserve ${randomUUID().slice(0, 6)}`,
          parentId: root.id,
          legalEntityId: root.legalEntityId,
          fiscalYearId: root.fiscalYearId,
          budgetType: 'contingency',
        },
      }),
      201,
      BudgetDetail,
    );
    await allocateOk(request, root.id, reserve.id, USD(5_000), { as: 'finance-admin' });
    const rel = await traced(request, `/api/budgets/${reserve.id}/releases`, {
      toBudgetId: team.id,
      amountMinor: 2_000,
      reason: 'Unplanned visit',
    });
    expect(rel.audits.map((x) => x.action)).toEqual(['budget.release_requested']);
    const decision = await traced(
      request,
      `/api/budget-requests/${(rel.body as BudgetChangeRequest).id}/decision`,
      { decision: 'approve' },
      'regional-manager',
    );
    expect(decision.audits.map((x) => x.action)).toEqual(['budget.change_request_approved']);
    expect((await budget(request, team.id)).balances.budgetCurrency.authorized.amountMinor).toBe(
      2_000,
    );
  });
});
