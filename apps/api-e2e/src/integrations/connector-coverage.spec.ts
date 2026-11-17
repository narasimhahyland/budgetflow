// Tier C connector coverage (094-097): Odoo, Workday Financials, NetSuite, Brex, Coupa, Workday HCM
// and Google Calendar each get a contract scenario against the mock provider. Each connects in Mock
// mode (credential write-only), passes "Test connection", runs its inbound objects through the same
// paths as every connector (money into the actuals review, workers into a headcount snapshot,
// calendar answers into RSVPs), and a repeated run applies nothing twice. The provider shapes are
// the recorded, scrubbed fixtures in infra/mock-providers/server.mjs.
import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import {
  ConnectionDetail,
  EventInvitationView,
  ImportBatch,
  SyncRunView,
  TestConnectionResult,
  type IntegrationProvider,
  type SyncObject,
} from '@bf/contracts';
import { P5_EVENT, userById } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { env } from '../support/env';
import { mockApi, resetMock } from '../support/p12';

test.beforeEach(async () => {
  await resetMock();
});

/** Connections this file made, disconnected afterwards so the hub is left as the seed has it. */
const made = new Set<string>();
test.afterAll(async () => {
  const api = await pwRequest.newContext({
    baseURL: process.env.API_URL ?? `http://localhost:${env('BF_API_PORT')}`,
  });
  for (const id of made) {
    const res = await api.delete(`/api/integrations/connections/${id}`, {
      headers: await mutate('integration-admin'),
    });
    expect(res.status()).toBe(200);
  }
});

/** Connects the provider in Mock mode, or returns the connection a previous run made. */
async function connect(request: APIRequestContext, provider: IntegrationProvider) {
  const res = await request.post('/api/integrations', {
    headers: await mutate('integration-admin'),
    data: { provider, mode: 'mock', credential: `mock-${provider}-dev-only-0001` },
  });
  if (res.status() === 409) {
    const body = (await res.json()) as { code: string; params?: { connectionId?: string } };
    expect(body.code).toBe('INTEGRATION_ALREADY_CONNECTED');
    made.add(body.params!.connectionId!);
    return body.params!.connectionId!;
  }
  const detail = await expectContract(res, 201, ConnectionDetail);
  made.add(detail.summary.id);
  expect(detail.summary.status).toBe('connected');
  expect(JSON.stringify(detail)).not.toContain(`mock-${provider}-dev-only-0001`);
  return detail.summary.id;
}

async function testConnection(request: APIRequestContext, id: string) {
  const r = await expectContract(
    await request.post(`/api/integrations/connections/${id}/test`, {
      headers: await mutate('integration-admin'),
    }),
    200,
    TestConnectionResult,
  );
  expect(r, r.message).toMatchObject({ ok: true, statusCode: 200 });
}

async function sync(request: APIRequestContext, id: string, object: SyncObject) {
  return expectContract(
    await request.post(`/api/integrations/connections/${id}/sync`, {
      headers: await mutate('integration-admin'),
      data: { object, direction: 'inbound', since: '2026-01-01' },
    }),
    201,
    SyncRunView,
  );
}

/**
 * A money object: the lines reach the actuals review under their own source (never the ledger),
 * every line read is either applied or recognised as a duplicate, and a second run of the same
 * window applies nothing.
 */
async function moneyObject(
  request: APIRequestContext,
  id: string,
  object: SyncObject,
  expected: { read: number; source: string },
) {
  const first = await sync(request, id, object);
  expect(['succeeded', 'partly_succeeded'], first.errorSummary ?? '').toContain(first.status);
  expect(first.recordsRead).toBe(expected.read);
  expect(first.recordsApplied + first.recordsSkippedDuplicate + first.recordsFailed).toBe(
    expected.read,
  );
  if (first.recordsApplied > 0) {
    const batch = await expectContract(
      await request.get(`/api/actuals/imports/${first.importBatchId}`, {
        headers: await as('finance-admin'),
      }),
      200,
      ImportBatch,
    );
    expect(batch).toMatchObject({ status: 'review', source: expected.source });
  }
  const second = await sync(request, id, object);
  expect(second.recordsRead).toBe(expected.read);
  expect(second.recordsApplied, 'nothing is applied twice').toBe(0);
}

