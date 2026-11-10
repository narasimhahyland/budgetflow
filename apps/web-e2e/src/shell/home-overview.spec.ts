// Home as an executive overview (Stage 1 of screen 011): the answer line, the four buckets with
// their denominators, what needs attention, what waits on the viewer, and the budget list as a
// tool. The page is walked as the five roles whose Home differs: CEO, finance controller,
// department head, an employee without budget visibility, and a platform operator.
//
// Every figure is checked against the response body the page itself received, captured off the
// browser's own network rather than fetched again. Home shows tenant-wide roll-ups, and other
// journeys in this suite legitimately allocate, reduce and freeze budgets while it runs, so a
// second fetch would compare the screen against totals from a different moment and fail on a
// correct page.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { ApprovalInbox, BudgetHealthOverview, BudgetList, BudgetSummary } from '@bf/contracts';
import { apiToken } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile, type RoleId } from '../support/roles';

/** A real token call to cross-check the UI against the API, or read a deterministic seeded figure. */
async function api<T>(request: APIRequestContext, role: RoleId, path: string): Promise<T> {
  const res = await request.get(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${await apiToken(role)}` },
  });
  expect(res.status(), `${path} as ${role}`).toBe(200);
  return (await res.json()) as T;
}

/** The first successful JSON body the page receives for `pattern`. Register before `goto`. */
function bodyFromPage<T>(page: Page, pattern: RegExp): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the page sent no successful response matching ${pattern}`)),
      25_000,
    );
    page.on('response', (res) => {
      if (!pattern.test(res.url()) || !res.ok()) return;
      void res
        .json()
        .then((body) => {
          clearTimeout(timer);
          resolve(body as T);
        })
        .catch(() => undefined);
    });
  });
}

const SUMMARY = /\/api\/budgets\/summary/;
const HEALTH = /\/api\/dashboards\/health/;
const INBOX = /\/api\/approvals\/inbox/;

