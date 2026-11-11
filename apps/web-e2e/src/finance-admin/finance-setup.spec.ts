// Finance master-data journeys: legal entities (6, 102a), fiscal calendars and period statuses (7, 108,
// 108a), exchange rates with plan-vs-spot conversion and plan lock (107, 107a), GL mapping (106a), reason
// codes (106b), vendors (106c) and the DoA matrix (104a). Status changes run on a journey-made calendar.
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';

test.describe('fiscal calendars', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('shows the Hyland calendars, the UK 53-week year and ordered period actions', async ({
    page,
  }) => {
    await page.goto('/finance/periods');
    await expectShell(page);
    await expect(page.getByTestId('calendar-entities')).toContainText('HYL-DE, HYL-US');
    const periods = page.getByRole('table', { name: 'Accounting periods' });
    await expect(periods.getByRole('row', { name: /Oct 2026/ })).toContainText('Soft-closed');
    await expect(periods.getByRole('row', { name: /Nov 2026/ }).getByRole('button')).toHaveText([
      'Soft-close',
    ]);
    await expect(page.getByTestId('closing-hint')).toContainText(
      'Closing Oct 2026 blocks new postings',
    );
    await page.getByTestId('calendar-select').click();
    await page.getByRole('option', { name: /Hyland UK 4-4-5/ }).click();
    await page.getByRole('button', { name: 'FY2028', exact: true }).click();
    await expect(page.getByTestId('year-summary')).toContainText('53 weeks');
  });

  test('creates a 4-4-5 calendar with a live preview and closes, locks and reopens periods in order', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto('/finance/periods');
    await page.getByRole('button', { name: 'New calendar' }).click();
    const form = page.getByRole('region', { name: 'New fiscal calendar' });
    await form.getByLabel('Name').fill(`Journey 4-4-5 ${randomUUID().slice(0, 6)}`);
    await form.getByLabel('First fiscal year').fill('2028');
    await expect(page.getByTestId('calendar-preview')).toContainText('53 weeks');
    await expect(page.getByTestId('calendar-preview')).toContainText('4w · 4w · 5w');
    await page.getByRole('button', { name: 'Create calendar' }).click();
    await expect(page.getByText(/is ready with 2 fiscal year\(s\)/)).toBeVisible();
    await page.getByRole('button', { name: 'FY2028', exact: true }).click();
    const periods = page.getByRole('table', { name: 'Accounting periods' });
    const p1 = periods.getByRole('row', { name: /P01 FY2028/ });
    const p2 = periods.getByRole('row', { name: /P02 FY2028/ });
    await expect(p2.getByRole('button')).toHaveText(['Soft-close']);
    await p1.getByRole('button', { name: 'Close P01 FY2028', exact: true }).click();
    await expect(page.getByText('P01 FY2028 is now closed.')).toBeVisible();
    await p1.getByRole('button', { name: 'Lock P01 FY2028', exact: true }).click();
    await expect(p1).toContainText('Locked');
    await p1.getByRole('button', { name: 'Unlock P01 FY2028', exact: true }).click();
    await page.getByLabel(/Reason to unlock/).fill('Audit adjustment');
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(p1).toContainText('Closed');
    await p1.getByRole('button', { name: 'Reopen P01 FY2028', exact: true }).click();
    await page.getByLabel(/Reason to reopen/).fill('Late supplier invoice');
    await page.getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(p1).toContainText('Open');
  });
});

test.describe('exchange rates', () => {
  test.use({ storageState: authFile('analyst') });

  test('converts INR at the locked plan rate and at spot, showing the FX effect separately', async ({
    page,
  }) => {
    await page.goto('/finance/rates');
    await expect(page.getByRole('heading', { level: 1, name: 'Exchange rates' })).toBeVisible();
    await page.getByTestId('lookup-amount').fill('83250');
    await page.getByTestId('lookup-date').fill('2026-11-16');
    await page.getByTestId('lookup-type').click();
    await page.getByRole('option', { name: 'Spot' }).click();
    await expect(page.getByTestId('lookup-plan')).toContainText('USD 1,000.00');
    await expect(page.getByTestId('lookup-plan')).toContainText('FY2026, locked');
    await expect(page.getByTestId('lookup-other')).toContainText('USD 990.25');
    await expect(page.getByTestId('lookup-fx-effect')).toContainText('-USD 9.75');
    await page.getByTestId('lookup-type').click();
    await page.getByRole('option', { name: 'Month-end' }).click();
    await expect(page.getByTestId('lookup-other')).toContainText('No rate');
    await expect(page.getByTestId('plan-INR')).toContainText('83.2500 (locked)');
    await expect(page.getByTestId('plan-rate-state')).toContainText(
      'Locked plan rate active for FY2026',
    );
    await expect(page.getByRole('button', { name: 'Add rate' })).toHaveCount(0);
  });

  test.describe('finance admin', () => {
    test.use({ storageState: authFile('finance-admin') });
    test('adds a spot rate and sees which plan years are locked', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
      const year = 2100 + Math.floor(Math.random() * 700);
      await page.goto('/finance/rates');
      await expect(page.getByRole('region', { name: 'Plan-rate lock' })).toContainText(
        'FY2026 locked',
      );
      await page.getByRole('button', { name: 'Add rate' }).click();
      const add = page.getByRole('region', { name: 'Add rate' });
      await add.getByLabel(/Units per 1 USD/).fill('0.8123');
      await add.getByLabel('Effective date').fill(`${year}-03-15`);
      await page.getByRole('button', { name: 'Add rate', exact: true }).last().click();
      await expect(
        page.getByText(`Spot rate USD/INR 0.812300000000 from ${year}-03-15 added.`),
      ).toBeVisible();
    });
  });
});