test.describe('ERP connectors (094)', () => {
  test('Odoo journal items enter the actuals review as ERP lines', async ({ request }) => {
    const id = await connect(request, 'odoo');
    await testConnection(request, id);
    await moneyObject(request, id, 'gl_lines', { read: 3, source: 'erp' });
  });

  test('Workday Financials journal lines enter the actuals review as ERP lines', async ({
    request,
  }) => {
    const id = await connect(request, 'workday_financials');
    await testConnection(request, id);
    await moneyObject(request, id, 'gl_lines', { read: 2, source: 'erp' });
  });

  test('NetSuite transactions enter the actuals review as ERP lines', async ({ request }) => {
    const id = await connect(request, 'netsuite');
    await testConnection(request, id);
    await moneyObject(request, id, 'gl_lines', { read: 2, source: 'erp' });
  });
});

test.describe('card and procurement connectors (095, 096)', () => {
  test('Brex card transactions enter the actuals review as card lines', async ({ request }) => {
    const id = await connect(request, 'brex');
    await testConnection(request, id);
    await moneyObject(request, id, 'transactions', { read: 1, source: 'card' });
  });

  test('Coupa supplier invoices enter as payables; its purchase orders are read and reported', async ({
    request,
  }) => {
    const id = await connect(request, 'coupa');
    await testConnection(request, id);
    await moneyObject(request, id, 'supplier_invoices', { read: 1, source: 'ap' });
    const orders = await sync(request, id, 'purchase_orders');
    expect(orders).toMatchObject({ status: 'succeeded', recordsRead: 1, recordsApplied: 1 });
    expect(orders.importBatchId, 'purchase orders never become actuals').toBeNull();
  });
});

test.describe('HR and calendar connectors (093, 097)', () => {
  test('Workday HCM workers become a headcount snapshot, and a location without a mapping is held back', async ({
    request,
  }) => {
    const id = await connect(request, 'workday_hcm');
    await testConnection(request, id);
    // Map the locations the HR file connection maps; "Remote - Europe" stays unmapped on purpose.
    expect(
      (
        await request.put(`/api/integrations/connections/${id}/mappings`, {
          headers: await mutate('integration-admin'),
          data: {
            entries: [
              { kind: 'hr_field', externalValue: 'Bengaluru', internalValue: 'BLR' },
              { kind: 'hr_field', externalValue: 'Hyderabad', internalValue: 'HYD' },
              { kind: 'hr_field', externalValue: 'New York', internalValue: 'NYC' },
              { kind: 'hr_field', externalValue: 'Berlin', internalValue: 'BER' },
            ],
          },
        })
      ).ok(),
    ).toBe(true);
    const run = await sync(request, id, 'workers');
    expect(run.recordsRead).toBeGreaterThan(0);
    expect(run.recordsFailed, 'the unmapped location is held back, not guessed').toBeGreaterThan(0);
    expect(run.errorSummary).toContain('Headcount snapshot created');
  });

  test('Google Calendar responses reach the invitation through the RSVP rules', async ({
    request,
  }) => {
    const id = await connect(request, 'google_calendar');
    await testConnection(request, id);
    const employee = userById('employee');
    const eventId = P5_EVENT.id;
    const before = await expectContract(
      await request.get(`/api/events/${eventId}/invitations`, {
        headers: await as('event-organizer'),
      }),
      200,
      EventInvitationView,
    );
    const mine = before.participants.find((p) => p.personId === employee.personId)!;
    // The seed has the employee going; an Accepted from the calendar keeps them going.
    expect(mine.rsvpStatus).toBe('going');
    const mock = await mockApi();
    await mock.post('/_control/calendar-responses', {
      data: {
        provider: 'google_calendar',
        items: [
          {
            id: 'GCAL-9001',
            eventCode: 'EV-2026-DIWALI',
            attendee: employee.username,
            response: 'accepted',
            at: '2026-11-16T08:00:00Z',
          },
          {
            id: 'GCAL-9002',
            eventCode: 'EV-2026-DIWALI',
            attendee: 'nobody@example.test',
            response: 'accepted',
            at: '2026-11-12T08:00:00Z',
          },
        ],
      },
    });
    const run = await sync(request, id, 'calendar_responses');
    expect(run).toMatchObject({
      recordsRead: 2,
      recordsApplied: 0,
      recordsSkippedDuplicate: 1,
      recordsFailed: 1,
    });
    expect(run.errorSummary).toContain('Accepted 2');
    const after = await expectContract(
      await request.get(`/api/events/${eventId}/invitations`, {
        headers: await as('event-organizer'),
      }),
      200,
      EventInvitationView,
    );
    expect(after.counts).toEqual(before.counts);
  });
});
