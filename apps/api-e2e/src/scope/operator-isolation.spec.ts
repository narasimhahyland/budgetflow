// Phase 18: a platform operator without a break-glass grant reads no tenant data (security.mdc,
// authorization.md). The sweep calls every parameter-free GET endpoint in the contract registry as the
// operator and fails on any that answers with data, so a future endpoint that forgets its policy check
// is caught here. The other tests pin the two leaks the Phase 18 review found.
import { expect, test } from '@playwright/test';
import { endpoints, HeadcountSummary } from '@bf/contracts';
import { as } from '../support/auth';
import { expectContract } from '../support/contract';

/** The operator's own account, not tenant data: these may answer 200. */
const PERSONAL = new Set([
  '/api/me',
  '/api/me/features',
  '/api/me/activity',
  '/api/me/following',
  '/api/notifications',
]);

/** True when a 200 body carries nothing: every list empty, every amount zero, no named records. */
function empty(body: unknown): boolean {
  // A list is empty when every element is (a placeholder card is not a record).
  if (Array.isArray(body)) return body.every(empty);
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    // A placeholder "nothing needs you" card is not data.
    if (o['id'] === 'none') return true;
    return Object.entries(o).every(([k, v]) => {
      if (k === 'currency' || k === 'scope' || k === 'tone' || k === 'text') return true;
      if (typeof v === 'number') return v === 0;
      if (typeof v === 'boolean' || v === null) return true;
      if (typeof v === 'string') return !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) || k === 'id';
      return empty(v);
    });
  }
  return true;
}

test('every parameter-free GET endpoint refuses the operator or returns nothing', async ({
  request,
}) => {
  const leaks: string[] = [];
  const gets = Object.values(
    endpoints as Record<string, { method: string; path: string; auth?: boolean }>,
  ).filter((e) => e.method === 'get' && e.auth && !e.path.includes('{'));
  expect(gets.length).toBeGreaterThan(100);
  for (const e of gets) {
    if (PERSONAL.has(e.path)) continue;
    const res = await request.get(e.path, { headers: await as('super-admin') });
    if (res.status() !== 200) continue;
    const body = await res.json().catch(() => null);
    if (!empty(body)) leaks.push(`${e.path} -> ${JSON.stringify(body).slice(0, 160)}`);
  }
  expect(leaks, 'endpoints that answer the operator with tenant data').toEqual([]);
});

test('event templates, with their per-attendee estimates, are not found for the operator', async ({
  request,
}) => {
  expect(
    (await request.get('/api/events/templates', { headers: await as('super-admin') })).status(),
  ).toBe(404);
  // Members still read the company's published templates.
  const res = await request.get('/api/events/templates', { headers: await as('employee') });
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
});

test('headcount: the operator is refused and a scoped reader sees only their own totals', async ({
  request,
}) => {
  expect(
    (await request.get('/api/org/headcount', { headers: await as('super-admin') })).status(),
  ).toBe(404);

  const company = await expectContract(
    await request.get('/api/org/headcount', { headers: await as('finance-admin') }),
    200,
    HeadcountSummary,
  );
  const scoped = await expectContract(
    await request.get('/api/org/headcount', { headers: await as('location-manager') }),
    200,
    HeadcountSummary,
  );
  expect(company.snapshot?.totalHeadcount).toBeGreaterThan(0);
  // The scoped reader's snapshot totals are what they can see, never the company's.
  expect(scoped.snapshot?.totalHeadcount).toBe(scoped.total);
  expect(scoped.snapshot?.totalHeadcount).toBeLessThan(company.snapshot?.totalHeadcount ?? 0);
  expect(scoped.snapshot?.lineCount).toBeLessThan(company.snapshot?.lineCount ?? 0);
});
