// Screens 120a and 122b. A thank-you note moves no money and needs no budget, which is why it is
// the one award that still works when a Recognition budget is frozen; the journey checks that the
// frozen type is offered as refused with its reason rather than hidden. The organizer profile shows
// feedback only where enough people answered to stay anonymous.
import { expect, test } from '@playwright/test';
import { P15_IDS, userById } from '@bf/seed';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { getJson, type Money, type SuppressibleFigure } from './support';

interface RecognitionAwardType {
  id: string;
  kind: string;
  name: string;
  amount: Money | null;
  fundingFrozen: boolean;
  active: boolean;
}
interface RecognitionAward {
  id: string;
  typeName: string;
  giverName: string;
  recipientName: string;
  message: string;
  amount: Money | null;
  status: string;
}
interface RecognitionFeed {
  items: RecognitionAward[];
  awardTypes: RecognitionAwardType[];
}
interface OrganizerThankNote {
  id: string;
  note: string;
  authorName: string;
}
interface OrganizerRecognition {
  personId: string;
  personName: string;
  eventsOrganised: number;
  colleaguesReached: number;
  averagePulse: SuppressibleFigure;
  notes: OrganizerThankNote[];
  thankNoteCount: number;
}

test.describe('recognition spends a budget, a thank-you note does not (120a)', () => {
  test.use({ storageState: authFile('employee') });

  test('a frozen Recognition budget refuses its award type by name, in the form', async ({
    page,
  }) => {
    const feed = await getJson<RecognitionFeed>('employee', '/api/recognition');
    // The seeded United States type is funded by a frozen budget; the thank-you note has no budget.
    const frozen = feed.awardTypes.find((t) => t.id === P15_IDS.awardTypePausedRecognition);
    const thankYou = feed.awardTypes.find((t) => t.id === P15_IDS.awardTypeThankYou);
    expect(frozen, 'the seed offers an award type funded by a frozen budget').toBeTruthy();
    expect(frozen!.fundingFrozen).toBe(true);
    expect(thankYou!.amount, 'a thank-you note carries no money').toBeNull();

    await page.goto('/recognition');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Recognition' })).toBeVisible();
    await expect(page.getByTestId('recognition-frozen')).toContainText(frozen!.name);
    await expect(page.getByTestId('recognition-frozen')).toContainText(
      'Thank-you notes, which move no money, still work',
    );

    await page.getByTestId('give-recognition').click();
    await expect(page.getByRole('heading', { name: 'Give recognition' })).toBeVisible();
    // Refused, not hidden: the giver can see the award exists and why they cannot use it.
    const frozenOption = page.getByTestId(`award-type-${frozen!.id}`);
    await expect(frozenOption).toContainText('is frozen');
    await expect(frozenOption.locator('input')).toBeDisabled();
    await expect(page.getByTestId(`award-type-${thankYou!.id}`).locator('input')).toBeEnabled();
  });

  test('a thank-you note is given without touching a budget', async ({ page }) => {
    const recipient = userById('event-organizer');
    const message = `Thank you for organising the Diwali celebration so calmly. ${Date.now()}`;

    await page.goto('/recognition');
    await page.getByTestId('give-recognition').click();
    await page.getByTestId('recognition-recipient').click();
    await page.getByRole('option', { name: recipient.displayName }).click();
    await page.getByTestId(`award-type-${P15_IDS.awardTypeThankYou}`).click();
    await page.getByTestId('recognition-message').fill(message);
    await page.getByTestId('recognition-visibility').click();
    await page.getByRole('option', { name: 'Public, in the recognition feed' }).click();
    await page.getByTestId('recognition-give-confirm').click();

    const feed = await getJson<RecognitionFeed>('employee', '/api/recognition');
    const given = feed.items.find((a) => a.message === message);
    expect(given, 'the note the journey just left is in the feed').toBeTruthy();
    expect(given!.recipientName).toBe(recipient.displayName);
    expect(given!.amount, 'a thank-you note commits no money').toBeNull();

    await expect(page.getByTestId(`award-${given!.id}`)).toContainText(recipient.displayName);
    await expect(page.getByTestId(`award-${given!.id}`)).toContainText('No money attached');
  });
});

test.describe('organizer recognition credits the work without exposing a respondent (122b)', () => {
  test.use({ storageState: authFile('employee') });

  test('the profile shows the seeded thank-you notes and guards small feedback groups', async ({
    page,
  }) => {
    const organizerPersonId = userById('event-organizer').personId!;
    const profile = await getJson<OrganizerRecognition>(
      'employee',
      `/api/recognition/organizers/${organizerPersonId}`,
    );

    await page.goto(`/recognition/organizers/${organizerPersonId}`);
    await expectShell(page);
    await expect(page.getByRole('heading', { name: profile.personName })).toBeVisible();

    // Both seeded notes are picked by id, so a note another suite leaves cannot stand in for them.
    for (const id of [P15_IDS.thankNoteDiwali, P15_IDS.thankNoteOffsite]) {
      const seeded = profile.notes.find((n) => n.id === id);
      expect(seeded, `the seeded note ${id} is on the organizer's profile`).toBeTruthy();
      await expect(page.getByTestId(`note-${id}`)).toContainText(seeded!.note);
      await expect(page.getByTestId(`note-${id}`)).toContainText(seeded!.authorName);
    }

    // Feedback is either backed by enough responses or withheld with the threshold spelled out.
    if (profile.averagePulse.suppressed) {
      await expect(page.getByTestId('organizer-pulse-suppressed')).toHaveText(
        profile.averagePulse.suppressionReason!,
      );
    } else {
      await expect(page.getByTestId('organizer-pulse')).toContainText(
        String(profile.averagePulse.groupSize),
      );
    }
    await expect(page.getByTestId('organizer-events')).toContainText(
      String(profile.eventsOrganised),
    );
  });
});
