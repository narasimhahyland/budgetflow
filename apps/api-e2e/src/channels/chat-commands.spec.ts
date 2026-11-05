// Chat commands, workspace setup and account linking (061d, 061e). `/budgetflow balance` and the quick
// request answer only within the asking person's PolicyService scope and respect budget controls;
// linking a chat identity to a BudgetFlow person needs an exact verified-email match; the Integration
// Admin console shows the installations, the linked accounts and the outbound delivery log.
import { expect, test } from '@playwright/test';
import {
  AdminChannelsView,
  ChannelDeliveryList,
  ChatAccountLinkView,
  ChatInstallationView,
  ChatLinkPreview,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { postChatWebhook, webhookOk } from '../support/p8';
import { applyControl, budget, directorTree } from '../support/p5';

const TENANT = SEED.tenants.acme;

test.describe('chat commands, workspace setup and account linking', () => {
  test('a balance check answers only with budgets the asker may see', async ({ request }) => {
    // Rahul Menon manages Bengaluru; the United States tree is none of his business.
    const res = await webhookOk(request, 'slack', {
      tenantId: TENANT,
      providerUserId: 'U-LM-RAHUL',
      kind: 'balance',
    });
    expect(res.ephemeral).toBe(true);
    expect(res.text).toContain("Available under this budget's rules");
    expect(res.balances?.some((b) => b.budgetId === SEED.budgets.bengaluru)).toBe(true);
    expect(res.balances?.some((b) => b.budgetId === SEED.budgets.unitedStates)).toBe(false);
  });

  test('a quick request from chat pre-encumbers like any other request, and a frozen budget refuses it', async ({
    request,
  }) => {
    const before = await budget(request, SEED.budgets.bengaluru);
    const created = await webhookOk(request, 'slack', {
      tenantId: TENANT,
      providerUserId: 'U-EO-KAVYA',
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
    });
    expect(created.createdRequestRef).toMatch(/^REQ-/);

    const after = await budget(request, SEED.budgets.bengaluru);
    expect(
      after.balances.budgetCurrency.preEncumbered.amountMinor -
        before.balances.budgetCurrency.preEncumbered.amountMinor,
    ).toBe(15_000);

    // Withdraw it again so the seeded Bengaluru balances the visual baselines use stay clean.
    await request.post(`/api/requests/${created.createdRequestId}/withdraw`, {
      headers: await mutate('event-organizer'),
      data: { reason: 'Clean up scenario quick request' },
    });

    const { team } = await directorTree(request);
    await applyControl(request, team.id, 'freeze');
    await expectProblem(
      await postChatWebhook(request, 'slack', {
        tenantId: TENANT,
        providerUserId: 'U-DH-LENA',
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

  test('linking a chat account needs an exact verified-email match', async ({ request }) => {
    const mismatch = await expectContract(
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
    expect(mismatch.emailMatches).toBe(false);
    await expectProblem(
      await request.post('/api/channels/link-complete', {
        headers: await mutate('regional-manager'),
        data: { token: mismatch.token },
      }),
      422,
      'CHAT_LINK_EMAIL_MISMATCH',
    );

    // A tampered token is not a link anybody can follow.
    await expectProblem(
      await request.get(`/api/channels/link-preview?token=${mismatch.token.slice(0, -4)}abcd`, {
        headers: await as('regional-manager'),
      }),
      404,
      'CHAT_LINK_INVALID',
    );

    // The matching email links Lena's Teams identity to her BudgetFlow person.
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
    const link = await expectContract(
      await request.post('/api/channels/link-complete', {
        headers: await mutate('department-head'),
        data: { token: intent.token },
      }),
      200,
      ChatAccountLinkView,
    );
    expect(link).toMatchObject({
      provider: 'teams',
      personId: userById('department-head').personId,
      providerUserId: 'ENTRA-DH-LENA',
    });
  });

  test('the Integration Admin console shows installations, links and the delivery log', async ({
    request,
  }) => {
    const view = await expectContract(
      await request.get('/api/admin/channels', { headers: await as('integration-admin') }),
      200,
      AdminChannelsView,
    );
    expect(view.canManage).toBe(true);
    expect(view.slack.status).toBe('connected');
    expect(view.links.length).toBeGreaterThan(0);

    const checked = await expectContract(
      await request.patch('/api/admin/channels/teams', {
        headers: await mutate('integration-admin'),
        data: { action: 'check_status' },
      }),
      200,
      ChatInstallationView,
    );
    expect(checked.provider).toBe('teams');

    const deliveries = await expectContract(
      await request.get('/api/channels/deliveries?limit=20', {
        headers: await as('integration-admin'),
      }),
      200,
      ChannelDeliveryList,
    );
    expect(deliveries.items.length).toBeGreaterThan(0);

    // Nobody without the notification.manage action administers the workspace apps.
    await expectProblem(
      await request.patch('/api/admin/channels/slack', {
        headers: await mutate('budget-owner'),
        data: { action: 'check_status' },
      }),
      403,
      'FORBIDDEN',
    );
  });

  test('the App Home lists what the asker is waiting on and what they asked for', async ({
    request,
  }) => {
    const home = await webhookOk(request, 'slack', {
      tenantId: TENANT,
      providerUserId: `U-LM-RAHUL`,
      interactionId: `home-${randomUUID()}`,
      kind: 'app_home',
    });
    expect(home.kind).toBe('app_home');
    expect(home.waitingApprovals).toBeDefined();
    expect(home.myRequests).toBeDefined();
  });
});
