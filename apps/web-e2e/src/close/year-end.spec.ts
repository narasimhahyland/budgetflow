// Year-end journeys (87b, 87c): the dry run says plainly that nothing has been posted, the per-budget
// outcome comes from the server, and Execute stays disabled with the reason until the target year is
// ready — so nobody can commit the irreversible run by accident.
import { expect, test } from '@playwright/test';
import { P11_IDS } from '@bf/seed';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';

const RUN = `/finance/year-end/${P11_IDS.yearEndRunFy2026}`;

test.describe('year-end run', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('the FY2026 run opens from the list and offers no execution until it is ready', async ({
    page,
  }) => {
    await page.goto('/finance/year-end');
    await expectShell(page);
    await page.getByRole('link', { name: 'FY2026 → FY2027' }).click();
    await expect(page).toHaveURL(new RegExp(`${P11_IDS.yearEndRunFy2026}$`));
    await expect(page.getByRole('heading', { name: /Year end FY2026/ })).toBeVisible();
    await expect(page.getByTestId('execute-run')).toBeDisabled();
    await expect(page.getByTestId('run-not-ready')).toContainText('Execute is not available yet');
  });

  test('a dry run fills the per-budget outcome and execute stays refused with the reason', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto(RUN);
    await expectShell(page);
    await page.getByTestId('dry-run').click();

    await expect(page.getByTestId('dry-run-banner')).toContainText('nothing has been posted');
    await expect(page.getByTestId('run-notice')).toContainText('Nothing has been posted');
    const table = page.getByRole('table', { name: 'Year-end outcome per budget' });
    await expect(table.getByRole('row')).not.toHaveCount(1);
    await expect(table).toContainText('Bengaluru Events');
    await expect(table).toContainText('CARRY-25');

    // The target year has no counterpart budgets yet, so the server refuses to execute and the
    // screen repeats its reason and points at the roll-forward rather than enabling the button.
    await expect(page.getByTestId('run-not-ready')).toContainText('no counterpart in the target');
    await expect(page.getByTestId('execute-run')).toBeDisabled();
    await expect(
      page.getByRole('link', { name: 'Roll this year’s tree forward into the new year' }),
    ).toBeVisible();
  });
});

test.describe('rollover policies', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('every rollover mode is shown with what it does at year end', async ({ page }) => {
    await page.goto('/finance/rollover-policies');
    await expectShell(page);
    const table = page.getByRole('table', { name: 'Rollover policies' });
    await expect(table).toContainText('CARRY-25');
    await expect(table).toContainText('Up to 25% of authorized carries');
    await expect(table).toContainText('LAPSE-CORP');
    await expect(table).toContainText(
      'Nothing carries; everything unused returns to the corporate',
    );
  });

  test('a policy is assigned to a budget with a reason', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto('/finance/rollover-policies');
    await expectShell(page);
    await page.getByTestId('assign-budget').click();
    await page.getByRole('option', { name: 'Hyderabad Events', exact: true }).click();
    await page.getByTestId('assign-policy').click();
    await page.getByRole('option', { name: /CARRY-25/ }).click();
    await page.getByTestId('assign-reason').fill('Hyderabad moves to the capped carry for FY2026.');
    await page.getByTestId('confirm-assign').click();
    await expect(page.getByTestId('policy-notice')).toContainText(
      'Hyderabad Events now follows CARRY-25',
    );
  });
});

test.describe('year-end scope', () => {
  test.use({ storageState: authFile('analyst') });

  test('an analyst reads the run but is offered no dry run or execution', async ({ page }) => {
    await page.goto(RUN);
    await expectShell(page);
    await expect(page.getByRole('heading', { name: /Year end FY2026/ })).toBeVisible();
    await expect(page.getByTestId('dry-run')).toHaveCount(0);
    await expect(page.getByTestId('execute-run')).toHaveCount(0);
  });
});
