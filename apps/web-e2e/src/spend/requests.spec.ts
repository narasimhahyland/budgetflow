// Phase 5 requester journeys: the history tab with version compare after a resubmission (064),
// a receipt uploaded on its own page and verified (121), approved allocations with used and open
// amounts (120), funding for a team event in one step (118), and the employee dashboard (115).
import { expect, test } from '@playwright/test';
import { api } from '../budgets/api';
import { authFile } from '../support/roles';
import {
  decide,
  desktopOnly,
  directorTree,
  getRequest,
  PDF,
  spendingRequest,
  suffix,
  taskOf,
  usdText,
} from './api';

test.describe('requester', () => {
  test.use({ storageState: authFile('budget-owner') });

  test('resubmits after changes were asked and compares the versions in the history tab', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();
    const { team } = await directorTree();
    const r = await spendingRequest(team.id, 80_000);
    await decide(await taskOf(r.id, 'department-head', 'requests'), 'department-head', {
      decision: 'request_changes',
      comment: 'Align catering with the regional benchmark.',
    });

    await page.goto(`/requests/${r.id}`);
    await expect(page.getByText('Changes requested: Align catering')).toBeVisible();
    await page.getByLabel(/^Amount/).fill('600');
    await page.getByRole('button', { name: 'Resubmit' }).click();
    await expect.poll(async () => (await getRequest(r.id)).status).toBe('pending_approval');

    await page.getByTestId('tab-history').click();
    await expect(page).toHaveURL(/tab=history/);
    const history = page.getByTestId('request-history');
    await expect(history).toContainText('Resubmitted the request');
    await expect(history).toContainText('Align catering with the regional benchmark.');
    const compare = page.getByTestId('compare-versions');
    await expect(compare).toContainText('Compare version 2 with');
    await expect(compare).toContainText(usdText(80_000));
    await expect(compare).toContainText(usdText(60_000));
    await expect(compare).toContainText('(unchanged)');
  });

  test('uploads a receipt on its own page and sees it on the request after verification', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();
    const { team } = await directorTree();
    const r = await spendingRequest(team.id, 5_749);
    await decide(await taskOf(r.id, 'department-head', 'requests'), 'department-head', {
      decision: 'approve',
    });

    await page.goto(`/requests/${r.id}?tab=documents`);
    await page.getByRole('link', { name: 'Upload receipt' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Upload a receipt or document' }),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Request' })).toContainText(r.ref);
    await page.getByLabel('Amount on the receipt (USD)').fill('54.61');
    await expect(page.getByTestId('amount-check')).toContainText(
      `${usdText(288)} less than approved`,
    );
    await page.locator('input[type=file]').setInputFiles({
      name: `receipt-${suffix()}.pdf`,
      mimeType: 'application/pdf',
      buffer: PDF,
    });
    await expect(page.getByTestId('chosen-file')).toBeVisible();
    await page.getByRole('button', { name: 'Upload receipt' }).click();
    await expect(page).toHaveURL(new RegExp(`/requests/${r.id}\\?tab=documents`));
    await expect(page.getByRole('list', { name: 'Documents' })).toContainText('receipt-');
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
  });

  test('a file that is not a PDF, image, CSV or spreadsheet is refused before upload', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();
    await page.goto('/requests/upload');
    await page.locator('input[type=file]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a receipt'),
    });
    await expect(page.getByTestId('upload-failure')).toContainText('This file type is not allowed');
  });

  test('sees what was approved with used and open amounts', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();
    const { team } = await directorTree();
    const r = await spendingRequest(team.id, 12_000, 'budget-owner', `Approved lunch ${suffix()}`);
    await decide(await taskOf(r.id, 'department-head', 'requests'), 'department-head', {
      decision: 'approve',
    });

    await page.goto('/requests/approved');
    await expect(page.getByRole('heading', { level: 1, name: 'Approved for you' })).toBeVisible();
    await expect(page.getByTestId('approved-summary')).toContainText('Receipts due');
    const row = page.getByRole('row').filter({ hasText: r.ref });
    await expect(row).toContainText(usdText(12_000));
    await expect(row).toContainText('Receipt due');
    await row.getByRole('link', { name: 'Upload receipt' }).click();
    await expect(page).toHaveURL(new RegExp(`/requests/upload\\?request=${r.id}`));
  });

  test('requests funding for a team event in one step', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();
    const { team } = await directorTree();
    const name = `Team pottery workshop ${suffix()}`;

    await page.goto('/requests/event-funding');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Request event funding' }),
    ).toBeVisible();
    await page.getByTestId('submit-event-funding').click();
    await expect(page.getByTestId('error-summary')).toContainText('name the event');

    await page.getByLabel('Event name').fill(name);
    await page.getByLabel('Date').fill('2026-12-15');
    await page.getByRole('combobox', { name: 'Location' }).click();
    await page.getByRole('option', { name: 'New York' }).click();
    await page.getByLabel('People attending').fill('12');
    await page.getByLabel(/^Amount/).fill('180');
    await page.getByRole('combobox', { name: 'Charge to budget' }).click();
    await page.getByRole('option', { name: team.name }).click();
    await expect(page.getByTestId('estimate-total')).toContainText(usdText(18_000));
    await expect(page.getByTestId('check-panel')).toContainText('Lena Fischer');
    await page.getByTestId('submit-event-funding').click();

    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const eventId = page.url().split('/events/')[1]!.split('?')[0]!;
    const event = await api<{ status: string }>('budget-owner', 'get', `/api/events/${eventId}`);
    expect(event.status).toBe('submitted');
  });
});

test.describe('employee', () => {
  test.use({ storageState: authFile('employee') });

  test('dashboard shows the request entry points and the upload page', async ({ page }) => {
    await page.goto('/my');
    await expect(page.getByRole('link', { name: 'Request funds' })).toBeVisible();
    await page.getByRole('link', { name: 'Upload receipt' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Upload a receipt or document' }),
    ).toBeVisible();
  });

  test('cannot open event funding without the organizer permission', async ({ page }) => {
    await page.goto('/requests/event-funding');
    await expect(
      page.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/requests\/event-funding$/);
  });
});
