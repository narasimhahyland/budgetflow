// The connector framework (092, 093-098): connections in Mock mode talk to the local mock provider,
// a sync run feeds the Phase 6 actuals review rather than the ledger, running the same window twice
// never double-counts, a value without a mapping is held back instead of guessed, and a provider that
// refuses the credentials puts the connection into "Needs attention" with a retryable message.
import { expect, test } from '@playwright/test';
import {
  ConnectionDetail,
  ImportBatch,
  IntegrationMessageList,
  IntegrationsHub,
  SyncRunList,
  SyncRunView,
  TestConnectionResult,
} from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { armFailure, CONNECTIONS, resetMock } from '../support/p12';

test.beforeEach(async () => {
  await resetMock();
});

test.describe('the connector hub and detail frame', () => {
  test('the Integration Admin sees connected systems, what can still be added, and may manage', async ({
    request,
  }) => {
    const hub = await expectContract(
      await request.get('/api/integrations', { headers: await as('integration-admin') }),
      200,
      IntegrationsHub,
    );
    expect(hub.canManage).toBe(true);
    expect(hub.health.connected).toBeGreaterThan(0);
    expect(hub.connections.map((c) => c.provider)).toContain('erpnext');
    const planning = hub.connections.find((c) => c.provider === 'adaptive_planning');
    expect(planning, 'the planning connector is on the hub').toBeTruthy();
    expect(hub.available.map((a) => a.provider)).toContain('netsuite');
  });

  test('a Finance Admin reads the hub but cannot manage it', async ({ request }) => {
    const hub = await expectContract(
      await request.get('/api/integrations', { headers: await as('finance-admin') }),
      200,
      IntegrationsHub,
    );
    expect(hub.canManage).toBe(false);
    await expectProblem(
      await request.post(`/api/integrations/connections/${CONNECTIONS.erpnext}/test`, {
        headers: await mutate('finance-admin'),
      }),
      403,
      'FORBIDDEN',
    );
  });

  test('an employee cannot see the integrations area at all', async ({ request }) => {
    await expectProblem(
      await request.get('/api/integrations', { headers: await as('employee') }),
      403,
      'FORBIDDEN',
    );
  });

  test('the detail frame never returns the credential, only when and by whom it was set', async ({
    request,
  }) => {
    const detail = await expectContract(
      await request.get(`/api/integrations/connections/${CONNECTIONS.erpnext}`, {
        headers: await as('integration-admin'),
      }),
      200,
      ConnectionDetail,
    );
    expect(detail.credential.secretRef).not.toBeNull();
    expect(detail.credential.setByName).not.toBeNull();
    expect(JSON.stringify(detail)).not.toContain('mock-erpnext');
    expect(detail.inboundWebhookPath).toContain(CONNECTIONS.erpnext);
  });

  test('test connection reports what the provider said, and a refusal flags the connection', async ({
    request,
  }) => {
    const ok = await expectContract(
      await request.post(`/api/integrations/connections/${CONNECTIONS.erpnext}/test`, {
        headers: await mutate('integration-admin'),
      }),
      200,
      TestConnectionResult,
    );
    expect(ok.ok).toBe(true);

    await armFailure('/erpnext/api/resource/Supplier', 401, 1);
    const failed = await expectContract(
      await request.post(`/api/integrations/connections/${CONNECTIONS.erpnext}/test`, {
        headers: await mutate('integration-admin'),
      }),
      200,
      TestConnectionResult,
    );
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain('401');
    expect(failed.message).not.toContain('mock-erpnext');

    // Put it back so later scenarios start from a healthy connection.
    await request.post(`/api/integrations/connections/${CONNECTIONS.erpnext}/test`, {
      headers: await mutate('integration-admin'),
    });
  });
});

