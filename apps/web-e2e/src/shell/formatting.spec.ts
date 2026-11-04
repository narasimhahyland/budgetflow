// Money, number and date formatting (Phase 2): currency codes, Indian lakh/crore grouping for INR, the
// reporting-currency equivalent, and timestamps in the user's timezone. Numbers are cross-checked against
// the API's integer minor units, formatted here independently with Intl.
import { expect, test } from '@playwright/test';
import { SEED, type RoleId } from '@bf/seed';
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
  const res = await request.get(`${API_URL}/api/budgets`, {
    headers: { authorization: `Bearer ${await apiToken(role)}` },
  });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: Budget[] }).items;
}

test.describe('regional manager in Bengaluru', () => {
  test.use({ storageState: authFile('regional-manager') });

  test('INR amounts use lakh grouping with the USD equivalent; times show IST', async ({
    page,
    request,
  }, testInfo) => {
    const india = (await budgetsFor('regional-manager', request)).find(
      (b) => b.id === SEED.budgets.india,
    )!;
    expect(india.balances.available.currency).toBe('INR');
    await page.goto('/');
    const row = page.getByRole('row').filter({ hasText: 'India Region' });
    const inr = money(india.balances.available.amountMinor, 'INR');
    expect(inr).toMatch(/^INR \d{1,2},\d{2},\d{3}\.\d{2}$/);
    await expect(row).toContainText(inr);
    await expect(row).toContainText(money(india.balances.availableReporting.amountMinor, 'USD'));
    await expect(row).toContainText('GMT+5:30');
    await expect(page.getByText('Times are shown in Asia/Kolkata.')).toBeVisible();
    // The header chips give way to the page title on phones.
    if (testInfo.project.name !== 'mobile') {
      await expect(page.getByLabel('Reporting currency USD')).toBeVisible();
    }
  });
});

test.describe('finance controller in Berlin', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('USD and EUR use western grouping and times show the Berlin offset', async ({
    page,
    request,
  }, testInfo) => {
    const budgets = await budgetsFor('finance-controller', request);
    await page.goto('/');
    for (const id of [SEED.budgets.unitedStates, SEED.budgets.europe]) {
      const b = budgets.find((x) => x.id === id)!;
      const row = page.getByRole('row').filter({ hasText: b.name });
      await expect(row).toContainText(
        money(b.balances.available.amountMinor, b.balances.available.currency),
      );
    }
    await expect(page.getByText('Times are shown in Europe/Berlin.')).toBeVisible();
    if (testInfo.project.name !== 'mobile') {
      await expect(page.getByLabel('Fiscal year FY2026')).toBeVisible();
    }
  });
});
