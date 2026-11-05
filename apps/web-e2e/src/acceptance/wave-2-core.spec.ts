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
import { expect, test, type Page } from '@playwright/test';
import { ACTUALS_EVENTS, SEED } from '@bf/seed';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { api, getBudget } from '../budgets/api';
import {
  approvedEvent,
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

    test('utilization by location matches the API totals in USD', async ({ page }) => {
      const report = await api<{
        currency: string;
        totals: { authorized: { amountMinor: number }; utilizationBps: number };
      }>('regional-manager', 'get', '/api/utilization?groupBy=location');

      await page.goto('/reports/utilization');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Budget utilization' }),
      ).toBeVisible();
      await expect(page.getByRole('table', { name: 'Utilization' })).toContainText('USD');
      await expect(page.getByRole('table', { name: 'Utilization' })).toContainText(
        usdText(report.totals.authorized.amountMinor),
      );
      expect(report.currency).toBe('USD');
      expect(report.totals.utilizationBps).toBeGreaterThanOrEqual(0);
    });
  });
});
