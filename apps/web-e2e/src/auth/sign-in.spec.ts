// Sign-in journeys on the real Keycloak pages (screen 001) with fresh browser contexts: deep links survive
// sign-in, wrong passwords are refused, the SSO session is reused, and sign-out really ends the session.
import { expect, test } from '@playwright/test';
import { expectShell, submitSignIn } from '../support/auth';

test.describe('sign-in', () => {
  test('a deep link asks the user to sign in, then opens the page they asked for', async ({
    page,
  }) => {
    await page.goto('/audit-log');
    await expect(page.getByRole('complementary', { name: 'BudgetFlow' })).toContainText(
      'Budget delegation and control for Hyland',
    );
    await submitSignIn(page, 'auditor');
    await expectShell(page);
    await expect(page).toHaveURL(/\/audit-log$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    await expect(page).toHaveTitle('Audit log | BudgetFlow');
  });

  test('a wrong password is refused with a plain message and no session', async ({ page }) => {
    await page.goto('/');
    await submitSignIn(page, 'department-head', 'not-the-password');
    await expect(page.getByText('Invalid username or password.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in to BudgetFlow' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Platform Navigation' })).toHaveCount(0);
  });

  test('single sign-on: a new tab in the same browser opens without asking again', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await submitSignIn(page, 'analyst');
    await expectShell(page);
    const second = await context.newPage();
    await second.goto('/reports');
    await expectShell(second);
    await expect(second.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    await expect(second.getByRole('heading', { name: 'Sign in to BudgetFlow' })).toHaveCount(0);
  });

  test('sign-out ends the session; signing in again asks for credentials', async ({ page }) => {
    await page.goto('/');
    await submitSignIn(page, 'budget-owner');
    await expectShell(page);
    await page.getByRole('button', { name: 'Account menu for Jordan Smith' }).last().click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/signed-out$/);
    await expect(page.getByRole('heading', { name: 'You have signed out' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in again' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to BudgetFlow' })).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in to BudgetFlow' })).toBeVisible();
  });
});
