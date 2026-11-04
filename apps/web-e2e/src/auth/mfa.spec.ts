// MFA (screen 003): a user enrolled in TOTP must enter the authenticator code after the password; a wrong
// code is refused, the right one completes sign-in.
import { expect, test } from '@playwright/test';
import { acceptedTotps, expectShell, freshTotp, submitSignIn } from '../support/auth';

test('the authenticator code is required: wrong code refused, right code signs in', async ({
  page,
}) => {
  await page.goto('/');
  await submitSignIn(page, 'mfa-user');

  const code = page.getByLabel('One-time code');
  await expect(code).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Platform Navigation' })).toHaveCount(0);

  const accepted = acceptedTotps();
  const wrong = ['000000', '111111', '222222', '333333'].find((c) => !accepted.includes(c))!;
  await code.fill(wrong);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByText('Invalid authenticator code.')).toBeVisible();

  await page.getByLabel('One-time code').fill(await freshTotp());
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expectShell(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome, Noor' })).toBeVisible();
});
