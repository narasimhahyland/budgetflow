// Phase 5 event journeys: Jordan creates a cross-location event with participants and a cost split,
// submits it, and after approval asks for additional funds; then he asks Lena for an Inter-Director
// Budget Contribution Request three times, which she decides in full, in part and declines, and the
// co-funding board shows each contributor. Data comes from the API per journey; desktop only.
import { expect, test, type Page } from '@playwright/test';
import { api } from '../budgets/api';
import { authFile } from '../support/roles';
import {
  approvedEvent,
  decide,
  desktopOnly,
  directorTree,
  giverBudget,
  pageAs,
  suffix,
  taskOf,
  usd,
  usdText,
} from './api';

const pick = async (page: Page, label: string | RegExp, option: string | RegExp) => {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
};

test.describe('event organizer', () => {
  test.use({ storageState: authFile('budget-owner') });

  test('creates a cross-location event with participants and a cost split, then asks for more funds', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const { team } = await directorTree();
    const name = `Journey offsite ${suffix()}`;

    await page.goto('/events/new');
    await page.getByLabel('Event name').fill(name);
    await page.getByLabel('Starts').fill('2026-12-10T09:00');
    await page.getByLabel('Ends').fill('2026-12-10T17:00');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    await page.getByLabel('Locations', { exact: true }).click();
    await page.getByRole('option', { name: 'New York' }).click();
    await page.getByRole('option', { name: 'Westlake' }).click();
    await page.keyboard.press('Escape');
    for (const person of ['Isabella', 'Mason']) {
      await page.getByLabel('Find people to add').fill(person);
      await page
        .getByRole('list', { name: 'Directory matches' })
        .getByRole('button')
        .first()
        .click();
    }
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    await pick(page, 'Home budget (funds the event first)', team.name);
    await page
      .getByLabel(/Unit cost/)
      .first()
      .fill('3000');
    await expect(page.getByText('New York · 1 participant')).toBeVisible();
    await expect(page.getByText('Westlake · 1 participant')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to funding' }).click();
    await page.getByLabel(/Own funds from the home budget/).fill('2000');
    await page.getByRole('button', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Submit for approval' }).click();

    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Cost split by location and legal entity' }),
    ).toBeVisible();
    const eventId = page.url().split('/events/')[1]!.split('?')[0]!;
    const event = await api<{ ownFundsRequest: { id: string } | null; status: string }>(
      'budget-owner',
      'get',
      `/api/events/${eventId}`,
    );
    expect(event.status).toBe('submitted');
    await decide(
      await taskOf(event.ownFundsRequest!.id, 'department-head', 'requests'),
      'department-head',
      {
        decision: 'approve',
      },
    );

    await page.reload();
    await page.getByRole('button', { name: 'Request additional funds' }).click();
    await expect(page).toHaveURL(/kind=additional_fund/);
    await page.getByLabel('Amount').fill('500');
    await page
      .getByLabel('Justification')
      .fill('Ten more people confirmed after the first estimate.');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByText(/Additional-fund request/)).toBeVisible();
    await expect(page.locator('bf-approval-route')).toContainText('Lena Fischer');
  });
});

test.describe('Inter-Director Budget Contribution Request', () => {
  test.use({ storageState: authFile('budget-owner') });

  test('Jordan asks, Lena contributes in full, in part and declines; the board shows each', async ({
    page,
    browser,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const { root, team, tag } = await directorTree();
    const giver = await giverBudget(root.id, tag);
    const event = await approvedEvent(team.id, 2_000_000, 400_000);

    await page.goto(`/events/${event.id}`);
    await page.getByRole('button', { name: 'Request contribution' }).click();
    await page.getByLabel('Find a giving budget').fill(giver.name);
    await pick(page, 'Giving budget', new RegExp(giver.name));
    await page.getByLabel(/^Amount/).fill('3000');
    await page.getByLabel('Purpose').fill('Co-fund the shared offsite');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText(/Contribution requested|sent/i).first()).toBeVisible();

    const ask = (amountMinor: number) =>
      api<{ id: string }>('budget-owner', 'post', '/api/contributions', {
        eventId: event.id,
        giverBudgetId: giver.id,
        amount: usd(amountMinor),
        purpose: 'Co-fund the shared offsite',
      });
    const list = await api<{ contributions: { id: string; requested: { amountMinor: number } }[] }>(
      'budget-owner',
      'get',
      `/api/events/${event.id}`,
    );
    const full = list.contributions.find((c) => c.requested.amountMinor === 300_000)!;
    const part = await ask(200_000);
    const declined = await ask(100_000);

    const lena = await pageAs(browser, 'department-head');
    await lena.goto(`/contributions/${full.id}`);
    await expect(
      lena.getByRole('heading', { level: 1, name: 'Inter-Director Budget Contribution Request' }),
    ).toBeVisible();
    await lena.getByRole('checkbox', { name: 'I have no conflict of interest' }).check();
    await lena.getByRole('button', { name: `Contribute ${usdText(300_000)}` }).click();
    await expect(lena.getByRole('heading', { name: 'Your decision' })).toHaveCount(0);

    await lena.goto(`/contributions/${part.id}`);
    await lena.getByRole('radio', { name: /Contribute part/ }).click();
    await lena.getByLabel(/Approved contribution amount/).fill('1500');
    await pick(lena, /Reason code/, /TRF-COFUND/);
    await lena.getByRole('checkbox', { name: 'I have no conflict of interest' }).check();
    await lena.getByRole('button', { name: `Contribute ${usdText(150_000)}` }).click();
    await expect(lena.getByRole('heading', { name: 'Your decision' })).toHaveCount(0);

    await lena.goto(`/contributions/${declined.id}`);
    await lena.getByRole('radio', { name: /Decline/ }).click();
    await pick(lena, /Reason code/, /REJ-BUDGET/);
    await lena.getByRole('button', { name: 'Decline request' }).click();
    await expect(lena.getByRole('heading', { name: 'Your decision' })).toHaveCount(0);
    await lena.context().close();

    await page.goto(`/events/cofunding-board?event=${event.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Co-funding board' })).toBeVisible();
    const board = page
      .getByRole('heading', { name: new RegExp(`${event.name}: funding breakdown`) })
      .locator('xpath=ancestor::section[1]');
    await expect(board).toContainText(usdText(300_000));
    await expect(board).toContainText(usdText(150_000));
  });
});
