// Slack and Microsoft Teams interactive callbacks (061b, 061c, 061d). Every callback is HMAC-verified
// inside a 5-minute replay window before any business logic runs; the chat identity is mapped to a
// BudgetFlow person and the decision goes through the same approval engine, so PolicyService and the
// DoA limits decide, never the card. Retries of the same interaction post once.
import { expect, test } from '@playwright/test';
import { ChatApprovalCardView, RequestDetail } from '@bf/contracts';
import { TENANTS } from '@bf/seed';
import { expectContract, expectProblem } from '../support/contract';
import { as } from '../support/auth';
import {
  auditEvents,
  chatWebhookBody,
  postChatWebhook,
  postRawChatWebhook,
  signChatWebhook,
  webhookOk,
} from '../support/p8';
import {
  createRoot,
} from '../support/factory';
import {
  decideOk,
  directorTree,
  fundedChild,
  getRequest,
  spendingRequest,
  taskOf,
  usd,
} from '../support/p5';

const TENANT = TENANTS.acme;

/** Slack handles of the seeded linked accounts (libs/seed/src/lib/channels.ts). */
const SLACK = {
  departmentHead: 'U-DH-LENA',
  financeController: 'U-FC-DANIEL',
  eventOrganizer: 'U-EO-KAVYA',
};
const TEAMS = { regionalManager: 'ENTRA-RM-ANANYA' };

/** Root → department (Ananya, regional manager) → team (Jordan, budget owner). */
async function regionalTree(request: import('@playwright/test').APIRequestContext) {
  const root = await createRoot(request, { amountMinor: 50_000_000, name: 'P8 teams root' });
  const dept = await fundedChild(request, root.id, {
    owner: 'regional-manager',
    amountMinor: 10_000_000,
  });
  const team = await fundedChild(request, dept.id, {
    owner: 'budget-owner',
    amountMinor: 5_000_000,
    as: 'regional-manager',
  });
  return { root, dept, team };
}

