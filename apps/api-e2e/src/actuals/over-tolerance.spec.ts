// Invariants 3 and 11 (P6): matched actuals stay within commitment + tolerance; above it the excess needs an
// over-budget request approved within the approver's delegation-of-authority limit, never by the requester.
// A direct charge beyond a hard-mode budget's available is blocked the same way.
import { expect, test } from '@playwright/test';
import { ActualDetail, OverBudgetRequest } from '@bf/contracts';
import { mutate } from '../support/auth';
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

test.describe('over tolerance needs an over-budget request', () => {
  test('an actual above commitment + tolerance waits in the queue until an over-budget request is approved within DoA', async ({
    request,
  }) => {
    const budget = await spendBudget(request, { owner: 'location-manager' });
    const c = await createCommitment({
      budgetId: budget.id,
      amountMinor: 100_000,
      description: 'Offsite catering',
    });
    const big = await createCommitment({
      budgetId: budget.id,
      amountMinor: 100_000,
      description: 'Offsite venue',
    });
    const p = `O${uniq()}`;
    const batch = await importAndPost(
      request,
      csv([
        `${p}-1,2026-11-03,1300.00,USD,HYL-IN,,6100,,,Catering with extra guests,${c.reference},,charge`,
        `${p}-2,2026-11-03,4000.00,USD,HYL-IN,,6100,,,Venue upgrade,${big.reference},,charge`,
      ]),
    );
    expect(batch.summary).toMatchObject({ unmatched: 2 });
    const line = await actualByRef(request, `${p}-1`);
    expect(line.actual.note).toContain('over-budget');
    expect(line.candidates.find((x) => x.commitmentId === c.id)).toMatchObject({
      fit: 'over_tolerance',
      differenceMinor: 30_000,
      toleranceMinor: 1_000,
    });

    await expectProblem(
      await request.post(`/api/actuals/${line.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ commitmentId: c.id }] },
      }),
      409,
      'MATCH_OVER_TOLERANCE',
    );

    const req = await expectContract(
      await request.post(`/api/actuals/${line.actual.id}/over-budget-requests`, {
        headers: await mutate('finance-controller'),
        data: { commitmentId: c.id, purpose: 'Twenty extra guests confirmed on the day' },
      }),
      201,
      OverBudgetRequest,
    );
    expect(req).toMatchObject({
      status: 'pending_approval',
      amount: { amountMinor: 30_000, currency: 'USD' },
      budgetId: budget.id,
    });

    await expectProblem(
      await request.post(`/api/actuals/over-budget-requests/${req.id}/decision`, {
        headers: await mutate('finance-controller'),
        data: { decision: 'approve' },
      }),
      409,
      'SELF_APPROVAL',
    );
    expect([403, 404]).toContain(
      (
        await request.post(`/api/actuals/over-budget-requests/${req.id}/decision`, {
          headers: await mutate('employee'),
          data: { decision: 'approve' },
        })
      ).status(),
    );
    const approved = await expectContract(
      await request.post(`/api/actuals/over-budget-requests/${req.id}/decision`, {
        headers: await mutate('location-manager'),
        data: { decision: 'approve' },
      }),
      200,
      OverBudgetRequest,
    );
    expect(approved).toMatchObject({ status: 'approved', approved: { amountMinor: 30_000 } });

    const before = await buckets(request, budget.id);
    const matched = await expectContract(
      await request.post(`/api/actuals/${line.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ commitmentId: c.id }] },
      }),
      201,
      ActualDetail,
    );
    expect(matched.matches[0]).toMatchObject({
      fit: 'over_tolerance',
      relief: { amountMinor: 100_000 },
      excess: { amountMinor: 30_000 },
    });
    const after = await buckets(request, budget.id);
    expect(after.balances.available.amountMinor).toBe(
      before.balances.available.amountMinor - 30_000,
    );
    expect(await commitmentState(request, budget.id, c.id)).toMatchObject({ status: 'consumed' });

    // A USD 3,000 excess is above the location manager's USD 2,500 limit: the finance controller approves instead.
    const second = await actualByRef(request, `${p}-2`);
    const bigReq = await expectContract(
      await request.post(`/api/actuals/${second.actual.id}/over-budget-requests`, {
        headers: await mutate('finance-admin'),
        data: { commitmentId: big.id, purpose: 'Venue upgrade after headcount grew' },
      }),
      201,
      OverBudgetRequest,
    );
    await expectProblem(
      await request.post(`/api/actuals/over-budget-requests/${bigReq.id}/decision`, {
        headers: await mutate('location-manager'),
        data: { decision: 'approve' },
      }),
      409,
      'DOA_LIMIT_EXCEEDED',
    );
    await expectContract(
      await request.post(`/api/actuals/over-budget-requests/${bigReq.id}/decision`, {
        headers: await mutate('finance-controller'),
        data: { decision: 'approve' },
      }),
      200,
      OverBudgetRequest,
    );
    await expectContract(
      await request.post(`/api/actuals/${second.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ commitmentId: big.id }] },
      }),
      201,
      ActualDetail,
    );
  });

  test('a direct charge beyond a hard-mode budget’s available is blocked until approved; a rejection needs a reason', async ({
    request,
  }) => {
    const budget = await spendBudget(request, { amountMinor: 100_000 });
    const p = `H${uniq()}`;
    await importAndPost(
      request,
      csv([`${p}-1,2026-11-03,1500.00,USD,HYL-IN,,6100,,,Unplanned AV hire,,,charge`]),
    );
    const line = await actualByRef(request, `${p}-1`);
    await expectProblem(
      await request.post(`/api/actuals/${line.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ budgetId: budget.id }] },
      }),
      409,
      'INSUFFICIENT_AVAILABLE',
    );
    const req = await expectContract(
      await request.post(`/api/actuals/${line.actual.id}/over-budget-requests`, {
        headers: await mutate('finance-admin'),
        data: { budgetId: budget.id, purpose: 'AV failure on the day, replacement hired' },
      }),
      201,
      OverBudgetRequest,
    );
    expect(req.amount.amountMinor).toBe(50_000);
    await expectProblem(
      await request.post(`/api/actuals/over-budget-requests/${req.id}/decision`, {
        headers: await mutate('finance-controller'),
        data: { decision: 'reject' },
      }),
      422,
      'REASON_REQUIRED',
    );
    await expectContract(
      await request.post(`/api/actuals/over-budget-requests/${req.id}/decision`, {
        headers: await mutate('finance-controller'),
        data: { decision: 'approve' },
      }),
      200,
      OverBudgetRequest,
    );
    // The approval covers the USD 500 beyond available, so the charge posts and available goes below zero (audited).
    await expectContract(
      await request.post(`/api/actuals/${line.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ budgetId: budget.id }] },
      }),
      201,
      ActualDetail,
    );
    expect((await buckets(request, budget.id)).balances.available.amountMinor).toBe(-50_000);
  });
});
