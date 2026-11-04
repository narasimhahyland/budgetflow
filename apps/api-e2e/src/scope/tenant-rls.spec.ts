// Invariant 18 (API): tenant isolation holds even with a forged X-Tenant-Id; other tenants' ids are invisible.
import { expect, test } from '@playwright/test';
import { BudgetList, MeResponse } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

const { acme, globex } = SEED.tenants;

test.describe('tenant isolation through the API', () => {
  test('a forged X-Tenant-Id for a tenant the user does not belong to is refused', async ({
    request,
  }) => {
    await expectProblem(
      await request.get('/api/budgets', { headers: await as('ceo', {}, globex) }),
      403,
      'TENANT_NOT_MEMBER',
    );
    await expectProblem(
      await request.get(`/api/budgets/${SEED.budgets.globexOperations}`, {
        headers: await as('finance-admin', {}, globex),
      }),
      403,
      'TENANT_NOT_MEMBER',
    );
    await expectProblem(
      await request.get('/api/budgets', { headers: await as('ceo', {}, 'not-a-tenant') }),
      400,
      'VALIDATION_FAILED',
    );
  });

  test('without a header the single membership is used', async ({ request }) => {
    const me = await expectContract(
      await request.get('/api/me', { headers: await as('ceo', {}, null) }),
      200,
      MeResponse,
    );
    expect(me).toMatchObject({
      tenantId: acme,
      tenantName: 'Hyland',
      reportingCurrency: 'USD',
      displayName: 'Morgan Lee',
      roles: ['ceo'],
    });
  });

  test("another tenant's budgets are not found, cannot be allocated from, and never listed", async ({
    request,
  }) => {
    for (const id of [SEED.budgets.employeeExperience, SEED.budgets.india]) {
      await expectProblem(
        await request.get(`/api/budgets/${id}`, { headers: await as('globex-admin') }),
        404,
        'NOT_FOUND',
      );
    }
    const res = await request.post(`/api/budgets/${SEED.budgets.employeeExperience}/allocations`, {
      headers: await mutate('globex-admin'),
      data: { childBudgetId: SEED.budgets.india, amount: { amountMinor: 1, currency: 'USD' } },
    });
    await expectProblem(res, 404, 'NOT_FOUND');
    const list = await expectContract(
      await request.get('/api/budgets', { headers: await as('globex-admin') }),
      200,
      BudgetList,
    );
    expect(list.items.map((b) => b.id)).toEqual([SEED.budgets.globexOperations]);
    await expectProblem(
      await request.get(`/api/budgets/${SEED.budgets.globexOperations}`, {
        headers: await as('finance-admin'),
      }),
      404,
      'NOT_FOUND',
    );
  });
});
