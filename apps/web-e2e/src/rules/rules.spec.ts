// Phase 7 journeys: Finance reads what the rules are doing, tests a request against them, sees why a
// conflicting draft cannot be published, settles a post-spend exception, and the CEO approves the
// approval-limit change Finance submitted. Each journey runs once, on desktop.
import { expect, test } from '@playwright/test';
import { authFile } from '../support/roles';
import { desktopOnly } from '../spend/api';

test.describe('rules and policies', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('Finance sees what the rules are doing and opens the one that needs attention', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));

    await page.goto('/admin/rules');
    await expect(page.getByRole('heading', { level: 1, name: 'Rules and policies' })).toBeVisible();
    await expect(page.getByText('Active rules')).toBeVisible();

    // The attention list names the draft that cannot be published yet.
    const attention = page.getByRole('region', { name: 'Needs attention' });
    await expect(attention).toContainText('conflict');

    await page.getByRole('link', { name: 'All rules' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'All rules' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'R-12' });
    await expect(row).toContainText('Conflicts with R-05');

    await row.getByRole('link', { name: 'R-12' }).click();
    await expect(page.getByText('This draft cannot be published yet')).toBeVisible();
    // The screen must not offer a publish button the API would refuse.
    await expect(page.getByRole('button', { name: 'Publish draft' })).toHaveCount(0);
  });

  test('Finance tests a request and sees which rule decided it and why', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));

    await page.goto('/admin/rules/simulate');
    await expect(page.getByRole('heading', { level: 1, name: 'Test a request' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Vendor' }).click();
    await page.getByRole('option', { name: 'Blocked' }).click();
    await page.getByRole('button', { name: 'See what would happen' }).click();

    const outcome = page.getByRole('region', { name: 'What would happen' });
    await expect(outcome).toContainText('This request would be blocked');
    await expect(outcome).toContainText('R-03');

    const matches = page.getByRole('region', { name: 'Rules that matched' });
    await expect(matches.getByRole('row').filter({ hasText: 'R-03' })).toContainText(
      'Decided the outcome',
    );
  });

  test('Finance settles a post-spend exception and it leaves the open queue', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));

    await page.goto('/admin/rules/exceptions');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Post-spend exceptions' }),
    ).toBeVisible();

    // One seeded exception, picked by its rule code rather than by position or by "whichever row
    // still offers Settle": the API scenarios settle the first open one, so a positional pick
    // would act on a different exception depending on what ran before.
    const queue = page.getByRole('region', { name: /exception/ });
    const subject = queue.getByRole('row').filter({ hasText: 'R-22' });
    await expect(subject).toContainText('Amelia Clarke');
    await subject.getByRole('button', { name: 'Settle' }).click();

    await page
      .getByRole('textbox', { name: 'Reason' })
      .fill('Agreed with the budget owner before the spend; the cap is revised next year.');
    await page.getByRole('button', { name: 'Settle this exception' }).click();

    await expect(page.getByText('The exception is settled')).toBeVisible();
    // It leaves the open tab, and settling it again is not offered.
    await expect(queue.getByRole('row').filter({ hasText: 'R-22' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Settle this exception' })).toHaveCount(0);
  });
});

test.describe('approval limits', () => {
  test.use({ storageState: authFile('ceo') });

  test('the CEO approves the approval-limit change Finance submitted', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));

    await page.goto('/admin/rules/doa');
    await expect(page.getByRole('heading', { level: 1, name: 'Approval limits' })).toBeVisible();
    await expect(page.getByText('Approvals in flight')).toBeVisible();

    // The seed leaves version 2 waiting for the CEO, so the approval is asserted outright rather
    // than only when a button happens to be there: a conditional would pass without approving.
    await page.getByRole('button', { name: 'Approve this version' }).click();
    await expect(page.getByText('Approved. The new limits apply')).toBeVisible();

    // A matrix is in force today: the screen never shows "None".
    const inForce = page.getByText('In force today');
    await expect(inForce).toBeVisible();
    await expect(page.locator('.bf-kpi').filter({ hasText: 'In force today' })).not.toContainText(
      'None',
    );
  });
});

test.describe('policy settings', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('every policy section shows its settings', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));

    const sections: [string, string][] = [
      ['limits', 'Spending limits'],
      ['categories', 'What can be bought'],
      ['gifts', 'Gifts, entertainment and alcohol'],
      ['locations', 'Location settings'],
      ['vendors', 'Vendors'],
      ['over-budget', 'Going over budget'],
      ['freeze', 'Freeze, reduce and set to zero'],
      ['sla', 'How long each step has'],
    ];
    for (const [key, heading] of sections) {
      await page.goto(`/admin/rules/policies/${key}`);
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
      // No stored code should reach the reader.
      await expect(page.locator('main')).not.toContainText('_');
    }
  });
});

test.describe('approval history', () => {
  test.use({ storageState: authFile('auditor') });

  test('an auditor reads every decision and narrows it to the rejections', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));

    await page.goto('/approvals/history');
    await expect(page.getByRole('heading', { level: 1, name: 'Approval history' })).toBeVisible();
    const summary = page.getByTestId('history-summary');
    await expect(summary).toContainText('Decisions');
    const rows = page.getByRole('row').filter({ hasText: 'REQ-' });
    const all = await rows.count();
    expect(all).toBeGreaterThan(0);

    await page.getByTestId('filter-decision').click();
    await page.getByRole('option', { name: 'Rejected' }).click();
    await expect.poll(() => rows.count()).toBeLessThan(all);
    for (const cell of await page.getByRole('row').filter({ hasText: 'REQ-' }).all()) {
      await expect(cell).toContainText('Rejected');
    }

    // A combination with nothing in it says so instead of showing an empty table.
    await page.getByTestId('filter-only').click();
    await page.getByRole('option', { name: 'Escalated first' }).click();
    await expect(page.getByTestId('history-empty')).toBeVisible();
  });
});
