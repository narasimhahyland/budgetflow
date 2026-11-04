// Phase 4 budget journeys: hierarchy and details per role, allocation (dialog and grid with paste),
// freeze, reduce and set to zero with their impact previews, an increase request decided by the parent
// owner, the per-head driver, and plan import. Mutating journeys run once, on desktop, on budgets they
// create through the API; read-only journeys run on every viewport against the seeded tree.
import { expect, test, type Page } from '@playwright/test';
import { SEED, P4_BUDGETS } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { allocate, createChild, createRoot, getBudget } from './api';

const usd = (minor: number) =>
  `USD ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
const dialog = (page: Page) => page.getByRole('dialog');
const desktopOnly = (name: string) =>
  test.skip(name !== 'desktop', 'mutating journey runs once, on desktop');

test.describe('regional manager (India)', () => {
  test.use({ storageState: authFile('regional-manager') });

  test('sees the India tree, the per-head budget and Available under its rules', async ({
    page,
  }) => {
    await page.goto(`/budgets?root=${SEED.budgets.india}&budget=${SEED.budgets.hyderabad}`);
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Budget hierarchy' })).toBeVisible();
    await expect(page.getByTestId('tree-row-EX-IN')).toBeVisible();
    await expect(page.getByTestId('tree-row-EX-IN-BLR')).toBeVisible();
    const panel = page.getByTestId('detail-panel');
    await expect(panel.getByRole('heading', { name: 'Hyderabad Events' })).toBeVisible();
    await expect(panel).toContainText('per head');
    await expect(panel.getByTestId('available-under-rules')).toContainText('USD');
    await panel.getByRole('button', { name: 'How Available is calculated' }).click();
    await expect(page.getByText('Company-wide (dashboards):')).toBeVisible();
  });

  test('Bengaluru shows its figures, limits and the pending increase request', async ({ page }) => {
    await page.goto(`/budgets/${SEED.budgets.bengaluru}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Bengaluru Events' })).toBeVisible();
    await expect(page.getByTestId('kpi-available')).toContainText('USD');
    await page.getByTestId('tab-limits').click();
    await expect(page.getByTestId('limit-0')).toBeVisible();
    await page.getByTestId('tab-requests').click();
    await expect(page.getByTestId('request-Bengaluru Events')).toContainText('USD 2,000.00');
    await page.getByTestId('tab-versions').click();
    await expect(page.getByTestId('version-compare')).toBeVisible();
  });

  test('the allocation workspace blocks a grid that exceeds India', async ({ page }) => {
    await page.goto(`/budgets/allocate?parent=${SEED.budgets.india}`);
    await expect(page.getByTestId('grid-row-0')).toBeVisible();
    await page.locator('input[data-col=next]').first().fill('99000');
    await expect(page.getByTestId('grid-blocked')).toBeVisible();
    await expect(page.getByTestId('submit-grid')).toBeDisabled();
  });
});

test.describe('department head (Europe)', () => {
  test.use({ storageState: authFile('department-head') });

  test('lists the Europe budgets with the zeroed one under its own tab', async ({ page }) => {
    await page.goto('/budgets/list');
    await expect(page.getByTestId('row-EX-EU')).toBeVisible();
    await expect(page.getByTestId('row-EX-EU-BER')).toBeVisible();
    await page.getByRole('tab', { name: /Set to zero/ }).click();
    await expect(page.getByTestId('row-EX-EU-WELL')).toBeVisible();
    await expect(page.getByTestId('row-EX-EU-BER')).toHaveCount(0);
  });
});

