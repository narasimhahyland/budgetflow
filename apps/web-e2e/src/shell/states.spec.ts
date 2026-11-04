// Guards and shell states (screen 000a): forbidden in place with the URL kept, not found, placeholder for
// later areas, server error with retry, ended session, account without membership, platform operator.
import { expect, test } from '@playwright/test';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';

test.describe('employee', () => {
  test.use({ storageState: authFile('employee') });

  test('a page outside the role shows the forbidden state and keeps the URL', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(
      page.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
    await expect(page.getByText('Audit log is not part of your role in BudgetFlow')).toBeVisible();
    await expect(page).toHaveURL(/\/audit-log$/);
    await page.getByRole('link', { name: 'Go to Home' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Arjun' })).toBeVisible();
  });

  test('an unknown address shows page not found inside the shell', async ({ page }) => {
    await page.goto('/no-such-page');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('home explains what the role will see without budget access', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Nothing to show here yet' })).toBeVisible();
  });
});

test.describe('finance controller', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('an allowed area that opens later shows its placeholder', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Audit log is not open yet' })).toBeVisible();
  });

  test('a server error shows the error state and recovers on retry', async ({ page }) => {
    let fail = true;
    await page.route('**/api/me', (route) =>
      fail
        ? route.fulfill({
            status: 500,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'about:blank',
              title: 'Internal error',
              status: 500,
              code: 'INTERNAL_ERROR',
              detail: 'Something went wrong.',
            }),
          })
        : route.continue(),
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Daniel' })).toBeVisible();
  });

  test('a rejected token ends the session and offers to sign in again', async ({ page }) => {
    await page.route('**/api/budgets*', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Unauthenticated',
          status: 401,
          code: 'UNAUTHENTICATED',
          detail: 'Your session is not valid. Sign in again.',
        }),
      }),
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your session has ended' })).toBeVisible();
    await page.unroute('**/api/budgets*');
    await page.getByRole('button', { name: 'Sign in again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Daniel' })).toBeVisible();
  });

  test('an account without a BudgetFlow membership gets a clear dead end', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Forbidden',
          status: 403,
          code: 'TENANT_NOT_MEMBER',
          detail: 'Your account does not belong to any BudgetFlow tenant.',
        }),
      }),
    );
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Your account is not set up in BudgetFlow' }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Platform Navigation' })).toHaveCount(0);
  });
});

test.describe('super admin', () => {
  test.use({ storageState: authFile('super-admin') });

  test('a platform operator sees no tenant financial data', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('You are signed in as a platform operator.')).toBeVisible();
    await page.goto('/budgets');
    await expect(
      page.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
  });
});
