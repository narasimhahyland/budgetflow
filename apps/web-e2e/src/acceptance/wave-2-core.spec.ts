// Core acceptance. Two parts:
//
// 1. "Core acceptance scenario, end to end" (below the per-step checks): the plan's ten-step scenario
//    as one story on desktop, through the UI as each role, with API assertions on every number. Its
//    table of steps is next to it.
// 2. "Wave 2 core acceptance": the earlier per-step checks. Read-only steps run on every viewport
//    against the seed; mutating ones run once on desktop on data they create through the API.
//
// | Step | Outcome | Role(s) |
// | --- | --- | --- |
// | 1 | FY2026 USD plan version and tie-out | finance-admin |
// | 2 | Budget hierarchy and per-head driver | regional-manager |
// | 3 | Cross-location event funding submitted | budget-owner |
// | 4 | Inter-Director Budget Contribution Request decided | budget-owner, department-head |
// | 5 | DoA approval on a spending request | department-head, budget-owner |
// | 6 | Freeze then set-to-zero impact on a pending request | finance-admin, budget-owner |
// | 7 | Seeded actuals import and plan-rate matching | finance-controller |
// | 8 | Event reconciliation blocked until actuals are clean | finance-controller |
// | 9 | GL tie-out difference and sign-off gate | finance-controller, finance-admin |
// | 10 | Utilization roll-up matches the API | regional-manager |
import { expect, request, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ACTUALS_EVENTS, SEED } from '@bf/seed';
import { apiToken, expectShell, submitSignIn } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile } from '../support/roles';
import { api, getBudget } from '../budgets/api';
import {
  approvedEvent,
  linkPath,
  mailTo,
  control,
  desktopOnly,
  directorTree,
  getRequest,
  giverBudget,
  pageAs,
  spendingRequest,
  suffix,
  taskOf,
  usd,
  usdText,
} from '../spend/api';

const pick = async (page: Page, label: string | RegExp, option: string | RegExp) => {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
};

