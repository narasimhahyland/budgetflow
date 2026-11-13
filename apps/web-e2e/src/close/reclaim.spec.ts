// Reclaim and redistribute journeys (086a) on the seeded Q4 FY2026 campaign: finance reads every
// owner's answer, an owner past the deadline still answers from the phone-friendly notice (and the
// page shows the API's refusal when the amount is too high), and finance redistributes the HYL-US
// pool through the confirm dialog. One story in one test, because each step reads the one before.
import { expect, test } from '@playwright/test';
import { RECLAIM_IDS } from '@bf/seed';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';

const CAMPAIGN = `/finance/reclaim/${RECLAIM_IDS.campaign}`;

test.describe('reclaim campaign', () => {
  test('finance reads the answers, an owner releases part, and finance redistributes the pool', async ({
    browser,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const finance = await browser.newContext({ storageState: authFile('finance-admin') });
    const page = await finance.newPage();
    await page.goto('/finance/reclaim');
    await expectShell(page);
    await page.getByRole('link', { name: 'Q4 FY2026 reclaim' }).click();
    await expect(page).toHaveURL(new RegExp(`${CAMPAIGN}$`));
    const table = page.getByRole('table', { name: 'Owner responses' });
    await expect(table.getByRole('row', { name: /Bengaluru Events/ })).toContainText(
      'Released part',
    );
    await expect(table.getByRole('row', { name: /Berlin Events/ })).toContainText('Kept');
    await expect(table.getByRole('row', { name: /Berlin Events/ })).toContainText(
      'Committed winter party',
    );
    await expect(table.getByRole('row', { name: /New York Events/ })).toContainText('No response');
    await expect(page.getByTestId(`escalate-${RECLAIM_IDS.noticeNewYork}`)).toBeVisible();
    await expect(page.getByTestId('pool-HYL-US')).toHaveCount(0);

    // The owner of New York Events answers late, before finance escalated it.
    const ownerCtx = await browser.newContext({ storageState: authFile('budget-owner') });
    const owner = await ownerCtx.newPage();
    await owner.goto(`/reclaim/${RECLAIM_IDS.noticeNewYork}`);
    await expectShell(owner);
    await expect(
      owner.getByRole('heading', { name: 'Release unused money from New York Events' }),
    ).toBeVisible();
    await owner.getByRole('radio', { name: 'Release a different amount' }).check();
    await owner.getByTestId('release-amount').fill('999999');
    await owner.getByTestId('submit-reclaim').click();
    await expect(owner.getByRole('alert')).toContainText(
      'You can release at most the amount the campaign proposed.',
    );
    await owner.getByTestId('release-amount').fill('1600');
    await owner.getByTestId('keep-reason').fill('the holiday party');
    await owner.getByTestId('submit-reclaim').click();
    await expect(
      owner.getByText(/You released USD\s1,600\.00 from New York Events\./),
    ).toBeVisible();
    await expect(owner.getByRole('heading', { name: 'Answer' })).toBeVisible();
    await ownerCtx.close();

    // Finance sees the HYL-US pool and sends it back to the parent through the confirm dialog.
    await page.reload();
    const pool = page.getByTestId('pool-HYL-US');
    await expect(pool).toContainText(/USD\s1,600\.00/);
    await pool.getByTestId('review-HYL-US').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('table', { name: 'Moves' })).toContainText(
      'United States Region',
    );
    await expect(dialog).toContainText('Remainder to parent');
    const confirm = dialog.getByTestId('reclaim-confirm');
    await expect(confirm).toBeDisabled();
    await dialog.getByTestId('reclaim-reason').fill('Year-end reclaim of unused event money');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(
      page.getByText(
        /HYL-US redistributed: USD\s0\.00 to targets and USD\s1,600\.00 back to parents/,
      ),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Journals posted' })).toBeVisible();
    await expect(table.getByRole('row', { name: /New York Events/ })).toContainText(
      'Redistributed',
    );
    await finance.close();
  });
});
