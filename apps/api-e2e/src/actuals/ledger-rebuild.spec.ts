// Invariant 20 on Phase 6 postings: after matches in local currency (FX effect), partial and final matches,
// credit notes, source reversals, accruals and their auto-reversal, prepaid recognition, release and
// cancellation with fees, the worker's rebuild check finds cached balances equal to a rebuild from the
// ledger, every journal balanced, every triplet matching its stored rates and every reversal exact.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ActualDetail, AccrualRunResponse, IntegrityCheckRun } from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { actualByRef, createCommitment, csv, importAndPost, spendBudget, uniq } from './support';

async function runCheck(request: APIRequestContext) {
  const queued = await expectContract(
    await request.post('/api/integrity/ledger-checks', {
      headers: await mutate('finance-controller'),
    }),
    202,
    IntegrityCheckRun,
  );
  let run = queued;
  await expect
    .poll(
      async () => {
        run = await expectContract(
          await request.get(`/api/integrity/ledger-checks/${queued.id}`, {
            headers: await as('finance-controller'),
          }),
          200,
          IntegrityCheckRun,
        );
        return run.status;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toMatch(/^(clean|drift_detected|failed)$/);
  return run;
}

test.describe('ledger rebuild after actuals and accounting postings', () => {
  test('every Phase 6 posting kind leaves the ledger rebuildable and balanced', async ({
    request,
  }) => {
    const budget = await spendBudget(request);
    const c1 = await createCommitment(request, {
      budgetId: budget.id,
      amountMinor: 150_000,
      serviceEnd: '2026-10-30',
    });
    const c2 = await createCommitment(request, { budgetId: budget.id, amountMinor: 30_000 });
    const c3 = await createCommitment(request, {
      budgetId: budget.id,
      amountMinor: 50_000,
      serviceStart: '2026-12-01',
      serviceEnd: '2026-12-02',
      nonRefundableDepositMinor: 10_000,
    });
    const c4 = await createCommitment(request, {
      budgetId: budget.id,
      amountMinor: 20_000,
      serviceEnd: '2026-10-15',
    });
    const c5 = await createCommitment(request, { budgetId: budget.id, amountMinor: 70_000 });

    const accruals = await expectContract(
      await request.post('/api/actuals/accruals/proposals', {
        headers: await mutate('finance-controller'),
        data: { asOfDate: '2026-11-05', budgetId: budget.id },
      }),
      201,
      AccrualRunResponse,
    );
    for (const a of accruals.items)
      await request.post(`/api/actuals/accruals/${a.id}/approval`, {
        headers: await mutate('finance-controller'),
      });

    const p = `L${uniq()}`;
    await importAndPost(
      request,
      csv([
        `${p}-1,2026-10-14,62437.50,INR,HYL-IN,,6100,,,Partial INR invoice (FX effect),CMT-${c1.id.slice(-8).toUpperCase()},,charge`,
        `${p}-2,2026-11-03,300.00,USD,HYL-IN,,6100,,,Exact,CMT-${c2.id.slice(-8).toUpperCase()},,charge`,
        `${p}-3,2026-11-04,-30.00,USD,HYL-IN,,6100,,,Credit note,,${p}-2,credit_note`,
        `${p}-4,2026-11-04,100.00,USD,HYL-IN,,6100,,,Deposit,,,charge`,
        `${p}-5,2026-11-04,250.00,EUR,HYL-IN,,6140,,,EUR charge,CMT-${c5.id.slice(-8).toUpperCase()},,charge`,
      ]),
    );
    await importAndPost(
      request,
      csv([`${p}-6,2026-11-05,-250.00,EUR,HYL-IN,,6140,,,Reversal,,${p}-5,reversal`]),
    );
    const deposit = await actualByRef(request, `${p}-4`);
    await expectContract(
      await request.post(`/api/actuals/${deposit.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: {
          parts: [{ commitmentId: c3.id }],
          prepaid: { serviceStart: '2026-12-01', serviceEnd: '2026-12-02', nonRefundable: true },
        },
      }),
      201,
      ActualDetail,
    );
    await request.post('/api/actuals/prepaids/recognitions', {
      headers: await mutate('finance-controller'),
      data: { asOfDate: '2026-12-01', budgetId: budget.id },
    });
    await request.post('/api/actuals/accruals/auto-reversals', {
      headers: await mutate('finance-controller'),
      data: { asOfDate: '2026-12-01', budgetId: budget.id },
    });
    await request.post(`/api/actuals/commitments/${c4.id}/release`, {
      headers: await mutate('finance-controller'),
      data: { reasonCode: 'NO-INVOICE', reason: 'Never invoiced' },
    });
    expect(
      (
        await request.post(`/api/actuals/commitments/${c3.id}/cancellation`, {
          headers: await mutate('finance-controller'),
          data: { feeMinor: 5_000, reasonCode: 'CANCELLED', reason: 'Event moved online' },
        })
      ).status(),
    ).toBe(409); // partially consumed by the recognized deposit: release instead
    await request.post(`/api/actuals/commitments/${c3.id}/release`, {
      headers: await mutate('finance-controller'),
      data: { reasonCode: 'CANCELLED', reason: 'Event moved online' },
    });

    const run = await runCheck(request);
    expect(run.status, JSON.stringify(run.summary)).toBe('clean');
    expect(run.flagsRaised).toBe(0);
  });
});
