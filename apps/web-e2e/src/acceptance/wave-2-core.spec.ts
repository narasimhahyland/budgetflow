// Wave 2 core acceptance (P4 budgets + P5 events/co-funding/DoA + P6 actuals/GL): ten-step story
// exercised as named tests. Read-only steps run on every viewport; mutating steps run once on desktop
// and create their own data through the API (the seeded tree stays untouched).
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
      await expect(board).toContainText(usdText(90_000));

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
const minor = (text: string) => Math.round(Number(text.replace(/[^0-9.-]/g, '')) * 100);

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

  test.beforeEach(({}, info) => {
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
    const root = await balances(s.root);
    expect(root.balances.budgetCurrency.authorized).toEqual({
      amountMinor: 10_000_000,
      currency: 'USD',
    });

    // INR and EUR plan rates for FY2026 are locked (the seed locks them at plan approval).
    await ceo.goto('/finance/rates');
    await expect(ceo.getByTestId('plan-INR')).toContainText('83.2500 (locked)');
    await expect(ceo.getByTestId('plan-EUR')).toContainText('0.9200 (locked)');
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
    await rm.context().close();
  });

  test('Step 6 — contributions in full, in part and declined; UK blocked, US and Europe recharged', async ({
    browser,
  }) => {
    const rm = await pageAs(browser, 'regional-manager');
    await rm.goto(`/events/${s.eventId}`);
    const ask = async (budgetName: string, usdAmount: string) => {
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
    const ukOption = await ask(`United Kingdom ${s.tag}`, '1000');
    await expect(ukOption).toContainText('Blocked by the intercompany policy.');
    await expect(ukOption).toHaveAttribute('aria-disabled', 'true');
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
      const opt = await ask(budgetName, usdAmount);
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
    const india = await balances(s.india);
    expect(india.balances.budgetCurrency.encumbered.amountMinor).toBeGreaterThan(0);
    await rm.context().close();
  });
});
