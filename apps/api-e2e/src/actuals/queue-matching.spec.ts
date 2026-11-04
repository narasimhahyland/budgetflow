// Invariants 15 and 3 (P6): unmatched lines are resolved from the queue - matched to a commitment, split
// across budgets or marked not budget-relevant - and an actual is matched at most once. Corrections are
// linked reversals (never edits) and return the line to the queue. A cross-source duplicate is flagged
// before matching and needs explicit confirmation.
import { expect, test } from '@playwright/test';
import { ActualDetail, ActualList, Journal } from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  actualByRef,
  buckets,
  commitmentState,
  createCommitment,
  csv,
  importAndPost,
  spendBudget,
  uniq,
} from './support';

test.describe('unmatched queue and manual matching', () => {
  test('a queued actual is split across a commitment and a budget, matched once, and a correction reverses it back to the queue', async ({
    request,
  }) => {
    const b1 = await spendBudget(request);
    const b2 = await spendBudget(request);
    const p = `Q${uniq()}`;
    const vendorName = `Riverside Retreats ${p}`;
    const vendor = await request.post('/api/finance/vendors', {
      headers: await mutate('finance-admin'),
      data: { name: vendorName, status: 'approved', country: 'IN' },
    });
    expect(vendor.status()).toBe(201);
    const c1 = await createCommitment({
      budgetId: b1.id,
      amountMinor: 60_000,
      description: 'Shared offsite venue',
      vendorId: ((await vendor.json()) as { id: string }).id,
    });
    await importAndPost(
      request,
      csv([`${p}-1,2026-11-03,1000.00,USD,HYL-IN,,6100,,${vendorName},Shared offsite,,,charge`]),
    );
    const queued = await actualByRef(request, `${p}-1`);
    expect(queued.actual.status).toBe('unmatched');
    expect(queued.candidates.some((c) => c.commitmentId === c1.id)).toBe(true);

    const split = await expectContract(
      await request.post(`/api/actuals/${queued.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: {
          parts: [{ commitmentId: c1.id, amountMinor: 60_000 }, { budgetId: b2.id }],
          note: 'Venue on India events, rest on the second team',
        },
      }),
      201,
      ActualDetail,
    );
    expect(split.actual).toMatchObject({ status: 'matched', matched: { amountMinor: 100_000 } });
    expect(split.matches.map((m) => [m.budgetId, m.transaction.amountMinor, m.fit])).toEqual([
      [b1.id, 60_000, 'exact'],
      [b2.id, 40_000, 'direct'],
    ]);
    expect((await buckets(request, b1.id)).balances.budgetCurrency).toMatchObject({
      actual: { amountMinor: 60_000 },
      encumbered: { amountMinor: 0 },
    });
    expect((await buckets(request, b2.id)).balances.budgetCurrency.actual.amountMinor).toBe(40_000);

    await expectProblem(
      await request.post(`/api/actuals/${queued.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ budgetId: b2.id }] },
      }),
      409,
      'ACTUAL_ALREADY_MATCHED',
    );

    const undone = await expectContract(
      await request.post(`/api/actuals/${queued.actual.id}/reversals`, {
        headers: await mutate('finance-controller'),
        data: { reasonCode: 'WRONG-BUDGET', reason: 'Split agreed with the wrong team' },
      }),
      200,
      ActualDetail,
    );
    expect(undone.actual).toMatchObject({ status: 'unmatched', matched: { amountMinor: 0 } });
    expect(undone.matches.every((m) => m.reversedAt !== null)).toBe(true);
    const original = await expectContract(
      await request.get(`/api/ledger/journals/${split.matches[0].journalIds[0]}`, {
        headers: await as('finance-controller'),
      }),
      200,
      Journal,
    );
    expect(original.reversedByJournalId).not.toBeNull();
    const reversal = await expectContract(
      await request.get(`/api/ledger/journals/${original.reversedByJournalId}`, {
        headers: await as('finance-controller'),
      }),
      200,
      Journal,
    );
    expect(reversal.lines.map((l) => l.transaction.amountMinor)).toEqual(
      original.lines.map((l) => -l.transaction.amountMinor),
    );
    expect((await buckets(request, b1.id)).balances.budgetCurrency).toMatchObject({
      actual: { amountMinor: 0 },
      encumbered: { amountMinor: 60_000 },
    });
    expect((await buckets(request, b2.id)).balances.budgetCurrency.actual.amountMinor).toBe(0);
    expect(await commitmentState(request, b1.id, c1.id)).toMatchObject({
      status: 'encumbered',
      encumbered: { amountMinor: 60_000 },
    });

    // Back in the queue, it can now be matched correctly.
    const queue = await expectContract(
      await request.get(`/api/actuals?q=${p}`, { headers: await as('finance-controller') }),
      200,
      ActualList,
    );
    expect(queue.items.map((i) => i.sourceRef)).toEqual([`${p}-1`]);
    await expectContract(
      await request.post(`/api/actuals/${queued.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ budgetId: b2.id }] },
      }),
      201,
      ActualDetail,
    );
  });

  test('a partial match keeps the line in the queue; not budget-relevant lines leave it; cross-source duplicates need confirmation', async ({
    request,
  }) => {
    const budget = await spendBudget(request);
    const p = `X${uniq()}`;
    await importAndPost(
      request,
      csv([
        `${p}-1,2026-11-03,120.00,USD,HYL-IN,,6100,,,Team lunch,,,charge`,
        `${p}-2,2026-11-03,77.00,USD,HYL-IN,,6100,,Metro Coffee ${p},Coffee,,,charge`,
        `${p}-3,2026-11-03,15.00,USD,HYL-IN,,6100,,,Personal item on corporate card,,,charge`,
      ]),
    );
    const lunch = await actualByRef(request, `${p}-1`);
    const partial = await expectContract(
      await request.post(`/api/actuals/${lunch.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ budgetId: budget.id, amountMinor: 8_000 }] },
      }),
      201,
      ActualDetail,
    );
    expect(partial.actual).toMatchObject({
      status: 'partially_matched',
      matched: { amountMinor: 8_000 },
    });
    const queue = await expectContract(
      await request.get(`/api/actuals?status=queue&q=${p}`, {
        headers: await as('finance-controller'),
      }),
      200,
      ActualList,
    );
    expect(queue.items.map((i) => i.sourceRef).sort()).toEqual([`${p}-1`, `${p}-2`, `${p}-3`]);

    const personal = await actualByRef(request, `${p}-3`);
    const excluded = await expectContract(
      await request.post(`/api/actuals/${personal.actual.id}/exclusion`, {
        headers: await mutate('finance-controller'),
        data: { reason: 'Personal spend, recovered from the employee' },
      }),
      200,
      ActualDetail,
    );
    expect(excluded.actual).toMatchObject({
      status: 'excluded',
      excludedReason: 'Personal spend, recovered from the employee',
    });
    await expectProblem(
      await request.post(`/api/actuals/${lunch.actual.id}/exclusion`, {
        headers: await mutate('finance-controller'),
        data: { reason: 'Not budget relevant' },
      }),
      409,
      'INVALID_TRANSITION',
    );

    // The same coffee arrives from the card feed: flagged before matching.
    await importAndPost(
      request,
      [
        'transaction_id,date,amount,currency,entity,account,merchant,description',
        `C${p},2026-11-03,77.00,USD,HYL-IN,6100,Metro Coffee ${p},Coffee`,
      ].join('\n'),
      { source: 'card' },
    );
    const dup = await actualByRef(request, `C${p}`);
    expect(dup.actual.duplicateOfActualId).not.toBeNull();
    expect(dup.actual.note).toContain('duplicate');
    await expectProblem(
      await request.post(`/api/actuals/${dup.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ budgetId: budget.id }] },
      }),
      409,
      'ACTUAL_DUPLICATE_FLAGGED',
    );
    await expectContract(
      await request.post(`/api/actuals/${dup.actual.id}/exclusion`, {
        headers: await mutate('finance-controller'),
        data: { reason: 'Duplicate of the ERP line' },
      }),
      200,
      ActualDetail,
    );
  });
});
