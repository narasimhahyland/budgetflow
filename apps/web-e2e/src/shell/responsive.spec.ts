// Responsive shell: the navigation is a rail on desktop and tablet and a drawer behind the menu button on
// mobile; picking a page closes the expanded navigation.
import { expect, test } from '@playwright/test';
import { authFile } from '../support/roles';

test.use({ storageState: authFile('ceo') });

test('the navigation opens, navigates and closes on every viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  const opener =
    testInfo.project.name === 'mobile'
      ? page.getByRole('button', { name: 'Open navigation' })
      : page.getByRole('button', { name: 'Expand navigation' });
  await opener.click();
  const nav = page.getByRole('navigation', { name: 'Platform Navigation' });
  await expect(nav.getByText('Budgets', { exact: true })).toBeVisible();
  await nav.getByRole('menuitem', { name: 'Budget hierarchy' }).click();
  await expect(page).toHaveURL(/\/budgets$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Budget hierarchy' })).toBeVisible();
  await expect(nav.getByText('Budgets', { exact: true })).toHaveCount(0);
});
