// Product analytics pipeline from the web app: sign-in records session.started and navigation records
// page.viewed with the route template (no ids, names or amounts); the API accepts the batch.
import { expect, test, type Request } from '@playwright/test';
import { expectShell, submitSignIn } from '../support/auth';

type Batch = { events: { name: string; properties?: Record<string, unknown> }[] };

const isBatch = (r: Request) => r.url().endsWith('/api/analytics/events') && r.method() === 'POST';

test('sign-in and navigation send product analytics events the API accepts', async ({ page }) => {
  const seen: Batch['events'] = [];
  page.on('request', (r) => isBatch(r) && seen.push(...(r.postDataJSON() as Batch).events));

  await page.goto('/');
  const first = page.waitForResponse((r) => isBatch(r.request()));
  // A user no other fresh-sign-in journey uses, so parallel journeys never share its sign-in.
  await submitSignIn(page, 'integration-admin');
  await expectShell(page);
  const res = await first;
  expect(res.status()).toBe(202);
  expect(((await res.json()) as { accepted: number }).accepted).toBeGreaterThan(0);

  const second = page.waitForResponse((r) => isBatch(r.request()));
  await page.getByRole('menuitem', { name: 'Integrations' }).click();
  expect((await second).status()).toBe(202);

  expect(seen.map((e) => e.name)).toContain('session.started');
  expect(seen).toContainEqual(
    expect.objectContaining({ name: 'page.viewed', properties: { route: '/admin/integrations' } }),
  );
  for (const e of seen) expect(JSON.stringify(e.properties ?? {})).not.toMatch(/Omar|Haddad|@/);
});
