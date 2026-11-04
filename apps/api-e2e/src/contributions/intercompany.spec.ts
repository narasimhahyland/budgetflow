// Invariant 14: cross-entity contributions follow the intercompany policy: blocked pairs are refused up
// front; recharge with markup posts a balanced due-from / due-to journal at approval; recharge at cost
// with a tax approver waits for that approver, and the event cannot close until the recharge is approved.
import { expect, test } from '@playwright/test';
import {
  CandidateGivingBudgetList,
  CloseEventResponse,
  ContributionDetail,
  EventDetail,
  Journal,
  RechargeList,
  RechargeView,
} from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  approvedEvent,
  contribute,
  decideOk,
  directorTree,
  ENTITIES,
  eventAction,
  fundedChild,
  getContribution,
  taskOf,
  usd,
} from '../support/p5';

test.describe('intercompany policy on contributions', () => {
  test('block, recharge with markup and recharge at cost with tax approval; close waits for the recharge', async ({
    request,
  }) => {
    const { root, team } = await directorTree(request, { teamEntity: ENTITIES.india });
    const uk = await fundedChild(request, root.id, {
      owner: 'department-head',
      amountMinor: 1_000_000,
      legalEntityId: ENTITIES.uk,
    });
    const germany = await fundedChild(request, root.id, {
      owner: 'department-head',
      amountMinor: 1_000_000,
      legalEntityId: ENTITIES.germany,
    });
    const us = await fundedChild(request, root.id, {
      owner: 'department-head',
      amountMinor: 1_000_000,
      legalEntityId: ENTITIES.us,
    });
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(1_000_000),
      ownFunds: usd(300_000),
      toleranceBps: 1000,
    });
    expect(event.legalEntityId).toBe(ENTITIES.india);

    // The candidate list says up front which givers are blocked (names and treatment only, no balances).
    const candidates = await expectContract(
      await request.get(`/api/contributions/candidate-budgets?eventId=${event.id}`, {
        headers: await as('budget-owner'),
      }),
      200,
      CandidateGivingBudgetList,
    );
    expect(candidates.items.find((c) => c.budgetId === uk.id)).toMatchObject({
      crossEntity: true,
      intercompanyMode: 'block',
    });
    expect(candidates.items.find((c) => c.budgetId === germany.id)).toMatchObject({
      intercompanyMode: 'recharge_with_markup',
    });

    // Blocked pair (UK -> India): refused, nothing created.
    await expectProblem(
      await contribute(request, 'budget-owner', {
        eventId: event.id,
        giverBudgetId: uk.id,
        amount: usd(100_000),
      }),
      409,
      'INTERCOMPANY_BLOCKED',
    );
    // Transfers only within one legal entity.
    await expectProblem(
      await contribute(request, 'budget-owner', {
        eventId: event.id,
        giverBudgetId: us.id,
        amount: usd(100_000),
        mode: 'transfer',
      }),
      422,
      'TRANSFER_NOT_ALLOWED',
    );

    // Germany -> India: recharge with a 5% markup, no tax approver: posted at approval.
    const de = await expectContract(
      await contribute(request, 'budget-owner', {
        eventId: event.id,
        giverBudgetId: germany.id,
        amount: usd(200_000),
      }),
      201,
      ContributionDetail,
    );
    expect(de.intercompany).toMatchObject({
      crossEntity: true,
      mode: 'recharge_with_markup',
      markupBps: 500,
    });
    await decideOk(
      request,
      'department-head',
      await taskOf(request, 'department-head', 'contribution', de.id),
      { decision: 'approve' },
    );
    const deView = await getContribution(request, 'budget-owner', de.id);
    expect(deView.intercompany).toMatchObject({ rechargeStatus: 'approved' });
    const recharges = await expectContract(
      await request.get(`/api/recharges?eventId=${event.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      RechargeList,
    );
    const deRecharge = recharges.items.find((r) => r.contributionId === de.id)!;
    expect(deRecharge).toMatchObject({
      amount: usd(200_000),
      markup: usd(10_000),
      total: usd(210_000),
      status: 'approved',
    });
    const journal = await expectContract(
      await request.get(`/api/ledger/journals/${deRecharge.journalId}`, {
        headers: await as('finance-admin'),
      }),
      200,
      Journal,
    );
    expect(journal.balanced).toBe(true);
    expect(
      journal.lines.map((l) => [l.account, l.legalEntityId, l.transaction.amountMinor]),
    ).toEqual([
      ['intercompany_due_from', ENTITIES.germany, 210_000],
      ['intercompany_due_to', ENTITIES.india, -210_000],
    ]);

    // US -> India: tenant default, recharge at cost with the finance controller as tax approver.
    const usC = await expectContract(
      await contribute(request, 'budget-owner', {
        eventId: event.id,
        giverBudgetId: us.id,
        amount: usd(150_000),
      }),
      201,
      ContributionDetail,
    );
    await decideOk(
      request,
      'department-head',
      await taskOf(request, 'department-head', 'contribution', usC.id),
      { decision: 'approve' },
    );
    const pending = (await getContribution(request, 'budget-owner', usC.id)).intercompany!;
    expect(pending).toMatchObject({
      mode: 'recharge_at_cost',
      rechargeStatus: 'pending_tax_approval',
      taxApproverName: 'Daniel Weber',
    });

    // The event cannot close while a cross-entity contribution lacks its approved recharge.
    for (const verb of ['confirm-funding', 'start', 'complete']) {
      expect((await eventAction(request, 'budget-owner', event.id, verb)).status()).toBe(200);
    }
    await expectProblem(
      await eventAction(request, 'budget-owner', event.id, 'close'),
      409,
      'EVENT_MISSING_RECHARGE',
    );

    // Only the named tax approver can approve the recharge; then the journal posts and the event closes.
    const approve = async (user: Parameters<typeof mutate>[0]) =>
      request.post(`/api/recharges/${pending.rechargeId}/approve`, { headers: await mutate(user) });
    expect((await approve('finance-admin')).status()).toBe(403);
    const approved = await expectContract(await approve('finance-controller'), 200, RechargeView);
    expect(approved).toMatchObject({ status: 'approved', total: usd(150_000), markup: usd(0) });
    expect(approved.journalId).toBeTruthy();

    const closed = await expectContract(
      await eventAction(request, 'budget-owner', event.id, 'close'),
      200,
      CloseEventResponse,
    );
    expect(closed.event.status).toBe('closed');
    expect((await getContribution(request, 'budget-owner', usC.id)).status).toBe('settled');
    const finalEvent = await expectContract(
      await request.get(`/api/events/${event.id}`, { headers: await as('budget-owner') }),
      200,
      EventDetail,
    );
    expect(finalEvent.recharges.every((r) => r.status === 'approved')).toBe(true);
  });
});
