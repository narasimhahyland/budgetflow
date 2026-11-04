// Invariant 17: Director A never reads or mutates Director B's budget (except through an Inter-Director
// Budget Contribution Request, Phase 5). Role scope comes from PolicyService; ownership grants a subtree.
import { expect, test } from '@playwright/test';
import { BudgetDetail, BudgetList } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { allocate, allocateOk, createChild, createRoot, expectMoney } from '../support/factory';

const { india, unitedStates, europe, bengaluru, employeeExperience } = SEED.budgets;

test.describe('director isolation on the seeded hierarchy', () => {
  test('the India regional manager sees the India subtree only', async ({ request }) => {
    const headers = await as('regional-manager');
    const own = await expectContract(
      await request.get(`/api/budgets/${india}`, { headers }),
      200,
      BudgetDetail,
    );
    expectMoney(own.balances.budgetCurrency.authorized, SEED.indiaAuthorizedMinor, 'INR');
    expect(own.allowedActions).toEqual(
      expect.arrayContaining(['budget.read', 'budget.allocate', 'budget.create_child']),
    );
    await expectContract(
      await request.get(`/api/budgets/${bengaluru}`, { headers }),
      200,
      BudgetDetail,
    );
    for (const other of [unitedStates, europe, employeeExperience]) {
      await expectProblem(
        await request.get(`/api/budgets/${other}`, { headers }),
        404,
        'NOT_FOUND',
      );
    }
    const list = await expectContract(
      await request.get('/api/budgets', { headers }),
      200,
      BudgetList,
    );
    expect(list.items.length).toBeGreaterThanOrEqual(3);
    expect(list.items.every((b) => b.path.includes(`/${india}/`))).toBe(true);
  });

  test("Director A cannot allocate from or read Director B's budget", async ({ request }) => {
    const res = await request.post(`/api/budgets/${unitedStates}/allocations`, {
      headers: await mutate('regional-manager'),
      data: { childBudgetId: india, amount: { amountMinor: 1, currency: 'USD' } },
    });
    await expectProblem(res, 404, 'NOT_FOUND');
    await expectProblem(
      await request.get(`/api/budgets/${india}`, { headers: await as('budget-owner') }),
      404,
      'NOT_FOUND',
    );
    await expectProblem(
      await request.get(`/api/budgets/${india}/ledger`, { headers: await as('department-head') }),
      404,
      'NOT_FOUND',
    );
  });

  test('a location manager sees their location, not the region above it', async ({ request }) => {
    await expectContract(
      await request.get(`/api/budgets/${bengaluru}`, { headers: await as('location-manager') }),
      200,
      BudgetDetail,
    );
    await expectProblem(
      await request.get(`/api/budgets/${india}`, { headers: await as('location-manager') }),
      404,
      'NOT_FOUND',
    );
  });

  test('an owner allocates within their own subtree', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 50_000, owner: 'regional-manager' });
    const child = await createChild(request, root.id, {
      currency: 'INR',
      as: 'regional-manager',
      owner: 'location-manager',
    });
    const r = await allocateOk(
      request,
      root.id,
      child.id,
      { amountMinor: 10_000, currency: 'USD' },
      { as: 'regional-manager' },
    );
    expectMoney(r.child.balances.budgetCurrency.authorized, 832_500, 'INR');
    await expectProblem(
      await allocate(
        request,
        root.id,
        child.id,
        { amountMinor: 1, currency: 'USD' },
        { as: 'location-manager' },
      ),
      404,
      'NOT_FOUND',
    );
  });
});

test.describe('role scope from the authorization matrix', () => {
  test('read-only roles read everything and change nothing', async ({ request }) => {
    for (const role of ['auditor', 'analyst', 'finance-controller'] as const) {
      await expectContract(
        await request.get(`/api/budgets/${india}`, { headers: await as(role) }),
        200,
        BudgetDetail,
      );
      await expectProblem(
        await allocate(
          request,
          india,
          bengaluru,
          { amountMinor: 1, currency: 'INR' },
          { as: role },
        ),
        403,
        'FORBIDDEN',
      );
    }
  });

  test('roles without budget visibility get not found, including the platform operator without break-glass', async ({
    request,
  }) => {
    for (const role of [
      'employee',
      'org-admin',
      'integration-admin',
      'super-admin',
      'event-organizer',
    ] as const) {
      await expectProblem(
        await request.get(`/api/budgets/${india}`, { headers: await as(role) }),
        404,
        'NOT_FOUND',
      );
    }
    const empty = await expectContract(
      await request.get('/api/budgets', { headers: await as('employee') }),
      200,
      BudgetList,
    );
    expect(empty.items).toEqual([]);
  });

  test('the CEO and finance admins see the whole tenant', async ({ request }) => {
    for (const role of ['ceo', 'finance-admin'] as const) {
      const root = await expectContract(
        await request.get(`/api/budgets/${employeeExperience}`, { headers: await as(role) }),
        200,
        BudgetDetail,
      );
      expectMoney(root.balances.budgetCurrency.allocatedOut, 10_000_000, 'USD');
      expectMoney(root.balances.allocationAvailable, 0, 'USD');
    }
  });
});
