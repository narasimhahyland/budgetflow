// Phase 17 traceability: the all-events list (/events/all) had no journey. It groups events into the
// lifecycle stages, so this proves two things: every event a person may read sits under the stage its
// current status belongs to and nowhere else, and a person sees only the events they may read.
//
// Other journeys move events between stages while this one runs, so the expected grouping is taken
// from the API at the moment of the check rather than pinned to a stage.
import { expect, test, type Page } from '@playwright/test';
import type { SeedUserId } from '@bf/seed';
import { api } from '../budgets/api';
import { authFile } from '../support/roles';

// Mirrors the page's own grouping (libs/web/features/events/src/lib/events-list.page.ts).
const STAGES: { label: string; statuses: string[] }[] = [
  { label: 'Upcoming', statuses: ['submitted', 'approved', 'funded'] },
  { label: 'In progress', statuses: ['in_progress'] },
  { label: 'Reconciling', statuses: ['completed', 'reconciling'] },
  { label: 'Closed', statuses: ['closed', 'cancelled'] },
  { label: 'Drafts', statuses: ['draft'] },
];

interface EventSummary {
  name: string;
  status: string;
}

async function readable(user: SeedUserId): Promise<EventSummary[]> {
  const d = await api<{ items: EventSummary[] } | EventSummary[]>(user, 'get', '/api/events');
  return Array.isArray(d) ? d : d.items;
}

/** Opens a stage tab and waits until it lists exactly `expected` (retried, so never a stale read). */
async function expectStage(page: Page, stage: string, expected: string[]): Promise<void> {
  // The stage tabs are labelled 'Event stages'; each tab reads '<stage> <count>'.
  await page.getByLabel('Event stages').getByText(stage, { exact: false }).click();
  const table = page.getByRole('table', { name: 'Events' });
  await expect
    .poll(
      async () => (await table.getByRole('link').allTextContents()).map((t) => t.trim()).sort(),
      { message: `${stage} holds exactly the events in its statuses` },
    )
    .toEqual(expected);
}

async function expectStagesMatch(page: Page, user: SeedUserId): Promise<string[]> {
  await page.goto('/events/all');
  await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible();
  const events = await readable(user);
  const seen: string[] = [];
  for (const stage of STAGES) {
    const expected = events
      .filter((e) => stage.statuses.includes(e.status))
      .map((e) => e.name)
      .sort();
    await expectStage(page, stage.label, expected);
    seen.push(...expected);
  }
  return seen.sort();
}

test.describe('the all-events list groups events by lifecycle stage', () => {
  test.describe('as the Finance Controller, who reads every event', () => {
    test.use({ storageState: authFile('finance-controller') });

    test('every readable event sits under its stage, and only there', async ({ page }) => {
      const seen = await expectStagesMatch(page, 'finance-controller');
      expect(seen.length, 'the seed has events in several stages').toBeGreaterThanOrEqual(5);
      expect(new Set(seen).size, 'no event is listed under two stages').toBe(seen.length);
    });
  });

  test.describe('as the Event Organizer, who reads only some events', () => {
    test.use({ storageState: authFile('event-organizer') });

    test('the list holds only the events the organizer may read', async ({ page }) => {
      const seen = await expectStagesMatch(page, 'event-organizer');
      const readableNames = (await readable('event-organizer')).map((e) => e.name).sort();
      expect(seen).toEqual(readableNames);
      // Seeded events the organizer has no part in never appear.
      expect(seen).not.toContain('New York Team Offsite');
      expect(seen).not.toContain('Hyderabad Hack Week');
    });
  });
});