/** `bf-money` renders integer minor units by the ISO 4217 exponent: 10300000 -> USD 103,000.00 */
function money(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The share as the page writes it: the API's integer minor units become basis points first and are
 * only then formatted, one decimal below 10% so a small but non-zero share does not read as 0%.
 * The two steps are in this order on purpose — rounding to a percentage directly disagrees with the
 * page near 10%. Same rule as `shareBps` + `KpiTile.shareText` and `home-overview.ts`.
 */
function pctText(part: number, whole: number): string {
  const bps = whole > 0 ? Math.round((part / whole) * 10000) : 0;
  const pct = bps / 100;
  return `${pct > 0 && pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

function committedMinor(s: BudgetSummary): number {
  return s.held.amountMinor + s.preEncumbered.amountMinor + s.encumbered.amountMinor;
}

function tile(page: Page, label: string) {
  return page.getByTestId('kpis').locator('bf-kpi-tile').filter({ hasText: label }).first();
}

const attentionItems = (page: Page) =>
  page.getByTestId('attention-list').locator('li.bf-attention__item');

const tableRows = (page: Page) =>
  page.getByRole('table', { name: 'All budgets you can see' }).locator('tbody tr');

test.describe('ceo', () => {
  test.use({ storageState: authFile('ceo') });

  test('the answer line states where the year stands, from the API figures', async ({ page }) => {
    const summaryBody = bodyFromPage<BudgetSummary>(page, SUMMARY);
    const healthBody = bodyFromPage<BudgetHealthOverview>(page, HEALTH);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Morgan' })).toBeVisible();
    const summary = await summaryBody;
    const health = await healthBody;

    const used = committedMinor(summary) + summary.actual.amountMinor;
    const usedPct = pctText(used, summary.authorized.amountMinor);
    const attention = health.summary.watch + health.summary.atRisk;

    // The share, the fiscal year, the time left and the attention count are the four facts the
    // sentence carries; asserting the rendered percentage against the API's own buckets is what
    // proves the page is not showing a figure it made up.
    const answer = page.getByTestId('answer-line');
    await expect(answer).toContainText(`${usedPct} of the FY2026 budget is committed or spent`);
    await expect(answer).toContainText('days left');
    await expect(answer).toContainText(
      attention === health.summary.budgets
        ? `all ${attention} budgets need attention`
        : `${attention} of the ${health.summary.budgets} budgets need attention`,
    );

    // The context line names the scope and the API's own accounting date. The date is rendered
    // unshifted: converting a calendar date into the viewer's zone would move it a day.
    await expect(page.getByTestId('as-of')).toHaveText('16 Nov 2026');
    expect(health.asOf).toBe('2026-11-16');
    // Scope the label to the answer block: the shell hides the "Hyland" header chip on mobile, so a
    // page-wide getByText would resolve to that hidden element and fail.
    await expect(
      page.locator('.bf-answer').getByText(health.scope.label, { exact: false }).first(),
    ).toBeVisible();
    // FX is stated on its own and never folded into consumption.
    await expect(page.getByTestId('fx-note')).toContainText('FX never consumes budget');
  });

  test('every bucket tile carries its denominator and matches the roll-up', async ({ page }) => {
    const summaryBody = bodyFromPage<BudgetSummary>(page, SUMMARY);
    await page.goto('/');
    await expect(page.getByTestId('kpis')).toBeVisible();
    const summary = await summaryBody;

    const authorized = summary.authorized.amountMinor;
    const committed = committedMinor(summary);

    // Authorized is the base: the pill names the budget count and any controls in play.
    await expect(tile(page, 'Authorized')).toContainText(money(authorized, summary.currency));
    await expect(tile(page, 'Authorized')).toContainText(`${summary.budgetCount} budgets`);

    // Committed carries the amount, its share of authorized, and the composition in words, so
    // pending and approved commitments stay distinguishable from money already spent.
    const committedTile = tile(page, 'Committed');
    await expect(committedTile).toContainText(money(committed, summary.currency));
    await expect(committedTile).toContainText(pctText(committed, authorized));
    await expect(committedTile).toContainText('Encumbered + pre-encumbered + held');

    // Actual carries the amount, its share, and a pacing pill against the year elapsed.
    const actualTile = tile(page, 'Actual');
    await expect(actualTile).toContainText(money(summary.actual.amountMinor, summary.currency));
    await expect(actualTile).toContainText(pctText(summary.actual.amountMinor, authorized));
    await expect(actualTile).toContainText('even spread');

    const availableTile = tile(page, 'Available');
    await expect(availableTile).toContainText(
      money(summary.available.amountMinor, summary.currency),
    );
    await expect(availableTile).toContainText(pctText(summary.available.amountMinor, authorized));
    await expect(availableTile).toContainText('Company-wide uncommitted');
  });

  test('needs attention lists the API reasons worst first, each linking to its budget', async ({
    page,
  }) => {
    const healthBody = bodyFromPage<BudgetHealthOverview>(page, HEALTH);
    await page.goto('/');
    await expect(page.getByTestId('attention-list')).toBeVisible();
    const health = await healthBody;

    const flagged = health.rows.filter((r) => r.level !== 'healthy');
    expect(flagged.length, 'the seed has budgets needing attention').toBeGreaterThan(0);
    // Home shows the worst five and points at Budget health (013) for the rest. The rendered rows
    // come from the same health response this test captured, so their order equals it exactly even
    // while other journeys mutate the tenant-wide health.
    const shown = flagged.slice(0, 5);

    const items = attentionItems(page);
    await expect(items).toHaveCount(shown.length);
    // Worst first is the API's order, so the rendered order must equal it name for name.
    await expect(items.locator('a.bf-attention__name')).toHaveText(shown.map((r) => r.name));
    // The "See all N" link counts from the health summary (uncapped), not from rows (capped at the
    // query limit), so compute the expected number the same way the page does.
    const total = health.summary.watch + health.summary.atRisk;
    await expect(
      page.getByRole('link', {
        name: total > 5 ? `See all ${total} in Budget health` : 'Open Budget health',
      }),
    ).toBeVisible();

    // The first row names its reason in the API's own words with the numbers in it, so the reader
    // sees why it is a problem rather than a bare status.
    const first = items.first();
    for (const reason of shown[0].reasons) await expect(first).toContainText(reason.text);
    await expect(first).toContainText(money(shown[0].available.amountMinor, 'USD'));
    await expect(first.getByText(shown[0].level === 'at_risk' ? 'At risk' : 'Watch')).toBeVisible();

    // The row links to its budget — asserted on the link's href rather than by navigating, so a
    // slow SPA navigation under CI load cannot flake this check.
    await expect(first.locator('a.bf-attention__name')).toHaveAttribute(
      'href',
      new RegExp(`/budgets/${shown[0].budgetId}$`),
    );
  });

  // The CEO's table is tenant-wide, which other journeys in this suite mutate while it runs, so this
  // asserts structural invariants and seeded subjects — never tenant-wide absolute counts or order.
  test('the budget list searches, sorts, paginates and filters, and a row opens the budget', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(tableRows(page).first()).toBeVisible();
    const rows = tableRows(page);
    const PAGE = 10;
    const names = () => rows.locator('a.bf-cell__link').allTextContents();

    // The table paginates: page one shows at most PAGE rows, and the count line is self-consistent.
    expect(await rows.count()).toBeLessThanOrEqual(PAGE);
    await expect(page.getByTestId('budget-count')).toContainText(/\d+ of \d+ budgets match\./);

    // Search covers the owner too: searching a seeded owner surfaces their budget. Other journeys
    // may create budgets for the same seeded owner, so assert the budget is present, not a total.
    await page.getByTestId('budget-search').fill('Rahul Menon');
    await expect(rows.filter({ hasText: 'Bengaluru Events' })).toHaveCount(1);
    // A unique budget name narrows to exactly one row, and the count line reflects it.
    await page.getByTestId('budget-search').fill('Bengaluru Events');
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('budget-count')).toContainText(/^\s*1 of \d+ budgets match\./);
    await page.getByRole('button', { name: 'Clear filters' }).click();

    // Pagination, gated on the paginator's own state rather than a computed tenant-wide total.
    const next = page.getByRole('button', { name: 'Next page' });
    if (await next.isEnabled()) {
      const firstBefore = (await names())[0];
      await next.click();
      await expect(async () => expect((await names())[0]).not.toBe(firstBefore)).toPass();
      expect(await rows.count()).toBeLessThanOrEqual(PAGE);
      await page.getByRole('button', { name: 'Previous page' }).click();
    }

    // Sorting reorders the whole set, so page one is then internally ordered. Default is Budget A–Z;
    // clicking Budget flips to Z–A.
    const asc = await names();
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));
    await page.getByRole('button', { name: 'Budget' }).click();
    await expect(async () => {
      const desc = await names();
      expect(desc).toEqual([...desc].sort((a, b) => b.localeCompare(a)));
    }).toPass();

    // Status filter: every visible row reads the filtered status, and a seeded frozen budget is
    // reachable under it. Exact counts are not asserted — other journeys may freeze budgets too.
    await page.getByRole('button', { name: 'Frozen', exact: true }).click();
    await expect(rows.first()).toBeVisible();
    // Every visible row is frozen: none lacks the "Frozen" status text.
    await expect(rows.filter({ hasNotText: 'Frozen' })).toHaveCount(0);
    await page.getByTestId('budget-search').fill('US Recognition');
    await expect(rows.filter({ hasText: 'US Recognition' })).toHaveCount(1);

    // A row's link opens its budget detail — asserted on the link's own href.
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByTestId('budget-search').fill('Bengaluru Events');
    const link = rows.filter({ hasText: 'Bengaluru Events' }).getByRole('link').first();
    await expect(link).toHaveAttribute('href', /\/budgets\/[0-9a-f-]{36}$/);
    const href = await link.getAttribute('href');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });

  test('the health filter uses the levels the API returned, not thresholds of its own', async ({
    page,
  }) => {
    const healthBody = bodyFromPage<BudgetHealthOverview>(page, HEALTH);
    await page.goto('/');
    await expect(tableRows(page).first()).toBeVisible();
    const health = await healthBody;

    // United States Region is a stable seeded at-risk budget (US budgets are untouched by scenarios),
    // and Bengaluru Events is watch, not at-risk. The filter uses the API's levels, so after it the
    // at-risk one shows and the watch one does not. Exact tenant-wide counts are not asserted.
    expect(health.rows.find((r) => r.name === 'United States Region')?.level).toBe('at_risk');
    expect(health.rows.find((r) => r.name === 'Bengaluru Events')?.level).toBe('watch');

    await page.getByRole('button', { name: 'At risk' }).click();
    await page.getByTestId('budget-search').fill('United States Region');
    await expect(tableRows(page).filter({ hasText: 'United States Region' })).toHaveCount(1);
    await page.getByTestId('budget-search').fill('Bengaluru Events');
    await expect(tableRows(page)).toHaveCount(0);
  });

  // Two different Available figures sit on this page: the company-wide one the roll-up and the
  // health rows report, and each budget's own under its control rules. United States Region is a
  // seeded budget where they differ, and (per the testing rules) US-owned budgets are never touched
  // by the API scenarios, so it stays a deterministic subject under the full concurrent suite.
  test('company-wide Available and a budget’s own Available are labelled apart', async ({
    page,
    request,
  }) => {
    const NAME = 'United States Region';
    const health = await api<BudgetHealthOverview>(request, 'ceo', '/api/dashboards/health');
    const row = health.rows.find((r) => r.name === NAME);
    expect(row, 'United States Region is in the health rows').toBeTruthy();
    const budgets = await api<BudgetList>(
      request,
      'ceo',
      `/api/budgets?q=${encodeURIComponent(NAME)}&limit=50`,
    );
    const own = budgets.items.find((b) => b.id === row!.budgetId)!;
    expect(own, 'United States Region is in the budget list').toBeTruthy();
    // The two definitions genuinely differ for this budget, which is the whole point of labelling.
    expect(own.balances.available.amountMinor).not.toBe(row!.available.amountMinor);

    await page.goto('/');
    await expect(page.getByTestId('attention-list')).toBeVisible();
    await expect(attentionItems(page).filter({ hasText: NAME })).toContainText(
      `Available company-wide ${money(row!.available.amountMinor, 'USD')}`,
    );
    await expect(page.getByText('Available (own rules)')).toBeVisible();
    // Search brings the budget onto the (paginated) page, wherever it sorts.
    await page.getByTestId('budget-search').fill(NAME);
    await expect(tableRows(page).filter({ hasText: NAME })).toContainText(
      money(own.balances.available.amountMinor, own.currency),
    );
  });

  // Whether anything waits on the CEO depends on what the rest of the suite has created, so both
  // branches are asserted against the inbox the page was given rather than against the seed.
  test('waiting on your decision reflects the inbox the API returned', async ({ page }) => {
    const inboxBody = bodyFromPage<ApprovalInbox>(page, INBOX);
    await page.goto('/');
    const waiting = page.getByTestId('waiting');
    await expect(waiting.getByTestId('waiting-count')).toBeVisible();
    const inbox = await inboxBody;

    if (inbox.items.length === 0) {
      await expect(waiting.getByTestId('waiting-count')).toHaveText(
        'Nothing waits on you right now.',
      );
      return;
    }
    await expect(waiting.getByTestId('waiting-count')).toHaveText(String(inbox.items.length));
    const currencies = new Set(inbox.items.map((i) => i.amount.currency));
    const total = inbox.items.reduce((s, i) => s + i.amount.amountMinor, 0);
    // Amounts in more than one currency have no honest total, so the tile says so instead.
    await expect(waiting).toContainText(
      currencies.size === 1
        ? `${money(total, [...currencies][0])} across ${inbox.items.length} request`
        : `${inbox.items.length} requests in more than one currency`,
    );
    await expect(waiting.getByRole('link', { name: 'Open approval inbox' })).toBeVisible();
  });

  // Each section loads on its own, so one endpoint failing must cost its own card and nothing else.
  // The health call is failed once and then allowed through, which also proves Try again re-reads it.
  test('a failing section shows its own retry and leaves the rest of the page standing', async ({
    page,
  }) => {
    let failures = 0;
    await page.route('**/api/dashboards/health*', async (route) => {
      if (failures === 0) {
        failures += 1;
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'urn:budgetflow:problem:unavailable',
            title: 'Service unavailable',
            status: 503,
            code: 'INTERNAL',
            detail: 'The health checks are temporarily unavailable.',
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/');
    const attention = page
      .locator('section', { has: page.getByRole('heading', { name: /^Needs attention/ }) })
      .first();
    await expect(attention).toContainText('We could not load the health checks.');
    await expect(attention).toContainText('The health checks are temporarily unavailable.');

    // The buckets and the budget list come from other endpoints, so they are unaffected.
    await expect(tile(page, 'Authorized')).toContainText('USD');
    await expect(tableRows(page).first()).toBeVisible();
    // Without health there is no level per budget, so the health filter is absent rather than empty.
    await expect(page.getByRole('group', { name: 'Filter by health' })).toHaveCount(0);

    await attention.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByTestId('attention-list')).toBeVisible();
    await expect(attention).not.toContainText('We could not load');
  });

  // ADR 0006: Home carries no tenant or organization switcher, so none of the new filters may be a
  // select. role-navigation.spec.ts asserts the same thing for every role; this keeps the reason
  // next to the controls that could break it.
  test('the overview adds no combobox to Home', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('kpis')).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(0);
  });
});

test.describe('finance controller', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('a finance role sees the same tenant-wide overview', async ({ page }) => {
    const summaryBody = bodyFromPage<BudgetSummary>(page, SUMMARY);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Daniel' })).toBeVisible();
    const summary = await summaryBody;
    expect(summary.scope).toBe('tenant');

    await expect(tile(page, 'Authorized')).toContainText(
      money(summary.authorized.amountMinor, summary.currency),
    );
    await expect(page.getByRole('heading', { name: /^Needs attention/ })).toBeVisible();
  });
});

test.describe('department head', () => {
  test.use({ storageState: authFile('department-head') });

  test('a department head sees their own subtree, and the page says so', async ({ page }) => {
    const summaryBody = bodyFromPage<BudgetSummary>(page, SUMMARY);
    const healthBody = bodyFromPage<BudgetHealthOverview>(page, HEALTH);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Lena' })).toBeVisible();
    const summary = await summaryBody;
    const health = await healthBody;
    expect(health.scope.tenantWide, 'the subtree is narrower than the tenant').toBe(false);

    // The scope label and note come from the API, so the reader knows these are not company totals.
    // Scope to the answer block (the shell hides the header company chip on mobile).
    await expect(
      page.locator('.bf-answer').getByText(health.scope.label, { exact: false }).first(),
    ).toBeVisible();
    if (health.scope.note) {
      await expect(page.locator('.bf-answer').getByText(health.scope.note)).toBeVisible();
    }
    await expect(tile(page, 'Authorized')).toContainText(
      money(summary.authorized.amountMinor, summary.currency),
    );
  });
});

test.describe('employee', () => {
  test.use({ storageState: authFile('employee') });

  // The health endpoint answers 403 for this role, so its section must be absent rather than a
  // broken card, and the page keeps the state it had before the overview existed.
  test('a role without budget visibility keeps the placeholder Home', async ({ page, request }) => {
    const health = await request.get(`${API_URL}/api/dashboards/health`, {
      headers: { authorization: `Bearer ${await apiToken('employee')}` },
    });
    expect(health.status(), 'the API refuses the health overview for this role').toBe(403);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Nothing to show here yet' })).toBeVisible();
    await expect(page.getByTestId('kpis')).toHaveCount(0);
    await expect(page.getByTestId('answer-line')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Needs attention/ })).toHaveCount(0);
    await expect(page.getByText('We could not load')).toHaveCount(0);
  });
});

test.describe('platform operator', () => {
  test.use({ storageState: authFile('super-admin') });

  test('a platform operator still sees only the break-glass banner', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('You are signed in as a platform operator.')).toBeVisible();
    await expect(page.getByTestId('kpis')).toHaveCount(0);
    await expect(page.getByTestId('answer-line')).toHaveCount(0);
    await expect(page.getByText('We could not load')).toHaveCount(0);
  });
});
