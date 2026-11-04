// Org hierarchy journeys (screens 33-37): scope-based visibility per role and effective-dated changes
// made by the org admin. Scenario units are dated in the future, so today's tree stays as seeded.
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';

const tree = (page: Page) => page.getByRole('tree');
const unit = (page: Page, name: string) =>
  tree(page).getByRole('button', { name: new RegExp(`^${name}\\b`) });

test.describe('org admin', () => {
  test.use({ storageState: authFile('org-admin') });

  test('sees the whole Hyland hierarchy and a unit with manager, headcount and history', async ({
    page,
  }) => {
    await page.goto('/org');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Organization' })).toBeVisible();
    for (const name of [
      'Hyland',
      'India',
      'Bengaluru',
      'Hyderabad',
      'United States',
      'Westlake',
      'Europe',
      'London',
    ])
      await expect(unit(page, name)).toBeVisible();
    await unit(page, 'Bengaluru').click();
    const detail = page.getByRole('region', { name: 'Bengaluru' });
    await expect(detail.getByRole('definition').filter({ hasText: 'Rahul Menon' })).toBeVisible();
    await expect(detail.getByTestId('unit-headcount')).toContainText('140');
    await expect(detail.getByRole('table', { name: 'Unit history' })).toContainText('created');
    await expect(detail.getByRole('button', { name: 'Change unit' })).toBeVisible();
  });

  test('adds a unit from a future date and renames it later, keeping history', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const t = randomUUID().slice(0, 6).toUpperCase();
    const year = 2100 + Math.floor(Math.random() * 700);
    await page.goto('/org');
    await unit(page, 'Engineering Bengaluru').click();
    await page.getByRole('button', { name: 'Add unit below' }).click();
    const add = page.getByRole('form', { name: 'Add unit' });
    await add.getByLabel('Code').fill(`J-${t}`);
    await add.getByLabel('Name', { exact: true }).fill(`Journey team ${t}`);
    await add.getByLabel('Effective from').fill(`${year}-01-01`);
    await add.getByRole('button', { name: 'Add unit' }).click();
    await expect(
      page.getByText(`Journey team ${t} is part of Engineering Bengaluru from ${year}-01-01.`),
    ).toBeVisible();
    // Not in today's tree; visible as of its date.
    await expect(unit(page, `Journey team ${t}`)).toHaveCount(0);
    await page.getByTestId('as-of').fill(`${year}-02-01`);
    await unit(page, `Journey team ${t}`).click();
    await page.getByRole('button', { name: 'Change unit' }).click();
    const change = page.getByRole('form', { name: 'Change unit' });
    await change.getByLabel('Effective from').fill(`${year}-06-01`);
    await change.getByLabel('New name').fill(`Renamed journey team ${t}`);
    await change.getByLabel('Reason').fill('Team renamed');
    await change.getByRole('button', { name: 'Save change' }).click();
    await expect(
      page.getByText(/changes from .*Earlier dates keep the previous values/),
    ).toBeVisible();
    await page.getByTestId('as-of').fill(`${year}-06-01`);
    await unit(page, `Renamed journey team ${t}`).click();
    const history = page.getByRole('table', { name: 'Unit history' });
    await expect(history.getByRole('row')).toHaveCount(3);
    await expect(history).toContainText('renamed');
    await expect(history).toContainText('Team renamed');
  });

  test('a backdated change is refused with a plain-English reason', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto('/org');
    await unit(page, 'London').click();
    await page.getByRole('button', { name: 'Change unit' }).click();
    const change = page.getByRole('form', { name: 'Change unit' });
    await change.getByLabel('Effective from').fill('2025-06-01');
    await change.getByLabel('New name').fill('London backdated');
    await change.getByLabel('Reason').fill('Backdating check');
    await change.getByRole('button', { name: 'Save change' }).click();
    await expect(change.getByText(/already has a change effective 2026-01-01/)).toBeVisible();
  });
});

test.describe('scope', () => {
  test.describe('regional manager', () => {
    test.use({ storageState: authFile('regional-manager') });
    test('sees the India subtree only and cannot change it', async ({ page }) => {
      await page.goto('/org');
      await expect(
        page.getByText('You see the parts of the organization you are responsible for.'),
      ).toBeVisible();
      await expect(unit(page, 'India')).toBeVisible();
      await expect(unit(page, 'Hyderabad')).toBeVisible();
      for (const hidden of ['Hyland', 'United States', 'Europe'])
        await expect(unit(page, hidden)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Change unit' })).toHaveCount(0);
    });
  });

  test.describe('employee', () => {
    test.use({ storageState: authFile('employee') });
    test('sees only their own location and team', async ({ page }) => {
      await page.goto('/org');
      await expect(page.getByText('You see your own location and team.')).toBeVisible();
      await expect(tree(page).getByRole('treeitem')).toHaveCount(2);
      await expect(unit(page, 'Hyderabad')).toBeVisible();
      await expect(unit(page, 'Quality Engineering Team')).toBeVisible();
    });
  });

  test.describe('finance admin', () => {
    test.use({ storageState: authFile('finance-admin') });
    test('reads the whole org but has no change actions and cannot import', async ({ page }) => {
      await page.goto('/org');
      await expect(unit(page, 'Westlake')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Change unit' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Import org file' })).toHaveCount(0);
      await page.goto('/org/import');
      await expect(
        page.getByRole('heading', { name: 'You do not have access to this page' }),
      ).toBeVisible();
    });
  });
});
