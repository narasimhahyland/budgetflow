// Invariant 12: nobody approves their own request; an approver who attends the event or benefits from
// it (organizer, co-organizer) is skipped in routing and refused at decision time; a delegate acts
// within the lower of the delegation's limit and the delegator's own DoA limit, only between its dates,
// and the audit entry names both people.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ApprovalInbox,
  ContributionDetail,
  DelegationView,
  EventDetail,
  RequestDetail,
} from '@bf/contracts';
import { userById, type SeedUserId } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  auditFor,
  contribute,
  createEvent,
  decideOk,
  decideTask,
  directorTree,
  eventAction,
  fundedChild,
  spendingRequest,
  taskOf,
  usd,
} from '../support/p5';

const today = new Date().toISOString().slice(0, 10);
const TRAVEL = { spendType: 'travel' };

async function delegate(
  request: APIRequestContext,
  delegator: SeedUserId,
  delegateTo: SeedUserId,
  data: { limitMinor?: number; validFrom?: string; validTo?: string },
) {
  // Travel only, so these delegations never touch other scenarios' team-lunch and event approvals.
  return expectContract(
    await request.post('/api/approvals/delegations', {
      headers: await mutate(delegator),
      data: {
        delegatePersonId: userById(delegateTo).personId,
        validFrom: data.validFrom ?? today,
        validTo: data.validTo ?? today,
        reason: 'Scenario delegation',
        spendType: 'travel',
        ...(data.limitMinor ? { limit: usd(data.limitMinor) } : {}),
      },
    }),
    201,
    DelegationView,
  );
}

test.describe('approval hygiene', () => {
  test('an attendee and a co-organizer are skipped as approvers of the event’s funding and contributions', async ({
    request,
  }) => {
    const { root, team } = await directorTree(request);
    const giver = await fundedChild(request, root.id, {
      owner: 'department-head',
      amountMinor: 1_000_000,
    });
    // Lena attends Jordan's event: her own-funds step and her contribution decision go to the CEO instead.
    const event = await createEvent(request, 'budget-owner', {
      homeBudgetId: team.id,
      ownFunds: usd(200_000),
      participantPersonIds: [userById('department-head').personId!],
    });
    const submitted = await expectContract(
      await eventAction(request, 'budget-owner', event.id, 'submit'),
      200,
      EventDetail,
    );
    const own = await expectContract(
      await request.get(`/api/requests/${submitted.ownFundsRequest!.id}`, {
        headers: await as('budget-owner'),
      }),
      200,
      RequestDetail,
    );
    expect(own.route?.skipped.map((s) => [s.personName, s.reason])).toEqual([
      ['Jordan Smith', 'requester'],
      ['Lena Fischer', 'attendee'],
    ]);
    expect(own.route?.steps[0].personName).toBe('Morgan Lee');
    await decideOk(request, 'ceo', await taskOf(request, 'ceo', 'request', own.id), {
      decision: 'approve',
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
    expect(c.route?.skipped).toEqual([
      expect.objectContaining({ personName: 'Lena Fischer', reason: 'attendee' }),
    ]);
    expect(c.route?.steps[0]).toMatchObject({
      personName: 'Morgan Lee',
      resolver: 'giving_director',
    });

    // A co-organizer benefits from the event and is skipped the same way.
    const coEvent = await createEvent(request, 'budget-owner', {
      homeBudgetId: team.id,
      ownFunds: usd(100_000),
      coOrganizerPersonIds: [userById('department-head').personId!],
    });
    const coSubmitted = await expectContract(
      await eventAction(request, 'budget-owner', coEvent.id, 'submit'),
      200,
      EventDetail,
    );
    const coOwn = await expectContract(
      await request.get(`/api/requests/${coSubmitted.ownFundsRequest!.id}`, {
        headers: await as('budget-owner'),
      }),
      200,
      RequestDetail,
    );
    expect(coOwn.route?.skipped.map((s) => s.reason)).toEqual(['requester', 'beneficiary']);
  });

  test('a requester cannot approve their own request, even as a delegate', async ({ request }) => {
    const { team } = await directorTree(request);
    await delegate(request, 'department-head', 'budget-owner', { limitMinor: 500_000 });
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(50_000), TRAVEL),
      201,
      RequestDetail,
    );
    const task = await taskOf(request, 'department-head', 'request', r.id);
    await expectProblem(
      await decideTask(request, 'budget-owner', task, { decision: 'approve' }),
      409,
      'SELF_APPROVAL',
    );
    await expectProblem(
      await decideTask(request, 'budget-owner', task, { decision: 'reject', comment: 'no' }),
      409,
      'SELF_APPROVAL',
    );
  });

  test('a delegate acts within the lower of both limits and only between the delegation dates', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    // Lena's own limit for travel is USD 10,000.00. Delegation hygiene (P7) refuses a cap above
    // that, so the delegation is set at her limit and the delegate is capped by it.
    await expectProblem(
      await request.post('/api/approvals/delegations', {
        headers: await mutate('department-head'),
        data: {
          delegatePersonId: userById('finance-admin').personId,
          validFrom: today,
          validTo: today,
          reason: 'A cap above my own limit should be refused.',
          spendType: 'travel',
          limit: usd(2_000_000),
        },
      }),
      422,
      'DELEGATION_EXCEEDS_DOA',
    );
    await delegate(request, 'department-head', 'finance-admin', { limitMinor: 1_000_000 });
    const within = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(900_000), TRAVEL),
      201,
      RequestDetail,
    );
    const task = await taskOf(request, 'finance-admin', 'request', within.id);
    const inbox = await expectContract(
      await request.get('/api/approvals/inbox?tab=delegated', {
        headers: await as('finance-admin'),
      }),
      200,
      ApprovalInbox,
    );
    expect(inbox.items.find((i) => i.taskId === task)).toMatchObject({
      delegatedFromName: 'Lena Fischer',
    });
    const ok = await decideOk(request, 'finance-admin', task, { decision: 'approve' });
    expect(ok.subjectStatus).toBe('approved');
    const audit = await auditFor(request, within.id);
    const entry = audit.find((a) => a.action === 'request.approved');
    expect(entry?.onBehalfOfPersonId).toBe(userById('department-head').personId);

    // A newer, tighter delegation (USD 2,000.00) caps the delegate below the request: approve part only.
    await delegate(request, 'department-head', 'finance-admin', { limitMinor: 200_000 });
    const above = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(300_000), TRAVEL),
      201,
      RequestDetail,
    );
    const aboveTask = await taskOf(request, 'finance-admin', 'request', above.id);
    const refused = await expectProblem(
      await decideTask(request, 'finance-admin', aboveTask, { decision: 'approve' }),
      409,
      'DOA_LIMIT_EXCEEDED',
    );
    expect(refused.params).toMatchObject({ limitMinor: 200_000 });
    const part = await decideOk(request, 'finance-admin', aboveTask, {
      decision: 'approve_partial',
      approvedAmount: usd(200_000),
      reasonCode: 'REJ-BUDGET',
    });
    expect(part.subjectStatus).toBe('partially_approved');

    // An expired delegation gives no authority at all.
    await delegate(request, 'department-head', 'analyst', {
      validFrom: '2026-01-01',
      validTo: '2026-01-31',
    });
    const later = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(10_000), TRAVEL),
      201,
      RequestDetail,
    );
    const laterTask = await taskOf(request, 'department-head', 'request', later.id);
    await expectProblem(
      await decideTask(request, 'analyst', laterTask, { decision: 'approve' }),
      403,
      'APPROVAL_NOT_ASSIGNED',
    );
  });
});
