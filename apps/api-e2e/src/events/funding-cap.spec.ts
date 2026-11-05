// Invariant 16 (Phase 5 part) and the funding cap: an event never raises more than its estimate plus
// tolerance; commitments draw on the funding sources pro rata by funded share (the consumption order) at
// the locked plan rate; releasing a commitment returns exactly what it took; closing returns the surplus
// to each contributor by share, every earmark ends at zero, and the ledger rebuild check stays clean.
import { expect, test } from '@playwright/test';
import {
  CloseEventResponse,
  ContributionDetail,
  EventCommitment,
  EventDetail,
} from '@bf/contracts';
import { mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  approvedEvent,
  budget,
  contribute,
  decideOk,
  directorTree,
  eventAction,
  fundedChild,
  getContribution,
  getEvent,
  runLedgerCheck,
  taskOf,
  usd,
} from '../support/p5';

const inr = (amountMinor: number) => ({ amountMinor, currency: 'INR' });

test.describe('event funding cap, consumption order and surplus return', () => {
  test('cap, pro-rata commitments, exact release and surplus returned by share at close', async ({
    request,
  }) => {
    const { root, team } = await directorTree(request);
    const giver = await fundedChild(request, root.id, {
      owner: 'department-head',
      amountMinor: 2_000_000,
    });
    const teamBefore = await budget(request, team.id);
    const giverBefore = await budget(request, giver.id);
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(1_000_000),
      ownFunds: usd(600_000),
      toleranceBps: 1000,
    });
    expect(event.funding).toMatchObject({
      ceiling: usd(1_100_000),
      ownFunds: usd(600_000),
      cap: usd(600_000),
      gap: usd(400_000),
    });

    // Estimate + tolerance caps what the event may raise.
    const tooMuch = await expectProblem(
      await contribute(request, 'budget-owner', {
        eventId: event.id,
        giverBudgetId: giver.id,
        amount: usd(600_000),
      }),
      409,
      'FUNDING_CAP_EXCEEDED',
    );
    expect(tooMuch.params).toMatchObject({ ceilingMinor: 1_100_000, maxMinor: 500_000 });
    const c = await expectContract(
      await contribute(request, 'budget-owner', {
        eventId: event.id,
        giverBudgetId: giver.id,
        amount: usd(400_000),
      }),
      201,
      ContributionDetail,
    );
    await decideOk(
      request,
      'department-head',
      await taskOf(request, 'department-head', 'contribution', c.id),
      { decision: 'approve' },
    );
    const funded = await getEvent(request, 'budget-owner', event.id);
    expect(funded.status).toBe('funded');
    expect(funded.funding).toMatchObject({ cap: usd(1_000_000), fullyFunded: true });
    expect(funded.sources.map((s) => [s.kind, s.sharePct])).toEqual([
      ['own', 6000],
      ['contribution', 4000],
    ]);

    const commit = async (amount: { amountMinor: number; currency: string }) =>
      request.post(`/api/events/${event.id}/commitments`, {
        headers: await mutate('budget-owner'),
        data: { description: 'Venue and catering', amount },
      });

    // USD 5,000.00 splits 60/40 across the sources and moves held to encumbered on each budget.
    const venue = await expectContract(await commit(usd(500_000)), 201, EventCommitment);
    expect(venue.fundingLines.map((l) => [l.budgetId, l.sourceKind, l.amount.amountMinor])).toEqual(
      [
        [team.id, 'own', 300_000],
        [giver.id, 'contribution', 200_000],
      ],
    );
    const teamMid = await budget(request, team.id);
    const giverMid = await budget(request, giver.id);
    expect(
      teamMid.balances.budgetCurrency.held.amountMinor -
        teamBefore.balances.budgetCurrency.held.amountMinor,
    ).toBe(300_000);
    expect(
      teamMid.balances.budgetCurrency.encumbered.amountMinor -
        teamBefore.balances.budgetCurrency.encumbered.amountMinor,
    ).toBe(300_000);
    expect(
      giverMid.balances.budgetCurrency.held.amountMinor -
        giverBefore.balances.budgetCurrency.held.amountMinor,
    ).toBe(200_000);
    expect(
      giverMid.balances.budgetCurrency.encumbered.amountMinor -
        giverBefore.balances.budgetCurrency.encumbered.amountMinor,
    ).toBe(200_000);

    // Above the cap: refused.
    await expectProblem(await commit(usd(500_001)), 409, 'FUNDING_CAP_EXCEEDED');

    // INR 41,625.00 is USD 500.00 at the locked plan rate (83.25); it draws 60/40 as well.
    const inrCommit = await expectContract(await commit(inr(4_162_500)), 201, EventCommitment);
    expect(inrCommit.budgetAmount).toEqual(usd(50_000));
    expect(inrCommit.fundingLines.map((l) => l.amount.amountMinor)).toEqual([30_000, 20_000]);

    // An awkward INR amount is released back exactly: the earmarks return to where they were.
    const beforeOdd = await getEvent(request, 'budget-owner', event.id);
    const odd = await expectContract(await commit(inr(99_999)), 201, EventCommitment);
    const released = await expectContract(
      await request.post(`/api/events/${event.id}/commitments/${odd.id}/release`, {
        headers: await mutate('budget-owner'),
        data: { reason: 'Vendor cancelled' },
      }),
      200,
      EventCommitment,
    );
    expect(released.status).toBe('released');
    const afterOdd = await getEvent(request, 'budget-owner', event.id);
    expect(afterOdd.sources.map((s) => s.consumed.amountMinor)).toEqual(
      beforeOdd.sources.map((s) => s.consumed.amountMinor),
    );
    expect(afterOdd.funding.committed).toEqual(usd(550_000));

    // Close: open commitments go back to the sources and every source gets back what it holds, by share.
    for (const verb of ['start', 'complete'])
      expect((await eventAction(request, 'budget-owner', event.id, verb)).status()).toBe(200);
    const closed = await expectContract(
      await eventAction(request, 'budget-owner', event.id, 'close'),
      200,
      CloseEventResponse,
    );
    expect(closed.event.status).toBe('closed');
    expect(closed.surplusReturns.map((r) => [r.budgetId, r.amount.amountMinor])).toEqual([
      [team.id, 600_000],
      [giver.id, 400_000],
    ]);
    expect(
      closed.event.sources.every((s) => s.status === 'returned' && s.remaining.amountMinor === 0),
    ).toBe(true);
    expect((await getContribution(request, 'budget-owner', c.id)).status).toBe('settled');

    const teamAfter = await budget(request, team.id);
    const giverAfter = await budget(request, giver.id);
    for (const [b, a] of [
      [teamBefore, teamAfter],
      [giverBefore, giverAfter],
    ] as const) {
      expect(a.balances.budgetCurrency.held).toEqual(b.balances.budgetCurrency.held);
      expect(a.balances.budgetCurrency.encumbered).toEqual(b.balances.budgetCurrency.encumbered);
      expect(a.balances.budgetCurrency.preEncumbered).toEqual(
        b.balances.budgetCurrency.preEncumbered,
      );
      expect(a.balances.available).toEqual(b.balances.available);
    }

    const run = await runLedgerCheck(request);
    expect(run.status).toBe('clean');
  });

  test('an event cannot be committed against before its budget is approved', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const draft = await expectContract(
      await request.post('/api/events', {
        headers: await mutate('budget-owner'),
        data: {
          name: 'Draft event',
          eventType: 'offsite',
          homeBudgetId: team.id,
          startsAt: '2026-12-03T09:00:00.000Z',
          endsAt: '2026-12-03T17:00:00.000Z',
          toleranceBps: 0,
          estimate: usd(100_000),
          ownFunds: usd(100_000),
          locationOrgUnitIds: ['30000000-0000-4000-8000-000000000008'],
        },
      }),
      201,
      EventDetail,
    );
    await expectProblem(
      await request.post(`/api/events/${draft.id}/commitments`, {
        headers: await mutate('budget-owner'),
        data: { description: 'Too early', amount: usd(10_000) },
      }),
      409,
      'EVENT_NOT_FUNDED',
    );
  });
});
