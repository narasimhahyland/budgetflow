// Invariant 3: concurrent allocations never exceed the parent (ordered row locks, parent before children).
import { expect, test } from '@playwright/test';
import { allocate, createChild, createRoot, expectMoney, getBudget } from '../support/factory';

test('20 parallel allocations of 100.00 against 1,000.00 available: exactly 10 succeed', async ({
  request,
}) => {
  const root = await createRoot(request, { amountMinor: 100_000 });
  const children = await Promise.all(
    Array.from({ length: 4 }, () => createChild(request, root.id, { currency: 'USD' })),
  );
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      allocate(request, root.id, children[i % 4].id, { amountMinor: 10_000, currency: 'USD' }),
    ),
  );
  const statuses = responses.map((r) => r.status());
  expect(statuses.filter((s) => s === 201)).toHaveLength(10);
  expect(statuses.filter((s) => s === 409)).toHaveLength(10);
  for (const r of responses.filter((x) => x.status() === 409))
    expect((await r.json()).code).toBe('OVER_ALLOCATION');

  const parent = await getBudget(request, root.id);
  expectMoney(parent.balances.budgetCurrency.allocatedOut, 100_000, 'USD');
  expectMoney(parent.balances.allocationAvailable, 0, 'USD');
  const kids = await Promise.all(children.map((c) => getBudget(request, c.id)));
  expect(kids.reduce((sum, k) => sum + k.balances.budgetCurrency.authorized.amountMinor, 0)).toBe(
    100_000,
  );
});