test.describe('finance admin controls a program', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('allocates, freezes, reduces within the floor and sets a budget to zero', async ({
    page,
  }, info) => {
    desktopOnly(info.project.name);
    const root = await createRoot({ amountMinor: 1_000_000 });
    const team = await createChild(root.id, { name: `Team A ${randomUUID().slice(0, 4)}` });
    const other = await createChild(root.id, {
      name: `Team B ${randomUUID().slice(0, 4)}`,
      code: `TB-${randomUUID().slice(0, 4)}`,
    });
    await allocate(root.id, other.id, 300_000);

    await page.goto(`/budgets/${root.id}?tab=children`);
    await page
      .getByRole('row', { name: new RegExp(team.name) })
      .getByRole('button', { name: 'Allocate' })
      .click();
    await expect(dialog(page).getByTestId('child-select')).toContainText(team.name);
    await dialog(page).getByTestId('allocate-amount').fill('20000');
    await expect(dialog(page).getByTestId('over-allocation')).toBeVisible();
    await dialog(page).getByTestId('allocate-amount').fill('2500');
    await dialog(page).getByTestId('confirm-allocate').click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await getBudget(team.id)).balances.budgetCurrency.authorized.amountMinor).toBe(250_000);

    await page.goto(`/budgets/${team.id}`);
    await page.getByTestId('more-actions').click();
    await page.getByTestId('freeze').click();
    await dialog(page).getByRole('combobox', { name: 'Reason code' }).click();
    await page.getByRole('option').first().click();
    await dialog(page).getByLabel('Reason and internal note').fill('Quarterly review');
    await dialog(page).getByTestId('confirm-freeze').click();
    await expect(page.getByTestId('frozen-banner')).toBeVisible();

    await page.goto(`/budgets/${other.id}`);
    await page.getByTestId('reduce').click();
    await dialog(page).getByTestId('reduce-amount').fill('3500');
    await expect(dialog(page).getByTestId('reduce-problem')).toContainText('cannot go below');
    await dialog(page).getByTestId('reduce-amount').fill('500');
    await dialog(page).getByTestId('reason-code').click();
    await page.getByRole('option', { name: /RED-COST-SAVING/ }).click();
    await dialog(page).getByLabel('Reason', { exact: true }).fill('Cost-saving program');
    await expect(dialog(page).getByTestId('confirm-reduce')).toBeEnabled();
    await dialog(page).getByTestId('confirm-reduce').click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId('kpi-available')).toContainText(usd(250_000));

    await page.getByTestId('set-to-zero').click();
    await expect(dialog(page).getByTestId('zero-cut')).toContainText(usd(250_000));
    await dialog(page).getByTestId('reason-code').click();
    await page.getByRole('option', { name: /RED-REPRIORITIZE/ }).click();
    await dialog(page).getByLabel('Reason', { exact: true }).fill('Team merged');
    await expect(dialog(page).getByTestId('confirm-zero')).toBeDisabled();
    await dialog(page).getByTestId('confirm-text').fill(other.code!);
    await dialog(page).getByTestId('confirm-zero').click();
    await expect(page.getByTestId('zero-banner')).toBeVisible();
    expect((await getBudget(other.id)).balances.budgetCurrency.authorized.amountMinor).toBe(0);
  });

  test('pastes allocations from Excel into the grid and submits them as one change', async ({
    page,
  }, info) => {
    desktopOnly(info.project.name);
    const root = await createRoot({ amountMinor: 500_000 });
    const a = await createChild(root.id, { name: `Grid A ${randomUUID().slice(0, 4)}` });
    await page.goto(`/budgets/allocate?parent=${root.id}`);
    await expect(page.getByTestId('grid-row-0')).toBeVisible();
    await page.getByText('Paste rows as text instead').click();
    await page.getByTestId('paste-text').fill(`${a.name}\t1500\nGrid new team\t700`);
    await page.getByTestId('apply-paste').click();
    await expect(page.getByTestId('paste-banner')).toContainText('Pasted 2 row(s)');
    await expect(page.getByTestId('total-change')).toContainText(usd(220_000));
    await expect(page.getByTestId('submit-grid')).toBeEnabled();
    await page.getByTestId('submit-grid').click();
    await expect(page.getByTestId('grid-done')).toContainText('Posted 2 allocation(s)');
    expect((await getBudget(a.id)).balances.budgetCurrency.authorized.amountMinor).toBe(150_000);
  });

  test('validates a plan spreadsheet with column mapping', async ({ page }) => {
    await page.goto('/budgets/plans');
    await expect(page.getByTestId('tie-out')).toBeVisible();
    await page.getByTestId('import-plan').click();
    await page
      .getByTestId('import-csv')
      .fill(
        'Program code,Program,Budget (USD)\nJRN-1,Journey program,"1,000.00"\nJRN-2,Broken,abc',
      );
    await page.getByTestId('validate-import').click();
    await expect(page.getByTestId('import-rows')).toContainText('is not a positive amount');
    await expect(page.getByTestId('create-version')).toBeDisabled();
  });
});

