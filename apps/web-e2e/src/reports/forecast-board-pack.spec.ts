// Phase 11 journeys: the forecast and variance report (087) in the shared report frame, the forecast
// cycle (87a) where owners submit and finance decides, and the board and FP&A pack (16a). Each one
// cross-checks the screen against the API, so the UI can never quietly disagree with the ledger.
// The three things these screens must get right, and which every assertion below is outright rather
// than conditional: a forecast is never presented as money that moved, the variance direction is a
// word rather than a sign or a colour, and the pack is refused to owner-scoped roles by the API.
import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { FORECAST_CYCLES, P4_BUDGETS, SEED } from '@bf/seed';
import { apiToken, expectShell } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile } from '../support/roles';
import type { RoleId } from '../support/roles';

interface Money {
  amountMinor: number;
  currency: string;
}
interface Cell {
  text?: string | null;
  money?: Money | null;
  bps?: number | null;
}
interface Row {
  key: string;
  label: string;
  tags: string[];
  cells: Record<string, Cell>;
}
interface ReportResult {
  name: string;
  currency: string;
  notes: string[];
  scope: { tenantWide: boolean; note: string | null; budgetIds: number };
  columns: { key: string; label: string }[];
  rows: Row[];
  reconciliation: { ties: boolean; authorized: Money; budgetsCounted: number };
}
interface CycleDetail {
  cycle: { id: string; name: string; closeConfirmation: string; progress: { budgets: number } };
  allowedActions: string[];
  scope: { tenantWide: boolean; note: string | null };
  totals: { authorized: Money; forecast: Money };
  reconciliation: { ties: boolean };
  submissions: {
    id: string;
    budgetId: string | null;
    budgetName: string | null;
    eventId: string | null;
    eventName: string | null;
    authorized: Money;
    status: string;
    varianceDirection: string;
  }[];
}
interface BoardPack {
  title: string;
  currency: string;
  source: { kind: string; periodLabel: string; draft: boolean; statement: string };
  pages: { page: string; title: string; statement: string | null; rows: unknown[] }[];
  fxBridge: { rows: unknown[]; note: string; totalEffect: Money };
  reconciliation: { ties: boolean };
}

/**
 * One token per role for the whole file, with a short retry. Keycloak's brute-force quick-login
 * check answers `invalid_grant` when direct grants for the same user arrive together, and the local
 * stack is shared by several workers; one at a time succeeds, so a brief backoff is enough.
 */
const tokens = new Map<RoleId, Promise<string>>();
function tokenFor(role: RoleId): Promise<string> {
  const hit = tokens.get(role);
  if (hit) return hit;
  const pending = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await apiToken(role);
      } catch (e) {
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 1_000 + attempt * 750));
      }
    }
  })();
  tokens.set(role, pending);
  return pending;
}

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

async function getJson<T>(role: RoleId, path: string, status = 200): Promise<T> {
  const ctx = await apiAs(role);
  const res = await ctx.get(path);
  expect(res.status(), `${role} GET ${path}: ${await res.text()}`).toBe(status);
  const body = (await res.json()) as T;
  await ctx.dispose();
  return body;
}

