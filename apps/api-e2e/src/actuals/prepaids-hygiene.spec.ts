// Invariant 16 (P6): a deposit matched as a prepaid is consumed in its service period (straight-line by day),
// not when it is paid. Commitment hygiene shows aging and release prompts; releasing relieves what is left
// and cancelling consumes the cancellation fee, at least any non-refundable deposit.
import { expect, test } from '@playwright/test';
import {
  ActualDetail,
  CommitmentHygieneItem,
  CommitmentHygieneList,
  PrepaidList,
  PrepaidRunResponse,
} from '@bf/contracts';
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

test.describe('prepaids and commitment hygiene', () => {
  test('a venue deposit is consumed across its service days, not when paid', async ({
    request,
  }) => {
    const budget = await spendBudget(request);
    const venue = await createCommitment({
      budgetId: budget.id,
      amountMinor: 200_000,
      serviceStart: '2026-12-05',
      serviceEnd: '2026-12-06',
      description: 'Venue hire',
      nonRefundableDepositMinor: 60_000,
    });
    const p = `P${uniq()}`;
    await importAndPost(
      request,
      csv([`${p}-1,2026-11-04,600.00,USD,HYL-IN,,6100,,,Venue deposit,,,charge`]),
    );
    const line = await actualByRef(request, `${p}-1`);
    const before = await buckets(request, budget.id);
    await expectContract(
      await request.post(`/api/actuals/${line.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: {
          parts: [{ commitmentId: venue.id }],
          prepaid: { serviceStart: '2026-12-05', serviceEnd: '2026-12-06', nonRefundable: true },
        },
      }),
      201,
      ActualDetail,
    );
    const paid = await buckets(request, budget.id);
    expect(paid.balances.budgetCurrency.actual.amountMinor).toBe(
      before.balances.budgetCurrency.actual.amountMinor,
    );
    expect(paid.balances.budgetCurrency.encumbered.amountMinor).toBe(
      before.balances.budgetCurrency.encumbered.amountMinor,
    );
    const list = await expectContract(
      await request.get('/api/actuals/prepaids', { headers: await as('finance-controller') }),
      200,
      PrepaidList,
    );
    expect(list.items.find((x) => x.commitmentId === venue.id)).toMatchObject({
      amount: { amountMinor: 60_000 },
      recognized: { amountMinor: 0 },
      nonRefundable: true,
    });

    const recognize = async (asOfDate: string) =>
      expectContract(
        await request.post('/api/actuals/prepaids/recognitions', {
          headers: await mutate('finance-controller'),
          data: { asOfDate, budgetId: budget.id },
        }),
        200,
        PrepaidRunResponse,
      );
    expect((await recognize('2026-11-30')).recognizedMinor).toBe(0);
    expect((await recognize('2026-12-05')).recognizedMinor).toBe(30_000);
    expect((await recognize('2026-12-05')).recognizedMinor).toBe(0);
    expect((await recognize('2026-12-06')).recognizedMinor).toBe(30_000);
    const done = await buckets(request, budget.id);
    expect(
      done.balances.budgetCurrency.actual.amountMinor -
        before.balances.budgetCurrency.actual.amountMinor,
    ).toBe(60_000);
    expect(
      before.balances.budgetCurrency.encumbered.amountMinor -
        done.balances.budgetCurrency.encumbered.amountMinor,
    ).toBe(60_000);
    expect(await commitmentState(request, budget.id, venue.id)).toMatchObject({
      status: 'partially_consumed',
      encumbered: { amountMinor: 140_000 },
      prepaid: { amountMinor: 0 },
    });
  });

  test('aging and release prompts; release relieves the rest; cancellation consumes at least the non-refundable deposit', async ({
    request,
  }) => {
    const budget = await spendBudget(request);
    const stale = await createCommitment({
      budgetId: budget.id,
      amountMinor: 30_000,
      serviceStart: '2026-09-01',
      serviceEnd: '2026-09-02',
      description: 'Old team lunch',
    });
    const booked = await createCommitment({
      budgetId: budget.id,
      amountMinor: 120_000,
      serviceStart: '2026-12-10',
      serviceEnd: '2026-12-10',
      description: 'Boat cruise',
      nonRefundableDepositMinor: 40_000,
    });
    const hygiene = await expectContract(
      await request.get(`/api/actuals/commitments?budgetId=${budget.id}&asOfDate=2026-11-05`, {
        headers: await as('finance-controller'),
      }),
      200,
      CommitmentHygieneList,
    );
    expect(hygiene.items.find((i) => i.id === stale.id)).toMatchObject({
      daysPast: 64,
      agingBucket: '61-90',
      releasePrompt: true,
    });
    expect(hygiene.items.find((i) => i.id === booked.id)).toMatchObject({
      agingBucket: 'current',
      releasePrompt: false,
    });
    expect(hygiene.totals).toMatchObject({
      open: 2,
      prompts: 1,
      encumbered: { amountMinor: 150_000 },
    });

    const released = await expectContract(
      await request.post(`/api/actuals/commitments/${stale.id}/release`, {
        headers: await mutate('finance-controller'),
        data: { reasonCode: 'NO-INVOICE', reason: 'Invoice never arrived; lunch was cancelled' },
      }),
      200,
      CommitmentHygieneItem,
    );
    expect(released).toMatchObject({
      status: 'released',
      encumbered: { amountMinor: 0 },
      released: { amountMinor: 30_000 },
    });

    const available = (await buckets(request, budget.id)).balances.available.amountMinor;
    const cancelled = await expectContract(
      await request.post(`/api/actuals/commitments/${booked.id}/cancellation`, {
        headers: await mutate('finance-controller'),
        data: {
          feeMinor: 10_000,
          reasonCode: 'EVENT-CANCELLED',
          reason: 'Weather warning, cruise cancelled',
        },
      }),
      200,
      CommitmentHygieneItem,
    );
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      encumbered: { amountMinor: 0 },
      fees: { amountMinor: 40_000 },
      consumed: { amountMinor: 40_000 },
      released: { amountMinor: 80_000 },
    });
    const after = await buckets(request, budget.id);
    expect(after.balances.budgetCurrency.actual.amountMinor).toBe(40_000);
    expect(after.balances.available.amountMinor).toBe(available + 80_000);
    await expectProblem(
      await request.post(`/api/actuals/commitments/${booked.id}/release`, {
        headers: await mutate('finance-controller'),
        data: { reasonCode: 'X', reason: 'Already cancelled' },
      }),
      409,
      'INVALID_TRANSITION',
    );
  });
});
