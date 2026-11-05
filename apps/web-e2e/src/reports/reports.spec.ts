// Phase 10 report journeys (79, 13, 91 and the nine reports of 80-86 and 15a/15b): the catalog a role
// may open, the shared report frame rendered from the server's columns and cells, drill-down to the
// ledger lines behind a figure, the scope a budget owner is held to, and the forbidden state an
// employee gets. Figures are cross-checked against the API so the screen can never quietly disagree
// with the ledger.
import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { SEED } from '@bf/seed';
import { apiToken, expectShell } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile } from '../support/roles';
import type { RoleId } from '../support/roles';

interface Money {
  amountMinor: number;
  currency: string;
}
interface ReportResult {
  name: string;
  currency: string;
  scope: { tenantWide: boolean; note: string | null; budgetIds: number };
  rows: { key: string; label: string; budgetId: string | null }[];
  rowCount: number;
  reconciliation: { ties: boolean; authorized: Money; available: Money; budgetsCounted: number };
}
interface Catalog {
  scope: { tenantWide: boolean; note: string | null };
  reports: { reportId: string; name: string }[];
  activeSchedules: number;
}

// One token per role for the whole file: Keycloak's brute-force protection refuses a burst of
// direct grants for the same user, and these journeys cross-check several endpoints each.
const tokens = new Map<RoleId, Promise<string>>();
const tokenFor = (role: RoleId): Promise<string> => {
  const hit = tokens.get(role) ?? apiToken(role);
  tokens.set(role, hit);
  return hit;
};

async function apiAs(role: RoleId): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${await tokenFor(role)}`,
      'x-tenant-id': SEED.tenants.acme,
      accept: 'application/json',
    },
  });
}

async function getJson<T>(role: RoleId, path: string): Promise<T> {
  const ctx = await apiAs(role);
  const res = await ctx.get(path);
  expect(res.status(), `${role} GET ${path}: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as T;
  await ctx.dispose();
  return body;
}

