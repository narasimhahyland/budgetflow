// Single sign-on through the company identity provider (screen 002): "Hyland SSO" on the BudgetFlow
// sign-in page brokers to the IdP (a local Keycloak realm stand-in) and returns as the linked user.
import { expect, test } from '@playwright/test';
import { userById } from '@bf/seed';
import { expectShell, password } from '../support/auth';

test('signing in with Hyland SSO lands in BudgetFlow as the linked employee', async ({ page }) => {
  const employee = userById('employee');
  await page.goto('/');
  await page.getByRole('link', { name: 'Hyland SSO' }).click();

  await expect(page).toHaveURL(/\/realms\/hyland-sso\//);
  await page.getByLabel(/username or email/i).fill(employee.username);
  await page.getByLabel('Password', { exact: true }).fill(password());
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expectShell(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Arjun' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Platform Navigation' });
  await expect(nav.getByRole('menuitem')).toHaveText(['Home', 'Request funds', 'My requests']);
});
