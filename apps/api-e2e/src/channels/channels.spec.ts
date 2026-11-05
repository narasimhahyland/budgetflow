// Phase 8 API scenario tests:
// - Slack and Microsoft Teams interactive approval cards & signed webhook callbacks (061b, 061c)
// - HMAC-SHA256 signature and 5-minute timestamp window verification (replay/tamper rejection)
// - Server-side PolicyService.can + DoA limit enforcement and step-up to web app when outside DoA
// - Idempotent channel actions and channel audit trail ('slack', 'teams', 'mobile')
// - Chat balance check, App Home and quick spending request with soft warning / frozen budget block (061d)
// - Workspace installation setup, account linking with email match enforcement, and delivery logs (061e)
// - Comments, @mentions (rejecting no-access mentions with MENTION_NO_ACCESS), 15-min edit window, tombstones & follows (060a)
// - Notification feed, derived tasks, preferences, required rows (NOTIFICATION_REQUIRED), quiet hours & push devices (123, 059c)
// - Role-based digest templates, live scoped preview and test delivery via Mailpit (064a)
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  AdminChannelsView,
  ChannelDeliveryList,
  ChatAccountLinkView,
  ChatApprovalCardView,
  ChatInstallationView,
  ChatLinkPreview,
  ChatWebhookResponse,
  CommentView,
  DecisionResponse,
  DigestPreviewResponse,
  DigestTemplateList,
  DigestTemplateView,
  DiscussionThread,
  FollowedItemsList,
  FollowState,
  MarkNotificationsResponse,
  NotificationsFeed,
  NotificationSettingsView,
  PushDevice,
  RequestDetail,
  TestChannelResponse,
  type ChatProvider,
  type ChatWebhookInteractionRequest,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { createHmac, randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import {
  applyControl,
  auditFor,
  budget,
  directorTree,
  getRequest,
  spendingRequest,
  taskOf,
  usd,
  waitForMail,
} from '../support/p5';

const DEV_SLACK_SECRET = 'slack-signing-secret-dev-only-0001';
const DEV_TEAMS_SECRET = 'teams-webhook-secret-dev-only-0001';

function signWebhook(
  provider: ChatProvider,
  tsSec: number,
  rawBody: string,
  secret = provider === 'slack' ? DEV_SLACK_SECRET : DEV_TEAMS_SECRET,
) {
  if (provider === 'slack') {
    return `v0=${createHmac('sha256', secret).update(`v0:${tsSec}:${rawBody}`).digest('hex')}`;
  }
  return `sha256=${createHmac('sha256', secret).update(`${tsSec}.${rawBody}`).digest('hex')}`;
}

async function postWebhook(
  request: APIRequestContext,
  provider: ChatProvider,
  body: ChatWebhookInteractionRequest,
  opts?: { tsSec?: number; signature?: string },
) {
  const raw = JSON.stringify(body);
  const tsSec = opts?.tsSec ?? Math.floor(Date.now() / 1000);
  const sig = opts?.signature ?? signWebhook(provider, tsSec, raw);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(provider === 'slack'
      ? {
          'x-slack-request-timestamp': String(tsSec),
          'x-slack-signature': sig,
        }
      : {
          'x-teams-request-timestamp': String(tsSec),
          'x-teams-signature': sig,
        }),
  };
  return request.post(`/api/channels/webhooks/${provider}`, {
    headers,
    data: body,
  });
}

