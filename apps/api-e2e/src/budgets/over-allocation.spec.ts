// Invariant 2: child allocations never exceed the parent's available amount, checked at the locked plan
// rate (FY2026: 1 USD = 83.25 INR = 0.92 EUR = 150 JPY = 0.307 KWD), with the remaining amount named in
// the rejection. Across currencies the parent is charged rounding up and the child credited rounding
// down, so a child never receives more than its parent gave up.
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
    // INR 83,250.84 is worth USD 1,000.0101 at 83.25 (8,325,084 × 0.012012012012 = 100,001.0089); the
    // parent is charged rounding up, USD 1,000.02, so it is over by two cents.
    const over = await expectProblem(
      await allocate(request, root.id, india.id, { amountMinor: 8_325_084, currency: 'INR' }),
      409,
      'OVER_ALLOCATION',
    );
    expect(over.params).toMatchObject({
      availableMinor: 100_000,
      requestedMinor: 100_002,
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

  test('an exhausted parent cannot fund a child with amounts worth less than one parent minor unit', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    const india = await createChild(request, root.id, { currency: 'INR' });
    const kuwait = await createChild(request, root.id, { currency: 'KWD' });
    await allocateOk(request, root.id, india.id, { amountMinor: 10_000, currency: 'USD' });
    // INR 0.41 is worth USD 0.0049 and KWD 0.001 USD 0.0033: each still costs the parent one cent.
    for (let i = 0; i < 5; i++) {
      const p = await expectProblem(
        await allocate(request, root.id, india.id, { amountMinor: 41, currency: 'INR' }),
        409,
        'OVER_ALLOCATION',
      );
      expect(p.params).toMatchObject({ availableMinor: 0, requestedMinor: 1, currency: 'USD' });
    }
    await expectProblem(
      await allocate(request, root.id, kuwait.id, { amountMinor: 1, currency: 'KWD' }),
      409,
      'OVER_ALLOCATION',
    );
    expectMoney(
      (await getBudget(request, india.id)).balances.budgetCurrency.authorized,
      832_500,
      'INR',
    );
    expectMoney((await getBudget(request, kuwait.id)).balances.budgetCurrency.authorized, 0, 'KWD');
    expectMoney(
      (await getBudget(request, root.id)).balances.budgetCurrency.allocatedOut,
      10_000,
      'USD',
    );
  });

  test('repeated small child-currency allocations never give the child more than the parent gave up', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100 });
    const india = await createChild(request, root.id, { currency: 'INR' });
    // INR 1.24 is worth USD 0.0149 at 83.25; the parent is charged USD 0.02 each time.
    let accepted = 0;
    for (;;) {
      const res = await allocate(request, root.id, india.id, { amountMinor: 124, currency: 'INR' });
      if (res.status() !== 201) {
        await expectProblem(res, 409, 'OVER_ALLOCATION');
        break;
      }
      const line = (await res.json()).journal.lines.find(
        (l: { account: string }) => l.account === 'allocated_out',
      );
      expect(line.budget).toEqual({ amountMinor: 2, currency: 'USD' });
      accepted++;
    }
    expect(accepted).toBe(50);
    const parent = await getBudget(request, root.id);
    const child = await getBudget(request, india.id);
    expectMoney(parent.balances.budgetCurrency.allocatedOut, 100, 'USD');
    expectMoney(child.balances.budgetCurrency.authorized, 6_200, 'INR');
    // INR 62.00 is worth USD 0.7447 at the plan rate: never more than the USD 1.00 the parent gave up.
    expect(child.balances.budgetCurrency.authorized.amountMinor / 83.25).toBeLessThanOrEqual(
      parent.balances.budgetCurrency.allocatedOut.amountMinor,
    );
  });

  test('a parent-currency allocation to a coarser child currency credits the child rounding down', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    const yen = await createChild(request, root.id, { currency: 'JPY' });
    const europe = await createChild(request, root.id, { currency: 'EUR' });
    // USD 0.01 = JPY 1.5: the child receives JPY 1, never JPY 2 (worth USD 0.0133) for one cent.
    for (let i = 0; i < 3; i++) {
      const r = await allocateOk(request, root.id, yen.id, { amountMinor: 1, currency: 'USD' });
      expect(r.journal.lines.find((l) => l.account === 'authorized')!.budget).toEqual({
        amountMinor: -1,
        currency: 'JPY',
      });
    }
    expectMoney((await getBudget(request, yen.id)).balances.budgetCurrency.authorized, 3, 'JPY');
    // USD 0.01 = EUR 0.0092: less than one euro cent, rejected rather than credited as zero or one.
    const zero = await expectProblem(
      await allocate(request, root.id, europe.id, { amountMinor: 1, currency: 'USD' }),
      422,
      'AMOUNT_ROUNDS_TO_ZERO',
    );
    expect(zero.params).toMatchObject({ currency: 'EUR' });
    // USD 0.02 = EUR 0.0184 → EUR 0.01 (rounded down).
    const two = await allocateOk(request, root.id, europe.id, { amountMinor: 2, currency: 'USD' });
    expectMoney(two.child.balances.budgetCurrency.authorized, 1, 'EUR');
    expectMoney(two.parent.balances.budgetCurrency.allocatedOut, 5, 'USD');
  });

  test('allocation amounts must be positive whole minor units in a supported currency', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const cases: [unknown, number, string][] = [
      [{ amountMinor: 0, currency: 'USD' }, 422, 'AMOUNT_NOT_POSITIVE'],
      [{ amountMinor: -1, currency: 'USD' }, 422, 'AMOUNT_NOT_POSITIVE'],
      [{ amountMinor: 1.5, currency: 'USD' }, 400, 'VALIDATION_FAILED'],
      [{ amountMinor: 2 ** 53, currency: 'USD' }, 400, 'VALIDATION_FAILED'],
      [{ amountMinor: 1, currency: 'usd' }, 400, 'VALIDATION_FAILED'],
      [{ amountMinor: 1, currency: 'GBP' }, 422, 'CURRENCY_MISMATCH'],
      [{ amountMinor: '100', currency: 'USD' }, 400, 'VALIDATION_FAILED'],
    ];
    for (const [amount, status, code] of cases) {
      await expectProblem(
        await request.post(`/api/budgets/${root.id}/allocations`, {
          headers: await mutate('ceo'),
          data: { childBudgetId: child.id, amount },
        }),
        status,
        code,
      );
    }
    expectMoney((await getBudget(request, root.id)).balances.budgetCurrency.allocatedOut, 0, 'USD');
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
