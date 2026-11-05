// Phase 9 event depth journeys: the organizer plans an event, invites people, an employee answers
// their invitation and gives dietary needs, the organizer marks attendance and applies the
// attendance-based cost split, and the seeded wellbeing week shows its survey results and scorecard.
// Data comes from the API per journey; desktop only for the mutating paths.
import { expect, test } from '@playwright/test';
import { SEED, userById } from '@bf/seed';
import { api } from '../budgets/api';
import { authFile } from '../support/roles';
import { approvedEventWith, desktopOnly, directorTree, suffix, usd } from './api';

const EMPLOYEE = userById('employee').personId!;

interface InvitationsView {
  participants: { id: string; personId: string | null; name: string }[];
}

test.describe('event organizer plans and runs an event', () => {
  test.use({ storageState: authFile('budget-owner') });

  test('plans the checklist, invites people and sees the RSVP tracker', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();
    const { team } = await directorTree();
    const event = await approvedEventWith(team.id, {
      name: `Journey plan event ${suffix()}`,
      estimateMinor: 400_000,
      ownMinor: 400_000,
      participantPersonIds: [EMPLOYEE],
    });

    await page.goto(`/events/${event.id}/plan`);
    await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
    await expect(page.getByText('No plan yet')).toBeVisible();

    await page.getByLabel('Add a task').fill('Book the photographer');
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByText('Book the photographer')).toBeVisible();
    await expect(page.getByTestId('plan-progress')).toContainText('0 of 1 tasks done');

    await page.getByRole('checkbox', { name: 'Book the photographer' }).click();
    await expect(page.getByTestId('plan-progress')).toContainText('1 of 1 tasks done');

    await page.locator('a[satNavigationTab]:has-text("Agenda")').click();
    await page.getByLabel('Start').fill('18:00');
    await page.getByLabel('What happens').fill('Welcome and lamp lighting');
    await page.getByRole('button', { name: 'Add agenda item' }).click();
    await expect(page.getByText('Welcome and lamp lighting')).toBeVisible();

    await page.goto(`/events/${event.id}/people`);
    await expect(page.getByRole('heading', { name: 'Send invitations' })).toBeVisible();
    await page.getByLabel('RSVP deadline').fill('2026-12-01T18:00');
    await page.getByTestId('send-invitations').click();
    await expect(page.getByTestId('rsvp-going')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'RSVP tracker' })).toBeVisible();
  });

  test('marks attendance and applies the attendance-based cost split', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();
    const { team } = await directorTree();
    const event = await approvedEventWith(team.id, {
      name: `Journey attendance event ${suffix()}`,
      estimateMinor: 400_000,
      ownMinor: 400_000,
      participantPersonIds: [EMPLOYEE],
    });
    await api('budget-owner', 'post', `/api/events/${event.id}/commitments`, {
      description: 'Catering for the journey event',
      amount: usd(200_000),
    });
    // Approving the own funds already covered the estimate, so the event is Funded and can start.
    await api('budget-owner', 'post', `/api/events/${event.id}/start`, {});

    await page.goto(`/events/${event.id}/people`);
    await page.locator('a[satNavigationTab]:has-text("Attendance")').click();
    await expect(page.getByText('Preview only, based on')).toBeVisible();

    await page.getByRole('button', { name: 'Mark everyone going as attended' }).click();
    await page
      .getByRole('combobox', {
        name: new RegExp(`Attendance for ${userById('employee').displayName}`),
      })
      .click();
    await page.getByRole('option', { name: 'Attended' }).click();
    await page.getByTestId('finalize-attendance').click();
    await expect(page.getByTestId('attended-count')).toHaveText('1');

    await page.getByLabel('Reason').fill('Actual attendance: 1');
    await page.getByTestId('apply-split').click();
    await expect(page.getByTestId('split-applied')).toContainText('New split applied');
  });
});

test.describe('employee answers an invitation', () => {
  test.use({ storageState: authFile('employee') });

  test('says Going and gives dietary and accessibility needs', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();
    const { team } = await directorTree();
    const event = await approvedEventWith(team.id, {
      name: `Journey invitation event ${suffix()}`,
      estimateMinor: 400_000,
      ownMinor: 400_000,
      participantPersonIds: [EMPLOYEE],
    });
    const invitations = await api<InvitationsView>(
      'budget-owner',
      'post',
      `/api/events/${event.id}/invitations/send`,
      {
        message: 'Join us for the journey event.',
        deadline: '2026-12-01T18:00:00.000Z',
      },
    );
    const invitationId = invitations.participants.find((p) => p.personId === EMPLOYEE)!.id;

    await page.goto(`/invitations/${invitationId}`);
    await expect(page.getByRole('heading', { name: 'Will you attend?' })).toBeVisible();
    await page.getByTestId('rsvp-going').click();
    await expect(page.getByRole('heading', { name: "You're going" })).toBeVisible();

    await page.getByRole('radio', { name: 'Vegetarian' }).click();
    await page.getByRole('checkbox', { name: 'nuts' }).click();
    await page.getByRole('switch', { name: 'Severe: needs separate preparation' }).click();
    await page.getByTestId('save-needs').click();
    await expect(page.getByTestId('needs-saved')).toBeVisible();
  });
});

test.describe('the events dashboard and a closed event scorecard', () => {
  test.use({ storageState: authFile('event-organizer') });

  test('the dashboard lands on what needs the organizer', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Needs your attention' })).toBeVisible();
    await expect(page.getByTestId('kpi-upcoming')).toBeVisible();
  });

  test('the template library offers the company templates', async ({ page }) => {
    await page.goto('/events/templates');
    await expect(page.getByRole('heading', { name: 'Event templates' })).toBeVisible();
    await expect(page.getByText('Diwali celebration')).toBeVisible();
    await expect(page.getByText('Wellbeing week')).toBeVisible();
  });

  test('the wellbeing week shows survey results and its scorecard', async ({ page }) => {
    await page.goto(`/events/${SEED.p9.wellbeingEvent}/feedback`);
    await expect(page.getByTestId('response-count')).toHaveText('6');
    await expect(page.getByTestId('average-rating')).toContainText('of 5');

    await page.goto(`/events/${SEED.p9.wellbeingEvent}/scorecard`);
    await expect(page.getByRole('heading', { name: /wellbeing week/i })).toBeVisible();
    await expect(page.getByTestId('cost-per-attendee')).toBeVisible();
    await expect(page.getByText('Not part of cost')).toBeVisible();
  });
});
