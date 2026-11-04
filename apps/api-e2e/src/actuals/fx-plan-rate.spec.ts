// Invariant 8 on actuals: local-currency actuals (INR, EUR) consume the USD budget at the locked plan rate
// with the currency triplet stored; the FX effect against the month-end rate posts to fx_variance on
// counter accounts only and never consumes budget. Commitment relief reuses the budget amount posted on
// the commitment, so partial INR invoices against a USD commitment leave no FX drift.
import { expect, test } from '@playwright/test';
import { Journal } from '@bf/contracts';
import { as } from '../support/auth';
import { expectContract } from '../support/contract';
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

test.describe('actuals in local currency at the locked plan rate', () => {
  test('INR and EUR actuals consume budget at the plan rate; the FX effect is posted separately and never consumes budget', async ({
    request,
  }) => {
    const budget = await spendBudget(request);
    const inrCommitment = await createCommitment({ budgetId: budget.id, amountMinor: 150_000 });
    const eurCommitment = await createCommitment({ budgetId: budget.id, amountMinor: 100_000 });
    const before = await buckets(request, budget.id);
    const p = `F${uniq()}`;
    // October lines: their period is soft-closed, so they post to the next open period, flagged late.
    await importAndPost(
      request,
      csv([
        `${p}-INR,2026-10-14,124500.00,INR,HYL-IN,,6100,,,Annual Day tasting,${inrCommitment.reference},,charge`,
        `${p}-EUR,2026-10-14,920.00,EUR,HYL-IN,,6100,,,Venue Berlin,${eurCommitment.reference},,charge`,
      ]),
    );

    const inr = await actualByRef(request, `${p}-INR`);
    expect(inr.actual).toMatchObject({
      transaction: { amountMinor: 12_450_000, currency: 'INR' },
      reporting: { amountMinor: 149_550, currency: 'USD' },
      planRate: '0.012012012012',
      actualRate: { type: 'month_end' },
      actualReporting: { amountMinor: 148_179, currency: 'USD' },
      fxEffect: { amountMinor: -1_371, currency: 'USD' },
      budget: { amountMinor: 149_550, currency: 'USD' },
      status: 'matched',
    });
    const eur = await actualByRef(request, `${p}-EUR`);
    expect(eur.actual).toMatchObject({
      reporting: { amountMinor: 100_000 },
      actualReporting: { amountMinor: 97_872 },
      fxEffect: { amountMinor: -2_128 },
    });

    // Budget actual moved by the plan-rate amounts only.
    const after = await buckets(request, budget.id);
    expect(
      after.balances.budgetCurrency.actual.amountMinor -
        before.balances.budgetCurrency.actual.amountMinor,
    ).toBe(149_550 + 100_000);

    // Journals: the actual journal carries the triplet; the FX journal touches counter accounts only.
    const journals = await Promise.all(
      inr.matches[0].journalIds.map(async (id) =>
        expectContract(
          await request.get(`/api/ledger/journals/${id}`, {
            headers: await as('finance-controller'),
          }),
          200,
          Journal,
        ),
      ),
    );
    const charge = journals.find((j) => j.lines.some((l) => l.account === 'actual'))!;
    expect(charge.late).toBe(true);
    expect(charge.lines.find((l) => l.account === 'actual')).toMatchObject({
      transaction: { amountMinor: 12_450_000, currency: 'INR' },
      budget: { amountMinor: 149_550, currency: 'USD' },
      reporting: { amountMinor: 149_550, currency: 'USD' },
    });
    const fx = journals.find((j) => j.lines.some((l) => l.account === 'fx_variance'))!;
    expect(fx.lines.every((l) => l.budgetId === null)).toBe(true);
    expect(fx.lines.find((l) => l.account === 'fx_variance')!.reporting).toEqual({
      amountMinor: -1_371,
      currency: 'USD',
    });
    expect(fx.balanced).toBe(true);

    // The INR invoice was 4.50 under the USD commitment (within 1%): consumed and the difference released.
    expect(await commitmentState(request, budget.id, inrCommitment.id)).toMatchObject({
      status: 'consumed',
      encumbered: { amountMinor: 0 },
    });
    expect(after.balances.budgetCurrency.encumbered.amountMinor).toBe(
      before.balances.budgetCurrency.encumbered.amountMinor - 150_000 - 100_000,
    );
  });

  test('three INR invoices against a USD commitment relieve exactly what the commitment encumbered (no FX drift)', async ({
    request,
  }) => {
    const budget = await spendBudget(request);
    const c = await createCommitment({ budgetId: budget.id, amountMinor: 10_000 });
    const p = `D${uniq()}`;
    const line = (n: number) =>
      `${p}-${n},2026-11-0${n + 1},2775.00,INR,HYL-IN,,6100,,,Instalment ${n},${c.reference},,charge`;
    const batch = await importAndPost(request, csv([line(1), line(2), line(3)]));
    expect(batch.summary.posted).toMatchObject({ matched: 3, toQueue: 0 });
    const parts = await Promise.all([1, 2, 3].map((n) => actualByRef(request, `${p}-${n}`)));
    expect(parts.map((x) => x.actual.budget?.amountMinor)).toEqual([3_333, 3_333, 3_333]);
    expect(parts.map((x) => x.matches[0].fit)).toEqual([
      'partial',
      'partial',
      'under_within_tolerance',
    ]);
    expect(parts[2].matches[0]).toMatchObject({
      relief: { amountMinor: 3_334 },
      released: { amountMinor: 1 },
    });
    expect(await commitmentState(request, budget.id, c.id)).toMatchObject({
      status: 'consumed',
      encumbered: { amountMinor: 0 },
    });
    const b = await buckets(request, budget.id);
    expect(b.balances.budgetCurrency.encumbered.amountMinor).toBe(0);
    expect(b.balances.budgetCurrency.actual.amountMinor).toBe(9_999);
  });
});
