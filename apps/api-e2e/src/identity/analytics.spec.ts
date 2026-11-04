// Product analytics pipeline (Phase 2): web events are stored once per event id for the caller's tenant
// and person, only allowlisted client events with their allowed properties are accepted (route templates,
// no ids, emails or free text), and rows stay invisible to other tenants (RLS).
import { randomInt, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { RecordAnalyticsResponse } from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole } from '../support/db';

const { acme: hyland, globex } = SEED.tenants;

/** A unique route template (letters only, so it is never mistaken for an id). */
const markerRoute = () =>
  `/qa-${Array.from({ length: 12 }, () => String.fromCharCode(97 + randomInt(26))).join('')}`;

async function sessionStarts(personId: string): Promise<number> {
  return asAppRole(hyland, async (c) =>
    Number(
      (
        await c.query(
          `select count(*)::int as n from product_analytics_events
            where name = 'session.started' and actor_person_id = $1`,
          [personId],
        )
      ).rows[0].n,
    ),
  );
}

const occurredAtFor = (route: string) =>
  asAppRole(
    hyland,
    async (c) =>
      (
        await c.query(
          `select occurred_at from product_analytics_events where properties->>'route' = $1`,
          [route],
        )
      ).rows[0].occurred_at as Date,
  );

test.describe('product analytics events', () => {
  test('a batch is stored once per event id, for the caller and their tenant', async ({
    request,
  }) => {
    const analyst = userById('analyst');
    const route = markerRoute();
    const before = await sessionStarts(analyst.personId!);
    const events = [
      { id: randomUUID(), name: 'session.started' },
      { id: randomUUID(), name: 'page.viewed', properties: { route } },
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

    expect(await sessionStarts(analyst.personId!)).toBe(before + 1);
    const rows = await asAppRole(
      hyland,
      async (c) =>
        (
          await c.query(
            `select name, actor_person_id, properties from product_analytics_events
            where properties->>'route' = $1`,
            [route],
          )
        ).rows,
    );
    expect(rows).toEqual([
      {
        name: 'page.viewed',
        actor_person_id: analyst.personId,
        properties: { route, source: 'web' },
      },
    ]);
    const leaked = await asAppRole(globex, async (c) =>
      Number(
        (
          await c.query(
            `select count(*)::int as n from product_analytics_events where properties->>'route' = $1`,
            [route],
          )
        ).rows[0].n,
      ),
    );
    expect(leaked).toBe(0);
  });

  test('client times more than a day old or in the future are replaced by server time', async ({
    request,
  }) => {
    for (const occurredAt of [
      '2020-01-01T00:00:00.000Z',
      new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    ]) {
      const route = markerRoute();
      await expectContract(
        await request.post('/api/analytics/events', {
          headers: await as('employee'),
          data: {
            events: [{ id: randomUUID(), name: 'page.viewed', occurredAt, properties: { route } }],
          },
        }),
        202,
        RecordAnalyticsResponse,
      );
      const at = await occurredAtFor(route);
      expect(Math.abs(at.getTime() - Date.now())).toBeLessThan(5 * 60_000);
    }
  });

  test('server-only, unknown, personal or oversized events are rejected', async ({ request }) => {
    const headers = await as('analyst');
    const id = () => randomUUID();
    for (const events of [
      [{ id: id(), name: 'allocation.created' }],
      [{ id: id(), name: 'budget.deleted' }],
      [{ id: id(), name: 'session.started', properties: { route: '/' } }],
      [{ id: id(), name: 'page.viewed', properties: { route: '/', extra: 1 } }],
      [{ id: id(), name: 'page.viewed', properties: { route: '/people/someone@example.test' } }],
      [{ id: id(), name: 'page.viewed', properties: { route: `/budgets/${SEED.budgets.india}` } }],
      [{ id: id(), name: 'page.viewed', properties: { route: '/reports?owner=me' } }],
      [
        {
          id: id(),
          name: 'page.viewed',
          email: 'someone@example.test',
          properties: { route: '/' },
        },
      ],
      Array.from({ length: 26 }, () => ({ id: id(), name: 'session.started' })),
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
    for (const [user, tenant] of [
      ['ceo', globex],
      ['globex-admin', hyland],
    ] as const) {
      await expectProblem(
        await request.post('/api/analytics/events', { headers: await as(user, {}, tenant), data }),
        403,
        'TENANT_NOT_MEMBER',
      );
    }
  });
});
