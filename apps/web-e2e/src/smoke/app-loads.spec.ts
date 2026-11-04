// Smoke journey: the signed-in shell loads with the Satori light theme, without console errors or failed
// requests, and unknown routes fall back to the app (single-page routing).
import { expect, test } from '@playwright/test';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';

test.use({ storageState: authFile('ceo') });

test('the shell loads with the Satori light theme and no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) =>
    errors.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`),
  );
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

  await page.goto('/');
  await expectShell(page);
  await expect(page).toHaveTitle('Home | BudgetFlow');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Morgan' })).toBeVisible();

  const theme = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { primary: s.getPropertyValue('--mat-sys-primary').trim(), scheme: s.colorScheme };
  });
  expect(theme.primary).not.toBe('');
  expect(theme.scheme).toBe('light');
  expect(errors).toEqual([]);
});

test('unknown routes fall back to the app (single-page routing)', async ({ page }) => {
  const res = await page.goto('/budgets/does-not-exist-yet');
  expect(res?.status()).toBe(200);
  await expectShell(page);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
