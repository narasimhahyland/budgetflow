// Product analytics pipeline (Phase 2): web events are stored once per event id for the caller's tenant
// and person, only allowlisted client events are accepted, and rows stay invisible to other tenants (RLS).
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { RecordAnalyticsResponse } from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole } from '../support/db';

const { acme: hyland, globex } = SEED.tenants;

test.describe('product analytics events', () => {
  test('a batch is stored once per event id, for the caller and their tenant', async ({
    request,
  }) => {
    const marker = randomUUID();
    const events = [
      { id: randomUUID(), name: 'session.started', properties: { marker } },
      { id: randomUUID(), name: 'page.viewed', properties: { route: '/reports', marker } },
    ];
    const first = await expectContract(
      await request.post('/api/analytics/events', {
        headers: await as('analyst'),
        data: { events },
      }),
      202,
      RecordAnalyticsResponse,
    );
    expect(first).toEqual({ accepted: 2, duplicates: 0 });
    const retry = await expectContract(
      await request.post('/api/analytics/events', {
        headers: await as('analyst'),
        data: { events },
      }),
      202,
      RecordAnalyticsResponse,
    );
    expect(retry).toEqual({ accepted: 0, duplicates: 2 });

    const rows = await asAppRole(
      hyland,
      async (c) =>
        (
          await c.query(
            `select name, actor_person_id, properties from product_analytics_events
            where properties->>'marker' = $1 order by name`,
            [marker],
          )
        ).rows,
    );
    expect(rows).toEqual([
      {
        name: 'page.viewed',
        actor_person_id: userById('analyst').personId,
        properties: { route: '/reports', marker, source: 'web' },
      },
      {
        name: 'session.started',
        actor_person_id: userById('analyst').personId,
        properties: { marker, source: 'web' },
      },
    ]);
    const leaked = await asAppRole(
      globex,
      async (c) =>
        (
          await c.query(
            `select count(*)::int as n from product_analytics_events where properties->>'marker' = $1`,
            [marker],
          )
        ).rows[0].n,
    );
    expect(leaked).toBe(0);
  });

  test('a client time more than a day off is replaced by the server time', async ({ request }) => {
    const marker = randomUUID();
    await expectContract(
      await request.post('/api/analytics/events', {
        headers: await as('employee'),
        data: {
          events: [
            {
              id: randomUUID(),
              name: 'page.viewed',
              occurredAt: '2020-01-01T00:00:00.000Z',
              properties: { route: '/', marker },
            },
          ],
        },
      }),
      202,
      RecordAnalyticsResponse,
    );
    const at = await asAppRole(
      hyland,
      async (c) =>
        (
          await c.query(
            `select occurred_at from product_analytics_events where properties->>'marker' = $1`,
            [marker],
          )
        ).rows[0].occurred_at as Date,
    );
    expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(5 * 60_000);
  });

  test('server-only, unknown or oversized events are rejected', async ({ request }) => {
    const headers = await as('analyst');
    for (const events of [
      [{ id: randomUUID(), name: 'allocation.created' }],
      [{ id: randomUUID(), name: 'budget.deleted' }],
      [
        {
          id: randomUUID(),
          name: 'page.viewed',
          properties: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i])),
        },
      ],
      [{ id: randomUUID(), name: 'page.viewed', email: 'someone@example.test' }],
      Array.from({ length: 51 }, () => ({ id: randomUUID(), name: 'page.viewed' })),
      [],
    ]) {
      await expectProblem(
        await request.post('/api/analytics/events', { headers, data: { events } }),
        400,
        'VALIDATION_FAILED',
      );
    }
  });

  test('anonymous callers, platform operators and other tenants are refused', async ({
    request,
  }) => {
    const data = { events: [{ id: randomUUID(), name: 'session.started' }] };
    await expectProblem(
      await request.post('/api/analytics/events', { data }),
      401,
      'UNAUTHENTICATED',
    );
    const operator = await request.post('/api/analytics/events', {
      headers: await as('super-admin'),
      data,
    });
    expect(operator.status()).toBe(404);
    await expectProblem(
      await request.post('/api/analytics/events', { headers: await as('ceo', {}, globex), data }),
      403,
      'TENANT_NOT_MEMBER',
    );
  });
});