test.describe('Slack and Microsoft Teams interactive cards, webhooks and DoA enforcement', () => {
  test('rejects tampered HMAC signatures and stale timestamps outside the 5-minute replay window', async ({
    request,
  }) => {
    const payload: ChatWebhookInteractionRequest = {
      tenantId: SEED.tenants.acme,
      providerUserId: 'U-DH-LENA',
      interactionId: `int-${randomUUID()}`,
      kind: 'balance',
    };

    // Tampered signature
    await expectProblem(
      await postWebhook(request, 'slack', payload, {
        signature: 'v0=0000000000000000000000000000000000000000000000000000000000000000',
      }),
      401,
      'CHAT_SIGNATURE_INVALID',
    );

    // Expired timestamp (10 minutes old)
    const oldTs = Math.floor(Date.now() / 1000) - 600;
    await expectProblem(
      await postWebhook(request, 'slack', payload, { tsSec: oldTs }),
      401,
      'CHAT_TIMESTAMP_EXPIRED',
    );

    // Unlinked chat user returns Connect prompt without mutating anything
    const unlinked = await expectContract(
      await postWebhook(request, 'slack', {
        ...payload,
        providerUserId: 'U-NOT-LINKED-999',
      }),
      200,
      ChatWebhookResponse,
    );
    expect(unlinked.kind).toBe('not_linked');
    expect(unlinked.stepUpRequired).toBe(true);
    expect(unlinked.stepUpReason).toBe('CHAT_ACCOUNT_NOT_LINKED');
  });

  test('approves and rejects from signed Slack and Teams callbacks, enforces DoA/step-up, and is idempotent', async ({
    request,
  }) => {
    // Ensure Microsoft Teams is connected by Integration Admin so both Slack and Teams callbacks work
    await expectContract(
      await request.patch('/api/admin/channels/teams', {
        headers: await mutate('integration-admin'),
        data: { action: 'check_status' },
      }),
      200,
      ChatInstallationView,
    );

    // Link department-head (Lena Fischer) on Teams as well
    const intent = await expectContract(
      await request.post('/api/channels/link-intent', {
        headers: await mutate('department-head'),
        data: {
          provider: 'teams',
          providerUserId: 'ENTRA-DH-LENA',
          handle: 'lena.fischer@example.test',
        },
      }),
      201,
      ChatLinkPreview,
    );
    expect(intent.emailMatches).toBe(true);
    await expectContract(
      await request.post('/api/channels/link-complete', {
        headers: await mutate('department-head'),
        data: { token: intent.token },
      }),
      200,
      ChatAccountLinkView,
    );

    const { team } = await directorTree(request);

    // 1. Slack approval card + signed callback approval + idempotent replay
    const r1 = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(150_000)),
      201,
      RequestDetail,
    );
    const task1 = await taskOf(request, 'department-head', 'request', r1.id);

    const slackCard = await expectContract(
      await request.get(`/api/channels/slack/cards/${task1}`, {
        headers: await as('department-head'),
      }),
      200,
      ChatApprovalCardView,
    );
    expect(slackCard.state).toBe('waiting');
    expect(slackCard.canApprove).toBe(true);
    expect(slackCard.blockKit['blocks']).toBeTruthy();

    const interactionId = `slack-approve-${randomUUID()}`;
    const slackApprovePayload: ChatWebhookInteractionRequest = {
      tenantId: SEED.tenants.acme,
      providerUserId: 'U-DH-LENA',
      interactionId,
      kind: 'decision',
      taskId: task1,
      decision: 'approve',
    };
    const approvedRes = await expectContract(
      await postWebhook(request, 'slack', slackApprovePayload),
      200,
      ChatWebhookResponse,
    );
    expect(approvedRes.decision?.subjectStatus).toBe('approved');
    expect(approvedRes.card?.state).toBe('approved');
    expect(approvedRes.card?.canApprove).toBe(false);

    // Replay with the same interactionId returns the stored decision without posting a second time
    const replayRes = await expectContract(
      await postWebhook(request, 'slack', slackApprovePayload),
      200,
      ChatWebhookResponse,
    );
    expect(replayRes.decision?.taskId).toBe(task1);

    const audit1 = await auditFor(request, r1.id);
    const approvedEvents = audit1.filter((a) => a.action === 'request.approved');
    expect(approvedEvents).toHaveLength(1);
    expect(approvedEvents[0].changes['channel']?.to).toBe('slack');

    // 2. Microsoft Teams Adaptive Card rejection (requires reasonCode + reason) + non-approver read-only card view
    const r2 = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(90_000)),
      201,
      RequestDetail,
    );
    const task2 = await taskOf(request, 'department-head', 'request', r2.id);

    // Non-approver viewer in Teams gets read-only card without buttons
    const readOnlyView = await expectContract(
      await postWebhook(request, 'teams', {
        tenantId: SEED.tenants.acme,
        providerUserId: 'ENTRA-DH-LENA',
        viewerProviderUserId: 'ENTRA-OTHER-USER',
        interactionId: `teams-view-${randomUUID()}`,
        kind: 'card_view',
        taskId: task2,
      }),
      200,
      ChatWebhookResponse,
    );
    expect(readOnlyView.card?.state).toBe('read_only');
    expect(readOnlyView.card?.canApprove).toBe(false);
    expect(readOnlyView.card?.canReject).toBe(false);

    // Reject without reason is 422 REASON_REQUIRED
    await expectProblem(
      await postWebhook(request, 'teams', {
        tenantId: SEED.tenants.acme,
        providerUserId: 'ENTRA-DH-LENA',
        interactionId: `teams-reject-missing-${randomUUID()}`,
        kind: 'decision',
        taskId: task2,
        decision: 'reject',
      }),
      422,
      'REASON_REQUIRED',
    );

    const teamsRejected = await expectContract(
      await postWebhook(request, 'teams', {
        tenantId: SEED.tenants.acme,
        providerUserId: 'ENTRA-DH-LENA',
        interactionId: `teams-reject-${randomUUID()}`,
        kind: 'decision',
        taskId: task2,
        decision: 'reject',
        reasonCode: 'REJ-POLICY',
        reason: 'Use the quarterly offsite budget instead.',
      }),
      200,
      ChatWebhookResponse,
    );
    expect(teamsRejected.decision?.subjectStatus).toBe('rejected');
    expect(teamsRejected.card?.state).toBe('rejected');

    const audit2 = await auditFor(request, r2.id);
    expect(audit2.find((a) => a.action === 'request.rejected')?.changes['channel']?.to).toBe(
      'teams',
    );

    // 3. Another user pressing Approve on someone else's task is 403 APPROVAL_NOT_ASSIGNED
    const r3 = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(75_000)),
      201,
      RequestDetail,
    );
    const task3 = await taskOf(request, 'department-head', 'request', r3.id);
    await expectProblem(
      await postWebhook(request, 'slack', {
        tenantId: SEED.tenants.acme,
        providerUserId: 'U-FC-DANIEL',
        interactionId: `slack-wrong-user-${randomUUID()}`,
        kind: 'decision',
        taskId: task3,
        decision: 'approve',
      }),
      403,
      'APPROVAL_NOT_ASSIGNED',
    );

    // 4. Mobile channel decision records channel 'mobile'
    const mobileDecided = await expectContract(
      await request.post(`/api/approvals/tasks/${task3}/decision`, {
        headers: await mutate('department-head'),
        data: {
          decision: 'approve',
          noConflictAttested: true,
          channel: 'mobile',
        },
      }),
      200,
      DecisionResponse,
    );
    expect(mobileDecided.subjectStatus).toBe('approved');
    const audit3 = await auditFor(request, r3.id);
    expect(audit3.find((a) => a.action === 'request.approved')?.changes['channel']?.to).toBe(
      'mobile',
    );
  });

  test('outside-DoA or high-value tasks require step-up to the web app and cannot be approved in chat', async ({
    request,
  }) => {
    const { team } = await directorTree(request, {
      deptMinor: 40_000_000,
      teamMinor: 35_000_000,
    });
    // Request USD 30,000.00 (above Lena's USD 10,000 limit -> routed to Morgan Lee CEO, and above the USD 25,000 chat step-up threshold)
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(2_800_000)),
      201,
      RequestDetail,
    );
    const ceoTask = await taskOf(request, 'ceo', 'request', r.id);

    // Link CEO on Slack
    const ceoIntent = await expectContract(
      await request.post('/api/channels/link-intent', {
        headers: await mutate('ceo'),
        data: { provider: 'slack', providerUserId: 'U-CEO-MORGAN', handle: '@morgan.lee' },
      }),
      201,
      ChatLinkPreview,
    );
    await expectContract(
      await request.post('/api/channels/link-complete', {
        headers: await mutate('ceo'),
        data: { token: ceoIntent.token },
      }),
      200,
      ChatAccountLinkView,
    );

    const stepUpRes = await expectContract(
      await postWebhook(request, 'slack', {
        tenantId: SEED.tenants.acme,
        providerUserId: 'U-CEO-MORGAN',
        interactionId: `slack-stepup-${randomUUID()}`,
        kind: 'decision',
        taskId: ceoTask,
        decision: 'approve',
      }),
      200,
      ChatWebhookResponse,
    );
    expect(stepUpRes.kind).toBe('step_up');
    expect(stepUpRes.stepUpRequired).toBe(true);
    expect(stepUpRes.stepUpUrl).toContain(`/approvals?task=${ceoTask}`);
    expect((await getRequest(request, 'budget-owner', r.id)).status).toBe('pending_approval');
  });

  test('chat balance check, App Home and quick spending request enforce PolicyService scope and budget controls', async ({
    request,
  }) => {
    const { team } = await directorTree(request);

    // Balance check for Rahul Menon (location-manager Bengaluru) only returns his scoped budgets
    const balRes = await expectContract(
      await postWebhook(request, 'slack', {
        tenantId: SEED.tenants.acme,
        providerUserId: 'U-LM-RAHUL',
        interactionId: `slack-bal-${randomUUID()}`,
        kind: 'balance',
      }),
      200,
      ChatWebhookResponse,
    );
    expect(balRes.ephemeral).toBe(true);
    expect(balRes.balances?.some((b) => b.budgetId === SEED.budgets.bengaluru)).toBe(true);
    expect(balRes.balances?.some((b) => b.budgetId === SEED.budgets.unitedStates)).toBe(false);
    expect(balRes.text).toContain("Available under this budget's rules");

    // Quick request from Slack on an active budget creates and routes the request
    const beforeBal = await budget(request, SEED.budgets.bengaluru);
    const qrRes = await expectContract(
      await postWebhook(request, 'slack', {
        tenantId: SEED.tenants.acme,
        providerUserId: 'U-EO-KAVYA',
        interactionId: `slack-qr-${randomUUID()}`,
        kind: 'quick_request',
        quickRequest: {
          budgetId: SEED.budgets.bengaluru,
          amountMinor: 15_000,
          currency: 'USD',
          category: 'team_lunch',
          title: 'Quick chat lunch request',
          purpose: 'Sprint retrospective lunch',
          confirmSoftWarning: true,
        },
      }),
      200,
      ChatWebhookResponse,
    );
    expect(qrRes.createdRequestRef).toMatch(/^REQ-/);
    const afterBal = await budget(request, SEED.budgets.bengaluru);
    expect(
      afterBal.balances.budgetCurrency.preEncumbered.amountMinor -
        beforeBal.balances.budgetCurrency.preEncumbered.amountMinor,
    ).toBe(15_000);
    // Withdraw the created request so seeded Bengaluru balances stay clean
    await request.post(`/api/requests/${qrRes.createdRequestId}/withdraw`, {
      headers: await mutate('event-organizer'),
      data: { reason: 'Clean up scenario quick request' },
    });

    // Freezing a scenario budget blocks quick requests from chat with BUDGET_FROZEN
    await applyControl(request, team.id, 'freeze');
    await expectProblem(
      await postWebhook(request, 'slack', {
        tenantId: SEED.tenants.acme,
        providerUserId: 'U-DH-LENA',
        interactionId: `slack-qr-frozen-${randomUUID()}`,
        kind: 'quick_request',
        quickRequest: {
          budgetId: team.id,
          amountMinor: 10_000,
          currency: 'USD',
          category: 'team_lunch',
          title: 'Frozen budget request',
          purpose: 'Should be blocked',
        },
      }),
      409,
      'BUDGET_FROZEN',
    );
  });
});

