// Invariant 4: mutations carry an Idempotency-Key; a replay returns the first response and posts once.
import { expect, test } from '@playwright/test';
import { AllocationResponse, LedgerLineList } from '@bf/contracts';
import { randomUUID } from 'node:crypto';
import { as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { allocate, createChild, createRoot, expectMoney, getBudget } from '../support/factory';

test.describe('idempotent allocation', () => {
  test('the same key twice returns the same journal and posts once', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const key = randomUUID();
    const first = await allocate(
      request,
      root.id,
      child.id,
      { amountMinor: 25_000, currency: 'USD' },
      { key },
    );
    const a = await expectContract(first, 201, AllocationResponse);
    const second = await allocate(
      request,
      root.id,
      child.id,
      { amountMinor: 25_000, currency: 'USD' },
      { key },
    );
    const b = await expectContract(second, 201, AllocationResponse);
    expect(second.headers()['idempotent-replayed']).toBe('true');
    expect(b.journal.id).toBe(a.journal.id);
    const lines = await expectContract(
      await request.get(`/api/budgets/${root.id}/ledger`, { headers: await as('finance-admin') }),
      200,
      LedgerLineList,
    );
    expect(lines.items.filter((l) => l.account === 'allocated_out')).toHaveLength(1);
    expectMoney(
      (await getBudget(request, root.id)).balances.budgetCurrency.allocatedOut,
      25_000,
      'USD',
    );
  });

  test('ten parallel requests with one key produce one journal', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        allocate(request, root.id, child.id, { amountMinor: 1_000, currency: 'USD' }, { key }),
      ),
    );
    const bodies = await Promise.all(
      responses.map((r) => expectContract(r, 201, AllocationResponse)),
    );
    expect(new Set(bodies.map((b) => b.journal.id)).size).toBe(1);
    expectMoney(
      (await getBudget(request, child.id)).balances.budgetCurrency.authorized,
      1_000,
      'USD',
    );
  });

  test('reusing a key for a different request is refused', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const key = randomUUID();
    await expectContract(
      await allocate(request, root.id, child.id, { amountMinor: 1_000, currency: 'USD' }, { key }),
      201,
      AllocationResponse,
    );
    await expectProblem(
      await allocate(request, root.id, child.id, { amountMinor: 2_000, currency: 'USD' }, { key }),
      422,
      'IDEMPOTENCY_KEY_REUSED',
    );
    expectMoney(
      (await getBudget(request, child.id)).balances.budgetCurrency.authorized,
      1_000,
      'USD',
    );
  });

  test('a rejected command does not consume its key: the retry runs again', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 1_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const key = randomUUID();
    await expectProblem(
      await allocate(request, root.id, child.id, { amountMinor: 1_001, currency: 'USD' }, { key }),
      409,
      'OVER_ALLOCATION',
    );
    await expectProblem(
      await allocate(request, root.id, child.id, { amountMinor: 1_001, currency: 'USD' }, { key }),
      409,
      'OVER_ALLOCATION',
    );
    expectMoney((await getBudget(request, root.id)).balances.budgetCurrency.allocatedOut, 0, 'USD');
  });
});
