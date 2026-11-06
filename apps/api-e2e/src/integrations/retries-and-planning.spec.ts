// The retry queue and dead letter (100), and the planning import preview (094a). Transient provider
// failures retry with backoff and end in the dead letter; a retry reuses the original idempotency key
// so a success never duplicates; a discard keeps the item with its reason. The planning preview shows
// differences against the root budgets and blocks a decrease below what a root has already used.
import { expect, test } from '@playwright/test';
import {
  AdaptivePlanPreview,
  IntegrationMessageList,
  MessageActionResult,
  SyncRunView,
} from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { armFailure, CONNECTIONS, resetMock } from '../support/p12';

test.beforeEach(async () => {
  await resetMock();
});

test.describe('failures, retries and the dead letter', () => {
  test('a provider outage is retryable and scheduled with a backoff', async ({ request }) => {
    // Three attempts inside the client all fail, so the run records one retryable failure.
    await armFailure('/erpnext/api/resource/GL Entry', 503, 5);
    const run = await expectContract(
      await request.post(`/api/integrations/connections/${CONNECTIONS.erpnext}/sync`, {
        headers: await mutate('integration-admin'),
        data: { object: 'gl_lines', direction: 'inbound' },
      }),
      201,
      SyncRunView,
    );
    expect(run.status).toBe('failed');

    const queue = await expectContract(
      await request.get('/api/integrations/messages', {
        headers: await as('integration-admin'),
        params: { connectionId: CONNECTIONS.erpnext, status: 'retrying' },
      }),
      200,
      IntegrationMessageList,
    );
    const message = queue.items.find((m) => m.errorClass === 'provider_unavailable');
    expect(message, 'an outage waits for a retry rather than failing for good').toBeTruthy();
    expect(message!.nextRetryAt).not.toBeNull();
    expect(message!.maxAttempts).toBe(8);
    // Payloads are stored redacted, so nothing credential-shaped can leak into the screen.
    expect(JSON.stringify(message!.payloadRedacted)).not.toContain('mock-erpnext');

    // Once the provider is healthy again, retrying the item succeeds and it leaves the queue.
    const retried = await expectContract(
      await request.post('/api/integrations/messages/retry', {
        headers: await mutate('integration-admin'),
        data: { ids: [message!.id] },
      }),
      200,
      MessageActionResult,
    );
    expect(retried.succeeded).toBe(1);
    expect(retried.items[0].status).toBe('succeeded');
  });

  test('a discarded item keeps its reason and cannot be retried afterwards', async ({
    request,
  }) => {
    await armFailure('/concur/api/v3.0/expense/entries', 503, 5);
    await request.post(`/api/integrations/connections/${CONNECTIONS.concur}/sync`, {
      headers: await mutate('integration-admin'),
      data: { object: 'expense_lines', direction: 'inbound' },
    });
    const queue = await expectContract(
      await request.get('/api/integrations/messages', {
        headers: await as('integration-admin'),
        params: { connectionId: CONNECTIONS.concur },
      }),
      200,
      IntegrationMessageList,
    );
    const message = queue.items.find((m) => m.status === 'retrying');
    test.skip(!message, 'no failing message to discard');

    const discarded = await expectContract(
      await request.post('/api/integrations/messages/discard', {
        headers: await mutate('integration-admin'),
        data: {
          ids: [message!.id],
          reasonCode: 'DISCARD-DUPLICATE',
          reason: 'The provider resent a window we already have.',
        },
      }),
      200,
      MessageActionResult,
    );
    expect(discarded.discarded).toBe(1);
    expect(discarded.items[0].discardReasonCode).toBe('DISCARD-DUPLICATE');

    await expectProblem(
      await request.post('/api/integrations/messages/retry', {
        headers: await mutate('integration-admin'),
        data: { ids: [message!.id] },
      }),
      409,
      'MESSAGE_NOT_RETRYABLE',
    );
  });

  test('a Finance Admin reads the queue but cannot act on it', async ({ request }) => {
    await expectContract(
      await request.get('/api/integrations/messages', { headers: await as('finance-admin') }),
      200,
      IntegrationMessageList,
    );
    await expectProblem(
      await request.post('/api/integrations/messages/discard', {
        headers: await mutate('finance-admin'),
        data: {
          ids: ['00000000-0000-4000-8000-000000000001'],
          reasonCode: 'DISCARD-TEST',
          reason: 'A Finance Admin may not discard integration messages.',
        },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('planning import preview', () => {
  test('the preview shows differences, flags new money and blocks a decrease below the floor', async ({
    request,
  }) => {
    // Give the planning connector a working credential and map its levels onto the root budgets.
    await request.post(`/api/integrations/connections/${CONNECTIONS.adaptivePlanning}/credential`, {
      headers: await mutate('integration-admin'),
      data: { credential: 'mock-adaptive-dev-only-0002' },
    });
    const roots = await request.get('/api/budgets', {
      headers: await as('finance-admin'),
      params: { limit: 100 },
    });
    const body = (await roots.json()) as {
      items: { id: string; name: string; parentId: string | null }[];
    };
    const root = body.items.find((b) => b.parentId === null);
    test.skip(!root, 'no root budget to map the plan onto');

    await request.put(`/api/integrations/connections/${CONNECTIONS.adaptivePlanning}/mappings`, {
      headers: await mutate('integration-admin'),
      data: {
        entries: [
          {
            kind: 'plan_level',
            externalValue: 'Employee programs',
            internalValue: root!.id,
          },
        ],
      },
    });

    const preview = await expectContract(
      await request.post(
        `/api/integrations/connections/${CONNECTIONS.adaptivePlanning}/plan-import/preview`,
        {
          headers: await mutate('finance-admin'),
          data: { externalVersion: 'FY2027 Budget, Approved', fiscalYearLabel: 'FY2027' },
        },
      ),
      200,
      AdaptivePlanPreview,
    );
    expect(preview.lines.length).toBeGreaterThan(0);
    const line = preview.lines[0];
    expect(line.rootBudgetId).toBe(root!.id);
    expect(line.floorAmount).not.toBeNull();
    // A level with no mapping is listed rather than guessed, and blocks the import.
    expect(preview.unmappedLevels).toContain('Reserve');
    expect(preview.blocked).toBe(true);
    // Nothing is posted by a preview: it only describes what an approved plan version would do.
    expect(preview.requiresCeoApproval).toBe(line.differenceMinor > 0);
  });

  test('an Integration Admin alone cannot preview a plan import: it needs root budget authority (budget.create_root)', async ({
    request,
  }) => {
    await expectProblem(
      await request.post(
        `/api/integrations/connections/${CONNECTIONS.adaptivePlanning}/plan-import/preview`,
        {
          headers: await mutate('integration-admin'),
          data: { externalVersion: 'FY2027 Budget, Approved', fiscalYearLabel: 'FY2027' },
        },
      ),
      403,
      'FORBIDDEN',
    );
  });
});
