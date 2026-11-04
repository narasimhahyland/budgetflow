// Invariant 11: routing follows the budget hierarchy and the DoA table. The requester is skipped; an
// owner whose limit does not cover the amount escalates upward (exactly at the limit passes, one cent
// above escalates); finance review joins at the amount threshold or when little would be left; an
// approval encumbers the approved amount and releases the rest of the pre-encumbrance.
import { expect, test } from '@playwright/test';
import { RequestDetail } from '@bf/contracts';
import { expectContract } from '../support/contract';
import {
  budget,
  decideOk,
  directorTree,
  fundedChild,
  getRequest,
  spendingRequest,
  taskOf,
  usd,
} from '../support/p5';

test.describe('approval routing by hierarchy and delegation of authority', () => {
  test('requester skipped, owner within limit approves; exactly at the limit adds finance review; one cent above escalates', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const before = await budget(request, team.id);

    const small = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(500_000)),
      201,
      RequestDetail,
    );
    expect(small.status).toBe('pending_approval');
    expect(small.route?.skipped).toEqual([
      expect.objectContaining({ personName: 'Jordan Smith', reason: 'requester' }),
    ]);
    expect(small.route?.steps.map((s) => [s.personName, s.resolver, s.limit?.amountMinor])).toEqual(
      [['Lena Fischer', 'parent_owner', 1_000_000]],
    );
    expect(small.impact?.thisRequest).toEqual(usd(500_000));

    const atLimit = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(1_000_000)),
      201,
      RequestDetail,
    );
    expect(atLimit.route?.steps.map((s) => [s.personName, s.resolver])).toEqual([
      ['Lena Fischer', 'parent_owner'],
      ['Daniel Weber', 'finance_review'],
    ]);
    expect(atLimit.route?.explanation.join(' ')).toContain('finance review threshold');

    const over = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(1_000_001)),
      201,
      RequestDetail,
    );
    expect(over.route?.skipped.map((s) => [s.personName, s.reason])).toEqual([
      ['Jordan Smith', 'requester'],
      ['Lena Fischer', 'above_limit'],
    ]);
    expect(over.route?.steps.map((s) => [s.personName, s.resolver, s.limit?.amountMinor])).toEqual([
      ['Morgan Lee', 'parent_owner', 25_000_000],
      ['Daniel Weber', 'finance_review', 10_000_000],
    ]);

    // Submitting pre-encumbers every request on the budget.
    const pending = await budget(request, team.id);
    expect(
      pending.balances.budgetCurrency.preEncumbered.amountMinor -
        before.balances.budgetCurrency.preEncumbered.amountMinor,
    ).toBe(2_500_001);

    // Lena approves the small one: encumbered, pre-encumbrance released, one step only.
    const decided = await decideOk(
      request,
      'department-head',
      await taskOf(request, 'department-head', 'request', small.id),
      {
        decision: 'approve',
      },
    );
    expect(decided).toMatchObject({ subjectStatus: 'approved', nextApproverName: null });

    // At the limit: Lena's step passes it on to finance review, which approves part.
    const step1 = await decideOk(
      request,
      'department-head',
      await taskOf(request, 'department-head', 'request', atLimit.id),
      {
        decision: 'approve',
      },
    );
    expect(step1).toMatchObject({
      subjectStatus: 'pending_approval',
      nextApproverName: 'Daniel Weber',
    });
    const step2 = await decideOk(
      request,
      'finance-controller',
      await taskOf(request, 'finance-controller', 'request', atLimit.id),
      {
        decision: 'approve_partial',
        approvedAmount: usd(800_000),
        reasonCode: 'REJ-BUDGET',
        comment: 'Approved up to the quarterly plan.',
      },
    );
    expect(step2).toMatchObject({
      subjectStatus: 'partially_approved',
      approvedAmount: usd(800_000),
    });
    const view = await getRequest(request, 'budget-owner', atLimit.id);
    expect(view.route?.steps.map((s) => s.status)).toEqual(['approved', 'partially_approved']);
    expect(view.approvedAmount).toEqual(usd(800_000));

    const after = await budget(request, team.id);
    expect(
      after.balances.budgetCurrency.encumbered.amountMinor -
        before.balances.budgetCurrency.encumbered.amountMinor,
    ).toBe(1_300_000);
    expect(
      after.balances.budgetCurrency.preEncumbered.amountMinor -
        before.balances.budgetCurrency.preEncumbered.amountMinor,
    ).toBe(1_000_001);
  });

  test('an approver can escalate to the next authority up the hierarchy', async ({ request }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(300_000)),
      201,
      RequestDetail,
    );
    const escalated = await decideOk(
      request,
      'department-head',
      await taskOf(request, 'department-head', 'request', r.id),
      {
        decision: 'escalate',
        comment: 'Needs the program owner.',
      },
    );
    expect(escalated.nextApproverName).toBe('Morgan Lee');
    const view = await getRequest(request, 'budget-owner', r.id);
    expect(view.route?.steps.map((s) => [s.personName, s.status])).toEqual([
      ['Lena Fischer', 'escalated'],
      ['Morgan Lee', 'pending'],
    ]);
    const approved = await decideOk(request, 'ceo', await taskOf(request, 'ceo', 'request', r.id), {
      decision: 'approve',
    });
    expect(approved.subjectStatus).toBe('approved');
  });

  test('leaving less than 10% of the budget adds a finance review even for a small amount', async ({
    request,
  }) => {
    const { dept } = await directorTree(request);
    const tight = await fundedChild(request, dept.id, {
      owner: 'budget-owner',
      amountMinor: 100_000,
      as: 'department-head',
    });
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', tight.id, usd(95_000)),
      201,
      RequestDetail,
    );
    expect(r.route?.steps.map((s) => s.resolver)).toEqual(['parent_owner', 'finance_review']);
    expect(r.route?.explanation.join(' ')).toContain('less than 10% left');
    expect(r.impact?.warning).toContain('less than 10% left');
  });
});
