// Phase 17 traceability: the actuals event page (/finance/actuals/events/:eventId) had no journey.
// It is finance's view of an event's reconciliation. Closing is the organizer's act, on the event's
// own page: the close form here is offered only to someone who may manage the event (organizer,
// co-organizer, or an owner of its home budget with event.manage), and no finance role is one.
// So this proves two things from finance's side: the blocker behind "cannot close" is named, with
// the figure that causes it, and the page never offers finance a close it may not perform - it
// points to the organizers instead, whether or not the event is ready. Read-only.
import { expect, test } from '@playwright/test';
import { authFile } from '../support/roles';

// Seeded events, chosen by id rather than by whatever state they happen to be in.
const NYC_OFFSITE = '77000000-0000-4000-8000-000000000003'; // completed, one unmatched actual
const WELLBEING_WEEK = '78000000-0000-4000-8000-000000000020'; // completed, nothing outstanding

test.describe('finance sees why an event cannot close, and is not offered the close (actuals event page)', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('an event with an unmatched actual names that blocker and its count', async ({ page }) => {
    await page.goto(`/finance/actuals/events/${NYC_OFFSITE}`);
    await expect(
      page.getByRole('heading', { name: 'New York Team Offsite', level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId('event-unmatched')).toHaveText('1');
    await expect(page.getByTestId('blocker-EVENT_HAS_UNMATCHED_ACTUALS')).toContainText('(1)');
    // Gated on the right to manage the event, not on the data: finance gets the explanation only.
    await expect(page.getByTestId('close-organizer-note')).toContainText(
      "The event's organizers close it",
    );
    await expect(page.getByTestId('close-event')).toHaveCount(0);
  });

  test('an event with nothing blocking it shows no blocker, and still offers finance no close', async ({
    page,
  }) => {
    await page.goto(`/finance/actuals/events/${WELLBEING_WEEK}`);
    await expect(
      page.getByRole('heading', { name: 'Bengaluru wellbeing week 2026', level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId('event-unmatched')).toHaveText('0');
    await expect(page.locator('[data-testid^="blocker-"]')).toHaveCount(0);
    // Ready to close is not the same as allowed to close it.
    await expect(page.getByTestId('close-organizer-note')).toBeVisible();
    await expect(page.getByTestId('close-event')).toHaveCount(0);
  });
});