test.describe('account linking, discussions, notifications and digests', () => {
  test('account linking rejects mismatched email with CHAT_LINK_EMAIL_MISMATCH', async ({
    request,
  }) => {
    const mismatchIntent = await expectContract(
      await request.post('/api/channels/link-intent', {
        headers: await mutate('regional-manager'),
        data: {
          provider: 'slack',
          providerUserId: 'U-MISMATCH',
          handle: '@wrong.handle',
          verifiedEmail: 'wrong.email@example.test',
        },
      }),
      201,
      ChatLinkPreview,
    );
    expect(mismatchIntent.emailMatches).toBe(false);
    await expectProblem(
      await request.post('/api/channels/link-complete', {
        headers: await mutate('regional-manager'),
        data: { token: mismatchIntent.token },
      }),
      422,
      'CHAT_LINK_EMAIL_MISMATCH',
    );
  });

  test('comments, @mentions access check, 15-minute edit window, tombstone removal and follows', async ({
    request,
  }) => {
    const { team } = await directorTree(request);

    // Discussion on team budget (owned by Jordan Smith, parent Lena Fischer)
    const thread0 = await expectContract(
      await request.get(`/api/discussions/budget/${team.id}`, {
        headers: await as('budget-owner'),
      }),
      200,
      DiscussionThread,
    );
    expect(thread0.canComment).toBe(true);
    expect(thread0.follow).toMatchObject({ following: true, source: 'owner' });

    // Mentioning someone who cannot read this US team budget (e.g. Bengaluru location manager Rahul Menon) is 422 MENTION_NO_ACCESS
    await expectProblem(
      await request.post(`/api/discussions/budget/${team.id}/comments`, {
        headers: await mutate('budget-owner'),
        data: {
          body: 'Checking with @Rahul Menon on this budget',
          mentionedPersonIds: [userById('location-manager').personId!],
        },
      }),
      422,
      'MENTION_NO_ACCESS',
    );

    // Mentioning Lena Fischer (parent owner, has access) succeeds and creates a mention notification
    const created = await expectContract(
      await request.post(`/api/discussions/budget/${team.id}/comments`, {
        headers: await mutate('budget-owner'),
        data: {
          body: 'Hi @Lena Fischer, planning Q4 workshops on this budget.',
          mentionedPersonIds: [userById('department-head').personId!],
        },
      }),
      201,
      CommentView,
    );
    expect(created.canEdit).toBe(true);

    // Edit within 15 minutes succeeds
    const edited = await expectContract(
      await request.patch(`/api/comments/${created.id}`, {
        headers: await mutate('budget-owner'),
        data: { body: 'Hi @Lena Fischer, updated workshop estimate.' },
      }),
      200,
      CommentView,
    );
    expect(edited.editedAt).toBeTruthy();

    // After 15 minutes edit is rejected with 409 COMMENT_EDIT_WINDOW_EXPIRED
    await asOwner((c) =>
      c.query(
        `update comments set created_at = now() - interval '20 minutes' where id = $1`,
        [created.id],
      ),
    );
    await expectProblem(
      await request.patch(`/api/comments/${created.id}`, {
        headers: await mutate('budget-owner'),
        data: { body: 'Late edit attempt' },
      }),
      409,
      'COMMENT_EDIT_WINDOW_EXPIRED',
    );

    // Soft-delete leaves a tombstone while audit log keeps original text
    const removed = await expectContract(
      await request.delete(`/api/comments/${created.id}`, {
        headers: await mutate('budget-owner'),
      }),
      200,
      CommentView,
    );
    expect(removed.removedAt).toBeTruthy();
    expect(removed.body).toBe('');

    const audit = await auditFor(request, team.id);
    expect(audit.some((a) => a.action === 'comment.removed')).toBe(true);

    // Auditors can read the discussion but cannot post comments
    const auditorThread = await expectContract(
      await request.get(`/api/discussions/budget/${team.id}`, {
        headers: await as('auditor'),
      }),
      200,
      DiscussionThread,
    );
    expect(auditorThread.canComment).toBe(false);
    expect(auditorThread.readOnlyReason).toContain('Auditors can read the discussion');

    // Follow & unfollow
    const followState = await expectContract(
      await request.put(`/api/discussions/budget/${team.id}/follow`, {
        headers: await mutate('finance-controller'),
        data: { following: true, level: 'money_decisions' },
      }),
      200,
      FollowState,
    );
    expect(followState).toEqual({
      following: true,
      level: 'money_decisions',
      source: 'manual',
    });
    const followedList = await expectContract(
      await request.get('/api/me/following?itemType=budget', {
        headers: await as('finance-controller'),
      }),
      200,
      FollowedItemsList,
    );
    expect(followedList.items.some((i) => i.itemId === team.id)).toBe(true);
  });

  test('notifications feed, required preference protection, quiet hours, push devices and digest templates', async ({
    request,
  }) => {
    // 1. Notifications feed & mark read/unread
    const feed = await expectContract(
      await request.get('/api/notifications', {
        headers: await as('location-manager'),
      }),
      200,
      NotificationsFeed,
    );
    expect(feed.items.length).toBeGreaterThan(0);
    expect(feed.tasks.length).toBeGreaterThan(0);

    const firstId = feed.items[0].id;
    const marked = await expectContract(
      await request.post('/api/notifications/mark', {
        headers: await mutate('location-manager'),
        data: { ids: [firstId], read: true },
      }),
      200,
      MarkNotificationsResponse,
    );
    expect(marked.updated).toBe(1);
    await request.post('/api/notifications/mark', {
      headers: await mutate('location-manager'),
      data: { ids: [firstId], read: false },
    });

    // 2. Notification settings: required row cannot turn off in-app or email (422 NOTIFICATION_REQUIRED)
    const settings = await expectContract(
      await request.get('/api/me/notification-settings', {
        headers: await as('regional-manager'),
      }),
      200,
      NotificationSettingsView,
    );
    expect(settings.matrix.find((r) => r.type === 'approval.assigned')?.required).toBe(true);

    await expectProblem(
      await request.patch('/api/me/notification-settings', {
        headers: await mutate('regional-manager'),
        data: {
          matrixRow: { type: 'approval.assigned', email: false },
        },
      }),
      422,
      'NOTIFICATION_REQUIRED',
    );

    // Shortening quiet hours (e.g. 22:00 to 07:00 instead of 20:00 to 08:00) is 422 QUIET_HOURS_INVALID
    await expectProblem(
      await request.patch('/api/me/notification-settings', {
        headers: await mutate('regional-manager'),
        data: {
          quietHours: { start: '22:00', end: '07:00' },
        },
      }),
      422,
      'QUIET_HOURS_INVALID',
    );

    // Extending quiet hours (19:00 to 08:30) and toggling optional row succeeds
    const updatedSettings = await expectContract(
      await request.patch('/api/me/notification-settings', {
        headers: await mutate('regional-manager'),
        data: {
          matrixRow: { type: 'approval.reminder', slack: true },
          quietHours: { start: '19:00', end: '08:30' },
        },
      }),
      200,
      NotificationSettingsView,
    );
    expect(updatedSettings.quietHours.start).toBe('19:00');

    // Register & remove push device (audited)
    const device = await expectContract(
      await request.post('/api/me/push-devices', {
        headers: await mutate('regional-manager'),
        data: {
          deviceLabel: 'Test iPhone 16, Safari',
          userAgentFamily: 'iOS, Safari',
          endpoint: `https://push.budgetflow.example.test/sub/${randomUUID()}`,
          p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFg',
          authKey: 'UUQM145_auth_test',
        },
      }),
      201,
      PushDevice,
    );
    await request.delete(`/api/me/push-devices/${device.id}`, {
      headers: await mutate('regional-manager'),
    });

    // 3. Role-based digest templates, live scoped preview and test email via Mailpit
    const digestsList = await expectContract(
      await request.get('/api/digests/templates', {
        headers: await as('finance-admin'),
      }),
      200,
      DigestTemplateList,
    );
    expect(digestsList.items.length).toBeGreaterThanOrEqual(5);
    expect(digestsList.canManage).toBe(true);

    const ownerDigest = digestsList.items.find((d) => d.code === 'OWNER_WEEKLY')!;
    const preview = await expectContract(
      await request.get(
        `/api/digests/templates/${ownerDigest.id}/preview?personId=${userById('location-manager').personId}`,
        { headers: await as('finance-admin') },
      ),
      200,
      DigestPreviewResponse,
    );
    expect(preview.recipientName).toBe('Rahul Menon');
    expect(preview.emailText).toContain("Available under this budget's rules");

    const published = await expectContract(
      await request.patch(`/api/digests/templates/${ownerDigest.id}`, {
        headers: await mutate('finance-admin'),
        data: {
          introLine: ownerDigest.introLine,
          publish: true,
        },
      }),
      200,
      DigestTemplateView,
    );
    expect(published.version).toBeGreaterThan(ownerDigest.version);

    const testSent = await expectContract(
      await request.post(`/api/digests/templates/${ownerDigest.id}/test`, {
        headers: await mutate('finance-admin'),
        data: { channel: 'email' },
      }),
      200,
      TestChannelResponse,
    );
    expect(testSent.status).toBe('sent');
    await waitForMail('finance.admin@example.test', 'Owner weekly digest');

    // 4. Admin channels & delivery logs
    const adminView = await expectContract(
      await request.get('/api/admin/channels', {
        headers: await as('integration-admin'),
      }),
      200,
      AdminChannelsView,
    );
    expect(adminView.canManage).toBe(true);
    expect(adminView.slack.status).toBe('connected');

    const deliveries = await expectContract(
      await request.get('/api/channels/deliveries?limit=20', {
        headers: await as('integration-admin'),
      }),
      200,
      ChannelDeliveryList,
    );
    expect(deliveries.items.length).toBeGreaterThan(0);
  });
});
