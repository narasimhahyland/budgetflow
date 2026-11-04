// Smoke journey for the Phase 1 placeholder: the web app served by the stack loads with the Satori light
// theme, without console errors or failed requests. Phase 2 replaces it with sign-in and shell journeys.
import { expect, test } from '@playwright/test';

test('the web app loads with the Satori light theme and no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) =>
    errors.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`),
  );
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

  await page.goto('/');
  await expect(page).toHaveTitle('BudgetFlow');
  await expect(page.getByRole('heading', { level: 1, name: 'BudgetFlow' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Corporate budget delegation and control');

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
  await expect(page.getByRole('heading', { level: 1, name: 'BudgetFlow' })).toBeVisible();
});