test.describe('Wave 2 core acceptance', () => {
  test.describe('Step 1 — USD plan context', () => {
    test.use({ storageState: authFile('finance-admin') });

    test('shows FY2026 plan tie-out in USD and matches the API', async ({ page }) => {
      await page.goto('/budgets/plans');
      await expectShell(page);
      await expect(page.getByTestId('tie-out')).toBeVisible();
      await expect(page.getByTestId('tie-out')).toContainText('USD');

      const tieOut = await api<{ currency: string; tiedOut: boolean }>(
        'finance-admin',
        'get',
        `/api/plan-versions/tie-out?fiscalYearId=${SEED.fiscalYears.acmeFy2026}`,
      );
      expect(tieOut.currency).toBe('USD');
      expect(tieOut.tiedOut).toBe(true);

      const version = await api<{ id: string; status: string }>(
        'finance-admin',
        'get',
        `/api/plan-versions/${SEED.planVersions.acmeFy2026Original}`,
      );
      expect(version.status).toBe('approved');
    });
  });

  test.describe('Step 2 — hierarchy and per-head', () => {
    test.use({ storageState: authFile('regional-manager') });

    test('shows India hierarchy, per-head Hyderabad and authorized from the ledger', async ({
      page,
    }) => {
      await page.goto(`/budgets?root=${SEED.budgets.india}&budget=${SEED.budgets.hyderabad}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Budget hierarchy' })).toBeVisible();
      const panel = page.getByTestId('detail-panel');
      await expect(panel.getByRole('heading', { name: 'Hyderabad Events' })).toBeVisible();
      await expect(panel).toContainText('per head');

      const hyd = await getBudget(SEED.budgets.hyderabad, 'regional-manager');
      expect(hyd.balances.budgetCurrency.authorized.currency).toBe('USD');
      expect(hyd.balances.budgetCurrency.authorized.amountMinor).toBeGreaterThan(0);
      await expect(panel.getByTestId('available-under-rules')).toContainText('USD');
    });
  });

  test.describe('Step 3 — cross-location event funding', () => {
    test.use({ storageState: authFile('budget-owner') });

    test('creates a cross-location event and submits it for approval', async ({ page }, info) => {
      test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
      test.slow();
      const { team } = await directorTree();
      const name = `Acceptance offsite ${suffix()}`;

      await page.goto('/events/new');
      await page.getByLabel('Event name').fill(name);
      await page.getByLabel('Starts').fill('2026-12-10T09:00');
      await page.getByLabel('Ends').fill('2026-12-10T17:00');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();

      await page.getByLabel('Locations', { exact: true }).click();
      await page.getByRole('option', { name: 'New York' }).click();
      await page.getByRole('option', { name: 'Westlake' }).click();
      await page.keyboard.press('Escape');
      for (const person of ['Isabella', 'Mason']) {
        await page.getByLabel('Find people to add').fill(person);
        await page
          .getByRole('list', { name: 'Directory matches' })
          .getByRole('button')
          .first()
          .click();
      }
      await page.getByRole('button', { name: 'Continue', exact: true }).click();

      await pick(page, 'Home budget (funds the event first)', team.name);
      await page
        .getByLabel(/Unit cost/)
        .first()
        .fill('3000');
      await expect(page.getByText('New York · 1 participant')).toBeVisible();
      await page.getByRole('button', { name: 'Continue to funding' }).click();
      await page.getByLabel(/Own funds from the home budget/).fill('2000');
      await page.getByRole('button', { name: 'Review' }).click();
      await page.getByRole('button', { name: 'Submit for approval' }).click();

      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      const eventId = page.url().split('/events/')[1]!.split('?')[0]!;
      const event = await api<{ status: string; ownFundsRequest: { id: string } | null }>(
        'budget-owner',
        'get',
        `/api/events/${eventId}`,
      );
      expect(event.status).toBe('submitted');
      expect(event.ownFundsRequest?.id).toBeTruthy();
    });
  });

  test.describe('Step 4 — Inter-Director Budget Contribution Request', () => {
    test.use({ storageState: authFile('budget-owner') });

    test('Lena contributes in part and declines another ask', async ({ page, browser }, info) => {
      test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
      test.slow();
      const { root, team, tag } = await directorTree();
      const giver = await giverBudget(root.id, tag);
      const event = await approvedEvent(team.id, 2_000_000, 400_000);

      const part = await api<{ id: string }>('budget-owner', 'post', '/api/contributions', {
        eventId: event.id,
        giverBudgetId: giver.id,
        amount: usd(200_000),
        purpose: 'Wave 2 acceptance co-fund',
      });
      const declined = await api<{ id: string }>('budget-owner', 'post', '/api/contributions', {
        eventId: event.id,
        giverBudgetId: giver.id,
        amount: usd(100_000),
        purpose: 'Wave 2 acceptance co-fund',
      });

      const lena = await pageAs(browser, 'department-head');
      await lena.goto(`/contributions/${part.id}`);
      await lena.getByRole('radio', { name: /Contribute part/ }).click();
      await lena.getByLabel(/Approved contribution amount/).fill('1200');
      await pick(lena, /Reason code/, /TRF-COFUND/);
      await lena.getByRole('checkbox', { name: 'I have no conflict of interest' }).check();
      await lena.getByRole('button', { name: `Contribute ${usdText(120_000)}` }).click();
      await expect(lena.getByRole('heading', { name: 'Your decision' })).toHaveCount(0);

      await lena.goto(`/contributions/${declined.id}`);
      await lena.getByRole('radio', { name: /Decline/ }).click();
      await pick(lena, /Reason code/, /REJ-BUDGET/);
      await lena.getByRole('button', { name: 'Decline request' }).click();
      await lena.context().close();

      await page.goto(`/events/cofunding-board?event=${event.id}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Co-funding board' })).toBeVisible();
      const board = page
        .getByRole('heading', { name: new RegExp(`${event.name}: funding breakdown`) })
        .locator('xpath=ancestor::section[1]');
      await expect(board).toContainText(usdText(120_000));

      const detail = await api<{ contributions: { id: string; status: string }[] }>(
        'budget-owner',
        'get',
        `/api/events/${event.id}`,
      );
      expect(detail.contributions.find((c) => c.id === part.id)?.status).toBe('earmarked');
      expect(detail.contributions.find((c) => c.id === declined.id)?.status).toBe('rejected');
    });
  });

  test.describe('Step 5 — DoA approval', () => {
    test.use({ storageState: authFile('department-head') });

    test('Lena approves within her DoA limit and the requester sees the route', async ({
      page,
      browser,
    }, info) => {
      test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
      test.slow();
      const { team } = await directorTree();
      const r = await spendingRequest(team.id, 95_000);
      const taskId = await taskOf(r.id, 'department-head', 'requests');

      await page.goto(`/approvals?task=${taskId}`);
      const detail = page.getByRole('region', { name: 'Approval detail' });
      await expect(detail.locator('bf-approval-route')).toContainText('Lena Fischer');
      await detail.getByRole('checkbox', { name: 'I have no conflict of interest' }).check();
      await detail.getByRole('button', { name: `Approve ${usdText(95_000)}` }).click();
      await expect.poll(async () => (await getRequest(r.id)).status).toBe('approved');

      const requester = await pageAs(browser, 'budget-owner');
      await requester.goto(`/requests/${r.id}?tab=history`);
      await expect(requester.getByTestId('request-history')).toContainText('Within DoA');
      await requester.context().close();
    });
  });

  test.describe('Step 6 — freeze and set-to-zero on requests', () => {
    test.use({ storageState: authFile('budget-owner') });

    test('freeze holds approval; set to zero cancels the request', async ({ page }, info) => {
      test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
      test.slow();
      const { team } = await directorTree();
      const r = await spendingRequest(team.id, 70_000);

      await control(team.id, 'freeze');
      await expect
        .poll(async () => (await getRequest(r.id)).onHold, { timeout: 30_000 })
        .toBe(true);
      await page.goto(`/requests/${r.id}`);
      await expect(
        page.getByText('Budget frozen: decisions wait until it is unfrozen'),
      ).toBeVisible();

      await control(team.id, 'set_to_zero');
      await expect
        .poll(async () => (await getRequest(r.id)).status, { timeout: 30_000 })
        .toBe('cancelled');
      await page.reload();
      await expect(
        page.getByText('Cancelled: budget set to zero. Nothing was charged.'),
      ).toBeVisible();
    });
  });

  test.describe('Step 7 — actuals import and matching', () => {
    test.use({ storageState: authFile('finance-controller') });

    test('shows the seeded November ERP import with plan-rate FX', async ({ page }) => {
      await page.goto('/finance/actuals?file=erp-actuals-2026-11.csv');
      await expect(page.getByTestId('batch-status')).toContainText('Posted');
      await expect(page.getByTestId('kpi-auto')).toHaveText('3');
      await expect(page.getByTestId('kpi-unmatched')).toHaveText('3');
      await expect(page.getByText('Budget consumption uses the locked plan rate.')).toBeVisible();

      const batch = await api<{ items: { status: string }[] }>(
        'finance-controller',
        'get',
        '/api/actuals?status=all&limit=50',
      );
      expect(batch.items.some((i) => i.status === 'matched')).toBe(true);
      expect(batch.items.some((i) => i.status === 'unmatched')).toBe(true);
    });
  });

  test.describe('Step 8 — event reconciliation', () => {
    test.use({ storageState: authFile('finance-controller') });

    test('the New York offsite cannot close while an actual is still unmatched', async ({
      page,
    }) => {
      await page.goto('/finance/actuals/events');
      await page.getByTestId('event-NYC-OFFSITE-26').click();
      await expect(page.getByTestId('blocker-EVENT_HAS_UNMATCHED_ACTUALS')).toBeVisible();

      const recon = await api<{ canClose: boolean; blockers: { code: string }[] }>(
        'finance-controller',
        'get',
        `/api/actuals/events/${ACTUALS_EVENTS.newYorkOffsite}/reconciliation`,
      );
      expect(recon.canClose).toBe(false);
      expect(recon.blockers.map((b) => b.code)).toContain('EVENT_HAS_UNMATCHED_ACTUALS');
    });
  });

  test.describe('Step 9 — GL tie-out', () => {
    test.use({ storageState: authFile('finance-controller') });

    test('India shows a travel difference; the controller cannot sign off alone', async ({
      page,
    }) => {
      await page.goto('/finance/gl-tie-out');
      await expect(page.getByTestId('entity-chip-HYL-IN')).toContainText('1 difference');
      await expect(page.getByTestId('entity-chip-HYL-US')).toContainText('Tied');
      await expect(page.getByTestId('sign-off')).toBeDisabled();

      const tieOut = await api<{ items: { legalEntityCode: string; exceptions: number }[] }>(
        'finance-controller',
        'get',
        '/api/actuals/tie-outs?month=2026-11',
      );
      const india = tieOut.items.find((e) => e.legalEntityCode === 'HYL-IN');
      expect(india?.exceptions).toBeGreaterThan(0);
    });
  });

  test.describe('Step 10 — utilization and ledger roll-up', () => {
    test.use({ storageState: authFile('regional-manager') });

    // Screen 82 was rebuilt on the Phase 10 report frame, so the roll-up this step checks now comes
    // from the reports endpoint. The pre-Phase-10 /api/utilization roll-up is still asserted beside
    // it, because both read the same ledger balances and must agree on what the region authorized.
    test('utilization by location matches the API totals in USD', async ({ page }) => {
      const rollUp = await api<{
        currency: string;
        totals: { authorized: { amountMinor: number }; utilizationBps: number };
      }>('regional-manager', 'get', '/api/utilization?groupBy=location');
      const report = await api<{
        currency: string;
        reconciliation: { ties: boolean; authorized: { amountMinor: number } };
      }>('regional-manager', 'get', '/api/reports/utilization/run?groupBy=location');

      await page.goto('/reports/utilization');
      await expect(page.getByRole('heading', { level: 1, name: 'Utilization' })).toBeVisible();
      const table = page.getByRole('table', { name: 'Utilization' });
      await expect(table).toContainText('USD');
      await expect(table).toContainText(usdText(rollUp.totals.authorized.amountMinor));

      expect(rollUp.currency).toBe('USD');
      expect(rollUp.totals.utilizationBps).toBeGreaterThanOrEqual(0);
      expect(report.currency).toBe('USD');
      expect(report.reconciliation.ties).toBe(true);
      expect(report.reconciliation.authorized.amountMinor).toBe(
        rollUp.totals.authorized.amountMinor,
      );
    });
  });
});

// The plan's ten-step core acceptance scenario as one story, through the UI as each role, with API
// assertions on every number. It runs once, on desktop, in order: every step builds on the program the
// CEO creates in step 1 (named with a fresh tag), so it never reads seeded state another suite moves.
//
// | Step | Outcome | Role(s) |
// | --- | --- | --- |
// | 1 | USD 100,000 program funded by an approved plan revision; INR and EUR plan rates locked | finance-admin, finance-admin-2, ceo |
// | 2 | India (HYL-IN), US and Europe (HYL-DE) allocated | ceo |
// | 3 | Fixed and per-head allocations, then the headcount true-up | regional-manager, finance-admin |
// | 4 | Cross-location event on the India budget | regional-manager |
// | 5 | Attendees split by location and employing entity | regional-manager |
// | 6 | Additional funds; contributions full, part, declined; UK blocked, US and Europe recharged | regional-manager, budget-owner, department-head, finance-controller |
// | 7 | DoA approval with hygiene; one decision from the actionable email | ceo |
// | 8 | Set to zero through its dialog | finance-admin |
// | 9 | New requests blocked; INR card and expense files imported, matched, queue cleared; event closed with surplus by share | regional-manager, finance-controller |
// | 10 | Audit trail, utilization by location and team with FX separate, GL tie-out | auditor, regional-manager, finance-controller |
const UK_ENTITY = '20000000-0000-4000-8000-000000000006';

interface Balances {
  balances: {
    budgetCurrency: Record<
      'authorized' | 'allocatedOut' | 'held' | 'preEncumbered' | 'encumbered' | 'actual',
      { amountMinor: number; currency: string }
    >;
    available: { amountMinor: number; currency: string };
  };
  status: string;
  allocationDriver?: string;
}
const balances = (id: string, as: Parameters<typeof api>[0] = 'finance-admin') =>
  api<Balances & { id: string; name: string; code: string | null }>(
    as,
    'get',
    `/api/budgets/${id}`,
  );
/** Key states for the evidence pack, only when BF_EVIDENCE_DIR is set (never in CI). */
const shot = async (page: Page, name: string) => {
  const dir = process.env['BF_EVIDENCE_DIR'];
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};
/** The second finance admin is an extra seed user with no saved session: sign in fresh. */
async function secondFinanceAdmin(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await submitSignIn(page, 'finance-admin-2');
  await expectShell(page);
  return page;
}
/** A call that may fail, for asserting a refusal's status and problem code. */
async function rawApi(
  user: Parameters<typeof api>[0],
  method: 'post',
  path: string,
  data: unknown,
) {
  const ctx = await request.newContext();
  const res = await ctx.fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await apiToken(user)}`,
      'idempotency-key': randomUUID(),
      'x-tenant-id': SEED.tenants.acme,
    },
    data,
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  await ctx.dispose();
  return { status: res.status(), body };
}
const authorized = async (id: string) =>
  (await balances(id)).balances.budgetCurrency.authorized.amountMinor;

test.describe.serial('Core acceptance scenario, end to end', () => {
  const tag = suffix().toUpperCase();
  const s = {
    tag,
    code: `ACC-${tag}`,
    program: `Acceptance program ${tag}`,
    label: `Acceptance plan ${tag}`,
    root: '',
    india: '',
    us: '',
    europe: '',
    uk: '',
    hyderabad: '',
    eventId: '',
    eventName: `Acceptance summit ${tag}`,
    eventCode: '',
    asOf1: '',
    asOf2: '',
  };

  test.beforeEach(({ browserName: _browser }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();
  });

  test('Step 1 — the CEO creates the USD 100,000 program with INR and EUR plan rates locked', async ({
    browser,
  }) => {
    // Finance drafts the plan revision that funds the program; a second finance admin and the CEO
    // approve it (new money needs two people, neither the drafter).
    const fa = await pageAs(browser, 'finance-admin');
    await fa.goto('/budgets/plans');
    await fa.getByTestId('import-plan').click();
    await fa.getByTestId('import-label').fill(s.label);
    await pick(fa, 'Kind', 'Current (revision)');
    await fa
      .getByTestId('import-csv')
      .fill(
        `Program code,Program,Amount (USD),Legal entity code\n${s.code},${s.program},"100,000.00",HYL-US`,
      );
    await fa.getByTestId('validate-import').click();
    await fa.getByTestId('create-version').click();
    await expect(
      fa.getByText(`Draft version "${s.label}" created from the spreadsheet.`),
    ).toBeVisible();
    await fa.context().close();

    for (const role of ['finance-admin-2', 'ceo'] as const) {
      const p = role === 'ceo' ? await pageAs(browser, role) : await secondFinanceAdmin(browser);
      await p.goto('/budgets/plans');
      await p.getByTestId(`version-${s.label}`).click();
      await expect(p.getByTestId('version-lines')).toContainText(s.code);
      await p.getByTestId('approve-version').click();
      await expect(
        p.getByText(
          role === 'ceo'
            ? `Approved: "${s.label}" can now fund root budgets.`
            : `Your approval of "${s.label}" is recorded. It needs one more sign-off`,
        ),
      ).toBeVisible();
      await p.context().close();
    }
    const versions = await api<{ items: { id: string; label: string; status: string }[] }>(
      'ceo',
      'get',
      `/api/plan-versions?fiscalYearId=${SEED.fiscalYears.acmeFy2026}`,
    );
    const version = versions.items.find((v) => v.label === s.label);
    expect(version?.status).toBe('approved');

    // The CEO creates the root budget from that version.
    const ceo = await pageAs(browser, 'ceo');
    await ceo.goto('/budgets/new');
    await ceo.getByTestId('name').fill(s.program);
    await ceo.getByTestId('parent').click();
    await ceo.getByRole('option', { name: /No parent: a root budget/ }).click();
    await ceo.getByLabel('Code (optional)').fill(s.code);
    await pick(ceo, 'Legal entity', /HYL-US/);
    await pick(ceo, 'Plan version', s.label);
    await ceo.getByTestId('amount').fill('100000');
    await ceo.getByTestId('create').click();
    await expect(ceo).toHaveURL(/\/budgets\/[0-9a-f-]{36}/);
    s.root = ceo.url().split('/budgets/')[1]!.split(/[?#]/)[0]!;
    await expect(ceo.getByRole('heading', { level: 1, name: s.program })).toBeVisible();
    await shot(ceo, 'step-01-program-created');
    const root = await balances(s.root);
    expect(root.balances.budgetCurrency.authorized).toEqual({
      amountMinor: 10_000_000,
      currency: 'USD',
    });

    // INR and EUR plan rates for FY2026 are locked (the seed locks them at plan approval).
    await ceo.goto('/finance/rates');
    await expect(ceo.getByTestId('plan-INR')).toContainText('83.2500 (locked)');
    await expect(ceo.getByTestId('plan-EUR')).toContainText('0.9200 (locked)');
    await shot(ceo, 'step-01-plan-rates-locked');
    await expect(ceo.getByRole('region', { name: 'Plan-rate lock' })).toContainText(
      'FY2026 locked',
    );
    const rates = await api<{
      items: {
        quoteCurrency: string;
        rate: string;
        locked: boolean;
        fiscalYearId: string | null;
      }[];
    }>(
      'ceo',
      'get',
      `/api/finance/exchange-rates?rateType=plan&fiscalYearId=${SEED.fiscalYears.acmeFy2026}&limit=200`,
    );
    for (const [ccy, rate] of [
      ['INR', 83.25],
      ['EUR', 0.92],
    ] as const) {
      const r = rates.items.find((i) => i.quoteCurrency === ccy);
      expect(r?.locked, `${ccy} plan rate locked`).toBe(true);
      expect(Number(r?.rate)).toBe(rate);
    }
    await ceo.context().close();
  });

  test('Step 2 — the CEO allocates India, US and Europe', async ({ browser }) => {
    const ceo = await pageAs(browser, 'ceo');
    const children = [
      {
        key: 'india',
        name: `India ${s.tag}`,
        entity: /HYL-IN/,
        owner: 'Ananya Iyer',
        cc: /CC-IN-BLR-200/,
        usd: '40000',
      },
      {
        key: 'us',
        name: `United States ${s.tag}`,
        entity: /HYL-US/,
        owner: 'Jordan Smith',
        cc: /CC-US-NYC-300/,
        usd: '30000',
      },
      {
        key: 'europe',
        name: `Europe ${s.tag}`,
        entity: /HYL-DE/,
        owner: 'Lena Fischer',
        cc: /CC-EU-BER-400/,
        usd: '20000',
      },
    ] as const;
    for (const c of children) {
      await ceo.goto(`/budgets/new?parent=${s.root}`);
      await ceo.getByTestId('name').fill(c.name);
      await ceo.getByTestId('owner').click();
      await ceo.getByRole('option', { name: new RegExp(`^${c.owner}`) }).click();
      await pick(ceo, 'Legal entity', c.entity);
      await pick(ceo, 'Cost center', c.cc);
      await ceo.getByTestId('amount').fill(c.usd);
      await ceo.getByTestId('create').click();
      await expect(ceo.getByRole('heading', { level: 1, name: c.name })).toBeVisible();
      s[c.key] = ceo.url().split('/budgets/')[1]!.split(/[?#]/)[0]!;
      expect(await authorized(s[c.key])).toBe(Number(c.usd) * 100);
    }
    // A UK budget (HYL-UK) the intercompany policy will block from funding India (step 6).
    const uk = await api<{ id: string }>('ceo', 'post', '/api/budgets', {
      name: `United Kingdom ${s.tag}`,
      parentId: s.root,
      legalEntityId: UK_ENTITY,
      fiscalYearId: SEED.fiscalYears.acmeFy2026,
    });
    s.uk = uk.id;
    await api('ceo', 'post', `/api/budgets/${s.root}/allocations`, {
      childBudgetId: s.uk,
      amount: usd(500_000),
    });

    await ceo.goto(`/budgets/${s.root}?tab=children`);
    for (const c of children)
      await expect(ceo.getByRole('row', { name: new RegExp(c.name) })).toBeVisible();
    const root = await balances(s.root);
    expect(root.balances.budgetCurrency.allocatedOut.amountMinor).toBe(9_500_000);
    expect(root.balances.available.amountMinor).toBe(500_000);
    await shot(ceo, 'step-02-children-allocated');
    await ceo.context().close();
  });

  test('Step 3 — fixed and per-head allocations, then the headcount true-up', async ({
    browser,
  }) => {
    // India keeps a fixed allocation; Hyderabad is funded per head from an HR snapshot. The driver
    // needs snapshots inside FY2026 (it multiplies by the months left in the year), so this scenario's
    // files are dated March and April 2026: older than the seeded 31 October and 1 November snapshots,
    // so the latest-snapshot views other suites read stay on the seed, and no other suite dates files
    // in those months.
    s.asOf1 = '2026-03-01';
    s.asOf2 = '2026-04-01';
    const hyd = await api<{ id: string }>('regional-manager', 'post', '/api/budgets', {
      name: `Hyderabad per head ${s.tag}`,
      parentId: s.india,
      legalEntityId: SEED.legalEntities.acmeIndia,
      fiscalYearId: SEED.fiscalYears.acmeFy2026,
      orgUnitId: SEED.orgUnits.hyderabad,
      costCenterId: SEED.costCenters.hyderabad,
    });
    s.hyderabad = hyd.id;

    const fa = await pageAs(browser, 'finance-admin');
    const importHr = async (asOf: string, rows: string, people: number) => {
      await fa.goto('/org/headcount');
      await fa.getByRole('button', { name: 'Import HR file' }).click();
      await fa.getByTestId('import-date').fill(asOf);
      await fa
        .getByTestId('csv-text')
        .fill(`location_code,team_code,employment_type,headcount\n${rows}`);
      await fa.getByRole('button', { name: 'Validate' }).click();
      await fa.getByRole('button', { name: 'Apply import' }).click();
      await expect(
        fa.getByText(new RegExp(`Imported ${people} people on .* as of ${asOf}`)),
      ).toBeVisible();
    };
    await importHr(s.asOf1, 'HYD,,employee,40', 40);

    const rm = await pageAs(browser, 'regional-manager');
    await rm.goto(`/budgets/${s.hyderabad}/per-head`);
    await rm.getByTestId('rate').fill('20');
    await rm.getByLabel('HR snapshot on or before').fill(s.asOf1);
    await rm.getByRole('button', { name: 'Recalculate preview' }).click();
    // 40 employees × USD 20.00 a month × 10 months left (March to December).
    await expect(rm.getByTestId('target-amount')).toContainText(usdText(800_000));
    await rm.getByTestId('apply-per-head').click();
    await expect(rm.getByTestId('per-head-done')).toBeVisible();
    expect(await authorized(s.hyderabad)).toBe(800_000);
    expect((await balances(s.hyderabad)).allocationDriver).toBe('per_head');

    // HR sends a newer file: five more people in Hyderabad. The true-up allocates the difference for
    // the months left from April: 5 × USD 20.00 × 9.
    await importHr(s.asOf2, 'HYD,,employee,45', 45);
    await rm.goto(`/budgets/${s.hyderabad}/per-head`);
    await rm.getByLabel('HR snapshot on or before').fill(s.asOf2);
    await rm.getByRole('button', { name: 'Recalculate preview' }).click();
    await expect(rm.getByTestId('delta')).toContainText(usdText(90_000));
    await expect(rm.getByTestId('apply-per-head')).toHaveText(/Apply true-up/);
    await shot(rm, 'step-03-true-up-preview');
    await rm.getByTestId('apply-per-head').click();
    await expect(rm.getByTestId('per-head-done')).toBeVisible();
    expect(await authorized(s.hyderabad)).toBe(890_000);
    const india = await balances(s.india);
    expect(india.balances.budgetCurrency.authorized.amountMinor).toBe(4_000_000);
    expect(india.balances.budgetCurrency.allocatedOut.amountMinor).toBe(890_000);
    await fa.context().close();
    await rm.context().close();
  });

  test('Step 4 — Ananya creates a cross-location event on the India budget', async ({
    browser,
  }) => {
    const rm = await pageAs(browser, 'regional-manager');
    await rm.goto('/events/new');
    await rm.getByLabel('Event name').fill(s.eventName);
    await rm.getByLabel('Starts').fill('2026-12-03T09:00');
    await rm.getByLabel('Ends').fill('2026-12-03T17:00');
    await rm.getByRole('button', { name: 'Continue', exact: true }).click();

    await rm.getByLabel('Locations', { exact: true }).click();
    // Ananya picks the locations in her region; the attendees come from three legal entities.
    for (const l of ['Bengaluru', 'Hyderabad']) {
      const option = rm.getByRole('option', { name: l, exact: true });
      if ((await option.getAttribute('aria-selected')) !== 'true') await option.click();
      await expect(option).toHaveAttribute('aria-selected', 'true');
    }
    await rm.keyboard.press('Escape');
    // The wizard's directory search is scoped to the organizer's own region (finding recorded in
    // evidence/gap-a3-acceptance), so Ananya adds the India attendees here and the US and Europe
    // attendees join through the participants endpoint after the event is created.
    for (const person of ['Rohan Kulkarni', 'Deepika Srinivasan']) {
      await rm.getByLabel('Find people to add').fill(person);
      await rm
        .getByRole('list', { name: 'Directory matches' })
        .getByRole('button', { name: new RegExp(person) })
        .click();
    }
    await expect(rm.getByRole('heading', { name: '2 participants' })).toBeVisible();
    await rm.getByRole('button', { name: 'Continue', exact: true }).click();

    await pick(rm, 'Home budget (funds the event first)', new RegExp(`India ${s.tag}`));
    await rm
      .getByLabel(/Unit cost/)
      .first()
      .fill('10000');
    await expect(rm.getByText('Bengaluru · 2 participants')).toBeVisible();
    await shot(rm, 'step-04-event-cost-split');
    await rm.getByRole('button', { name: 'Continue to funding' }).click();
    await rm.getByLabel(/Own funds from the home budget/).fill('6000');
    await rm.getByRole('button', { name: 'Review' }).click();
    await rm.getByRole('button', { name: 'Submit for approval' }).click();

    await expect(rm.getByRole('heading', { level: 1, name: s.eventName })).toBeVisible();
    s.eventId = rm.url().split('/events/')[1]!.split(/[?#/]/)[0]!;
    const e = await api<{
      status: string;
      eventCode: string;
      legalEntityId: string;
      locationNames: string[];
      estimate: { amountMinor: number };
      ownFundsRequest: { id: string } | null;
    }>('regional-manager', 'get', `/api/events/${s.eventId}`);
    s.eventCode = e.eventCode;
    expect(e.status).toBe('submitted');
    expect(e.legalEntityId).toBe(SEED.legalEntities.acmeIndia);
    expect([...e.locationNames].sort()).toEqual(['Bengaluru', 'Hyderabad']);
    expect(e.estimate.amountMinor).toBe(1_000_000);
    expect(e.ownFundsRequest?.id).toBeTruthy();

    const person = async (name: string) =>
      (
        await api<{ items: { id: string; displayName: string }[] }>(
          'ceo',
          'get',
          `/api/org/people?q=${encodeURIComponent(name)}&limit=5`,
        )
      ).items.find((p) => p.displayName === name)!.id;
    await api('regional-manager', 'post', `/api/events/${s.eventId}/participants`, {
      personIds: [await person('Isabella Ward'), await person('Lena Hoffmann')],
    });
    await rm.reload();
    await expect(rm.getByRole('heading', { level: 1, name: s.eventName })).toBeVisible();
    await rm.context().close();
  });

  test('Step 5 — attendees with costs split by location and employing entity', async ({
    browser,
  }) => {
    const rm = await pageAs(browser, 'regional-manager');
    await rm.goto(`/events/${s.eventId}`);
    const card = rm
      .getByRole('heading', { name: 'Cost split by location and legal entity' })
      .locator('xpath=ancestor::section[1]');
    const e = await api<{
      splits: Record<
        'byLocation' | 'byEntity' | 'byCostCenter',
        {
          name: string;
          participants: number;
          shareBps: number;
          amount: { amountMinor: number };
          intercompany: boolean;
        }[]
      >;
    }>('regional-manager', 'get', `/api/events/${s.eventId}`);
    const byName = (rows: typeof e.splits.byEntity) =>
      Object.fromEntries(
        rows.map((r) => [r.name, [r.participants, r.amount.amountMinor, r.intercompany]]),
      );
    // Four people share the event's cost evenly: two in Bengaluru (HYL-IN), one in New York
    // (HYL-US), one in Berlin (HYL-DE). The US and Europe shares are intercompany.
    const total = e.splits.byLocation.reduce((t, r) => t + r.amount.amountMinor, 0);
    expect(total).toBeGreaterThan(0);
    expect(e.splits.byEntity.reduce((t, r) => t + r.amount.amountMinor, 0)).toBe(total);
    const each = total / 4;
    expect(byName(e.splits.byLocation)).toEqual({
      Bengaluru: [2, 2 * each, false],
      'New York': [1, each, false],
      Berlin: [1, each, false],
    });
    const entity = (name: string) => e.splits.byEntity.find((r) => r.name.includes(name));
    expect(entity('India')).toMatchObject({
      participants: 2,
      intercompany: false,
      amount: { amountMinor: 2 * each },
    });
    expect(entity('North America')).toMatchObject({
      participants: 1,
      intercompany: true,
      amount: { amountMinor: each },
    });
    expect(entity('Europe')).toMatchObject({
      participants: 1,
      intercompany: true,
      amount: { amountMinor: each },
    });

    const table = card.getByRole('table', { name: 'Cost split' });
    await expect(table.getByRole('row', { name: /Bengaluru/ })).toContainText(usdText(2 * each));
    await pick(rm, 'Split by', 'Employing entity');
    for (const r of e.splits.byEntity) {
      const row = table.getByRole('row', { name: new RegExp(r.name) });
      await expect(row).toContainText(usdText(r.amount.amountMinor));
      if (r.intercompany) await expect(row).toContainText('Intercompany');
    }
    await shot(rm, 'step-05-split-by-employing-entity');
    await rm.context().close();
  });

  test('Step 6 — contributions in full, in part and declined; UK blocked, US and Europe recharged', async ({
    browser,
  }) => {
    const rm = await pageAs(browser, 'regional-manager');
    await rm.goto(`/events/${s.eventId}`);
    const ask = async (budgetName: string) => {
      await rm.getByRole('button', { name: 'Request contribution' }).click();
      const matched = rm.waitForResponse(
        (res) =>
          res.url().includes('/api/contributions/candidate-budgets') &&
          new URL(res.url()).searchParams.get('q') === budgetName &&
          res.ok(),
      );
      await rm.getByLabel('Find a giving budget').fill(budgetName);
      await matched;
      await rm.getByRole('combobox', { name: 'Giving budget' }).click();
      return rm.getByRole('option', { name: new RegExp(budgetName) });
    };
    // The UK budget is offered but disabled: HYL-UK to HYL-IN is blocked by the intercompany policy.
    const ukOption = await ask(`United Kingdom ${s.tag}`);
    await expect(ukOption).toContainText('Blocked by the intercompany policy.');
    await expect(ukOption).toHaveAttribute('aria-disabled', 'true');
    await shot(rm, 'step-06-uk-blocked');
    await rm.keyboard.press('Escape');
    await rm.getByRole('button', { name: 'Cancel' }).first().click();
    const blocked = await rawApi('regional-manager', 'post', '/api/contributions', {
      eventId: s.eventId,
      giverBudgetId: s.uk,
      amount: usd(100_000),
      purpose: 'Co-fund the summit',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('INTERCOMPANY_BLOCKED');

    const send = async (budgetName: string, usdAmount: string) => {
      const opt = await ask(budgetName);
      await opt.click();
      await rm.getByLabel(/^Amount/).fill(usdAmount);
      await rm.getByLabel('Purpose').fill('Co-fund the summit');
      const created = rm.waitForResponse(
        (res) =>
          res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/contributions',
      );
      await rm.getByRole('button', { name: 'Send request' }).click();
      expect((await created).status()).toBe(201);
      await expect(rm.getByLabel('Find a giving budget')).toHaveCount(0);
    };
    await send(`United States ${s.tag}`, '2000');
    await send(`Europe ${s.tag}`, '2000');
    const contributionsOf = async () =>
      (
        await api<{
          contributions: {
            id: string;
            giverBudgetName: string;
            requested: { amountMinor: number };
          }[];
        }>('regional-manager', 'get', `/api/events/${s.eventId}`)
      ).contributions;
    const fromBudget = async (name: string, minor: number) => {
      const c = (await contributionsOf()).find(
        (x) => x.giverBudgetName === name && x.requested.amountMinor === minor,
      );
      expect(c, `${name} asked for ${minor}`).toBeTruthy();
      return c!;
    };
    const us = await fromBudget(`United States ${s.tag}`, 200_000);
    const euPart = await fromBudget(`Europe ${s.tag}`, 200_000);
    const sources = rm.getByRole('table', { name: 'Funding sources' });
    await expect(
      sources.getByRole('row', { name: new RegExp(`United States ${s.tag}`) }),
    ).toContainText(usdText(200_000));

    // Jordan (US) contributes in full; Lena (Europe) contributes part.
    const jordan = await pageAs(browser, 'budget-owner');
    await jordan.goto(`/contributions/${us.id}`);
    await expect(jordan.getByText(/Cross-entity: .* recharged at cost/)).toBeVisible();
    await jordan.getByRole('checkbox', { name: 'I have no conflict of interest' }).check();
    await jordan.getByRole('button', { name: `Contribute ${usdText(200_000)}` }).click();
    await expect(jordan.getByRole('heading', { name: 'Your decision' })).toHaveCount(0);
    await jordan.context().close();

    const lena = await pageAs(browser, 'department-head');
    await lena.goto(`/contributions/${euPart.id}`);
    await expect(lena.getByText(/Cross-entity: .* 5% markup/)).toBeVisible();
    await lena.getByRole('radio', { name: /Contribute part/ }).click();
    await lena.getByLabel(/Approved contribution amount/).fill('1500');
    await pick(lena, /Reason code/, /TRF-COFUND/);
    await lena.getByRole('checkbox', { name: 'I have no conflict of interest' }).check();
    await lena.getByRole('button', { name: `Contribute ${usdText(150_000)}` }).click();
    await expect(lena.getByRole('heading', { name: 'Your decision' })).toHaveCount(0);

    // The funding still falls short, so Ananya asks Europe again; Lena declines.
    await rm.reload();
    await send(`Europe ${s.tag}`, '1000');
    const euNo = await fromBudget(`Europe ${s.tag}`, 100_000);
    await expect(sources.getByRole('row', { name: new RegExp(`Europe ${s.tag}`) })).toHaveCount(2);
    await rm.context().close();
    await lena.goto(`/contributions/${euNo.id}`);
    await lena.getByRole('radio', { name: /Decline/ }).click();
    await pick(lena, /Reason code/, /REJ-BUDGET/);
    await lena.getByRole('button', { name: 'Decline request' }).click();
    await expect(lena.getByRole('heading', { name: 'Your decision' })).toHaveCount(0);
    await lena.context().close();

    const after = await api<{
      contributions: { id: string; status: string; approved: { amountMinor: number } | null }[];
    }>('regional-manager', 'get', `/api/events/${s.eventId}`);
    const st = (id: string) => after.contributions.find((c) => c.id === id)!;
    expect(st(us.id)).toMatchObject({ status: 'earmarked', approved: { amountMinor: 200_000 } });
    expect(st(euPart.id)).toMatchObject({
      status: 'earmarked',
      approved: { amountMinor: 150_000 },
    });
    expect(st(euNo.id).status).toBe('rejected');
    // Earmarks are held on each giver's budget.
    expect((await balances(s.us)).balances.budgetCurrency.held.amountMinor).toBe(200_000);
    expect((await balances(s.europe)).balances.budgetCurrency.held.amountMinor).toBe(150_000);

    // Recharges: Europe to India at a 5% markup posts at once; US to India at cost waits for the tax
    // approver, Daniel, who approves it on the recharge schedule.
    const recharges = async () =>
      api<{
        items: {
          contributionId: string;
          mode: string;
          status: string;
          total: { amountMinor: number };
        }[];
      }>('finance-controller', 'get', `/api/recharges?eventId=${s.eventId}`);
    const r1 = await recharges();
    const rOf = (id: string, list = r1) => list.items.find((r) => r.contributionId === id)!;
    expect(rOf(euPart.id)).toMatchObject({
      mode: 'recharge_with_markup',
      status: 'approved',
      total: { amountMinor: 157_500 },
    });
    expect(rOf(us.id)).toMatchObject({
      mode: 'recharge_at_cost',
      status: 'pending_tax_approval',
      total: { amountMinor: 200_000 },
    });
    const daniel = await pageAs(browser, 'finance-controller');
    await daniel.goto(`/finance/recharges?event=${s.eventId}`);
    const row = daniel
      .getByRole('table', { name: 'Recharge schedule' })
      .getByRole('row', { name: /At cost/ });
    await expect(row).toContainText(usdText(200_000));
    await shot(daniel, 'step-06-recharge-schedule');
    await row.getByRole('button', { name: 'Approve recharge' }).click();
    await expect(
      daniel.getByText('Recharge approved; the due-to / due-from journal is posted'),
    ).toBeVisible();
    expect(rOf(us.id, await recharges()).status).toBe('approved');
    await daniel.context().close();
  });

  test('Step 7 — DoA approval with hygiene; one decision from the actionable email', async ({
    browser,
  }) => {
    const e0 = await api<{ ownFundsRequest: { id: string } }>(
      'regional-manager',
      'get',
      `/api/events/${s.eventId}`,
    );
    const own = await getRequest(e0.ownFundsRequest.id, 'regional-manager');
    // The requester holds no task on her own request: nobody approves their own request.
    expect(own.myTaskId).toBeNull();
    const taskId = await taskOf(own.id, 'ceo', 'requests');
    const task = await api<{
      checks: { code: string; passed: boolean }[];
      doa: { withinLimit: boolean; limit: { amountMinor: number } | null };
    }>('ceo', 'get', `/api/approvals/tasks/${taskId}`);
    expect(Object.fromEntries(task.checks.map((c) => [c.code, c.passed]))).toMatchObject({
      not_requester: true,
      not_beneficiary: true,
      not_attendee: true,
      within_doa: true,
    });
    expect(task.doa.withinLimit).toBe(true);
    expect(task.doa.limit!.amountMinor).toBeGreaterThanOrEqual(600_000);

    const ceo = await pageAs(browser, 'ceo');
    await ceo.goto(`/approvals?task=${taskId}`);
    const panel = ceo.getByRole('region', { name: 'Approval detail' });
    const checks = panel.getByRole('complementary', { name: 'Check before you decide' });
    for (const label of [
      'Not the requester',
      'Not a beneficiary',
      'Not attending the event',
      'Within delegation of authority',
    ])
      await expect(checks).toContainText(label);
    const approve = panel.getByRole('button', { name: `Approve ${usdText(600_000)}` });
    await expect(approve).toBeDisabled();
    await panel.getByRole('checkbox', { name: 'I have no conflict of interest' }).check();
    await approve.click();
    await expect
      .poll(async () => (await getRequest(own.id, 'regional-manager')).status)
      .toBe('approved');

    // Ananya asks for USD 500.00 more; the CEO approves it from the email.
    const rm = await pageAs(browser, 'regional-manager');
    await rm.goto(`/events/${s.eventId}`);
    await rm.getByRole('button', { name: 'Request additional funds' }).click();
    await expect(rm).toHaveURL(/kind=additional_fund/);
    await rm.getByLabel('Amount').fill('500');
    await rm.getByLabel('Justification').fill('Two more speakers confirmed for the summit.');
    await rm.getByRole('button', { name: 'Submit request' }).click();
    await expect(rm.getByText(/Additional-fund request/)).toBeVisible();
    const extraId = rm.url().split('/requests/')[1]!.split(/[?#/]/)[0]!;
    const extra = await getRequest(extraId, 'regional-manager');
    expect(extra.status).toBe('pending_approval');
    const mail = await mailTo('ceo', extra.ref);
    expect(mail.Subject).toContain(`Approve ${usdText(50_000)}`);
    await ceo.goto(linkPath(mail.Text, 'Approve '));
    await expect(ceo.getByTestId('email-action-result')).toBeVisible();
    await shot(ceo, 'step-07-email-decision');
    await expect
      .poll(async () => (await getRequest(extra.id, 'regional-manager')).status)
      .toBe('approved');
    // The link works once.
    await ceo.goto(linkPath(mail.Text, 'Approve '));
    await expect(ceo.getByRole('link', { name: 'Open in BudgetFlow' })).toBeVisible();
    await ceo.context().close();

    // Fully funded, the event moves to Funded by itself; Ananya commits USD 9,000.00 of spend.
    await rm.goto(`/events/${s.eventId}`);
    await expect(rm.getByRole('button', { name: 'Start event' })).toBeVisible();
    const funded = await api<{
      status: string;
      funding: { cap: { amountMinor: number } };
    }>('regional-manager', 'get', `/api/events/${s.eventId}`);
    expect(funded.status).toBe('funded');
    // Own funds 6,000 + additional 500 + contributions 2,000 and 1,500.
    expect(funded.funding.cap.amountMinor).toBe(1_000_000);
    await rm.getByRole('tab', { name: 'Commitments' }).click();
    await rm.getByRole('button', { name: 'Commit spend' }).click();
    await rm.getByLabel('What is it for').fill('Venue, catering and travel');
    await rm.getByLabel('Amount').fill('9000');
    await rm.getByRole('button', { name: 'Commit', exact: true }).click();
    await expect(rm.getByRole('table', { name: 'Commitments' })).toContainText(usdText(900_000));
    const committed = await api<{
      funding: Record<'committed' | 'actual' | 'available', { amountMinor: number }>;
    }>('regional-manager', 'get', `/api/events/${s.eventId}`);
    expect(committed.funding).toMatchObject({
      committed: { amountMinor: 900_000 },
      actual: { amountMinor: 0 },
      available: { amountMinor: 100_000 },
    });
    const india = await balances(s.india);
    expect(india.balances.budgetCurrency.encumbered.amountMinor).toBeGreaterThan(0);
    await rm.context().close();
  });

  test('Step 8 — finance sets India to zero through the dialog', async ({ browser }) => {
    const preview = await api<{
      floorMinor: number;
      reductionMinor: number;
      childrenAllocatedMinor: number;
    }>('finance-admin', 'post', `/api/budgets/${s.india}/controls/preview`, {
      action: 'set_to_zero',
      destination: 'parent',
      cascade: false,
    });
    const before = await balances(s.india);
    const rootBefore = await balances(s.root);
    // The floor keeps what Hyderabad holds and India's own funding of the event (USD 6,000.00
    // plus the USD 500.00 additional funds); the contributions fund the rest of the commitment.
    expect(preview.childrenAllocatedMinor).toBe(890_000);
    expect(preview.floorMinor).toBe(890_000 + 650_000);
    expect(preview.reductionMinor).toBe(before.balances.available.amountMinor);

    const fa = await pageAs(browser, 'finance-admin');
    await fa.goto(`/budgets/${s.india}`);
    await fa.getByTestId('set-to-zero').click();
    const dialog = fa.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Set budget to zero' })).toBeVisible();
    await expect(dialog.getByTestId('zero-floor')).toContainText(usdText(preview.floorMinor));
    await expect(dialog.getByTestId('zero-cut')).toContainText(usdText(preview.reductionMinor));
    await expect(dialog).toContainText(`Hyderabad per head ${s.tag}`);
    await pick(fa, 'Destination for cut money', /Return to parent/);
    await dialog.getByTestId('reason-code').click();
    await fa.getByRole('option', { name: /RED-REPRIORITIZE/ }).click();
    await dialog
      .getByLabel('Reason', { exact: true })
      .fill('Program reprioritized after the summit');
    const confirm = dialog.getByTestId('confirm-zero');
    await expect(confirm).toBeDisabled();
    await dialog.getByTestId('confirm-text').fill(`India ${s.tag}`);
    await expect(confirm).toBeEnabled();
    await shot(fa, 'step-08-set-to-zero-dialog');
    await confirm.click();
    await expect(fa.getByTestId('zero-banner')).toBeVisible();

    const after = await balances(s.india);
    expect(after.status).toBe('set_to_zero');
    expect(after.balances.available.amountMinor).toBe(0);
    expect(after.balances.budgetCurrency.authorized.amountMinor).toBe(
      before.balances.budgetCurrency.authorized.amountMinor - preview.reductionMinor,
    );
    expect((await balances(s.root)).balances.available.amountMinor).toBe(
      rootBefore.balances.available.amountMinor + preview.reductionMinor,
    );
    // The commitment stays encumbered.
    expect(after.balances.budgetCurrency.encumbered.amountMinor).toBe(
      before.balances.budgetCurrency.encumbered.amountMinor,
    );
    await fa.context().close();
  });

  test('Step 9 — requests blocked, commitments complete, INR files matched, event closed with surplus by share', async ({
    browser,
  }) => {
    // A new request on India is refused; the event (already funded and committed) carries on.
    const rm = await pageAs(browser, 'regional-manager');
    await rm.goto(`/requests/new?budgetId=${s.india}`);
    await expect(rm.getByRole('combobox', { name: 'Charge to' })).toContainText(
      'This budget is set to zero: new requests, allocations and contributions are blocked.',
    );
    await rm.getByLabel('Amount', { exact: true }).fill('100');
    await expect(rm.getByTestId('impact-blocked')).toContainText('set to zero');
    await shot(rm, 'step-09-new-request-blocked');
    await expect(rm.getByRole('button', { name: 'Submit request' })).toBeDisabled();
    const refused = await rawApi('regional-manager', 'post', '/api/requests', {
      kind: 'spending',
      budgetId: s.india,
      amount: usd(10_000),
      spendType: 'team_lunch',
      title: 'Lunch after the summit',
      purpose: 'Team lunch after the summit',
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('BUDGET_SET_TO_ZERO');

    await rm.goto(`/events/${s.eventId}`);
    // The reason is stated once (the domain message already says commitments can complete).
    await expect(rm.getByTestId('event-blocked')).toHaveText(
      /Home budget: This budget is set to zero: new requests, allocations and contributions are blocked\. Existing commitments can still complete\.\s*$/,
    );
    await rm.getByRole('button', { name: 'Start event' }).click();
    await rm.getByRole('button', { name: 'Complete event' }).click();
    await expect(rm.getByRole('button', { name: 'Close and return surplus' })).toBeVisible();

    const event = await api<{
      commitments: { id: string; amount: { amountMinor: number }; status: string }[];
    }>('regional-manager', 'get', `/api/events/${s.eventId}`);
    expect(event.commitments).toHaveLength(1);
    const commitment = event.commitments[0]!;
    const cmtRef = `CMT-${commitment.id.slice(-8).toUpperCase()}`;

    // Finance imports the INR corporate-card file and the INR expense-report file.
    const header =
      'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,event_code,vendor,memo,reference,original_ref,kind';
    const card = `CARD-${s.tag}`;
    const exp = `EXP-${s.tag}`;
    const files = [
      {
        source: 'Corporate card',
        name: `card-inr-${s.tag}.csv`,
        lines: [
          `${card}-1,2026-12-04,416250.00,INR,HYL-IN,CC-IN-BLR-200,6100,${s.eventCode},Lotus Convention Centre,Summit venue,,,charge`,
        ],
        // Part of the USD 9,000.00 commitment: partially matched by event code and cost center.
        partial: 1,
        unmatched: 0,
      },
      {
        source: 'Expense reports',
        name: `expenses-inr-${s.tag}.csv`,
        lines: [
          `${exp}-1,2026-12-05,166500.00,INR,HYL-IN,CC-IN-BLR-200,6100,${s.eventCode},Deccan Caterers,Summit catering,,,charge`,
          `${exp}-2,2026-12-05,83250.00,INR,HYL-IN,CC-IN-BLR-200,6100,,Metro Cabs,Airport transfers for summit speakers,,,charge`,
        ],
        partial: 1,
        unmatched: 1,
      },
    ];
    const fc = await pageAs(browser, 'finance-controller');
    for (const f of files) {
      await fc.goto('/finance/actuals');
      await fc.getByTestId('import-another').click();
      await fc.getByTestId('import-source').click();
      await fc.getByRole('option', { name: f.source }).click();
      await fc.locator('input[type=file]').setInputFiles({
        name: f.name,
        mimeType: 'text/csv',
        buffer: Buffer.from([header, ...f.lines].join('\n')),
      });
      await expect(fc.getByTestId('file-name')).toContainText(f.name);
      await fc.getByRole('button', { name: 'Continue to column mapping' }).click();
      await fc.getByRole('button', { name: `Review ${f.lines.length} lines` }).click();
      await expect(fc.getByTestId('kpi-read')).toHaveText(String(f.lines.length));
      await expect(fc.getByTestId('kpi-auto')).toHaveText('0');
      await expect(fc.getByTestId('kpi-partial')).toHaveText(String(f.partial));
      await expect(fc.getByTestId('kpi-unmatched')).toHaveText(String(f.unmatched));
      const byCurrency = fc.getByRole('table', { name: 'Imported lines by transaction currency' });
      await expect(byCurrency.getByRole('row', { name: /INR/ })).toContainText('83.2500');
      await expect(fc.getByText('Budget consumption uses the locked plan rate.')).toBeVisible();
      await shot(fc, `step-09-import-${f.source.toLowerCase().replace(/ /g, '-')}`);
      await fc.getByTestId('post-import').click();
      await expect(fc.getByTestId('import-notice')).toContainText(
        `${f.unmatched} sent to the unmatched queue`,
      );
    }

    const lines = async () =>
      Object.fromEntries(
        (
          await api<{
            items: {
              sourceRef: string;
              status: string;
              transaction: { amountMinor: number; currency: string };
              reporting: { amountMinor: number; currency: string };
              fxEffect: { amountMinor: number } | null;
            }[];
          }>('finance-controller', 'get', `/api/actuals?status=all&q=${s.tag}&limit=50`)
        ).items.map((i) => [i.sourceRef, i]),
      );
    const l1 = await lines();
    // INR converts at the locked plan rate (83.25 per USD): 416,250.00 → 5,000.00 and so on.
    expect(l1[`${card}-1`]).toMatchObject({
      status: 'matched',
      transaction: { amountMinor: 41_625_000, currency: 'INR' },
      reporting: { amountMinor: 500_000, currency: 'USD' },
    });
    expect(l1[`${exp}-1`]).toMatchObject({
      status: 'matched',
      reporting: { amountMinor: 200_000 },
    });
    expect(l1[`${exp}-2`]).toMatchObject({
      status: 'unmatched',
      reporting: { amountMinor: 100_000 },
    });

    // The taxi line has no event code: the controller matches it to the commitment from the
    // unmatched queue as the final invoice, which releases what is left.
    await fc.goto('/finance/actuals/queue');
    await fc.getByTestId('queue-search').fill(exp);
    await fc.getByTestId(`queue-row-${exp}-2`).click();
    const drawer = fc.getByTestId('match-drawer');
    await expect(drawer.getByTestId('fx-plan')).toContainText(usdText(100_000));
    await expect(drawer.getByTestId('fx-effect')).toBeVisible();
    await drawer.getByTestId(`candidate-${cmtRef}`).click();
    await drawer.getByRole('checkbox', { name: /Final invoice/ }).check();
    await shot(fc, 'step-09-unmatched-queue-match');
    await drawer.getByTestId('match-button').click();
    await expect(fc.getByTestId('queue-notice')).toContainText(`${exp}-2 matched`);
    expect((await lines())[`${exp}-2`]!.status).toBe('matched');

    // Reconciliation: USD 8,000.00 spent at the plan rate; the FX effect is reported on its own.
    const recon = await api<{
      actuals: {
        matched: number;
        unmatched: number;
        matchedReporting: { amountMinor: number };
        fxEffect: { amountMinor: number };
      };
      sources: { budgetId: string; budgetName: string; funded: { amountMinor: number } }[];
      blockers: { code: string }[];
      canClose: boolean;
    }>('finance-controller', 'get', `/api/actuals/events/${s.eventId}/reconciliation`);
    expect(recon.actuals).toMatchObject({
      matched: 3,
      unmatched: 0,
      matchedReporting: { amountMinor: 800_000 },
    });
    expect(recon.blockers).toEqual([]);
    expect(recon.canClose).toBe(true);
    await fc.goto(`/finance/actuals/events/${s.eventId}`);
    await expect(fc.getByTestId('event-unmatched')).toHaveText('0');
    // Spend is valued at the plan rate; the difference to the actual rate is shown on its own.
    const kpi = (label: string) => fc.getByText(label, { exact: true }).locator('xpath=../..');
    await expect(kpi('Actual spend (plan rate)')).toContainText(usdText(800_000));
    expect(recon.actuals.fxEffect.amountMinor).not.toBe(0);
    await expect(kpi('FX effect (separate)')).toContainText(
      usdText(Math.abs(recon.actuals.fxEffect.amountMinor)),
    );
    await expect(kpi('FX effect (separate)')).toContainText('Never consumes budget');
    await shot(fc, 'step-09-reconciliation-fx-separate');
    await fc.context().close();

    // Ananya closes the event; each funding source gets back its share of the USD 2,000.00 surplus.
    await rm.reload();
    await rm.getByRole('button', { name: 'Close and return surplus' }).click();
    await expect(rm.getByText(/Surplus returned:/)).toBeVisible();
    await shot(rm, 'step-09-event-closed-surplus');
    const closed = await api<{
      event: { status: string };
      surplusReturns: { budgetId: string; budgetName: string; amount: { amountMinor: number } }[];
      sources: {
        budgetId: string;
        funded: { amountMinor: number };
        returned: { amountMinor: number };
      }[];
    }>('finance-controller', 'get', `/api/actuals/events/${s.eventId}/reconciliation`);
    expect(closed.event.status).toBe('closed');
    // The closed event keeps its spend: USD 8,000.00 actual, nothing committed or available.
    const after = await api<{
      funding: Record<'committed' | 'actual' | 'available', { amountMinor: number }>;
    }>('regional-manager', 'get', `/api/events/${s.eventId}`);
    expect(after.funding).toMatchObject({
      committed: { amountMinor: 0 },
      actual: { amountMinor: 800_000 },
      available: { amountMinor: 0 },
    });
    await expect(rm.getByText('Actual', { exact: true }).locator('xpath=../..')).toContainText(
      usdText(800_000),
    );
    const returned = (id: string) =>
      closed.surplusReturns
        .filter((r) => r.budgetId === id)
        .reduce((t, r) => t + r.amount.amountMinor, 0);
    // Funded: India 6,500 (65%), US 2,000 (20%), Europe 1,500 (15%) of USD 10,000.00.
    expect(returned(s.india)).toBe(130_000);
    expect(returned(s.us)).toBe(40_000);
    expect(returned(s.europe)).toBe(30_000);
    for (const r of closed.surplusReturns)
      await expect(rm.getByText(/Surplus returned:/)).toContainText(
        `${r.budgetName} ${usdText(r.amount.amountMinor)}`,
      );
    // Earmarks are released: nothing stays held on the givers' budgets.
    expect((await balances(s.us)).balances.budgetCurrency.held.amountMinor).toBe(0);
    expect((await balances(s.europe)).balances.budgetCurrency.held.amountMinor).toBe(0);
    await rm.context().close();
  });

  test('Step 10 — audit trail, utilization by location and team, and the GL tie-out', async ({
    browser,
  }) => {
    // Audit: every change to the event is in the tamper-evident log, and the chain verifies.
    const audit = await api<{ items: { action: string; seq: number }[] }>(
      'auditor',
      'get',
      `/api/audit/events?resourceId=${s.eventId}&order=desc&limit=200`,
    );
    const actions = audit.items.map((i) => i.action);
    for (const a of [
      'event.created',
      'event.submitted',
      'event.participants_added',
      'event.closed',
    ])
      expect(actions, a).toContain(a);
    const verification = await api<{ valid: boolean }>('auditor', 'get', '/api/audit/verification');
    expect(verification.valid).toBe(true);
    const auditor = await pageAs(browser, 'auditor');
    await auditor.goto(`/audit-log?resource=${s.eventId}`);
    await expect(auditor.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    const entries = auditor.getByRole('table', { name: 'Audit entries' });
    await expect(entries.getByRole('row')).toHaveCount(audit.items.length + 1);
    await expect(entries.getByRole('row', { name: /Closed/ })).toBeVisible();
    await auditor.getByRole('button', { name: 'Verify chain' }).click();
    await expect(auditor.getByTestId('chain-status')).toContainText('Chain verified');
    await shot(auditor, 'step-10-audit-trail');
    const zeroed = await api<{ items: { action: string }[] }>(
      'auditor',
      'get',
      `/api/audit/events?resourceId=${s.india}&limit=200`,
    );
    expect(zeroed.items.map((i) => i.action)).toContain('budget.set_to_zero');
    await auditor.context().close();

    // Utilization of the program by location and by team (nearest team or department), from the
    // ledger at the locked plan rate: the table matches the API row for row.
    const ceo = await pageAs(browser, 'ceo');
    for (const groupBy of ['location', 'department'] as const) {
      const report = await api<{
        currency: string;
        rows: { label: string; cells: Record<string, { money?: { amountMinor: number } }> }[];
        reconciliation: { ties: boolean };
      }>('ceo', 'get', `/api/reports/utilization/run?groupBy=${groupBy}&rootBudgetId=${s.root}`);
      expect(report.currency).toBe('USD');
      expect(report.reconciliation.ties).toBe(true);
      expect(report.rows.length).toBeGreaterThan(0);
      await ceo.goto(`/reports/utilization?groupBy=${groupBy}&rootBudgetId=${s.root}`);
      const table = ceo.getByRole('table', { name: 'Utilization' });
      for (const row of report.rows) {
        const r = table.getByRole('row', { name: new RegExp(row.label) }).first();
        await expect(r).toContainText(usdText(row.cells['authorized']!.money!.amountMinor));
        await expect(r).toContainText(usdText(row.cells['actual']!.money!.amountMinor));
      }
      await shot(ceo, `step-10-utilization-by-${groupBy}`);
    }
    const byLocation = await api<{
      rows: { label: string; cells: Record<string, { money?: { amountMinor: number } }> }[];
    }>('ceo', 'get', `/api/reports/utilization/run?groupBy=location&rootBudgetId=${s.root}`);
    expect(
      byLocation.rows.find((r) => r.label === 'Hyderabad')?.cells['authorized']?.money?.amountMinor,
    ).toBe(890_000);
    await ceo.context().close();

    // GL tie-out for India, December 2026. India's GL carries the full invoices on 6100 /
    // CC-IN-BLR-200 (on a fresh seed, exactly this scenario's INR 666,000.00, USD 8,000.00 at the
    // plan rate). BudgetFlow posts each actual pro rata on the funding budgets, so India's ledger
    // holds its 65% and the US and Europe shares sit on their own entities, to be recharged: the
    // difference is exactly the recharged 35%. The controller explains it; a finance admin signs off.
    const december: {
      sourceRef: string;
      transaction: { amountMinor: number };
      reporting: { amountMinor: number };
    }[] = [];
    for (let cursor: string | null = ''; cursor !== null; ) {
      const page: {
        items: {
          sourceRef: string;
          status: string;
          accountingDate: string;
          costCenterCode: string | null;
          glAccountCode: string | null;
          transaction: { amountMinor: number; currency: string };
          reporting: { amountMinor: number };
        }[];
        nextCursor: string | null;
      } = await api(
        'finance-controller',
        'get',
        `/api/actuals?status=all&legalEntityId=${SEED.legalEntities.acmeIndia}&currency=INR&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      december.push(
        ...page.items.filter(
          (i) =>
            i.status === 'matched' &&
            i.accountingDate.startsWith('2026-12') &&
            i.costCenterCode === 'CC-IN-BLR-200' &&
            i.glAccountCode === '6100',
        ),
      );
      cursor = page.nextCursor;
    }
    const refs = december.map((d) => d.sourceRef);
    for (const r of [`CARD-${s.tag}-1`, `EXP-${s.tag}-1`, `EXP-${s.tag}-2`])
      expect(refs).toContain(r);
    const glInr = december.reduce((t, d) => t + d.transaction.amountMinor, 0);
    const glUsd = december.reduce((t, d) => t + d.reporting.amountMinor, 0);
    const inr = (minor: number) => (minor / 100).toFixed(2);

    const fc = await pageAs(browser, 'finance-controller');
    await fc.goto('/finance/gl-tie-out');
    await pick(fc, 'Period', 'Dec 2026');
    await fc.getByRole('button', { name: 'Run tie-out' }).click();
    await fc.getByTestId('prep-entity').click();
    await fc.getByRole('option', { name: /HYL-IN/ }).click();
    await fc
      .getByTestId('csv-text')
      .fill(`cost_center,gl_account,amount,currency\nCC-IN-BLR-200,6100,${inr(glInr)},INR`);
    await fc.getByRole('button', { name: 'Compare with BudgetFlow' }).click();
    await expect(fc.getByTestId('tieout-notice')).toContainText('1 difference(s) above tolerance');
    await expect(fc.getByTestId('entity-chip-HYL-IN')).toContainText('1 difference');
    const row = fc.getByTestId('tieout-row-6100-CC-IN-BLR-200');
    await expect(row).toContainText(usdText(glUsd));
    await expect(row).toContainText(usdText((glUsd * 65) / 100));
    await fc.getByTestId('add-explanation').click();
    await fc
      .getByTestId('explanation')
      .fill('US and Europe shares of the summit are recharged to HYL-US and HYL-DE.');
    await fc.getByTestId('save-explanation').click();
    await expect(fc.getByTestId('tieout-notice')).toContainText('Explanation added.');
    await fc.context().close();

    const fa = await pageAs(browser, 'finance-admin');
    await fa.goto('/finance/gl-tie-out');
    await pick(fa, 'Period', 'Dec 2026');
    await fa.getByTestId('entity-chip-HYL-IN').click();
    await expect(fa.getByTestId('sign-off')).toHaveText(/Sign off Dec 2026 with explanations/);
    await fa.getByTestId('sign-off').click();
    await expect(fa.getByTestId('signed-off')).toContainText('Signed off by Priya Raman');
    await shot(fa, 'step-10-gl-tie-out-signed-off');
    await fa.context().close();
    const tie = await api<{
      items: {
        legalEntityCode: string;
        status: string;
        glTotal: { amountMinor: number };
        budgetflowTotal: { amountMinor: number };
        difference: { amountMinor: number };
      }[];
    }>('finance-controller', 'get', '/api/actuals/tie-outs?month=2026-12');
    const india = tie.items.find((t) => t.legalEntityCode === 'HYL-IN');
    expect(india).toMatchObject({
      status: 'signed_off',
      glTotal: { amountMinor: glUsd },
      budgetflowTotal: { amountMinor: (glUsd * 65) / 100 },
    });
    expect(Math.abs(india!.difference.amountMinor)).toBe((glUsd * 35) / 100);
  });
});