test.describe('master data', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('legal entities, GL mapping, vendors and reason codes read correctly', async ({ page }) => {
    await page.goto('/finance/legal-entities');
    await expect(page.getByRole('row', { name: /Hyland Solutions UK Limited/ })).toContainText(
      'GBP',
    );
    await expect(page.getByRole('row', { name: /Hyland Technologies India/ })).toContainText(
      'Hyland India (Apr-Mar)',
    );
    await page.goto('/finance/gl');
    await page.getByTestId('gl-entity').click();
    await page.getByRole('option', { name: /HYL-DE/ }).click();
    const map = page.getByRole('table', { name: 'Category-to-GL mapping' });
    await expect(map.getByRole('row', { name: /^Wellbeing/ })).toContainText(
      '6110 Staff welfare and wellbeing',
    );
    await expect(map.getByRole('row', { name: /^Employee events/ })).toContainText(
      '6200 Client entertainment',
    );
    await page.goto('/finance/vendors');
    await page.getByTestId('vendor-search').fill('Metro');
    await expect(page.getByRole('row', { name: /Metro Party Rentals/ })).toContainText('Blocked');
    await page.goto('/finance/reason-codes');
    await expect(page.getByRole('row', { name: /FRZ-POLICY/ })).toContainText('Freeze');
  });

  test('adds and blocks a vendor, and adds and retires a reason code', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const t = randomUUID().slice(0, 6).toUpperCase();
    await page.goto('/finance/vendors');
    await page.getByRole('button', { name: 'Add vendor' }).click();
    await page
      .getByRole('region', { name: 'Add vendor' })
      .getByLabel('Name')
      .fill(`Journey Caterers ${t}`);
    await page.getByRole('button', { name: 'Add vendor', exact: true }).last().click();
    await expect(page.getByText(`Journey Caterers ${t} added as approved.`)).toBeVisible();
    await page.getByTestId('vendor-search').fill(t);
    await page
      .getByRole('row', { name: new RegExp(t) })
      .getByRole('button', { name: 'Change status' })
      .click();
    const change = page.getByRole('region', { name: 'Change vendor status' });
    await change.getByRole('combobox', { name: 'New status' }).click();
    await page.getByRole('option', { name: 'Blocked' }).click();
    await change.getByLabel('Reason').fill('Failed food safety review');
    await change.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Journey Caterers ${t} is now blocked.`)).toBeVisible();
    await page.goto('/finance/reason-codes');
    await page.getByRole('button', { name: 'Add reason code' }).click();
    const reasonForm = page.getByRole('region', { name: 'Add reason code' });
    await reasonForm.getByLabel('Code').fill(`J${t}`);
    await reasonForm.getByLabel('Label').fill(`Journey reason ${t}`);
    await reasonForm.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(`Reason code J${t} added.`)).toBeVisible();
    await page
      .getByRole('row', { name: new RegExp(`J${t}`) })
      .getByRole('button', { name: 'Retire' })
      .click();
    await expect(page.getByText(`J${t} is retired.`)).toBeVisible();
  });
});

test.describe('delegation of authority', () => {
  test.describe('finance controller', () => {
    test.use({ storageState: authFile('finance-controller') });
    test('checks a limit exactly at and one cent above the threshold', async ({ page }) => {
      await page.goto('/finance/doa');
      await expect(page.getByRole('table', { name: 'Matrix' })).toContainText('USD 250,000.00');
      await page.getByTestId('doa-entity').click();
      await page.getByRole('option', { name: 'HYL-IN' }).click();
      await page.getByTestId('doa-amount').fill('1000');
      await page.getByRole('button', { name: 'Check' }).click();
      await expect(page.getByTestId('doa-result')).toContainText('Within the limit.');
      await expect(page.getByTestId('doa-result')).toContainText('team_lunch');
      await page.getByTestId('doa-amount').fill('1000.01');
      await page.getByRole('button', { name: 'Check' }).click();
      await expect(page.getByTestId('doa-result')).toContainText(
        'Above the limit; the approval escalates.',
      );
    });
  });

  test.describe('employee', () => {
    test.use({ storageState: authFile('employee') });
    test('cannot open the DoA matrix', async ({ page }) => {
      await page.goto('/finance/doa');
      await expect(
        page.getByRole('heading', { name: 'You do not have access to this page' }),
      ).toBeVisible();
    });
  });
});