test.describe('increase request', () => {
  test('the location manager asks; the regional manager approves part of it', async ({
    browser,
  }, info) => {
    desktopOnly(info.project.name);
    const root = await createRoot({ amountMinor: 400_000, owner: 'regional-manager' });
    const child = await createChild(root.id, {
      name: `Diwali ${randomUUID().slice(0, 4)}`,
      owner: 'location-manager',
      as: 'regional-manager',
    });
    await allocate(root.id, child.id, 100_000, 'regional-manager');

    const lm = await browser.newContext({ storageState: authFile('location-manager') });
    const p1 = await lm.newPage();
    await p1.goto(`/budgets/${child.id}`);
    await p1.getByTestId('request-increase').click();
    await p1.getByRole('dialog').getByTestId('increase-target').fill('1500');
    await p1
      .getByRole('dialog')
      .getByLabel('Reason and business justification')
      .fill('Attendance doubled');
    await p1.getByRole('dialog').getByTestId('confirm-increase').click();
    await expect(p1.getByText('Increase request sent')).toBeVisible();
    await lm.close();

    const rm = await browser.newContext({ storageState: authFile('regional-manager') });
    const p2 = await rm.newPage();
    await p2.goto(`/budgets/${child.id}?tab=requests`);
    const panel = p2.getByTestId('request-panel');
    await expect(panel).toContainText(usd(50_000));
    await panel.getByTestId('approve-amount').fill('300');
    await panel.getByTestId('approve').click();
    await expect(panel).toContainText('Approved');
    await rm.close();
    expect((await getBudget(child.id)).balances.budgetCurrency.authorized.amountMinor).toBe(
      130_000,
    );
  });
});

test.describe('per-head driver', () => {
  test.use({ storageState: authFile('regional-manager') });

  test('allocates rate x eligible headcount from the HR import', async ({ page }, info) => {
    desktopOnly(info.project.name);
    const root = await createRoot({ amountMinor: 500_000, owner: 'regional-manager' });
    const hyd = await createChild(root.id, {
      name: `Per-head ${randomUUID().slice(0, 4)}`,
      orgUnitId: SEED.orgUnits.hyderabad,
      as: 'regional-manager',
    });
    await page.goto(`/budgets/${hyd.id}/per-head`);
    await expect(page.getByTestId('breakdown')).toContainText('contractor');
    await expect(page.getByTestId('target-amount')).toContainText('USD');
    await page.getByTestId('apply-per-head').click();
    await expect(page.getByTestId('per-head-done')).toBeVisible();
    expect(
      (await getBudget(hyd.id)).balances.budgetCurrency.authorized.amountMinor,
    ).toBeGreaterThan(0);
  });
});

test.describe('contingency reserve', () => {
  test.use({ storageState: authFile('ceo') });

  test('the CEO sees the pending release with its impact and decision panel', async ({ page }) => {
    await page.goto(`/budgets/${P4_BUDGETS.contingency}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Central Contingency Reserve' }),
    ).toBeVisible();
    await expect(page.getByTestId('request-panel')).toContainText('Europe Region');
    await expect(page.getByTestId('approve')).toBeVisible();
  });
});
