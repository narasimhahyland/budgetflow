// Invariants 8 and 22 on commitments: a request in INR on a USD budget converts once at the locked plan
// rate; later movements reuse the stored rate, and the movement that clears the commitment relieves
// exactly the budget amount still posted (a true-up journal absorbs per-line rounding), so nothing drifts
// and every line still re-converts from its stored rate (the rebuild check stays clean).
import { expect, test } from '@playwright/test';
import { RequestDetail } from '@bf/contracts';
import { expectContract } from '../support/contract';
import {
  budget,
  decideOk,
  directorTree,
  getRequest,
  runLedgerCheck,
  spendingRequest,
  taskOf,
} from '../support/p5';

const inr = (amountMinor: number) => ({ amountMinor, currency: 'INR' });

test.describe('commitment relief in a non-budget currency', () => {
  test('a partial approval of an INR request leaves no rounding behind on the USD budget', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const before = await budget(request, team.id);
    // INR 1,000.00 is USD 12.01 at 83.25 (12.012...).
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, inr(100_000)),
      201,
      RequestDetail,
    );
    expect(r.budgetAmount).toEqual({ amountMinor: 1_201, currency: 'USD' });
    expect(
      (await budget(request, team.id)).balances.budgetCurrency.preEncumbered.amountMinor -
        before.balances.budgetCurrency.preEncumbered.amountMinor,
    ).toBe(1_201);

    // INR 333.50 rounds to USD 4.01 and the INR 666.50 remainder to USD 8.01: one cent too many if converted
    // afresh. The release relieves the USD 8.00 actually left.
    await decideOk(
      request,
      'department-head',
      await taskOf(request, 'department-head', 'request', r.id),
      {
        decision: 'approve_partial',
        approvedAmount: inr(33_350),
        reasonCode: 'REJ-BUDGET',
      },
    );
    const view = await getRequest(request, 'budget-owner', r.id);
    expect(view).toMatchObject({ status: 'partially_approved', approvedAmount: inr(33_350) });
    const after = await budget(request, team.id);
    expect(after.balances.budgetCurrency.preEncumbered).toEqual(
      before.balances.budgetCurrency.preEncumbered,
    );
    expect(
      after.balances.budgetCurrency.encumbered.amountMinor -
        before.balances.budgetCurrency.encumbered.amountMinor,
    ).toBe(401);

    // A rejected INR request releases exactly what it pre-encumbered.
    const rejected = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, inr(77_777)),
      201,
      RequestDetail,
    );
    await decideOk(
      request,
      'department-head',
      await taskOf(request, 'department-head', 'request', rejected.id),
      {
        decision: 'reject',
        comment: 'Not this quarter',
        noConflictAttested: false,
      },
    );
    expect((await budget(request, team.id)).balances.budgetCurrency.preEncumbered).toEqual(
      before.balances.budgetCurrency.preEncumbered,
    );

    expect((await runLedgerCheck(request)).status).toBe('clean');
  });
});
