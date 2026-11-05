// GL tie-out journeys (80c): the seeded India tie-out shows one difference caused by an unmatched line and
// blocks sign-off; on a journey-made legal entity the controller prepares a tie-out from a general ledger
// file and explains the difference, and the finance admin signs the month off (the preparer cannot).
import { expect, request as pwRequest, test } from '@playwright/test';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { apiToken, expectShell } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile } from '../support/roles';

test.describe('GL tie-out', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('the seeded India tie-out shows the travel difference with its unmatched lines and blocks sign-off', async ({
    page,
  }) => {
    await page.goto('/finance/gl-tie-out');
    await expectShell(page);
    await expect(page.getByTestId('entity-chip-HYL-IN')).toContainText('1 difference');
    await expect(page.getByTestId('entity-chip-HYL-US')).toContainText('Tied');
    const row = page.getByTestId('tieout-row-6140-CC-IN-HYD-210');
    await expect(row).toContainText('Difference');
    await expect(row).toContainText('unmatched lines');
    await row.click();
    await expect(page.getByTestId('tieout-drill')).toContainText('ERP-2611-0004');
    await expect(page.getByTestId('sign-off')).toBeDisabled();
    await expect(page.getByTestId('signoff-blocked')).toHaveText('Sign-off needs a finance admin.');
  });

  test('a controller prepares and explains a tie-out; a finance admin signs the month off', async ({
    page,
    browser,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const code = `JT-${randomUUID().slice(0, 6).toUpperCase()}`;
    const api = await pwRequest.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: {
        authorization: `Bearer ${await apiToken('finance-admin')}`,
        'x-tenant-id': SEED.tenants.acme,
        'content-type': 'application/json',
      },
    });
    const post = async (path: string, data: unknown) => {
      const r = await api.post(path, { data, headers: { 'idempotency-key': randomUUID() } });
      expect(r.status(), await r.text()).toBe(201);
      return (await r.json()) as { id: string };
    };
    const entity = await post('/api/finance/legal-entities', {
      code,
      name: `Journey entity ${code}`,
      country: 'IN',
      functionalCurrency: 'INR',
      fiscalCalendarId: '21000000-0000-4000-8000-000000000001',
    });
    await post('/api/finance/gl-accounts', {
      legalEntityId: entity.id,
      code: '6100',
      name: 'Employee events',
      accountType: 'expense',
    });
    await post('/api/org/cost-centers', {
      code: `CC-${code}`,
      name: 'Journey office',
      legalEntityId: entity.id,
      effectiveFrom: '2026-01-01',
    });
    await api.dispose();

    await page.goto('/finance/gl-tie-out');
    await page.getByRole('button', { name: 'Run tie-out' }).click();
    await page.getByTestId('prep-entity').click();
    await page.getByRole('option', { name: new RegExp(code) }).click();
    await page
      .getByTestId('csv-text')
      .fill(['cost_center,gl_account,amount,currency', `CC-${code},6100,8325.00,INR`].join('\n'));
    await page.getByRole('button', { name: 'Compare with BudgetFlow' }).click();
    await expect(page.getByTestId('tieout-notice')).toContainText(
      '1 difference(s) above tolerance',
    );
    await expect(page.getByTestId(`entity-chip-${code}`)).toContainText('1 difference');
    await page.getByTestId('add-explanation').click();
    await page
      .getByTestId('explanation')
      .fill('Accrual booked in the ERP; the invoice arrives next month.');
    await page.getByTestId('save-explanation').click();
    await expect(page.getByTestId('tieout-notice')).toContainText('Explanation added.');

    const admin = await browser.newContext({ storageState: authFile('finance-admin') });
    const adminPage = await admin.newPage();
    await adminPage.goto('/finance/gl-tie-out');
    await adminPage.getByTestId(`entity-chip-${code}`).click();
    await expect(adminPage.getByTestId('sign-off')).toHaveText(
      /Sign off Nov 2026 with explanations/,
    );
    await adminPage.getByTestId('sign-off').click();
    await expect(adminPage.getByTestId('signed-off')).toContainText('Signed off by Priya Raman');
    await expect(adminPage.getByTestId(`entity-chip-${code}`)).toContainText('Signed off');
    await admin.close();
  });
});
