// Money, number and date formatting (Phase 2): currency codes, Indian lakh/crore grouping for INR (budgets
// are held in USD from Phase 4) and timestamps in the user's timezone. Numbers are cross-checked against
// the API's integer minor units, formatted here independently with Intl.
import { expect, test } from '@playwright/test';
import { SEED, type RoleId } from '@bf/seed';
import { allocate, createChild, createRoot, getBudget } from '../budgets/api';
import { apiToken } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile } from '../support/roles';

interface Budget {
  id: string;
  name: string;
  balances: {
    available: { amountMinor: number; currency: string };
    availableReporting: { amountMinor: number; currency: string };
  };
}

const money = (minor: number, currency: string) =>
  `${currency} ${new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)}`;

async function budgetsFor(role: RoleId, request: import('@playwright/test').APIRequestContext) {
  // Scenario budgets pile up between resets; the code filter keeps the seeded tree in one page.
  const res = await request.get(`${API_URL}/api/budgets?q=EX-&limit=200`, {
    headers: { authorization: `Bearer ${await apiToken(role)}` },
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: Budget[] }).items;
}

test.describe('regional manager in Bengaluru', () => {
  test.use({ storageState: authFile('regional-manager') });

  test('India is held in USD with western grouping; times show IST', async ({
    page,
    request,
  }, testInfo) => {
    const india = (await budgetsFor('regional-manager', request)).find(
      (b) => b.id === SEED.budgets.india,
    )!;
    expect(india.balances.available.currency).toBe('USD');
    await page.goto('/');
    const row = page.getByRole('row').filter({ hasText: 'India Region' });
    await expect(row).toContainText(money(india.balances.available.amountMinor, 'USD'));
    await expect(row).toContainText('GMT+5:30');
    await expect(page.getByText('Times are shown in Asia/Kolkata.')).toBeVisible();
    // The header chips give way to the page title on phones.
    if (testInfo.project.name !== 'mobile') {
      await expect(page.getByLabel('Reporting currency USD')).toBeVisible();
    }
  });

  // Budgets are held in USD; an INR amount (still possible for local-currency budgets) keeps lakh grouping.
  test('an INR amount uses lakh grouping', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'creates scenario data once, on desktop');
    const root = await createRoot({ amountMinor: 500_000, owner: 'regional-manager' });
    const inr = await createChild(root.id, {
      name: 'INR formatting check',
      currency: 'INR',
      as: 'regional-manager',
    });
    await allocate(root.id, inr.id, 200_000, 'regional-manager');
    await page.goto(`/budgets/${inr.id}`);
    const amount = money(
      (await getBudget(inr.id)).balances.budgetCurrency.authorized.amountMinor,
      'INR',
    );
    expect(amount).toBe('INR 1,66,500.00');
    await expect(page.getByTestId('kpi-available')).toContainText(amount);
  });
});

// The US and Europe owners' budgets are never touched by API scenarios, so their Home lists stay fixed.
const WESTERN: { role: RoleId; budget: string; timezone: string; offset: RegExp }[] = [
  {
    role: 'department-head',
    budget: SEED.budgets.europe,
    timezone: 'Europe/Berlin',
    offset: /GMT\+1\b/,
  },
  {
    role: 'budget-owner',
    budget: SEED.budgets.unitedStates,
    timezone: 'America/New_York',
    offset: /\bEST\b/,
  },
];

for (const w of WESTERN) {
  test.describe(`${w.role} in ${w.timezone}`, () => {
    test.use({ storageState: authFile(w.role) });

    test('amounts use western grouping and times show the local offset', async ({
      page,
      request,
    }, testInfo) => {
      const b = (await budgetsFor(w.role, request)).find((x) => x.id === w.budget)!;
      await page.goto('/');
      const row = page.getByRole('row').filter({ hasText: b.name });
      await expect(row).toContainText(
        money(b.balances.available.amountMinor, b.balances.available.currency),
      );
      if (b.balances.available.currency !== 'USD') {
        await expect(row).toContainText(money(b.balances.availableReporting.amountMinor, 'USD'));
      }
      await expect(page.getByText(`Times are shown in ${w.timezone}.`)).toBeVisible();
      if (testInfo.project.name !== 'mobile') {
        await expect(row).toContainText(w.offset);
        await expect(page.getByLabel('Fiscal year FY2026')).toBeVisible();
      }
    });
  });
}
