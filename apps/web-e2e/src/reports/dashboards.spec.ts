// Gap package B2, first part: the finance controller dashboard (012), alerts (017) and exceptions
// (017a) as the roles that use them. Every number on screen is cross-checked against the API, so the
// page can never quietly disagree with the server.
import { expect, request as pwRequest, test } from '@playwright/test';
import { SEED } from '@bf/seed';
import { apiToken, expectShell } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile, type RoleId } from '../support/roles';

const tokens = new Map<RoleId, Promise<string>>();
const tokenFor = (role: RoleId): Promise<string> => {
  const hit = tokens.get(role) ?? apiToken(role);
  tokens.set(role, hit);
  return hit;
};

async function getJson<T>(role: RoleId, path: string): Promise<T> {
  const ctx = await pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${await tokenFor(role)}`,
      'x-tenant-id': SEED.tenants.acme,
      accept: 'application/json',
    },
  });
  const res = await ctx.get(path);
  expect(res.status(), `${role} GET ${path}: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as T;
  await ctx.dispose();
  return body;
}

const usdText = (minor: number) =>
  `${minor < 0 ? '-' : ''}USD ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(minor) / 100)}`;

interface Finance {
  close: { period: { label: string }; entities: { legalEntityCode: string }[] }[];
  tiles: { key: string; label: string; count: number; detail: string }[];
  fx: { total: { amountMinor: number } };
}
interface Alerts {
  scope: { tenantWide: boolean };
  counts: { open: number; acknowledged: number };
  items: { key: string; kind: string; budgetName: string; text: string; severity: string }[];
}
interface Exceptions {
  kpis: { open: number };
  types: { type: string; label: string; open: number }[];
  withheld: string[];
}

test.describe('finance controller dashboard (012)', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('close status per entity, the blocking queues and the FX effect, as the API reports them', async ({
    page,
  }) => {
    const api = await getJson<Finance>('finance-controller', '/api/dashboards/finance');
    await page.goto('/dashboards/finance');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Finance overview' })).toBeVisible();

    const close = page.getByRole('table', { name: 'Close status by legal entity' });
    for (const c of api.close)
      for (const e of c.entities) {
        const row = close.getByTestId(`close-row-${e.legalEntityCode}`);
        await expect(row).toContainText(e.legalEntityCode);
        await expect(row).toContainText(c.period.label);
      }
    // The seed's October has no signed tie-out: that step reads as blocking, in words.
    await expect(close.getByTestId('close-row-HYL-US')).toContainText('Blocking');

    for (const t of api.tiles) {
      const tile = page.getByTestId(`tile-${t.key}`);
      await expect(tile).toContainText(t.label);
      await expect(tile).toContainText(t.detail);
    }
    await expect(page.getByTestId('fx-card')).toContainText(usdText(api.fx.total.amountMinor));
    await expect(page.getByTestId('fx-card')).toContainText('Not part of spend or available');

    await page.getByTestId('tile-unmatched_actuals').click();
    await expect(page).toHaveURL(/\/finance\/actuals\/queue/);
  });

  test('an owner is refused the tenant-wide page', async ({ browser }) => {
    const page = await (
      await browser.newContext({ storageState: authFile('location-manager') })
    ).newPage();
    await page.goto('/dashboards/finance');
    await expect(
      page.getByRole('heading', { name: 'You cannot see the finance overview' }),
    ).toBeVisible();
  });
});

test.describe('alerts dashboard (017)', () => {
  test.use({ storageState: authFile('regional-manager') });

  test('an owner sees the alerts on their subtree and acknowledges one', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const api = await getJson<Alerts>('regional-manager', '/api/dashboards/alerts');
    expect(api.scope.tenantWide).toBe(false);
    // A seeded budget in the owner's region, chosen by name and kind, never by position.
    const subject = api.items.find(
      (a) => a.budgetName === 'Hyderabad Events' && a.kind === 'lapse',
    );
    expect(subject, 'the seed raises a lapse alert on Hyderabad Events').toBeTruthy();

    await page.goto('/dashboards/alerts');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible();
    await expect(page.getByText('Showing budgets you can see.')).toBeVisible();
    await expect(page.getByRole('tab', { name: `Open (${api.counts.open})` })).toBeVisible();
    for (const a of api.items)
      await expect(page.getByTestId(`alert-${a.key}`)).toContainText(a.text);

    const card = page.getByTestId(`alert-${subject!.key}`);
    await card.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText('Alert acknowledged.')).toBeVisible();
    await expect(page.getByTestId(`alert-${subject!.key}`)).toHaveCount(0);

    await page.getByRole('tab', { name: /^Acknowledged/ }).click();
    await expect(page.getByTestId(`alert-${subject!.key}`)).toContainText('You acknowledged this');
    const after = await getJson<Alerts>('regional-manager', '/api/dashboards/alerts');
    expect(after.counts.open).toBe(api.counts.open - 1);
  });

  test('an employee has no alerts page', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: authFile('employee') })).newPage();
    await page.goto('/dashboards/alerts');
    await expect(
      page.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
  });
});

test.describe('exceptions dashboard (017a)', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('exceptions by type, drilled into one type', async ({ page }) => {
    const api = await getJson<Exceptions>('finance-controller', '/api/dashboards/exceptions');
    await page.goto('/dashboards/exceptions');
    await expectShell(page);
    await expect(page.getByTestId('kpi-open')).toHaveText(String(api.kpis.open));
    for (const t of api.types)
      await expect(page.getByTestId(`type-${t.type}`)).toContainText(t.label);

    const breach = api.types.find((t) => t.type === 'post_spend_breach')!;
    expect(breach.open).toBeGreaterThan(0);
    await page.getByRole('link', { name: breach.label }).click();
    const items = page.getByRole('table', { name: 'Open items of the selected type' });
    await expect(items.getByRole('row')).toHaveCount(breach.open + 1);
  });

  test('the CEO reads it without the integrity-flag types, and is told why', async ({
    browser,
  }) => {
    const page = await (await browser.newContext({ storageState: authFile('ceo') })).newPage();
    const api = await getJson<Exceptions>('ceo', '/api/dashboards/exceptions');
    expect(api.withheld.length).toBeGreaterThan(0);
    await page.goto('/dashboards/exceptions');
    await expect(page.getByText('shown to roles that read integrity')).toBeVisible();
    await expect(page.getByTestId('type-duplicate')).toHaveCount(0);
  });
});
