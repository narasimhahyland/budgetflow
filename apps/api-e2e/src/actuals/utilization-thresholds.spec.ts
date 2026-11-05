// Invariant 33 (P6 part): matched actuals feed utilization = (encumbered + actual) / authorized. A direct
// charge that lifts utilization past an owner alert threshold publishes `budget.threshold_crossed`; an actual
// matched within its commitment moves encumbered into actual, so utilization and alerts stay unchanged.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ActualDetail } from '@bf/contracts';
import { mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { asOwner } from '../support/db';
import {
  actualByRef,
  buckets,
  createCommitment,
  csv,
  importAndPost,
  spendBudget,
  uniq,
} from './support';

async function thresholdEvents(budgetId: string): Promise<unknown[]> {
  return asOwner(async (db) =>
    (
      await db.query<{ payload: Record<string, unknown> }>(
        `select payload from outbox_messages where topic = 'budget.threshold_crossed' and payload->>'budgetId' = $1
          order by created_at, id`,
        [budgetId],
      )
    ).rows.map((r) => r.payload['thresholdPct']),
  );
}

async function charge(
  request: APIRequestContext,
  ref: string,
  amount: string,
  part: { budgetId?: string; commitmentId?: string },
) {
  await importAndPost(
    request,
    csv([`${ref},2026-11-03,${amount},USD,HYL-IN,,6100,,,Scenario charge,,,charge`]),
  );
  const line = await actualByRef(request, ref);
  return expectContract(
    await request.post(`/api/actuals/${line.actual.id}/matches`, {
      headers: await mutate('finance-controller'),
      data: { parts: [part] },
    }),
    201,
    ActualDetail,
  );
}

test.describe('actuals feed utilization and owner alerts', () => {
  test('direct charges crossing 50% and 80% publish budget.threshold_crossed once each', async ({
    request,
  }) => {
    const budget = await spendBudget(request, { amountMinor: 100_000 });
    const p = `U${uniq()}`;
    await charge(request, `${p}-1`, '400.00', { budgetId: budget.id });
    expect(await thresholdEvents(budget.id)).toEqual([]);
    await charge(request, `${p}-2`, '200.00', { budgetId: budget.id });
    expect(await thresholdEvents(budget.id)).toEqual([50]);
    await charge(request, `${p}-3`, '250.00', { budgetId: budget.id });
    const after = await buckets(request, budget.id);
    expect(after.utilizationBps).toBe(8_500);
    expect(after.thresholdsReachedPct).toEqual([50, 80]);
    expect(await thresholdEvents(budget.id)).toEqual([50, 80]);
  });

  test('an actual matched within its commitment leaves utilization and alerts unchanged', async ({
    request,
  }) => {
    const budget = await spendBudget(request, { amountMinor: 100_000 });
    const c = await createCommitment({ budgetId: budget.id, amountMinor: 60_000 });
    expect((await buckets(request, budget.id)).utilizationBps).toBe(6_000);
    await charge(request, `U${uniq()}-1`, '600.00', { commitmentId: c.id });
    const after = await buckets(request, budget.id);
    expect(after.balances.budgetCurrency.actual.amountMinor).toBe(60_000);
    expect(after.balances.budgetCurrency.encumbered.amountMinor).toBe(0);
    expect(after.utilizationBps).toBe(6_000);
    expect(await thresholdEvents(budget.id)).toEqual([]);
  });
});