test.describe('synchronisation feeds the actuals review, never the ledger', () => {
  test('ERP GL lines arrive as a review batch, and a second run of the same window applies nothing', async ({
    request,
  }) => {
    const window = { object: 'gl_lines', direction: 'inbound', since: '2026-01-01' } as const;
    const first = await expectContract(
      await request.post(`/api/integrations/connections/${CONNECTIONS.erpnext}/sync`, {
        headers: await mutate('integration-admin'),
        data: window,
      }),
      201,
      SyncRunView,
    );
    expect(first.recordsRead).toBeGreaterThan(0);

    if (first.importBatchId) {
      // The batch waits in the review queue: nothing has been posted yet.
      const batch = await expectContract(
        await request.get(`/api/actuals/imports/${first.importBatchId}`, {
          headers: await as('finance-admin'),
        }),
        200,
        ImportBatch,
      );
      expect(batch.status).toBe('review');
      expect(batch.source).toBe('erp');
      if (first.recordsApplied > 0) expect(batch.summary.imported).toBe(first.recordsApplied);
    }

    // Running the same window again reads the same lines and applies none: source references are unique.
    const second = await expectContract(
      await request.post(`/api/integrations/connections/${CONNECTIONS.erpnext}/sync`, {
        headers: await mutate('integration-admin'),
        data: window,
      }),
      201,
      SyncRunView,
    );
    expect(second.recordsRead).toBe(first.recordsRead);
    expect(second.recordsApplied, 'nothing is applied twice').toBe(0);
    expect(second.recordsSkippedDuplicate).toBeGreaterThan(0);
    expect(second.errorSummary).toContain('already imported');
  });

  test('card transactions enter as their own source and show up in the run list', async ({
    request,
  }) => {
    const run = await expectContract(
      await request.post(`/api/integrations/connections/${CONNECTIONS.ramp}/sync`, {
        headers: await mutate('integration-admin'),
        data: { object: 'transactions', direction: 'inbound', since: '2026-01-01' },
      }),
      201,
      SyncRunView,
    );
    expect(['succeeded', 'partly_succeeded'], run.errorSummary ?? '').toContain(run.status);

    const runs = await expectContract(
      await request.get('/api/integrations/sync-runs', {
        headers: await as('integration-admin'),
        params: { connectionId: CONNECTIONS.ramp },
      }),
      200,
      SyncRunList,
    );
    expect(runs.items.map((r) => r.id)).toContain(run.id);
    expect(runs.summary.runs24h).toBeGreaterThan(0);
  });

  test('a value without a mapping is held back and listed in the retry queue, not guessed', async ({
    request,
  }) => {
    // The Concur feed carries "Wellness - other", which the seed deliberately leaves unmapped (093, 095).
    const run = await expectContract(
      await request.post(`/api/integrations/connections/${CONNECTIONS.concur}/sync`, {
        headers: await mutate('integration-admin'),
        data: { object: 'expense_lines', direction: 'inbound', since: '2026-01-01' },
      }),
      201,
      SyncRunView,
    );
    expect(run.recordsFailed, run.errorSummary ?? '').toBeGreaterThan(0);

    const messages = await expectContract(
      await request.get('/api/integrations/messages', {
        headers: await as('integration-admin'),
        params: { connectionId: CONNECTIONS.concur, errorClass: 'mapping' },
      }),
      200,
      IntegrationMessageList,
    );
    const held = messages.items.find((m) => m.lastError.includes('Wellness - other'));
    expect(held, 'the unmapped expense type is held as a mapping error').toBeTruthy();
    expect(held!.errorClass).toBe('mapping');
    // A mapping error is not retried on a timer: it waits for a person to add the mapping.
    expect(held!.nextRetryAt).toBeNull();
  });

  test('a provider that refuses the credentials fails the run and flags the connection', async ({
    request,
  }) => {
    await armFailure('/ramp/developer/v1/transactions', 401, 1);
    const run = await expectContract(
      await request.post(`/api/integrations/connections/${CONNECTIONS.ramp}/sync`, {
        headers: await mutate('integration-admin'),
        data: { object: 'transactions', direction: 'inbound' },
      }),
      201,
      SyncRunView,
    );
    expect(run.status).toBe('failed');
    expect(run.errorSummary).toContain('401');

    const detail = await expectContract(
      await request.get(`/api/integrations/connections/${CONNECTIONS.ramp}`, {
        headers: await as('integration-admin'),
      }),
      200,
      ConnectionDetail,
    );
    expect(detail.summary.status).toBe('needs_attention');

    // Authentication failures are listed for a person; they are not retried on a timer.
    const messages = await expectContract(
      await request.get('/api/integrations/messages', {
        headers: await as('integration-admin'),
        params: { connectionId: CONNECTIONS.ramp, errorClass: 'authentication' },
      }),
      200,
      IntegrationMessageList,
    );
    expect(messages.items.length).toBeGreaterThan(0);
    expect(messages.items[0].nextRetryAt).toBeNull();

    await request.post(`/api/integrations/connections/${CONNECTIONS.ramp}/test`, {
      headers: await mutate('integration-admin'),
    });
  });

  test('a connector refuses an object it does not exchange', async ({ request }) => {
    await expectProblem(
      await request.post(`/api/integrations/connections/${CONNECTIONS.ramp}/sync`, {
        headers: await mutate('integration-admin'),
        data: { object: 'workers', direction: 'inbound' },
      }),
      422,
      'CONNECTOR_OBJECT_UNSUPPORTED',
    );
  });
});
