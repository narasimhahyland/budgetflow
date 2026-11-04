// Invariant 13: the giving director decides an Inter-Director Budget Contribution Request in full, in
// part or declines it; approved amounts are earmarked on the giving budget (held), attributed per
// contributor, posted once, audited once; the requester never sees the giver's balances.
import { expect, test } from '@playwright/test';
import { ContributionDetail, DecisionResponse, ProblemDetails } from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  approvedEvent,
  auditFor,
  budget,
  contribute,
  decideTask,
  directorTree,
  getContribution,
  getEvent,
  taskOf,
  usd,
} from '../support/p5';
import { fundedChild } from '../support/p5';

test.describe('Inter-Director Budget Contribution Request decisions', () => {
  test('full, partial and declined contributions with attribution, earmarks and one audit entry each', async ({
    request,
  }) => {
    const { root, team } = await directorTree(request);
    const giver = await fundedChild(request, root.id, {
      owner: 'department-head',
      amountMinor: 3_000_000,
    });
    // Jordan organizes on his own budget; his own-funds request skips him and goes to Lena, the owner above.
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(2_000_000),
      ownFunds: usd(400_000),
      toleranceBps: 500,
    });
    expect(event.funding.ownFunds.amountMinor).toBe(400_000);

    // Full: USD 3,000.00 earmarked on the giving budget.
    const full = await expectContract(
      await contribute(request, 'budget-owner', {
        eventId: event.id,
        giverBudgetId: giver.id,
        amount: usd(300_000),
      }),
      201,
      ContributionDetail,
    );
    expect(full.status).toBe('pending_approval');
    expect(full.giverPosition).toBeNull();
    expect(full.route?.steps[0]).toMatchObject({
      resolver: 'giving_director',
      personName: 'Lena Fischer',
    });
    const before = await budget(request, giver.id);
    const fullTask = await taskOf(request, 'department-head', 'contribution', full.id);
    const lenaView = await getContribution(request, 'department-head', full.id);
    expect(lenaView.giverPosition?.available.amountMinor).toBe(
      before.balances.available.amountMinor,
    );
    expect(lenaView.giverPosition?.availableAfterFull.amountMinor).toBe(
      before.balances.available.amountMinor - 300_000,
    );
    const key = `p5-full-${full.id}`;
    const decided = await expectContract(
      await decideTask(request, 'department-head', fullTask, { decision: 'approve' }, key),
      200,
      DecisionResponse,
    );
    expect(decided).toMatchObject({ subjectStatus: 'earmarked', approvedAmount: usd(300_000) });
    // Idempotent replay: same key, same body, first response, no second earmark.
    const replay = await decideTask(
      request,
      'department-head',
      fullTask,
      { decision: 'approve' },
      key,
    );
    expect(replay.status()).toBe(200);
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    let after = await budget(request, giver.id);
    expect(
      after.balances.budgetCurrency.held.amountMinor -
        before.balances.budgetCurrency.held.amountMinor,
    ).toBe(300_000);
    expect(after.balances.available.amountMinor).toBe(
      before.balances.available.amountMinor - 300_000,
    );

    // Partial: USD 5,000.00 asked, USD 2,500.00 given with a reason code; requested and approved both kept.
    const part = await expectContract(
      await contribute(request, 'budget-owner', {
        eventId: event.id,
        giverBudgetId: giver.id,
        amount: usd(500_000),
      }),
      201,
      ContributionDetail,
    );
    const partTask = await taskOf(request, 'department-head', 'contribution', part.id);
    await expectProblem(
      await decideTask(request, 'department-head', partTask, {
        decision: 'approve_partial',
        approvedAmount: usd(250_000),
      }),
      422,
      'REASON_REQUIRED',
    );
    await expectProblem(
      await decideTask(request, 'department-head', partTask, {
        decision: 'approve_partial',
        approvedAmount: usd(500_000),
        reasonCode: 'TRF-COFUND',
      }),
      422,
      'CONTRIBUTION_AMOUNT_INVALID',
    );
    await expectProblem(
      await decideTask(request, 'department-head', partTask, {
        decision: 'approve',
        noConflictAttested: false,
      }),
      422,
      'CONFLICT_ATTESTATION_REQUIRED',
    );
    const partial = await expectContract(
      await decideTask(request, 'department-head', partTask, {
        decision: 'approve_partial',
        approvedAmount: usd(250_000),
        reasonCode: 'TRF-COFUND',
        comment: 'Half now; ask again after RSVPs.',
      }),
      200,
      DecisionResponse,
    );
    expect(partial).toMatchObject({ subjectStatus: 'earmarked', approvedAmount: usd(250_000) });
    const partView = await getContribution(request, 'budget-owner', part.id);
    expect(partView).toMatchObject({
      requested: usd(500_000),
      approved: usd(250_000),
      reasonCode: 'TRF-COFUND',
      mode: 'earmark',
    });
    after = await budget(request, giver.id);
    expect(
      after.balances.budgetCurrency.held.amountMinor -
        before.balances.budgetCurrency.held.amountMinor,
    ).toBe(550_000);

    // Decline: a reason is required, nothing is held.
    const no = await expectContract(
      await contribute(request, 'budget-owner', {
        eventId: event.id,
        giverBudgetId: giver.id,
        amount: usd(100_000),
      }),
      201,
      ContributionDetail,
    );
    const noTask = await taskOf(request, 'department-head', 'contribution', no.id);
    await expectProblem(
      await decideTask(request, 'department-head', noTask, {
        decision: 'reject',
        noConflictAttested: false,
      }),
      422,
      'REASON_REQUIRED',
    );
    const declined = await expectContract(
      await decideTask(request, 'department-head', noTask, {
        decision: 'reject',
        reasonCode: 'REJ-BUDGET',
        comment: 'Our budget is committed this quarter.',
        noConflictAttested: false,
      }),
      200,
      DecisionResponse,
    );
    expect(declined.subjectStatus).toBe('rejected');
    const noView = await getContribution(request, 'budget-owner', no.id);
    expect(noView).toMatchObject({
      status: 'rejected',
      approved: null,
      decisionReason: 'Our budget is committed this quarter.',
    });
    expect((await budget(request, giver.id)).balances.budgetCurrency.held.amountMinor).toBe(
      after.balances.budgetCurrency.held.amountMinor,
    );

    // Attribution: one funding source per approved contribution, by contributor, with its share.
    const withSources = await getEvent(request, 'budget-owner', event.id);
    const contributionSources = withSources.sources.filter((s) => s.kind === 'contribution');
    expect(
      contributionSources.map((s) => [s.contributionRef, s.funded.amountMinor, s.originBudgetId]),
    ).toEqual([
      [full.ref, 300_000, giver.id],
      [part.ref, 250_000, giver.id],
    ]);
    expect(withSources.funding.contributions.amountMinor).toBe(550_000);
    expect(withSources.funding.cap.amountMinor).toBe(950_000);

    // One audit entry per decision with the term, the amount and the reason code; none for rejected attempts.
    const audit = await auditFor(request, part.id);
    expect(audit.filter((a) => a.action === 'contribution.approved_partial')).toHaveLength(1);
    expect(
      audit.find((a) => a.action === 'contribution.approved_partial')?.changes['reasonCode']?.to,
    ).toBe('TRF-COFUND');
    expect(
      (await auditFor(request, full.id)).filter((a) => a.action === 'contribution.approved'),
    ).toHaveLength(1);
  });

  test('only the giving director decides; others are refused and nobody else sees the giving budget', async ({
    request,
  }) => {
    const { root, team } = await directorTree(request);
    const giver = await fundedChild(request, root.id, {
      owner: 'department-head',
      amountMinor: 1_000_000,
    });
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      ownFunds: usd(300_000),
    });
    const c = await expectContract(
      await contribute(request, 'budget-owner', {
        eventId: event.id,
        giverBudgetId: giver.id,
        amount: usd(100_000),
      }),
      201,
      ContributionDetail,
    );
    const decide = async (user: Parameters<typeof mutate>[0]) =>
      request.post(`/api/contributions/${c.id}/decision`, {
        headers: await mutate(user),
        data: { decision: 'approve', noConflictAttested: true },
      });
    // The requester can see it but not decide; an unrelated owner cannot see it at all.
    await expectProblem(await decide('budget-owner'), 403, 'APPROVAL_NOT_ASSIGNED');
    const regional = await request.get(`/api/contributions/${c.id}`, {
      headers: await as('regional-manager'),
    });
    expect(regional.status()).toBe(404);
    const employee = await decide('employee');
    expect(employee.status()).toBe(404);
    expect((await employee.json()) as ProblemDetails).toMatchObject({ code: 'NOT_FOUND' });
    // The giving budget itself stays out of the requester's reach (Director A never reads Director B's budget).
    const read = await request.get(`/api/budgets/${giver.id}`, {
      headers: await as('budget-owner'),
    });
    expect(read.status()).toBe(404);
  });
});
