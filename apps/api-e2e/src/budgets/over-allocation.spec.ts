// Invariant 2: child allocations never exceed the parent's available amount, checked at the locked plan
// rate (FY2026: 1 USD = 83.25 INR = 0.92 EUR), with the remaining amount named in the rejection.
import { expect, test } from '@playwright/test';
import {
  allocate,
  allocateOk,
  createChild,
  createRoot,
  expectMoney,
  getBudget,
} from '../support/factory';
import { expectProblem } from '../support/contract';
import { mutate } from '../support/auth';

test.describe('allocation against parent available', () => {
  test('allocating exactly the available amount passes; one minor unit more is rejected with the remaining amount', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const ok = await allocateOk(request, root.id, child.id, {
      amountMinor: 60_000,
      currency: 'USD',
    });
    expectMoney(ok.parent.balances.allocationAvailable, 40_000, 'USD');
    expectMoney(ok.child.balances.budgetCurrency.authorized, 60_000, 'USD');
    expect(ok.parent.allocationBadge).toBe('partially_allocated');

    const over = await expectProblem(
      await allocate(request, root.id, child.id, { amountMinor: 40_001, currency: 'USD' }),
      409,
      'OVER_ALLOCATION',
    );
    expect(over.params).toMatchObject({
      availableMinor: 40_000,
      requestedMinor: 40_001,
      shortfallMinor: 1,
      currency: 'USD',
    });

    const exact = await allocateOk(request, root.id, child.id, {
      amountMinor: 40_000,
      currency: 'USD',
    });
    expectMoney(exact.parent.balances.allocationAvailable, 0, 'USD');
    expect(exact.parent.allocationBadge).toBe('fully_allocated');
    await expectProblem(
      await allocate(request, root.id, child.id, { amountMinor: 1, currency: 'USD' }),
      409,
      'OVER_ALLOCATION',
    );
    expectMoney(
      (await getBudget(request, root.id)).balances.budgetCurrency.allocatedOut,
      100_000,
      'USD',
    );
  });

  test('cross-currency allocations are checked in the parent currency at the locked plan rate', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const india = await createChild(request, root.id, { currency: 'INR' });
    // INR 83,250.84 = USD 1,000.01 at 83.25 (8,325,084 × 0.012012012012 = 100,001.0089 → 100,001): one cent over.
    const over = await expectProblem(
      await allocate(request, root.id, india.id, { amountMinor: 8_325_084, currency: 'INR' }),
      409,
      'OVER_ALLOCATION',
    );
    expect(over.params).toMatchObject({
      availableMinor: 100_000,
      requestedMinor: 100_001,
      currency: 'USD',
    });
    // INR 83,250.00 = USD 1,000.00 exactly: allowed, child receives INR 83,250.00.
    const ok = await allocateOk(request, root.id, india.id, {
      amountMinor: 8_325_000,
      currency: 'INR',
    });
    expectMoney(ok.child.balances.budgetCurrency.authorized, 8_325_000, 'INR');
    expectMoney(ok.child.balances.reporting.authorized, 100_000, 'USD');
    expectMoney(ok.parent.balances.allocationAvailable, 0, 'USD');
  });

  test('allocation in the parent currency converts once for the child (USD 300.00 → EUR 276.00)', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const europe = await createChild(request, root.id, { currency: 'EUR' });
    const ok = await allocateOk(request, root.id, europe.id, {
      amountMinor: 30_000,
      currency: 'USD',
    });
    expectMoney(ok.child.balances.budgetCurrency.authorized, 27_600, 'EUR');
    expect(ok.journal.balanced).toBe(true);
  });

  test('money only flows to direct children, in the parent or child currency', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const grandchild = await createChild(request, child.id, { currency: 'USD' });
    await expectProblem(
      await allocate(request, root.id, grandchild.id, { amountMinor: 100, currency: 'USD' }),
      422,
      'NOT_A_CHILD',
    );
    await expectProblem(
      await allocate(request, root.id, child.id, { amountMinor: 100, currency: 'EUR' }),
      422,
      'CURRENCY_MISMATCH',
    );
    await expectProblem(
      await allocate(request, root.id, child.id, { amountMinor: 0, currency: 'USD' }),
      422,
      'AMOUNT_NOT_POSITIVE',
    );
  });

  test('a role that can read but not allocate is refused; a role that cannot read sees nothing', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const body = { childBudgetId: child.id, amount: { amountMinor: 100, currency: 'USD' } };
    await expectProblem(
      await request.post(`/api/budgets/${root.id}/allocations`, {
        headers: await mutate('auditor'),
        data: body,
      }),
      403,
      'FORBIDDEN',
    );
    await expectProblem(
      await request.post(`/api/budgets/${root.id}/allocations`, {
        headers: await mutate('employee'),
        data: body,
      }),
      404,
      'NOT_FOUND',
    );
    expectMoney((await getBudget(request, root.id)).balances.budgetCurrency.allocatedOut, 0, 'USD');
  });
});
