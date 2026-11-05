// Template scenario for apps/api-e2e: invariant 2 in docs/testing/invariant-scenarios.md.
// Arrange from the deterministic seed, act as the role, assert the business outcome (status, code, amounts, no posting).
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { bearer } from '../support/auth';
import { seed } from '../support/seed';

test.describe('allocation against parent available', () => {
  test('one minor unit over the parent available is rejected with the remaining amount', async ({
    request,
  }) => {
    const headers = await bearer('regional-manager', { 'idempotency-key': randomUUID() });
    const before = await (await request.get(`/api/budgets/${seed.india.id}`, { headers })).json();

    const res = await request.post(`/api/budgets/${seed.india.id}/allocations`, {
      headers,
      data: {
        childId: seed.hyderabad.id,
        amount: { amountMinor: before.available.amountMinor + 1, currency: 'INR' },
      },
    });

    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe('OVER_ALLOCATION');
    const after = await (await request.get(`/api/budgets/${seed.india.id}`, { headers })).json();
    expect(after.available.amountMinor).toBe(before.available.amountMinor);
  });

  test('a role without allocation rights on the parent is denied', async ({ request }) => {
    const res = await request.post(`/api/budgets/${seed.india.id}/allocations`, {
      headers: await bearer('employee', { 'idempotency-key': randomUUID() }),
      data: { childId: seed.hyderabad.id, amount: { amountMinor: 100, currency: 'INR' } },
    });
    expect(res.status()).toBe(403);
  });
});
