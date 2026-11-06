// Outbound webhooks to customer endpoints (101): https only, HMAC-signed with a timestamp the
// receiver can verify, retried with backoff, and redeliverable. The mock receiver checks the
// signature with the secret BudgetFlow showed once, which proves the scheme end to end.
import { expect, test } from '@playwright/test';
import {
  SendTestPingResult,
  WebhookDeliveryList,
  WebhookEndpointCreated,
  WebhookEndpointList,
  WebhookEndpointView,
} from '@bf/contracts';
import { mutate, as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { freeze, tree } from '../budgets/p4';
import {
  armFailure,
  deliveriesSignedWith,
  deliveryLog,
  isTerminal,
  MOCK_INTERNAL_BASE,
  resetMock,
  waitForDelivery,
} from '../support/p12';

const RECEIVER = `${MOCK_INTERNAL_BASE}/receiver/hook`;

async function createEndpoint(
  request: import('@playwright/test').APIRequestContext,
  url = RECEIVER,
) {
  return expectContract(
    await request.post('/api/integrations/webhook-endpoints', {
      headers: await mutate('integration-admin'),
      data: {
        url,
        description: 'Scenario receiver',
        events: ['budget.frozen', 'budget.threshold_crossed'],
      },
    }),
    201,
    WebhookEndpointCreated,
  );
}

test.beforeEach(async () => {
  await resetMock();
});

test.describe('webhook endpoints', () => {
  test('the signing secret is shown once and the list explains how to verify a delivery', async ({
    request,
  }) => {
    const created = await createEndpoint(request);
    expect(created.signingSecret.length).toBeGreaterThan(20);

    const list = await expectContract(
      await request.get('/api/integrations/webhook-endpoints', {
        headers: await as('integration-admin'),
      }),
      200,
      WebhookEndpointList,
    );
    expect(list.verification).toContain('BudgetFlow-Signature');
    expect(JSON.stringify(list)).not.toContain(created.signingSecret);
  });

  test('an address that is not allowed is refused', async ({ request }) => {
    await expectProblem(
      await request.post('/api/integrations/webhook-endpoints', {
        headers: await mutate('integration-admin'),
        data: { url: 'https://evil.example.com/hook', events: ['budget.frozen'] },
      }),
      422,
      'OUTBOUND_HOST_NOT_ALLOWED',
    );
  });

  test('at least one event is required', async ({ request }) => {
    await expectProblem(
      await request.post('/api/integrations/webhook-endpoints', {
        headers: await mutate('integration-admin'),
        data: { url: RECEIVER, events: [] },
      }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

test.describe('deliveries', () => {
  test('a test ping arrives with a signature the receiver can verify', async ({ request }) => {
    const created = await createEndpoint(request);
    const ping = await expectContract(
      await request.post(`/api/integrations/webhook-endpoints/${created.endpoint.id}/test`, {
        headers: await mutate('integration-admin'),
      }),
      200,
      SendTestPingResult,
    );
    expect(ping.ok).toBe(true);
    expect(ping.statusCode).toBe(200);

    // Several endpoints point at the same receiver, so find the delivery this secret signed. That
    // the HMAC verifies at all is the point: a receiver can tell a real delivery from a forged one.
    const mine = await deliveriesSignedWith(created.signingSecret);
    expect(mine.length, 'exactly one delivery verifies with this endpoint’s secret').toBe(1);
    expect(mine[0].signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(mine[0].body?.type).toBe('budget.threshold_crossed');
    expect(mine[0].body?.data).toMatchObject({ test: true });
  });

  test('a failing receiver is recorded with a retry time and can be redelivered', async ({
    request,
  }) => {
    const created = await createEndpoint(request);
    await armFailure('/receiver/hook', 503, 1);
    const failed = await expectContract(
      await request.post(`/api/integrations/webhook-endpoints/${created.endpoint.id}/test`, {
        headers: await mutate('integration-admin'),
      }),
      200,
      SendTestPingResult,
    );
    expect(failed.ok).toBe(false);
    expect(failed.statusCode).toBe(503);

    const deliveries = await expectContract(
      await request.get('/api/integrations/webhook-deliveries', {
        headers: await as('integration-admin'),
        params: { endpointId: created.endpoint.id },
      }),
      200,
      WebhookDeliveryList,
    );
    const first = deliveries.items[0];
    expect(first.status).toBe('failed');
    expect(first.nextRetryAt).not.toBeNull();

    const retried = await expectContract(
      await request.post(`/api/integrations/webhook-deliveries/${first.id}/redeliver`, {
        headers: await mutate('integration-admin'),
      }),
      200,
      SendTestPingResult,
    );
    expect(retried.ok).toBe(true);

    // The endpoint recovers; it is only disabled after a full day of failures.
    const after = await expectContract(
      await request.get('/api/integrations/webhook-endpoints', {
        headers: await as('integration-admin'),
      }),
      200,
      WebhookEndpointList,
    );
    expect(after.items.find((e) => e.id === created.endpoint.id)?.status).toBe('active');
  });

  test('rotating the secret signs with both until receivers switch over', async ({ request }) => {
    const created = await createEndpoint(request);
    const rotated = await expectContract(
      await request.post(
        `/api/integrations/webhook-endpoints/${created.endpoint.id}/rotate-secret`,
        { headers: await mutate('integration-admin') },
      ),
      200,
      WebhookEndpointCreated,
    );
    expect(rotated.signingSecret).not.toBe(created.signingSecret);
    expect(rotated.endpoint.secretRotatedAt).not.toBeNull();

    await request.post(`/api/integrations/webhook-endpoints/${created.endpoint.id}/test`, {
      headers: await mutate('integration-admin'),
    });
    expect(
      (await deliveriesSignedWith(rotated.signingSecret)).length,
      'the delivery verifies with the new secret',
    ).toBe(1);
    expect((await deliveriesSignedWith(created.signingSecret)).length).toBe(0);
  });

  test('an endpoint can be removed and stops receiving', async ({ request }) => {
    const created = await createEndpoint(request);
    await request.delete(`/api/integrations/webhook-endpoints/${created.endpoint.id}`, {
      headers: await mutate('integration-admin'),
    });
    await expectProblem(
      await request.post(`/api/integrations/webhook-endpoints/${created.endpoint.id}/test`, {
        headers: await mutate('integration-admin'),
      }),
      404,
      'NOT_FOUND',
    );
  });

  test('a Finance Admin reads endpoints but cannot change them', async ({ request }) => {
    const created = await createEndpoint(request);
    await expectContract(
      await request.get('/api/integrations/webhook-endpoints', {
        headers: await as('finance-admin'),
      }),
      200,
      WebhookEndpointList,
    );
    await expectProblem(
      await request.patch(`/api/integrations/webhook-endpoints/${created.endpoint.id}`, {
        headers: await mutate('finance-admin'),
        data: { description: 'not allowed' },
      }),
      403,
      'FORBIDDEN',
    );
    const view = await expectContract(
      await request.patch(`/api/integrations/webhook-endpoints/${created.endpoint.id}`, {
        headers: await mutate('integration-admin'),
        data: { description: 'updated by the admin' },
      }),
      200,
      WebhookEndpointView,
    );
    expect(view.description).toBe('updated by the admin');
  });
});

test.describe('domain events reach subscribed endpoints', () => {
  test('freezing a budget is published through the Phase 8 outbox and delivered signed', async ({
    request,
  }) => {
    const created = await createEndpoint(request);
    const { a } = await tree(request, 2_000_000, 500_000);
    await freeze(request, a.id);

    const delivery = await waitForDelivery(created.signingSecret);
    expect(delivery, 'the worker drained the outbox and delivered the event').toBeTruthy();
    expect(delivery!.body?.type).toBe('budget.frozen');
    expect(delivery!.body?.data).toMatchObject({ budgetId: a.id });
    // The payload carries identifiers and the fields of the event, never a secret.
    expect(JSON.stringify(delivery!.body)).not.toContain(created.signingSecret);
  });

  test('an endpoint receives events from after it was registered, never the backlog before it', async ({
    request,
  }) => {
    const { a, b } = await tree(request, 2_000_000, 500_000);

    // Happens before anyone subscribes: the new owner was never authorized to see it.
    await freeze(request, a.id);

    const created = await createEndpoint(request);

    // Happens after: this one is theirs.
    await freeze(request, b.id);

    const later = await waitForDelivery(created.signingSecret);
    expect(later, 'the event raised after registration was delivered').toBeTruthy();
    expect(later!.body?.data).toMatchObject({ budgetId: b.id });

    // The drain publishes a tenant's outbox in created_at order and sends each delivery in turn, so
    // the earlier freeze was already offered to the fan-out by the time this one arrived. Its
    // absence here is a decision not to deliver it, not a message still in flight.
    const mine = await deliveriesSignedWith(created.signingSecret);
    expect(mine.map((d) => d.body?.data?.['budgetId'])).toEqual([b.id]);

    const log = await expectContract(
      await request.get('/api/integrations/webhook-deliveries', {
        headers: await as('integration-admin'),
        params: { endpointId: created.endpoint.id },
      }),
      200,
      WebhookDeliveryList,
    );
    expect(
      log.items.map((d) => d.payload['budgetId']),
      'the delivery log holds only the event raised after the endpoint existed',
    ).toEqual([b.id]);
  });
});

/**
 * One fanned-out event is one delivery. The fan-out queues the row and the send writes its outcome
 * back onto it, so an operator reading the log sees what happened to each event and never a queued
 * row beside a sent one that will never complete.
 */
test.describe('the delivery log holds one row per event', () => {
  test('a delivered event leaves exactly one row, in a terminal state', async ({ request }) => {
    const { b } = await tree(request, 2_000_000, 500_000);
    const created = await createEndpoint(request);
    await freeze(request, b.id);

    expect(await waitForDelivery(created.signingSecret), 'the receiver got the event').toBeTruthy();

    const items = await deliveryLog(
      request,
      created.endpoint.id,
      await as('integration-admin'),
      (rows) => rows.length > 0 && rows.every(isTerminal),
    );
    expect(
      items.map((d) => d.status),
      'the delivered event is one row that reached a terminal state',
    ).toEqual(['succeeded']);
    expect(items[0].payload['budgetId']).toBe(b.id);
    expect(items[0].statusCode).toBe(200);
    expect(items[0].attempt, 'the row records the attempt that sent it').toBeGreaterThan(0);
    expect(items[0].error).toBeNull();
    expect(items[0].nextRetryAt, 'nothing is waiting to be sent again').toBeNull();
  });

  test('a delivery the receiver rejects leaves one row, failed, with the reason', async ({
    request,
  }) => {
    const { b } = await tree(request, 2_000_000, 500_000);
    const created = await createEndpoint(request);
    // Only the first attempt fails; the retry is a minute away, so this scenario reads the log
    // between them and sees the failure exactly as the operator would.
    await armFailure('/receiver/hook', 503, 1);
    await freeze(request, b.id);

    expect(
      await waitForDelivery(created.signingSecret),
      'the receiver was called and refused',
    ).toBeTruthy();

    const items = await deliveryLog(
      request,
      created.endpoint.id,
      await as('integration-admin'),
      (rows) => rows.length > 0 && rows.every((d) => d.status === 'failed'),
    );
    expect(
      items.map((d) => d.status),
      'the refused event is one row recorded as failed',
    ).toEqual(['failed']);
    expect(items[0].statusCode).toBe(503);
    expect(items[0].error, 'the failure carries a reason the operator can act on').toContain('503');
    expect(items[0].nextRetryAt, 'it is queued to be tried again').not.toBeNull();
  });
});
