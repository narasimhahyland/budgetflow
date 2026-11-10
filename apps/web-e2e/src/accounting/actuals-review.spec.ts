// Phase 17 traceability: the matched-actuals page (/finance/actuals/matched) and the mapping-rules
// page (/finance/actuals/rules) had no journey. Both show finance data to more roles than may change
// it, so both are proved the same way: a role that reads actuals sees the data and is offered no
// change; a role that manages actuals is offered exactly the changes it may make.
//
// Undoing a match posts a reversal - corrections are reversals, never edits - so a reversal line is
// itself never offered an undo. The assertions hold whatever lines other journeys have matched by the
// time this runs: they count actions against rows rather than pinning a row.
import { expect, test } from '@playwright/test';
import { authFile } from '../support/roles';

const SEEDED_RULE = 'Hyderabad ground transport to Hack Week';

test.describe('matched actuals: everyone who reads them sees them, only finance may undo a match', () => {
  test.describe('as the Auditor (reads actuals, cannot change them)', () => {
    test.use({ storageState: authFile('auditor') });

    test('sees the matched lines and is offered no undo', async ({ page }) => {
      await page.goto('/finance/actuals/matched');
      await expect(page.getByRole('heading', { name: 'Matched actuals', level: 1 })).toBeVisible();
      const rows = page.getByRole('table', { name: 'Matched actuals' }).getByRole('row');
      await expect(rows.nth(1), 'the seed matches lines, so the list is not empty').toBeVisible();
      await expect(page.getByRole('button', { name: /^(Undo|Reverse) match$/ })).toHaveCount(0);
    });
  });

  test.describe('as the Finance Controller (manages actuals)', () => {
    test.use({ storageState: authFile('finance-controller') });

    test('is offered an undo on every matched line that is not itself a reversal', async ({
      page,
    }) => {
      await page.goto('/finance/actuals/matched');
      const table = page.getByRole('table', { name: 'Matched actuals' });
      await expect(table.getByRole('row').nth(1)).toBeVisible();
      const dataRows = await table.getByRole('row').count();
      const reversals = await table
        .getByRole('row')
        .filter({ hasText: /reversal/i })
        .count();
      await expect(page.getByRole('button', { name: 'Undo match' })).toHaveCount(
        dataRows - 1 - reversals,
      );
    });
  });
});

test.describe('mapping rules: readers see the rules, only finance may add one', () => {
  test.describe('as the Auditor', () => {
    test.use({ storageState: authFile('auditor') });

    test('sees the seeded rule and no way to add one', async ({ page }) => {
      await page.goto('/finance/actuals/rules');
      await expect(page.getByRole('heading', { name: 'Mapping rules', level: 1 })).toBeVisible();
      await expect(page.getByText(SEEDED_RULE)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(0);
    });
  });

  test.describe('as the Finance Controller', () => {
    test.use({ storageState: authFile('finance-controller') });

    test('sees the seeded rule and can open the form to add one', async ({ page }) => {
      await page.goto('/finance/actuals/rules');
      await expect(page.getByText(SEEDED_RULE)).toBeVisible();
      await page.getByRole('button', { name: 'Add rule' }).click();
      await expect(page.getByRole('heading', { name: 'Add mapping rule' })).toBeVisible();
    });
  });
});