test.describe('signed Slack and Teams approval callbacks', () => {
  test('a signed Slack callback approves through the approval engine and is audited as slack', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(150_000)),
      201,
      RequestDetail,
    );
    const taskId = await taskOf(request, 'department-head', 'request', r.id);

    // The card the approver sees in Slack: Block Kit with the amount, the budget impact and the reason.
    const card = await expectContract(
      await request.get(`/api/channels/slack/cards/${taskId}`, {
        headers: await as('department-head'),
      }),
      200,
      ChatApprovalCardView,
    );
    expect(card).toMatchObject({
      provider: 'slack',
      state: 'waiting',
      canApprove: true,
      canReject: true,
      ref: r.ref,
      amount: usd(150_000),
    });
    expect(JSON.stringify(card.blockKit)).toContain('Approve USD 1,500.00');
    expect(JSON.stringify(card.blockKit)).toContain("Available under this budget's rules");

    const res = await webhookOk(request, 'slack', {
      tenantId: TENANT,
      providerUserId: SLACK.departmentHead,
      kind: 'decision',
      taskId,
      decision: 'approve',
    });
    expect(res).toMatchObject({
      provider: 'slack',
      kind: 'decision',
      stepUpRequired: false,
    });
    expect(res.decision?.subjectStatus).toBe('approved');
    expect(res.card?.state).toBe('approved');
    expect(res.card?.canApprove).toBe(false);

    const view = await getRequest(request, 'budget-owner', r.id);
    expect(view.status).toBe('approved');
    expect(view.route?.steps[0]).toMatchObject({ status: 'approved', channel: 'slack' });

    const approved = (await auditEvents(request, r.id)).filter(
      (a) => a.action === 'request.approved',
    );
    expect(approved).toHaveLength(1);
    expect(approved[0].changes['channel']?.to).toBe('slack');
  });

  test('a signed Teams callback approves and rejecting from a card needs a reason code and reason', async ({
    request,
  }) => {
    const { team } = await regionalTree(request);
    const approve = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(120_000)),
      201,
      RequestDetail,
    );
    const approveTask = await taskOf(request, 'regional-manager', 'request', approve.id);

    const card = await expectContract(
      await request.get(`/api/channels/teams/cards/${approveTask}`, {
        headers: await as('regional-manager'),
      }),
      200,
      ChatApprovalCardView,
    );
    expect(card.adaptiveCard['version']).toBe('1.5');
    expect(card.adaptiveCard['type']).toBe('AdaptiveCard');
    expect(JSON.stringify(card.adaptiveCard)).toContain('Action.Execute');

    const ok = await webhookOk(request, 'teams', {
      tenantId: TENANT,
      providerUserId: TEAMS.regionalManager,
      kind: 'decision',
      taskId: approveTask,
      decision: 'approve',
    });
    expect(ok.decision?.subjectStatus).toBe('approved');
    expect((await getRequest(request, 'budget-owner', approve.id)).route?.steps[0]).toMatchObject({
      status: 'approved',
      channel: 'teams',
    });

    // Reject needs both the reason code and the typed reason, exactly like the web app.
    const reject = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(90_000)),
      201,
      RequestDetail,
    );
    const rejectTask = await taskOf(request, 'regional-manager', 'request', reject.id);
    await expectProblem(
      await postChatWebhook(request, 'teams', {
        tenantId: TENANT,
        providerUserId: TEAMS.regionalManager,
        kind: 'decision',
        taskId: rejectTask,
        decision: 'reject',
      }),
      422,
      'REASON_REQUIRED',
    );
    expect((await getRequest(request, 'budget-owner', reject.id)).status).toBe('pending_approval');

    const rejected = await webhookOk(request, 'teams', {
      tenantId: TENANT,
      providerUserId: TEAMS.regionalManager,
      kind: 'decision',
      taskId: rejectTask,
      decision: 'reject',
      reasonCode: 'REJ-BUDGET',
      reason: 'The regional budget is committed to the Diwali programme.',
    });
    expect(rejected.decision?.subjectStatus).toBe('rejected');
    expect((await getRequest(request, 'budget-owner', reject.id)).decisionReason).toBe(
      'The regional budget is committed to the Diwali programme.',
    );
  });

  test('a callback outside the 5-minute replay window or with a broken signature changes nothing', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(80_000)),
      201,
      RequestDetail,
    );
    const taskId = await taskOf(request, 'department-head', 'request', r.id);
    const payload = {
      tenantId: TENANT,
      providerUserId: SLACK.departmentHead,
      kind: 'decision' as const,
      taskId,
      decision: 'approve' as const,
    };

    // Six minutes old: outside the window, refused before any business logic.
    await expectProblem(
      await postChatWebhook(request, 'slack', payload, {
        timestampSeconds: Math.floor(Date.now() / 1000) - 360,
      }),
      401,
      'CHAT_TIMESTAMP_EXPIRED',
    );
    // Six minutes in the future is refused the same way.
    await expectProblem(
      await postChatWebhook(request, 'slack', payload, {
        timestampSeconds: Math.floor(Date.now() / 1000) + 360,
      }),
      401,
      'CHAT_TIMESTAMP_EXPIRED',
    );

    // A body replayed with its original signature but a changed payload fails the HMAC.
    const raw = chatWebhookBody(payload);
    const ts = Math.floor(Date.now() / 1000);
    const signatureOfOtherBody = signChatWebhook('slack', ts, `${raw} `);
    await expectProblem(
      await postRawChatWebhook(request, 'slack', raw, {
        timestampSeconds: ts,
        signature: signatureOfOtherBody,
      }),
      401,
      'CHAT_SIGNATURE_INVALID',
    );
    // A signature made with the wrong secret fails too.
    await expectProblem(
      await postRawChatWebhook(request, 'slack', raw, {
        timestampSeconds: ts,
        signature: signChatWebhook('slack', ts, raw, 'not-the-signing-secret-0001'),
      }),
      401,
      'CHAT_SIGNATURE_INVALID',
    );
    // Teams uses its own secret, so a Slack-shaped signature is refused on the Teams endpoint.
    const teamsRaw = chatWebhookBody({ ...payload, providerUserId: TEAMS.regionalManager });
    await expectProblem(
      await postRawChatWebhook(request, 'teams', teamsRaw, {
        timestampSeconds: ts,
        signature: signChatWebhook('slack', ts, teamsRaw),
      }),
      401,
      'CHAT_SIGNATURE_INVALID',
    );

    expect((await getRequest(request, 'budget-owner', r.id)).status).toBe('pending_approval');
    expect(
      (await auditEvents(request, r.id)).filter((a) => a.action === 'request.approved'),
    ).toHaveLength(0);
  });

  test('a chat account nobody linked is prompted to connect instead of deciding', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(70_000)),
      201,
      RequestDetail,
    );
    const taskId = await taskOf(request, 'department-head', 'request', r.id);

    const res = await webhookOk(request, 'slack', {
      tenantId: TENANT,
      providerUserId: 'U-NOBODY-0000',
      kind: 'decision',
      taskId,
      decision: 'approve',
    });
    expect(res).toMatchObject({
      kind: 'not_linked',
      ephemeral: true,
      stepUpRequired: true,
      stepUpReason: 'CHAT_ACCOUNT_NOT_LINKED',
      decision: null,
    });
    expect(res.stepUpUrl).toContain('/link/chat?provider=slack');
    expect((await getRequest(request, 'budget-owner', r.id)).status).toBe('pending_approval');
  });

  test('a linked person who does not hold the task cannot decide it from chat', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(60_000)),
      201,
      RequestDetail,
    );
    const taskId = await taskOf(request, 'department-head', 'request', r.id);

    // Kavya has a linked Slack account but no authority on Lena's task: the server re-authorizes.
    const res = await postChatWebhook(request, 'slack', {
      tenantId: TENANT,
      providerUserId: SLACK.eventOrganizer,
      kind: 'decision',
      taskId,
      decision: 'approve',
    });
    expect([403, 404]).toContain(res.status());
    expect((await getRequest(request, 'budget-owner', r.id)).status).toBe('pending_approval');

    // Opening the card in a shared channel never shows the amount to somebody out of scope.
    const outOfScope = await webhookOk(request, 'slack', {
      tenantId: TENANT,
      providerUserId: SLACK.eventOrganizer,
      kind: 'card_view',
      taskId,
    });
    expect(outOfScope).toMatchObject({ kind: 'card_view', ephemeral: true, card: null });
    expect(outOfScope.headline).toBe('This approval is not yours to see');

    // Finance can read the request, so they get the card without any decision buttons.
    const readOnly = await webhookOk(request, 'slack', {
      tenantId: TENANT,
      providerUserId: SLACK.financeController,
      kind: 'card_view',
      taskId,
    });
    expect(readOnly).toMatchObject({ kind: 'card_view', ephemeral: true });
    expect(readOnly.card?.state).toBe('read_only');
    expect(readOnly.card?.canApprove).toBe(false);
    expect(readOnly.card?.canReject).toBe(false);
    expect(readOnly.card?.stateHeadline).toContain('Lena Fischer');
  });

  test('an amount above the chat single-click threshold sends the approver to BudgetFlow', async ({
    request,
  }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(3_000_000)),
      201,
      RequestDetail,
    );
    // USD 30,000 is above Lena's limit, so it routes to the CEO and then finance review.
    expect(r.route?.steps.map((s) => s.personName)).toEqual(['Morgan Lee', 'Daniel Weber']);
    await decideOk(request, 'ceo', await taskOf(request, 'ceo', 'request', r.id), {
      decision: 'approve',
    });

    const financeTask = await taskOf(request, 'finance-controller', 'request', r.id);
    const res = await webhookOk(request, 'slack', {
      tenantId: TENANT,
      providerUserId: SLACK.financeController,
      kind: 'decision',
      taskId: financeTask,
      decision: 'approve',
    });
    expect(res).toMatchObject({
      kind: 'step_up',
      ephemeral: true,
      stepUpRequired: true,
      stepUpReason: 'DOA_OR_STEP_UP_REQUIRED',
      decision: null,
    });
    expect(res.card?.state).toBe('outside_doa');
    expect(res.headline).toContain('chat single-click threshold');
    expect(res.stepUpUrl).toContain(`/approvals?task=${financeTask}`);
    expect((await getRequest(request, 'budget-owner', r.id)).status).toBe('pending_approval');

    // The same person decides it in BudgetFlow: the chat path never bypassed the step-up.
    await decideOk(request, 'finance-controller', financeTask, { decision: 'approve' });
    expect((await getRequest(request, 'budget-owner', r.id)).status).toBe('approved');
  });

  test('Slack retrying the same interaction decides once', async ({ request }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(45_000)),
      201,
      RequestDetail,
    );
    const taskId = await taskOf(request, 'department-head', 'request', r.id);
    const raw = chatWebhookBody({
      tenantId: TENANT,
      providerUserId: SLACK.departmentHead,
      kind: 'decision',
      taskId,
      decision: 'approve',
    });

    const first = await postRawChatWebhook(request, 'slack', raw);
    expect(first.status()).toBe(200);
    // Slack retries the identical payload when it does not see a timely 200.
    const retry = await postRawChatWebhook(request, 'slack', raw);
    expect(retry.status()).toBe(200);
    const retried = await retry.json();
    expect(retried.decision?.subjectStatus).toBe('approved');

    expect(
      (await auditEvents(request, r.id)).filter((a) => a.action === 'request.approved'),
    ).toHaveLength(1);
    const view = await getRequest(request, 'budget-owner', r.id);
    expect(view.route?.steps.filter((s) => s.status === 'approved')).toHaveLength(1);
  });
});
