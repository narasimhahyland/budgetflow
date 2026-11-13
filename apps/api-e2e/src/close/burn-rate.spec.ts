// Burn-rate alerts (gap B4): an owner hears when actual spend runs ahead of the budget's phasing.
// Finance requests a run; the worker measures every open budget at the run's as-of date, raises
// one alert per budget, fiscal period and level, and notifies the owner through the existing
// notifications. Running again finds nothing new; the same request key queues one run, not two.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { BudgetPhasing, BurnRateAlertList, BurnRateRun, NotificationsFeed } from '@bf/contracts';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { todayUtc } from '../support/clock';
import { expectContract, expectProblem } from '../support/contract';
import { allocateOk, createChild, createRoot } from '../support/factory';
import { openingBalance, USD } from '../budgets/p4';

async function runAndWait(request: APIRequestContext, key = randomUUID()) {
  const queued = await expectContract(
    await request.post('/api/burn-rate/runs', {
      headers: await mutate('finance-admin', key),
      data: {},
    }),
    202,
    BurnRateRun,
  );
  let run = queued;
  await expect
    .poll(
      async () => {
        run = await expectContract(
          await request.get(`/api/burn-rate/runs/${queued.id}`, {
            headers: await as('finance-admin'),
          }),
          200,
          BurnRateRun,
        );
        return run.status;
      },
      { timeout: 60_000, intervals: [250, 500, 1000] },
    )
    .toBe('completed');
  return run;
}

async function alertsFor(request: APIRequestContext, budgetId: string) {
  return (
    await expectContract(
      await request.get(`/api/burn-rate/alerts?budgetId=${budgetId}`, {
        headers: await as('budget-owner'),
      }),
      200,
      BurnRateAlertList,
    )
  ).items;
}

test.describe('burn-rate alerts', () => {
  test('alerts at exactly 110% and 125% of phased to date, never below, once per period and level, and reach the owner', async ({
    request,
  }) => {
    // USD 20,000.00 phased USD 1,000.00 a month to October, nothing in November and USD 10,000.00
    // in December: on 16 Nov the amount phased to date is exactly USD 10,000.00.
    const root = await createRoot(request, { amountMinor: 5_000_000 });
    const b = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'budget-owner',
      as: 'finance-admin',
    });
    await allocateOk(request, root.id, b.id, USD(2_000_000), { as: 'finance-admin' });
    const phasing = await expectContract(
      await request.put(`/api/budgets/${b.id}/phasing`, {
        headers: await mutate('finance-admin'),
        data: {
          method: 'manual',
          amountsMinor: [...Array(10).fill(100_000), 0, 1_000_000],
        },
      }),
      200,
      BudgetPhasing,
    );
    expect(phasing.phasedMinor).toBe(2_000_000);
    expect(todayUtc() >= '2026-11-01' && todayUtc() <= '2026-11-30').toBe(true);

    // Only finance runs the check.
    await expectProblem(
      await request.post('/api/burn-rate/runs', {
        headers: await mutate('budget-owner'),
        data: {},
      }),
      403,
      'FORBIDDEN',
    );

    // One minor unit under 110%: no alert.
    await openingBalance(request, b.id, 'actual', 1_099_999);
    await runAndWait(request);
    expect(await alertsFor(request, b.id)).toHaveLength(0);

    // Exactly 110%: "ahead".
    await openingBalance(request, b.id, 'actual', 1);
    const first = await runAndWait(request);
    const ahead = await alertsFor(request, b.id);
    expect(ahead).toHaveLength(1);
    expect(ahead[0]).toMatchObject({
      level: 'ahead',
      burnBps: 11_000,
      spent: USD(1_100_000),
      phased: USD(1_000_000),
      runId: first.id,
    });

    // Running again at the same date raises nothing new for the budget.
    await runAndWait(request);
    expect(await alertsFor(request, b.id)).toHaveLength(1);
    // The same request key is one run, not two.
    const key = randomUUID();
    const once = await runAndWait(request, key);
    const replay = await request.post('/api/burn-rate/runs', {
      headers: await mutate('finance-admin', key),
      data: {},
    });
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect((await expectContract(replay, 202, BurnRateRun)).id).toBe(once.id);

    // Just under 125% stays "ahead"; exactly 125% is "well ahead", raised once.
    await openingBalance(request, b.id, 'actual', 149_999);
    await runAndWait(request);
    expect(await alertsFor(request, b.id)).toHaveLength(1);
    await openingBalance(request, b.id, 'actual', 1);
    await runAndWait(request);
    await runAndWait(request);
    const both = await alertsFor(request, b.id);
    expect(both.map((a) => a.level).sort()).toEqual(['ahead', 'well_ahead']);
    expect(both.find((a) => a.level === 'well_ahead')!.burnBps).toBe(12_500);

    // The owner was told through the existing notifications, once per alert.
    await expect
      .poll(
        async () => {
          const feed = await expectContract(
            await request.get('/api/notifications?limit=100', {
              headers: await as('budget-owner'),
            }),
            200,
            NotificationsFeed,
          );
          return feed.items.filter((n) => n.type === 'budget.burn_rate' && n.itemId === b.id)
            .length;
        },
        { timeout: 30_000, intervals: [500, 1000] },
      )
      .toBe(2);
    // Another owner cannot see the budget's alerts.
    const other = await expectContract(
      await request.get(`/api/burn-rate/alerts?budgetId=${b.id}`, {
        headers: await as('location-manager'),
      }),
      200,
      BurnRateAlertList,
    );
    expect(other.items).toHaveLength(0);
  });
});
