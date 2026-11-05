// Invariant 10 (Phase 5 part): when a budget is set to zero, requests and Inter-Director Budget
// Contribution Requests still waiting on it are cancelled with the reason "budget set to zero", their
// pre-encumbrance is released and the requesters are emailed; when it is frozen they are held and no one
// can decide them until it is active again. New requests are refused with the reason; approved
// commitments stay visible and untouched; a reduction keeps them waiting. The worker reacts to the
// budget.control_changed messages Phase 4's control commands publish.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { ContributionDetail, RequestDetail } from '@bf/contracts';
import { expectContract, expectProblem } from '../support/contract';
import {
  applyControl,
  approvedEvent,
  budget,
  contribute,
  decideOk,
  decideTask,
  directorTree,
  fundedChild,
  getContribution,
  getRequest,
  spendingRequest,
  taskOf,
  usd,
  waitForMail,
} from '../support/p5';

const pollRequest = (request: APIRequestContext, id: string, pick: (r: RequestDetail) => unknown) =>
  expect.poll(async () => pick(await getRequest(request, 'budget-owner', id)), {
    timeout: 45_000,
    intervals: [500, 1000],
  });

test.describe('budget controls on waiting requests', () => {
  test('set to zero cancels waiting requests and contributions, releases them and keeps approved commitments', async ({
    request,
  }) => {
    const { root, team } = await directorTree(request);
    const approved = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(100_000)),
      201,
      RequestDetail,
    );
    await decideOk(
      request,
      'department-head',
      await taskOf(request, 'department-head', 'request', approved.id),
      { decision: 'approve' },
    );
    const base = await budget(request, team.id);
    const waiting = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(250_000)),
      201,
      RequestDetail,
    );
    expect((await budget(request, team.id)).balances.budgetCurrency.preEncumbered.amountMinor).toBe(
      base.balances.budgetCurrency.preEncumbered.amountMinor + 250_000,
    );

    // Another director asks the team budget for a contribution; it is waiting for Jordan.
    const other = await fundedChild(request, root.id, {
      owner: 'department-head',
      amountMinor: 2_000_000,
    });
    const event = await approvedEvent(request, 'department-head', 'ceo', {
      homeBudgetId: other.id,
      ownFunds: usd(300_000),
    });
    const asked = await expectContract(
      await contribute(request, 'department-head', {
        eventId: event.id,
        giverBudgetId: team.id,
        amount: usd(50_000),
      }),
      201,
      ContributionDetail,
    );
    expect(asked.status).toBe('pending_approval');

    await applyControl(request, team.id, 'set_to_zero');
    await pollRequest(request, waiting.id, (r) => r.status).toBe('cancelled');
    const cancelled = await getRequest(request, 'budget-owner', waiting.id);
    expect(cancelled.cancelReason).toBe('budget set to zero');
    expect(cancelled.route?.steps[0].status).toBe('cancelled');
    await expect
      .poll(async () => (await getContribution(request, 'department-head', asked.id)).status, {
        timeout: 30_000,
      })
      .toBe('cancelled');
    await waitForMail(
      'budget.owner@example.test',
      `Your request ${waiting.ref} was cancelled: budget set to zero`,
    );

    // Pre-encumbrance released; the approved commitment is still encumbered and visible.
    const after = await budget(request, team.id);
    expect(after.balances.budgetCurrency.preEncumbered).toEqual(
      base.balances.budgetCurrency.preEncumbered,
    );
    expect(after.balances.budgetCurrency.encumbered).toEqual(
      base.balances.budgetCurrency.encumbered,
    );
    expect((await getRequest(request, 'budget-owner', approved.id)).status).toBe('approved');

    // New requests and contributions against it are refused with the reason.
    await expectProblem(
      await spendingRequest(request, 'budget-owner', team.id, usd(1_000)),
      409,
      'BUDGET_SET_TO_ZERO',
    );
    await expectProblem(
      await contribute(request, 'department-head', {
        eventId: event.id,
        giverBudgetId: team.id,
        amount: usd(1_000),
      }),
      409,
      'BUDGET_SET_TO_ZERO',
    );
  });

  test('freeze holds waiting requests (no decision) and unfreezing releases them', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(80_000)),
      201,
      RequestDetail,
    );
    const task = await taskOf(request, 'department-head', 'request', r.id);

    await applyControl(request, team.id, 'freeze');
    await pollRequest(request, r.id, (x) => x.onHold).toBe(true);
    expect((await getRequest(request, 'budget-owner', r.id)).status).toBe('pending_approval');
    await expectProblem(
      await decideTask(request, 'department-head', task, { decision: 'approve' }),
      409,
      'REQUEST_ON_HOLD',
    );
    await expectProblem(
      await spendingRequest(request, 'budget-owner', team.id, usd(1_000)),
      409,
      'BUDGET_FROZEN',
    );

    await applyControl(request, team.id, 'unfreeze');
    await pollRequest(request, r.id, (x) => x.onHold).toBe(false);
    const ok = await decideOk(request, 'department-head', task, { decision: 'approve' });
    expect(ok.subjectStatus).toBe('approved');
  });

  test('a reduction keeps waiting requests decidable', async ({ request }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(80_000)),
      201,
      RequestDetail,
    );
    const task = await taskOf(request, 'department-head', 'request', r.id);
    const cut = await applyControl(request, team.id, 'reduce', 10_000);
    expect(cut.budget.status).toBe('reduced');
    const after = await getRequest(request, 'budget-owner', r.id);
    expect(after).toMatchObject({ status: 'pending_approval', onHold: false });
    const ok = await decideOk(request, 'department-head', task, { decision: 'approve' });
    expect(ok.subjectStatus).toBe('approved');
  });
});
