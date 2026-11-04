// Forgot password (screen 004): the reset email arrives in Mailpit, its link lets the user set a password
// and continue into BudgetFlow. The journey sets the same dev-only password again so it can repeat.
import { expect, test } from '@playwright/test';
import { userById } from '@bf/seed';
import { expectShell, password } from '../support/auth';
import { MAILPIT_URL } from '../support/env';

interface MailSummary {
  ID: string;
  Subject: string;
  Created: string;
}
test('a reset email lets the user set a new password and sign in', async ({ page, request }) => {
  const user = userById('reset-user');
  const requestedAt = Date.now();
  await page.goto('/');
  await page.getByRole('link', { name: 'Forgot Password?' }).click();
  await page.getByLabel(/username or email/i).fill(user.username);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(/you should receive an email shortly/i)).toBeVisible();

  let mail: MailSummary | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT_URL}/api/v1/search`, {
          params: { query: `to:${user.username}` },
        });
        const { messages } = (await res.json()) as { messages: MailSummary[] };
        mail = messages.find((m) => Date.parse(m.Created) >= requestedAt - 5_000);
        return mail?.Subject ?? '';
      },
      { timeout: 20_000 },
    )
    .toMatch(/reset password/i);

  const message = (await (
    await request.get(`${MAILPIT_URL}/api/v1/message/${mail!.ID}`)
  ).json()) as {
    Text: string;
  };
  const link = /https?:\/\/\S+login-actions\/action-token\S+/.exec(message.Text)?.[0];
  expect(link, 'reset link in the email').toBeTruthy();

  await page.goto(link!);
  await page.getByLabel('New Password', { exact: true }).fill(password());
  await page.getByLabel('Confirm password', { exact: true }).fill(password());
  await page.getByRole('button', { name: 'Submit' }).click();

  await expectShell(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Elif' })).toBeVisible();
});
