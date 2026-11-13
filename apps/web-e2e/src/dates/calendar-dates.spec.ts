// Calendar dates (ISO `YYYY-MM-DD`: period starts and ends, fiscal years) read the same in every browser
// timezone. Angular's date pipe parses a date-only string as local midnight, so formatting it in UTC
// moved it a day back east of UTC (1 Nov 2026 read "31 Oct" in India) and a month back on 1 January.
// The rest of the suite runs in UTC, where that bug cannot show, so these journeys pin other zones:
// Asia/Kolkata (east of UTC, where the old rendering was wrong) and America/New_York (west).
import { expect, test } from '@playwright/test';
import { periodId, CALENDAR_INDEX } from '@bf/seed';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';

const NOVEMBER = periodId(CALENDAR_INDEX.acmeGroup, 2026, 11);

/** `Date#getTimezoneOffset` in November 2026: minutes to add to local time to reach UTC. */
const OFFSET_MINUTES: Record<string, number> = { 'Asia/Kolkata': -330, 'America/New_York': 300 };

for (const timezoneId of Object.keys(OFFSET_MINUTES)) {
  test.describe(`calendar dates in ${timezoneId}`, () => {
    test.use({ storageState: authFile('finance-controller'), timezoneId });

    test('the browser really runs in that timezone', async ({ page }) => {
      await page.goto('/');
      await expectShell(page);
      // The UTC offset on the seed's frozen day, not the zone name (Chromium reports Asia/Calcutta).
      const offset = await page.evaluate(() =>
        new Date('2026-11-16T12:00:00Z').getTimezoneOffset(),
      );
      expect(offset).toBe(OFFSET_MINUTES[timezoneId]);
    });

    test('the November period reads 1 Nov to 30 Nov 2026', async ({ page }) => {
      await page.goto(`/finance/close/${NOVEMBER}`);
      await expectShell(page);
      await expect(page.getByRole('heading', { name: 'Nov 2026' })).toBeVisible();
      await expect(page.getByText(/1 Nov\s+–\s+30 Nov 2026/)).toBeVisible();

      await page.goto('/finance/close');
      await expectShell(page);
      // Oct 2026's row also names "Nov 2026" (its target close is 4 Nov), so anchor on the label.
      const row = page.getByRole('row', { name: /^Nov 2026/ });
      await expect(row).toContainText(/1 Nov\s+–\s+30 Nov 2026/);
    });

    test('the calendar year runs from 1 Jan to 31 Dec 2026', async ({ page }) => {
      await page.goto('/finance/periods');
      await expectShell(page);
      await expect(page.getByTestId('year-summary')).toContainText(
        'runs 1 Jan 2026 to 31 Dec 2026',
      );
      await expect(page.getByText(/Jan 2026\s+–\s+Dec 2026/)).toBeVisible();
      const periods = page.getByRole('table', { name: 'Accounting periods' });
      await expect(periods.getByRole('row', { name: /Nov 2026/ })).toContainText('1 Nov 2026');
      await expect(periods.getByRole('row', { name: /Nov 2026/ })).toContainText('30 Nov 2026');
    });
  });
}
