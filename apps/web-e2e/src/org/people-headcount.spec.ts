// People directory and profile (screens 38-40), HR headcount and its CSV import (22c), the org CSV import
// (9, 42) and cost centers (41). Imports and new cost centers are dated in the future.
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';

const futureDate = () =>
  `${2100 + Math.floor(Math.random() * 700)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-01`;

test.describe('people', () => {
  test.describe('org admin', () => {
    test.use({ storageState: authFile('org-admin') });
    test('finds a person and opens their profile with reporting history', async ({ page }) => {
      await page.goto('/org/people');
      await expectShell(page);
      await page.getByTestId('people-search').fill('hoffmann');
      const row = page.getByRole('row', { name: /Lena Hoffmann/ });
      await expect(row).toBeVisible();
      await expect(row).toContainText('Berlin');
      await row.getByRole('link', { name: 'Lena Hoffmann' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Lena Hoffmann' })).toBeVisible();
      await expect(page.getByTestId('manager')).toHaveText('Lena Fischer');
      await expect(page.getByRole('table', { name: 'Reporting history' })).toContainText('Solid');
      await expect(page.getByRole('button', { name: 'Change manager' })).toBeVisible();
    });
  });

  test.describe('employee', () => {
    test.use({ storageState: authFile('employee') });
    test('sees colleagues in their own location only', async ({ page }) => {
      await page.goto('/org/people');
      await expect(page.getByText('You see people in your own location and team.')).toBeVisible();
      await expect(page.getByRole('row', { name: /Arjun Das/ })).toBeVisible();
      await expect(page.getByRole('row', { name: /Rohan Kulkarni/ })).toHaveCount(0);
      await page.getByRole('link', { name: 'Arjun Das' }).click();
      await expect(page.getByRole('button', { name: 'Change manager' })).toHaveCount(0);
    });
  });
});

test.describe('headcount', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('shows the latest HR snapshot by location and team with the change since the previous import', async ({
    page,
  }) => {
    await page.goto('/org/headcount');
    await expect(page.getByRole('heading', { level: 1, name: 'Headcount' })).toBeVisible();
    await expect(page.getByTestId('headcount-total')).toHaveText('460');
    await expect(page.getByTestId('hc-BLR')).toHaveText('140');
    await expect(page.getByRole('row', { name: /Bengaluru BLR/ })).toContainText('+10');
    await expect(page.getByTestId('hc-BLR-ENG-PLAT')).toHaveText('46');
  });

  test('validates an HR file, refuses bad lines, then imports a clean file', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const asOf = futureDate();
    await page.goto('/org/headcount');
    await page.getByRole('button', { name: 'Import HR file' }).click();
    await page.getByTestId('import-date').fill(asOf);
    await page
      .getByTestId('csv-text')
      .fill(
        'location_code,team_code,employment_type,headcount\nXXX,,employee,3\nHYD,,freelancer,2',
      );
    await page.getByRole('button', { name: 'Validate' }).click();
    const problems = page.getByRole('table', { name: 'Problems in the file' });
    await expect(problems.getByRole('row')).toHaveCount(3);
    await expect(problems).toContainText('"XXX" is not a location code.');
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await page
      .getByTestId('csv-text')
      .fill(
        'location_code,team_code,employment_type,headcount\nBLR,BLR-ENG-PLAT,employee,51\nHYD,HYD-ENG-QE,intern,9',
      );
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByText('Ready to import 60 people on 2 lines')).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText(`Imported 60 people on 2 lines as of ${asOf}.`)).toBeVisible();
    await expect(page.getByTestId('headcount-total')).toHaveText('60');
  });
});

test.describe('org import', () => {
  test.use({ storageState: authFile('org-admin') });
  test('plans and applies a hierarchy file from an effective date', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const t = randomUUID().slice(0, 6).toUpperCase();
    await page.goto('/org/import');
    await page.getByTestId('effective-from').fill(futureDate());
    await page
      .getByTestId('csv-text')
      .fill(
        `code,name,kind,parent_code\nJ-${t},Journey import ${t},department,LON\nJ-${t}-A,Journey import team ${t},team,J-${t}`,
      );
    await page.getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByText('Ready: 2 to create, 0 to change, 0 unchanged.')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Planned changes' }).getByRole('row')).toHaveCount(
      3,
    );
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText(/Imported: 2 created and 0 changed, effective/)).toBeVisible();
  });
});

test.describe('cost centers', () => {
  test.use({ storageState: authFile('finance-admin') });
  test('adds a cost center from a future date and deactivates it', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const t = randomUUID().slice(0, 6).toUpperCase();
    const from = futureDate();
    await page.goto('/org/cost-centers');
    await expect(page.getByRole('row', { name: /CC-IN-BLR-200/ })).toContainText('HYL-IN');
    await page.getByRole('button', { name: 'Add cost center' }).click();
    await page.getByLabel('Code').fill(`CC-J-${t}`);
    await page.getByLabel('Name').fill(`Journey cost center ${t}`);
    await page.getByRole('combobox', { name: 'Legal entity' }).click();
    await page.getByRole('option', { name: /HYL-UK/ }).click();
    await page.getByLabel('Effective from').fill(from);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Cost center CC-J-${t} is active from ${from}.`)).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(`CC-J-${t}`) });
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await page.getByLabel('Reason').fill('Journey cleanup');
    await page.getByLabel('Deactivate from').fill(`${Number(from.slice(0, 4)) + 1}-01-01`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText(`Cost center CC-J-${t} is inactive after ${from.slice(0, 4)}-12-31.`),
    ).toBeVisible();
  });
});