const usdText = (minor: number) =>
  `USD ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;

test.describe('report catalog (79)', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('a finance admin sees every report grouped by the question it answers', async ({ page }) => {
    const catalog = await getJson<Catalog>('finance-admin', '/api/reports');
    expect(catalog.scope.tenantWide).toBe(true);

    await page.goto('/reports');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();

    // Tenant-wide viewers are not told their figures are partial.
    await expect(page.getByTestId('report-scope-note')).toHaveCount(0);

    for (const group of ['Budgets', 'Comparisons', 'Events', 'Fairness and reach'])
      await expect(page.getByRole('heading', { level: 2, name: group })).toBeVisible();
    for (const report of catalog.reports)
      await expect(page.getByTestId(`report-card-${report.reportId}`)).toContainText(report.name);
    // All nine reports, including the two only a tenant-wide viewer may open.
    expect(catalog.reports).toHaveLength(9);
    await expect(page.getByTestId('report-card-spend-per-head')).toBeVisible();

    // The seeded saved views and schedules of screen 91 are reachable from here.
    await expect(page.getByRole('heading', { level: 2, name: 'Saved views' })).toBeVisible();
    await expect(page.getByText('Unused budget watchlist')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Scheduled reports' })).toBeVisible();
  });
});

test.describe('the shared report frame (80-86, 15a, 15b)', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('budget versus actual renders the server figures and says they tie to the ledger', async ({
    page,
  }) => {
    const report = await getJson<ReportResult>(
      'finance-controller',
      '/api/reports/budget-vs-actual/run',
    );
    expect(report.currency).toBe('USD');
    expect(report.reconciliation.ties).toBe(true);

    await page.goto('/reports/budget-vs-actual');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: report.name })).toBeVisible();

    // Reconciliation is stated on the screen, not hidden behind a developer tool.
    const ties = page.getByTestId('reconciliation-ties');
    await expect(ties).toContainText(`${report.reconciliation.budgetsCounted} budgets`);
    await expect(ties).toContainText(usdText(report.reconciliation.authorized.amountMinor));
    await expect(page.getByTestId('reconciliation-broken')).toHaveCount(0);

    // The table is the server's: its rows are the rows the API returned, in the reporting currency.
    const table = page.getByRole('table', { name: report.name });
    await expect(table).toBeVisible();
    for (const row of report.rows.slice(0, 3)) await expect(table).toContainText(row.label);
  });

  test('every report in the catalog opens in the same frame', async ({ page }) => {
    const catalog = await getJson<Catalog>('finance-controller', '/api/reports');
    for (const report of catalog.reports) {
      await page.goto(`/reports/${report.reportId}`);
      await expect(page.getByRole('heading', { level: 1, name: report.name })).toBeVisible();
      // Each one proves where its figures came from.
      await expect(
        page.getByTestId('reconciliation-ties').or(page.getByTestId('reconciliation-broken')),
      ).toBeVisible();
    }
  });

  test('a drillable figure opens the ledger lines behind it', async ({ page }) => {
    await page.goto('/reports/utilization');
    await expect(page.getByRole('heading', { level: 1, name: 'Utilization' })).toBeVisible();

    const drill = page.getByTestId('report-drill').first();
    await expect(drill).toBeVisible();
    await drill.click();

    const panel = page.getByTestId('report-drilldown');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('The ledger lines behind this figure, newest first.');
    await expect(panel.getByRole('table', { name: 'Ledger lines' })).toBeVisible();
  });

  test('an export is recorded honestly: no file is promised', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto('/reports/unused-expired');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Record an export' }).click();
    await page.getByRole('menuitem', { name: 'CSV' }).click();

    const notice = page.getByTestId('report-notice');
    await expect(notice).toContainText('CSV export recorded');
    await expect(notice).toContainText('BudgetFlow does not produce a file yet');
  });
});

test.describe('budget health (13)', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('the five checks are summarised, mapped and written out per budget', async ({ page }) => {
    const overview = await getJson<{
      summary: { budgets: number; healthy: number; watch: number; atRisk: number };
      rows: { budgetId: string; name: string; reasons: { text: string }[] }[];
      scope: { tenantWide: boolean };
    }>('finance-controller', '/api/dashboards/health');
    expect(overview.scope.tenantWide).toBe(true);

    await page.goto('/reports/health');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Budget health' })).toBeVisible();

    const summary = page.getByTestId('health-summary');
    await expect(summary).toContainText(String(overview.summary.budgets));
    await expect(summary).toContainText('At risk');

    const matrix = page.getByRole('table', { name: 'Health matrix' });
    await expect(matrix).toBeVisible();
    for (const check of ['Pace', 'Forecast', 'Controls', 'Hygiene', 'Unused'])
      await expect(matrix.getByRole('columnheader', { name: check })).toBeVisible();

    const worst = overview.rows[0];
    if (worst) {
      const row = page.getByTestId(`health-row-${worst.budgetId}`);
      await expect(row).toContainText(worst.name);
      // The reason is a sentence the owner can act on, not a code.
      await expect(row).toContainText(worst.reasons[0].text);
    }
  });
});

test.describe('scope', () => {
  test('a budget owner sees only their subtree, and is told so', async ({ browser }) => {
    const page = await (
      await browser.newContext({ storageState: authFile('regional-manager') })
    ).newPage();
    const owner = await getJson<ReportResult>('regional-manager', '/api/reports/utilization/run');
    const tenant = await getJson<ReportResult>('finance-admin', '/api/reports/utilization/run');
    expect(owner.scope.tenantWide).toBe(false);
    expect(owner.reconciliation.authorized.amountMinor).toBeLessThan(
      tenant.reconciliation.authorized.amountMinor,
    );

    await page.goto('/reports/utilization');
    await expectShell(page);
    // The exact sentence the API writes, shown as written.
    await expect(page.getByTestId('report-scope-note')).toContainText(
      'Showing budgets you can see.',
    );
    await expect(page.getByTestId('reconciliation-ties')).toContainText(
      usdText(owner.reconciliation.authorized.amountMinor),
    );

    // Their subtree only: no sibling region's budgets in the table.
    const table = page.getByRole('table', { name: owner.name });
    const ids = new Set(owner.rows.map((r) => r.budgetId));
    expect(ids.has(SEED.budgets.europe)).toBe(false);
    await expect(table).not.toContainText('Europe Region');
    await page.close();
  });

  test('the catalog hides a company-wide report from a scoped owner, and opening it is refused', async ({
    browser,
  }) => {
    const page = await (
      await browser.newContext({ storageState: authFile('location-manager') })
    ).newPage();
    const catalog = await getJson<Catalog>('location-manager', '/api/reports');
    expect(catalog.reports.map((r) => r.reportId)).not.toContain('spend-per-head');

    await page.goto('/reports');
    await expectShell(page);
    await expect(page.getByTestId('catalog-scope-hint')).toContainText(
      'Reports that only make sense company-wide are not listed for you.',
    );
    await expect(page.getByTestId('report-card-spend-per-head')).toHaveCount(0);
    await expect(page.getByTestId('report-card-utilization')).toBeVisible();

    // Reaching it by URL is refused by the API and the screen says so, rather than showing nothing.
    await page.goto('/reports/spend-per-head');
    await expect(page.getByRole('heading', { name: /cannot see/i })).toBeVisible();
    await page.close();
  });

  test('an employee has no reports area at all', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: authFile('employee') })).newPage();
    await page.goto('/reports');
    await expectShell(page);
    // The permission guard renders the forbidden page in place, keeping the URL the user asked for.
    await expect(page).toHaveURL(/\/reports$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'You do not have access to this page' }),
    ).toBeVisible();
    await expect(page.getByText('Reports is not part of your role in BudgetFlow.')).toBeVisible();
    await page.close();
  });
});

test.describe('scheduled reports (91)', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('the seeded schedules show their rhythm, recipients and delivery history', async ({
    page,
  }) => {
    await page.goto('/reports/schedules');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Scheduled reports' })).toBeVisible();

    // The screen is honest about what a delivery carries.
    await expect(page.getByTestId('delivery-note')).toContainText(
      'does not produce a file to download yet',
    );

    const weekly = page.getByTestId(`schedule-${SEED.p10.schedules.indiaUtilizationWeekly}`);
    await expect(weekly).toContainText('India utilization, weekly');
    await expect(weekly).toContainText('Weekly on Monday at 08:00 Asia/Kolkata');
    await expect(weekly).toContainText('PDF');
    await expect(weekly).toContainText('#india-leads');

    await weekly.getByRole('button', { name: 'Delivery history' }).click();
    await expect(weekly.getByRole('table', { name: 'Delivery history' })).toContainText(
      'Delivered',
    );

    // The export record, with its 7-day expiry, and no download link.
    await expect(page.getByRole('heading', { level: 2, name: 'Recent exports' })).toBeVisible();
    const exports = page.getByRole('table', { name: 'Recent exports' });
    await expect(exports).toContainText('Utilization');
    await expect(exports).toContainText('PDF');
    await expect(exports.getByRole('link', { name: /download/i })).toHaveCount(0);
  });

  test('a finance admin pauses a schedule and resumes it', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto('/reports/schedules');
    const daily = page.getByTestId(`schedule-${SEED.p10.schedules.unusedBudgetDaily}`);
    await expect(daily).toContainText('Active');

    await daily.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByTestId('schedule-notice')).toContainText('paused');
    await expect(daily).toContainText('Paused');

    await daily.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByTestId('schedule-notice')).toContainText('resumed');
    await expect(daily).toContainText('Active');
  });
});

test.describe('saved views', () => {
  test.use({ storageState: authFile('auditor') });

  test('an auditor saves the filters of a report and opens it again from the catalog', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const name = `Journey view ${Date.now()}`;

    await page.goto('/reports/location-comparison');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Location comparison' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save this view' }).click();
    await page.getByLabel('View name').fill(name);
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByTestId('report-notice')).toContainText('stores the filters');

    await page.goto('/reports');
    const saved = page.getByRole('link', { name: new RegExp(name) });
    await expect(saved).toBeVisible();
    await saved.click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Location comparison' }),
    ).toBeVisible();

    // Clean up so the next run starts from the seeded views only.
    await page.goto('/reports');
    const row = page.locator('li', { hasText: name }).first();
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
