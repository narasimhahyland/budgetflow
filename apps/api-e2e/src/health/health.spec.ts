import { expect, test } from '@playwright/test';
import { HealthResponse, ReadinessResponse } from '@bf/contracts';
import { expectContract, expectProblem } from '../support/contract';

test.describe('health, readiness and the API contract', () => {
  test('liveness and readiness report the database and Keycloak as up', async ({ request }) => {
    await expectContract(await request.get('/health'), 200, HealthResponse);
    const ready = await expectContract(await request.get('/health/ready'), 200, ReadinessResponse);
    expect(ready).toEqual({ status: 'ready', checks: { database: 'up', identityProvider: 'up' } });
  });

  test('the generated OpenAPI 3.1 document is served and lists the Phase 1 endpoints', async ({
    request,
  }) => {
    const res = await request.get('/api/openapi.json');
    expect(res.status()).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/budgets',
        '/api/budgets/{budgetId}/allocations',
        '/api/ledger/journals/{journalId}/reversals',
        '/api/integrity/ledger-checks',
      ]),
    );
  });

  test('protected endpoints refuse requests without a valid Keycloak token', async ({
    request,
  }) => {
    await expectProblem(await request.get('/api/budgets'), 401, 'UNAUTHENTICATED');
    await expectProblem(
      await request.get('/api/budgets', { headers: { authorization: 'Bearer not-a-token' } }),
      401,
      'UNAUTHENTICATED',
    );
  });
});
