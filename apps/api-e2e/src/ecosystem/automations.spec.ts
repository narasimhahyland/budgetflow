// No-code connectors (092b). An automation acts as the person who connected it, can only look up a
// balance and create a Draft, and the Draft goes through the ordinary request command: same policy
// check, same idempotency key, one audit entry, and it stays a Draft until a person submits it.
import { expect, test } from '@playwright/test';
import {
  AuditEventList,
  AutomationBalanceResult,
  AutomationConnectorView,
  AutomationDraftRequestResult,
  RequestDetail,
} from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { connectAutomation, withToken } from './support';

test.describe('platforms and connecting', () => {
  test('Zapier is allowed and the other platforms are not', async ({ request }) => {
    const view = await expectContract(
      await request.get('/api/ecosystem/automations', {
        headers: await as('integration-admin'),
      }),
      200,
      AutomationConnectorView,
    );
    const allowed = view.platforms.filter((p) => p.allowed).map((p) => p.platform);
    expect(allowed).toEqual(['zapier']);
    // The actions are the whole surface: there is no action that submits, approves or moves money.
    expect(view.actions.map((a) => a.action).sort()).toEqual([
      'budget.balance.read',
      'request.draft.create',
    ]);
    expect(view.neverDoes.join(' ')).toContain('cannot approve');
  });

  test('connecting a platform the company has not allowed is refused', async ({ request }) => {
    await expectProblem(
      await request.post('/api/ecosystem/automations/connections', {
        headers: await mutate('event-organizer'),
        data: {
          platform: 'make',
          label: 'should not exist',
          actions: ['budget.balance.read'],
          consentAcknowledged: true,
        },
      }),
      403,
      'AUTOMATION_PLATFORM_NOT_ALLOWED',
    );
  });
});

test.describe('what an automation may do', () => {
  test('it reads a balance its person may read and nothing from another tenant', async ({
    request,
  }) => {
    const { token } = await connectAutomation(request, 'finance-admin', ['budget.balance.read']);
    const mine = await expectContract(
      await request.get(`/api/automation/v1/budgets/${SEED.budgets.bengaluru}/balance`, {
        headers: withToken(token),
      }),
      200,
      AutomationBalanceResult,
    );
    expect(mine.budgetId).toBe(SEED.budgets.bengaluru);
    expect(mine.availableUnderRules.currency).toBe('USD');
    // A budget in another tenant is simply not there, whatever the caller claims in a header.
    await expectProblem(
      await request.get(`/api/automation/v1/budgets/${SEED.budgets.globexOperations}/balance`, {
        headers: withToken(token, { 'x-tenant-id': SEED.tenants.globex }),
      }),
      404,
      'NOT_FOUND',
    );
  });

  test('an action the connection was not granted is refused', async ({ request }) => {
    const { token } = await connectAutomation(request, 'finance-admin', ['budget.balance.read']);
    await expectProblem(
      await request.post('/api/automation/v1/requests/drafts', {
        headers: withToken(token, { 'idempotency-key': randomUUID() }),
        data: {
          budgetId: SEED.budgets.bengaluru,
          amount: { amountMinor: 50_000, currency: 'USD' },
          spendType: 'team_event',
          title: 'Should not exist',
          purpose: 'The connection has no drafts grant.',
        },
      }),
      403,
      'ECOSYSTEM_GRANT_MISSING',
    );
  });

  test('a draft it creates stays a draft, is labelled, and writes one audit entry', async ({
    request,
  }) => {
    // The Bengaluru location manager owns that budget, so a draft on it is work they could do
    // unaided; an automation never reaches further than its person does.
    const { token } = await connectAutomation(request, 'location-manager', [
      'request.draft.create',
    ]);
    const created = await expectContract(
      await request.post('/api/automation/v1/requests/drafts', {
        headers: withToken(token, { 'idempotency-key': randomUUID() }),
        data: {
          budgetId: SEED.budgets.bengaluru,
          amount: { amountMinor: 50_000, currency: 'USD' },
          spendType: 'team_event',
          title: 'Intake form: team lunch',
          purpose: 'Raised from the intake form; the organizer submits it in BudgetFlow.',
        },
      }),
      201,
      AutomationDraftRequestResult,
    );
    expect(created.status).toBe('draft');
    expect(created.label).toContain('Zapier');
    expect(created.notice).toContain('cannot submit');

    // The request itself, read back through the ordinary API, is a draft and nothing more.
    const detail = await expectContract(
      await request.get(`/api/requests/${created.requestId}`, {
        headers: await as('location-manager'),
      }),
      200,
      RequestDetail,
    );
    expect(detail.status).toBe('draft');
    expect(detail.approvedAmount).toBeNull();

    const events = await expectContract(
      await request.get('/api/audit/events', {
        headers: await as('auditor'),
        params: { resourceType: 'request', resourceId: created.requestId, limit: 50 },
      }),
      200,
      AuditEventList,
    );
    expect(events.items.length, 'exactly one audit entry for the draft').toBe(1);
    expect(events.items[0].action).toBe('request.created');
  });

  test('the same idempotency key creates one draft, not two', async ({ request }) => {
    const { token } = await connectAutomation(request, 'location-manager', [
      'request.draft.create',
    ]);
    const key = randomUUID();
    const data = {
      budgetId: SEED.budgets.bengaluru,
      amount: { amountMinor: 25_000, currency: 'USD' },
      spendType: 'team_event',
      title: 'Intake form: replayed',
      purpose: 'The platform retried the same call.',
    };
    const first = await expectContract(
      await request.post('/api/automation/v1/requests/drafts', {
        headers: withToken(token, { 'idempotency-key': key }),
        data,
      }),
      201,
      AutomationDraftRequestResult,
    );
    const second = await expectContract(
      await request.post('/api/automation/v1/requests/drafts', {
        headers: withToken(token, { 'idempotency-key': key }),
        data,
      }),
      201,
      AutomationDraftRequestResult,
    );
    expect(second.requestId).toBe(first.requestId);
  });

  test('a revoked automation stops working at once', async ({ request }) => {
    const { token, id } = await connectAutomation(request, 'finance-admin', [
      'budget.balance.read',
    ]);
    expect(
      (
        await request.get(`/api/automation/v1/budgets/${SEED.budgets.bengaluru}/balance`, {
          headers: withToken(token),
        })
      ).status(),
    ).toBe(200);
    await request.post(`/api/ecosystem/automations/connections/${id}/revoke`, {
      headers: await mutate('finance-admin'),
      data: { reason: 'scenario' },
    });
    await expectProblem(
      await request.get(`/api/automation/v1/budgets/${SEED.budgets.bengaluru}/balance`, {
        headers: withToken(token),
      }),
      401,
      'ECOSYSTEM_CONNECTION_REVOKED',
    );
  });
});