const usdText = (minor: number) =>
  `USD ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;

const OCTOBER = FORECAST_CYCLES.october.id;
const SEPTEMBER = FORECAST_CYCLES.september.id;

test.describe('forecast and variance (087)', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('the report shows the API notes, the method, and the variance direction as a word', async ({
    page,
  }) => {
    const report = await getJson<ReportResult>(
      'finance-controller',
      '/api/reports/forecast-variance/run',
    );
    expect(report.currency).toBe('USD');
    expect(report.reconciliation.ties).toBe(true);
    expect(report.notes.length).toBeGreaterThan(0);
    expect(report.rows.length).toBeGreaterThan(0);

    await page.goto('/reports/forecast-variance');
    await expectShell(page);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Forecast and variance' }),
    ).toBeVisible();

    // The banner is the server's sentence, shown as written, not an empty state the screen invented.
    const notes = page.getByTestId('report-notes');
    for (const note of report.notes) await expect(notes).toContainText(note);
    await expect(notes).toContainText('post nothing and consume no budget');

    // Authorized, actual and committed came from the ledger and say so.
    await expect(page.getByTestId('reconciliation-ties')).toContainText(
      usdText(report.reconciliation.authorized.amountMinor),
    );
    await expect(page.getByTestId('reconciliation-broken')).toHaveCount(0);

    // A forecast is never dressed as money that moved: the column is marked wherever it appears.
    const table = page.getByRole('table', { name: report.name });
    await expect(table.getByRole('columnheader', { name: /Forecast at year end/ })).toContainText(
      'Forecast, not actual',
    );
    expect(await page.getByTestId('forecast-cell').count()).toBeGreaterThan(0);

    // The direction is written out on every row, so the sign is never the only signal.
    const directions = report.rows.map((r) => r.cells['varianceDirection']?.text);
    expect(directions.every((d) => d === 'under' || d === 'over' || d === 'on')).toBe(true);
    for (const row of report.rows.slice(0, 3)) {
      await expect(table).toContainText(row.label);
      await expect(table).toContainText(String(row.cells['varianceDirection']?.text));
    }

    // Row tags the API wrote: a system fallback and a variance still owing an explanation.
    const tagged = report.rows.filter((r) => r.tags.length);
    expect(tagged.length).toBeGreaterThan(0);
    for (const tag of tagged[0].tags) await expect(table).toContainText(tag);
  });

  test('comparing two snapshots adds the previous forecast and the change', async ({ page }) => {
    const compared = await getJson<ReportResult>(
      'finance-controller',
      `/api/reports/forecast-variance/run?forecastCycleId=${OCTOBER}&compareCycleId=${SEPTEMBER}`,
    );
    const keys = compared.columns.map((c) => c.key);
    expect(keys).toContain('previousForecast');
    expect(keys).toContain('change');

    await page.goto(
      `/reports/forecast-variance?forecastCycleId=${OCTOBER}&compareCycleId=${SEPTEMBER}`,
    );
    const table = page.getByRole('table', { name: compared.name });
    await expect(table.getByRole('columnheader', { name: /Previous forecast/ })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: /Change/ })).toBeVisible();
  });

  test('“commentary required only” narrows the report to the rows that owe an explanation', async ({
    page,
  }) => {
    const all = await getJson<ReportResult>(
      'finance-controller',
      '/api/reports/forecast-variance/run',
    );
    const narrowed = await getJson<ReportResult>(
      'finance-controller',
      '/api/reports/forecast-variance/run?commentaryRequiredOnly=true',
    );
    expect(narrowed.rows.length).toBeGreaterThan(0);
    expect(narrowed.rows.length).toBeLessThan(all.rows.length);

    await page.goto('/reports/forecast-variance?commentaryRequiredOnly=true');
    const table = page.getByRole('table', { name: narrowed.name });
    await expect(table.getByRole('row')).toHaveCount(narrowed.rows.length + 2); // header and totals
    for (const row of narrowed.rows) await expect(table).toContainText(row.label);
  });
});

test.describe('forecast cycles (87a)', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('finance monitors a cycle and the actions come from the API, not the browser', async ({
    page,
  }) => {
    const detail = await getJson<CycleDetail>(
      'finance-admin',
      `/api/close/forecast-cycles/${OCTOBER}`,
    );
    expect(detail.allowedActions).toContain('accept');
    expect(detail.allowedActions).toContain('close');
    expect(detail.reconciliation.ties).toBe(true);

    await page.goto(`/finance/forecast-cycles/${OCTOBER}`);
    await expectShell(page);
    await expect(
      page.getByRole('heading', { level: 1, name: FORECAST_CYCLES.october.name }),
    ).toBeVisible();

    // The totals are the API's, including the forecast, which is labelled as a projection.
    await expect(
      page.getByText(usdText(detail.totals.authorized.amountMinor)).first(),
    ).toBeVisible();
    await expect(
      page.getByText('A projection. Never posted, never consumes budget.'),
    ).toBeVisible();

    // The ledger check states what it covers and what it deliberately does not.
    await expect(page.getByTestId('cycle-reconciliation')).toContainText(
      'The forecast is not in this check',
    );
    await expect(page.getByTestId('cycle-reconcile-broken')).toHaveCount(0);

    // A line waiting for finance offers Accept; the direction is a word next to the variance.
    const submitted = detail.submissions.find((s) => s.status === 'submitted');
    expect(submitted, 'the seeded October cycle has a submitted line').toBeTruthy();
    const key = submitted!.budgetId ?? submitted!.eventId!;
    await expect(page.getByTestId(`accept-${key}`)).toBeVisible();
    await expect(page.getByTestId(`direction-${key}`)).toContainText(
      submitted!.varianceDirection === 'over' ? 'over budget' : 'under budget',
    );

    // Closing is a typed confirmation, not a button that fires on its own.
    await page.getByTestId('close-cycle').click();
    await expect(
      page.getByRole('heading', { name: `Close ${FORECAST_CYCLES.october.name}` }),
    ).toBeVisible();
    await expect(page.getByText('marked System', { exact: false })).toBeVisible();
    await expect(page.getByTestId('confirm-close-cycle')).toBeDisabled();
    await page.getByTestId('cycle-close-confirmation').fill(detail.cycle.closeConfirmation);
    await expect(page.getByTestId('confirm-close-cycle')).toBeEnabled();
    // Cancel: the cycle another suite depends on stays open.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('cycle-closed')).toHaveCount(0);
  });

  test('a closed cycle is read-only and says its snapshot cannot change', async ({ browser }) => {
    const detail = await getJson<CycleDetail>(
      'finance-admin',
      `/api/close/forecast-cycles/${SEPTEMBER}`,
    );
    expect(detail.allowedActions).toEqual([]);

    const page = await (
      await browser.newContext({ storageState: authFile('finance-admin') })
    ).newPage();
    await page.goto(`/finance/forecast-cycles/${SEPTEMBER}`);
    await expect(page.getByTestId('cycle-closed')).toContainText('cannot change');
    await expect(page.getByTestId('close-cycle')).toHaveCount(0);
    // Nothing on a closed cycle offers an action, so the Actions column is not even drawn.
    await expect(
      page.getByRole('table', { name: 'Forecast lines' }).getByRole('columnheader', {
        name: 'Actions',
      }),
    ).toHaveCount(0);
    await page.close();
  });

  test('an owner sees only their own budgets and is told so', async ({ browser }) => {
    const owner = await getJson<CycleDetail>(
      'department-head',
      `/api/close/forecast-cycles/${OCTOBER}`,
    );
    const finance = await getJson<CycleDetail>(
      'finance-admin',
      `/api/close/forecast-cycles/${OCTOBER}`,
    );
    expect(owner.scope.tenantWide).toBe(false);
    expect(owner.allowedActions).toEqual(['submit']);
    expect(owner.submissions.length).toBeLessThan(finance.submissions.length);

    const page = await (
      await browser.newContext({ storageState: authFile('department-head') })
    ).newPage();
    await page.goto(`/finance/forecast-cycles/${OCTOBER}`);
    await expect(page.getByTestId('cycle-scope-note')).toContainText(
      'Showing budgets you can see.',
    );
    // An owner never gets finance's decisions, whatever the browser might think of their role.
    await expect(page.getByTestId('close-cycle')).toHaveCount(0);
    const table = page.getByRole('table', { name: 'Forecast lines' });
    await expect(table.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    for (const line of owner.submissions)
      await expect(table).toContainText(String(line.budgetName ?? line.eventName));
    await page.close();
  });

  test('a large variance without commentary is refused on the field, with the figure spelled out', async ({
    browser,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'one attempt at the 422 is enough');
    // Berlin Events is Lena Fischer's and sits in the open October cycle with nothing submitted, so
    // forecasting it at zero is a 100% variance: above the cycle threshold on both tests.
    const owner = await getJson<CycleDetail>(
      'department-head',
      `/api/close/forecast-cycles/${OCTOBER}`,
    );
    const berlin = owner.submissions.find((s) => s.budgetId === P4_BUDGETS.berlin);
    expect(berlin, 'Berlin Events is in the October cycle for its owner').toBeTruthy();

    const page = await (
      await browser.newContext({ storageState: authFile('department-head') })
    ).newPage();
    await page.goto(`/finance/forecast-cycles/${OCTOBER}`);
    await page.getByTestId(`forecast-${P4_BUDGETS.berlin}`).click();

    await expect(page.getByRole('heading', { name: /Forecast Berlin Events/ })).toBeVisible();
    await page.getByTestId('method-owner_input').click();
    await page.getByTestId('owner-amount').fill('0.00');
    await page.getByTestId('submit-forecast').click();

    // The refusal lands on the commentary field and repeats the variance as money and per cent,
    // rather than the minor units the API phrases its own message in.
    const error = page.getByTestId('commentary-required');
    await expect(error).toBeVisible();
    await expect(error).toContainText(usdText(berlin!.authorized.amountMinor));
    await expect(error).toContainText('100.0%');
    await expect(error).toContainText('at least 20 characters');

    // Nothing was stored: the line is still where it was before the attempt.
    const after = await getJson<CycleDetail>(
      'department-head',
      `/api/close/forecast-cycles/${OCTOBER}`,
    );
    const stillThere = after.submissions.find((s) => s.budgetId === P4_BUDGETS.berlin);
    expect(stillThere!.status).toBe(berlin!.status);
    await page.close();
  });

  test('the method cards carry the amounts and the sentence behind each', async ({ browser }) => {
    const owner = await getJson<CycleDetail>(
      'department-head',
      `/api/close/forecast-cycles/${OCTOBER}`,
    );
    expect(owner.submissions.length).toBeGreaterThan(0);

    const page = await (
      await browser.newContext({ storageState: authFile('department-head') })
    ).newPage();
    await page.goto(`/finance/forecast-cycles/${OCTOBER}`);
    await page.getByTestId(`forecast-${P4_BUDGETS.berlin}`).click();
    await expect(page.getByTestId('method-run_rate')).toBeVisible();
    await expect(page.getByTestId('method-committed_pipeline')).toBeVisible();
    await expect(page.getByTestId('method-owner_input')).toBeVisible();
    // Every system option explains itself: an owner checks a number rather than inventing one.
    await expect(page.getByText('Run-rate').first()).toBeVisible();
    await page.close();
  });
});

test.describe('board and FP&A pack (16a)', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('the pack renders the API pages, keeps an empty page with its statement, and bridges FX separately', async ({
    page,
  }) => {
    const pack = await getJson<BoardPack>('finance-admin', '/api/reports/board-pack');
    expect(pack.reconciliation.ties).toBe(true);
    expect(pack.pages.length).toBeGreaterThan(0);

    await page.goto('/reports/board-pack');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: pack.title })).toBeVisible();
    await expect(page.getByTestId('pack-source')).toContainText(
      pack.source.kind === 'close_snapshot' ? 'Close snapshot' : 'Open period (draft)',
    );

    // Every page the API returned is on the screen, in its order.
    for (const p of pack.pages)
      await expect(page.getByTestId(`pack-page-${p.page}`)).toContainText(p.title);

    // A page with no rows keeps its place and shows the server's statement instead of vanishing.
    const empty = pack.pages.filter((p) => p.rows.length === 0);
    expect(empty.length, 'the seeded pack has at least one page with no data').toBeGreaterThan(0);
    for (const p of empty)
      await expect(page.getByTestId(`pack-statement-${p.page}`)).toContainText(String(p.statement));

    // The FX bridge is its own section and says it is not spend, on the bridge itself.
    const fx = page.getByTestId('pack-fx-bridge');
    await expect(fx).toContainText('Not part of spend or variance');
    await expect(fx).toContainText('FX never consumes budget');
    // The variance page never folds FX into a figure: it points at the bridge instead.
    const variance = page.getByTestId('pack-page-variance_fx');
    await expect(variance).toContainText('Variance against plan to date');
    await expect(variance).toContainText('Bridged separately');
  });

  test('the open period is a draft and every page is watermarked', async ({ page }) => {
    const draft = await getJson<BoardPack>('finance-admin', '/api/reports/board-pack?draft=true');
    expect(draft.source.draft).toBe(true);

    await page.goto('/reports/board-pack');
    await page.getByRole('checkbox', { name: 'Current open period (draft)' }).click();
    await expect(page.getByTestId('pack-draft')).toContainText('still open');
    await expect(page.getByTestId('pack-source')).toContainText('Open period (draft)');
    // Each page carries the mark the rendered PDF carries, not just the pack as a whole.
    await expect(page.getByTestId('pack-watermark')).toHaveCount(draft.pages.length);
  });

  test('generating a pack queues it, polls it and offers the two files', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'generation runs once, on desktop');
    await page.goto('/reports/board-pack');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByTestId('generate-pack').click();
    const packs = page.getByRole('table', { name: 'Generated packs' });
    await expect(packs).toContainText('Ready', { timeout: 60_000 });
    await expect(packs.getByTestId('download-pdf').first()).toBeVisible();
    await expect(packs.getByTestId('download-xlsx').first()).toBeVisible();
    await expect(page.getByTestId('pack-failure')).toHaveCount(0);

    // The link is fetched when it is asked for, because a signed URL only lasts five minutes.
    const generations = await getJson<{ items: { id: string; status: string }[] }>(
      'finance-admin',
      '/api/reports/board-pack/generations',
    );
    const ready = generations.items.find((g) => g.status === 'ready');
    expect(ready, 'the generation the journey just made is ready').toBeTruthy();
    const link = await getJson<{ url: string; fileName: string; expiresAt: string }>(
      'finance-admin',
      `/api/reports/board-pack/generations/${ready!.id}/download?format=pdf`,
    );
    expect(link.fileName).toContain('.pdf');
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1_000);
  });
});

test.describe('who may open what', () => {
  test('an owner-scoped role opens 087 but is refused the board pack', async ({ browser }) => {
    // The API decides both, and it decides them differently on purpose: 087 is scoped to a subtree,
    // the pack is tenant-wide finance work and is refused rather than shown as a slice.
    const report = await getJson<ReportResult>(
      'location-manager',
      '/api/reports/forecast-variance/run',
    );
    expect(report.scope.tenantWide).toBe(false);
    const ctx = await apiAs('location-manager');
    const refused = await ctx.get('/api/reports/board-pack');
    expect(refused.status()).toBe(403);
    await ctx.dispose();

    const page = await (
      await browser.newContext({ storageState: authFile('location-manager') })
    ).newPage();

    await page.goto('/reports/forecast-variance');
    await expectShell(page);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Forecast and variance' }),
    ).toBeVisible();
    await expect(page.getByTestId('report-scope-note')).toContainText(
      'Showing budgets you can see.',
    );
    for (const row of report.rows) await expect(page.getByText(row.label).first()).toBeVisible();

    // The pack says who it is for, keeps the URL, and offers nothing to click.
    await page.goto('/reports/board-pack');
    await expect(page).toHaveURL(/\/reports\/board-pack$/);
    await expect(
      page.getByRole('heading', { name: 'You cannot see the board and FP&A pack' }),
    ).toBeVisible();
    await expect(
      page.getByText('The board pack is open to finance roles, the CEO and auditors.'),
    ).toBeVisible();
    await expect(page.getByTestId('generate-pack')).toBeDisabled();
    await page.close();
  });

  test('an employee reaches neither the cycle nor the pack', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: authFile('employee') })).newPage();
    for (const path of ['/finance/forecast-cycles', '/reports/board-pack']) {
      await page.goto(path);
      await expectShell(page);
      await expect(
        page.getByRole('heading', { level: 1, name: 'You do not have access to this page' }),
      ).toBeVisible();
    }
    await page.close();
  });
});
