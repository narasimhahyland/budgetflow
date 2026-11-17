// Gap B9 journeys: 011a "Report a problem" and 113a Query log > Reported answers. A person
// reports one of their own answers with the text included; the Organization Admin reads it with
// the AI label on the answer and marks it reviewed with a note; the auditor reads the same tab
// without the review control; an employee gets the forbidden state. The latest nightly scan is
// named on the outlook screen.
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { onRecordedProvider } from './recorded';
import { apiAs, setAiFeature } from './support';

onRecordedProvider();

test('a reported answer reaches the AI administrator, who marks it reviewed', async ({
  browser,
}) => {
  const tag = randomUUID().slice(0, 6);
  const question = `How much is left in Bengaluru Events? (${tag})`;

  // The asker reports their own answer, text included (the default).
  const asker = await browser.newContext({ storageState: authFile('location-manager') });
  const page = await asker.newPage();
  await page.goto('/ask');
  await expectShell(page);
  await page.getByTestId('question').fill(question);
  await page.getByTestId('send').click();
  await expect(page.getByTestId('ai-prose')).toBeVisible();
  await page
    .getByRole('button', { name: `Report a problem with the answer to: ${question}` })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Report a problem with this answer' });
  await expect(
    dialog.getByRole('switch', { name: 'Include my question and the answer' }),
  ).toBeChecked();
  // Sending without a reason asks for one.
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose what was wrong.');
  await dialog.getByRole('radio', { name: 'Wrong figure' }).check();
  await dialog.getByLabel('Note (optional)').fill(`Available looks low ${tag}`);
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Report sent to your AI administrators.')).toBeVisible();
  await expect(page.getByTestId('answer-reported')).toHaveText('Reported. Thank you.');
  await asker.close();

  // The Organization Admin finds it on the Reported answers sub-tab and reviews it.
  const admin = await browser.newContext({ storageState: authFile('org-admin') });
  const adminPage = await admin.newPage();
  await adminPage.goto('/admin/ai/log');
  await expectShell(adminPage);
  await adminPage.getByRole('tab', { name: 'Reported answers' }).click();
  await expect(adminPage).toHaveURL(/\/admin\/ai\/log\/reported$/);
  const row = adminPage.getByRole('row').filter({ hasText: `Available looks low ${tag}` });
  await expect(row).toContainText(question);
  await expect(row).toContainText('Wrong figure');
  await expect(row.getByTestId('ai-label')).toBeVisible();
  await expect(row.getByText('New', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: /^Mark the report from .* reviewed$/ }).click();
  const review = adminPage.getByRole('dialog', { name: 'Mark the report reviewed' });
  await review.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(review.getByText('Add a note saying what you found.')).toBeVisible();
  await review.getByLabel('Review note').fill('Checked against the ledger.');
  await review.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(adminPage.getByText('Report marked reviewed.')).toBeVisible();
  await expect(row.getByText('Reviewed', { exact: true })).toBeVisible();
  await expect(row).toContainText('Checked against the ledger.');
  await admin.close();

  // The auditor reads the same report but has no review control.
  const auditor = await browser.newContext({ storageState: authFile('auditor') });
  const auditorPage = await auditor.newPage();
  await auditorPage.goto('/admin/ai/log/reported');
  await expectShell(auditorPage);
  await expect(
    auditorPage.getByRole('heading', { name: 'Reported answers, newest first' }),
  ).toBeVisible();
  const seeded = auditorPage
    .getByRole('row')
    .filter({ hasText: 'The available figure looks lower' });
  await expect(seeded).toContainText('Waiting for an AI administrator');
  await expect(auditorPage.getByRole('button', { name: /^Mark the report/ })).toHaveCount(0);
  await auditor.close();
});

test('the reported-answers tab filters by status and shows its empty state', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ storageState: authFile('org-admin') });
  const page = await ctx.newPage();
  await page.goto('/admin/ai/log/reported');
  await expectShell(page);
  await expect(page.getByTestId('reported-rows')).toBeVisible();
  // The seeded report someone left without text says so, and never shows any.
  const bare = page.getByRole('row').filter({ hasText: 'Not my scope' });
  await expect(bare).toContainText('The person did not include the text');
  await expect(page.getByTestId('reported-retention')).toContainText('kept 90 days');

  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Reviewed' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Not my scope' })).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'The available figure looks lower' }),
  ).toHaveCount(0);
  await ctx.close();
});

test('an employee gets the forbidden state on the reported answers', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile('employee') });
  const page = await ctx.newPage();
  await page.goto('/admin/ai/log/reported');
  await expectShell(page);
  await expect(
    page.getByRole('heading', { name: 'You cannot see the reported answers' }),
  ).toBeVisible();
  await expect(page.getByTestId('reported-rows')).toHaveCount(0);
  await ctx.close();
});

test('the outlook names the nightly scan its figures come from', async ({ browser }) => {
  await setAiFeature('outlook', true);
  // Tonight's scan, queued the way the schedule would (or returned when it already ran).
  const finance = await apiAs('finance-admin');
  const queued = await finance.post('/api/ai/scan-runs', {
    data: { feature: 'outlook' },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(queued.status()).toBe(202);
  const runId = ((await queued.json()) as { id: string }).id;
  await expect
    .poll(
      async () =>
        ((await (await finance.get(`/api/ai/scan-runs/${runId}`)).json()) as { status: string })
          .status,
      { timeout: 60_000 },
    )
    .toBe('completed');
  const latest = (
    (await (await finance.get('/api/ai/scan-runs?feature=outlook')).json()) as {
      latestCompleted: { trigger: string; evaluatedCount: number; resultCount: number }[];
    }
  ).latestCompleted[0];

  const ctx = await browser.newContext({ storageState: authFile('finance-admin') });
  const page = await ctx.newPage();
  await page.goto('/insights/outlook');
  await expectShell(page);
  const note = page.getByTestId('scan-run-note');
  await expect(note).toContainText(`Last scan (${latest.trigger})`);
  await expect(note).toContainText(`${latest.evaluatedCount} budgets checked`);
  await expect(note).toContainText(`${latest.resultCount} outlooks updated`);
  await ctx.close();
});
