// Phase 17 traceability: the delegations page (/approvals/delegations) had no journey. Delegation hygiene is
// enforced by the API (libs/domain authority/doa.ts), so this proves its refusals reach the person
// in plain English through the form. Only refusals are exercised: a delegation that succeeded would
// change whose inbox other journeys read while they run alongside this one.
import { expect, test, type Page } from '@playwright/test';
import { authFile } from '../support/roles';

const SELF = 'Lena Fischer'; // the seeded department head

async function fillDelegation(
  page: Page,
  delegate: string,
  from: string,
  to: string,
  reason: string,
): Promise<void> {
  await page.goto('/approvals/delegations');
  await expect(page.getByRole('heading', { name: 'Delegations', level: 1 })).toBeVisible();
  // Scoped to the form: the account menu also carries the signed-in person's name.
  const form = page.getByRole('region', { name: 'Set up a delegate' });
  await form.getByLabel('Find the delegate').fill(delegate.split(' ')[0]);
  await form.getByRole('button', { name: new RegExp(`^${delegate}`) }).click();
  await expect(form.getByText(`Delegate: ${delegate}`)).toBeVisible();
  await form.getByLabel('From').fill(from);
  await form.getByLabel('To').fill(to);
  await form.getByLabel('Reason').fill(reason);
}

test.describe('delegation hygiene reaches the person who sets one up (delegations)', () => {
  test.use({ storageState: authFile('department-head') });

  test('nobody can delegate to themselves', async ({ page }) => {
    await fillDelegation(page, SELF, '2026-11-20', '2026-11-25', 'Covering my own approvals');
    await page
      .getByRole('region', { name: 'Set up a delegate' })
      .getByRole('button', { name: 'Delegate', exact: true })
      .click();
    await expect(page.getByText('Choose someone other than yourself.')).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Delegations' }).getByText(SELF, { exact: false }),
    ).toHaveCount(0);
  });

  test('a delegation cannot end before it starts', async ({ page }) => {
    await fillDelegation(page, 'Lena Hoffmann', '2026-11-25', '2026-11-20', 'Holiday cover');
    await page
      .getByRole('region', { name: 'Set up a delegate' })
      .getByRole('button', { name: 'Delegate', exact: true })
      .click();
    await expect(page.getByText('The end date is before the start date.')).toBeVisible();
  });
});
