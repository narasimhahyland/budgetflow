// Screen 120b. Wallet money is budget money. An employee who has never claimed has an allowance but
// no wallet row, so the claim is made against the programme; a claim over the allowance is refused
// with the amount it is over by, not a generic error; and a reviewer's return releases the whole
// pre-encumbrance, which the employee then sees as "Returned" with the reviewer's reason.
import { expect, test } from '@playwright/test';
import { P15_IDS } from '@bf/seed';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { getJson, money, type Money } from './support';

interface Wallet {
  id: string | null;
  programId: string;
  programName: string;
  allowance: Money;
  proratedAllowance: Money;
  balance: Money;
  categories: string[];
  fundingFrozen: boolean;
  closed: boolean;
}
interface WalletClaim {
  id: string;
  programName: string;
  merchant: string;
  amount: Money;
  status: string;
  decisionReason: string | null;
}
interface WalletOverview {
  wallets: Wallet[];
  claims: WalletClaim[];
}

const FEEL_GOOD = P15_IDS.walletProgramWellbeing;
const LEARNING = P15_IDS.walletProgramLearning;

const walletFor = (overview: WalletOverview, programId: string): Wallet => {
  const wallet = overview.wallets.find((w) => w.programId === programId);
  expect(wallet, `the claimant has a wallet for programme ${programId}`).toBeTruthy();
  return wallet!;
};

test.describe('a wallet is an allowance inside a budget (120b)', () => {
  // These share one claimant's wallets, so they run in order rather than racing each other.
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: authFile('event-organizer') });

  test('an allowance is visible before any wallet row exists', async ({ page }) => {
    const overview = await getJson<WalletOverview>('event-organizer', '/api/wallets');
    // The learning programme is the one this file never claims from, so its wallet stays unused.
    const learning = walletFor(overview, LEARNING);
    expect(learning.id, 'no wallet row exists until the first claim creates one').toBeNull();

    await page.goto('/wallets');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'My wallets' })).toBeVisible();

    const card = page.getByTestId(`wallet-${LEARNING}`);
    await expect(card).toContainText(learning.programName);
    await expect(card).toContainText(
      money(learning.balance.amountMinor, learning.balance.currency),
    );
    await expect(card).toContainText(
      money(learning.proratedAllowance.amountMinor, learning.proratedAllowance.currency),
    );
    await expect(page.getByTestId(`wallet-unused-${LEARNING}`)).toContainText(
      'You have not claimed from this allowance yet',
    );
  });

  test('a claim over the allowance is refused with the amount it is over by', async ({ page }) => {
    const overview = await getJson<WalletOverview>('event-organizer', '/api/wallets');
    const wallet = walletFor(overview, FEEL_GOOD);
    expect(wallet.balance.amountMinor).toBeGreaterThan(0);
    const over = wallet.balance.amountMinor + 2_500;

    await page.goto('/wallets');
    await page.getByTestId(`claim-from-${FEEL_GOOD}`).click();
    await expect(
      page.getByRole('heading', { name: `Claim from ${wallet.programName}` }),
    ).toBeVisible();

    await page.getByTestId('claim-merchant').fill('Fitness First Indiranagar');
    await page.getByTestId('claim-amount').fill((over / 100).toFixed(2));

    const banner = page.getByTestId('claim-over-balance');
    await expect(banner).toContainText(money(2_500, wallet.balance.currency));
    await expect(banner).toContainText(money(wallet.balance.amountMinor, wallet.balance.currency));
    await expect(page.getByTestId('claim-submit')).toBeDisabled();

    // Refused means refused: nothing was submitted and the balance is untouched.
    const after = await getJson<WalletOverview>('event-organizer', '/api/wallets');
    expect(walletFor(after, FEEL_GOOD).balance.amountMinor).toBe(wallet.balance.amountMinor);
  });

  test('a claim within the allowance is submitted, reviewed and returned with its reason', async ({
    page,
    browser,
  }) => {
    const before = await getJson<WalletOverview>('event-organizer', '/api/wallets');
    const wallet = walletFor(before, FEEL_GOOD);
    const amountMinor = 1_200;
    expect(wallet.balance.amountMinor).toBeGreaterThan(amountMinor);
    const merchant = `Journey Gym ${Date.now()}`;

    await page.goto('/wallets');
    await page.getByTestId(`claim-from-${FEEL_GOOD}`).click();
    await page.getByTestId('claim-merchant').fill(merchant);
    await page.getByTestId('claim-amount').fill((amountMinor / 100).toFixed(2));
    await expect(page.getByTestId('claim-check')).toContainText(
      money(wallet.balance.amountMinor - amountMinor, wallet.balance.currency),
    );
    await page.getByTestId('claim-submit').click();

    // The claim pre-encumbers the programme budget, so the allowance left drops by exactly its size.
    const afterSubmit = await getJson<WalletOverview>('event-organizer', '/api/wallets');
    const claim = afterSubmit.claims.find((c) => c.merchant === merchant);
    expect(claim, 'the claim the journey just made is in the history').toBeTruthy();
    expect(claim!.status).toBe('submitted');
    expect(walletFor(afterSubmit, FEEL_GOOD).balance.amountMinor).toBe(
      wallet.balance.amountMinor - amountMinor,
    );
    await expect(page.getByTestId(`claim-${claim!.id}`)).toContainText('Submitted');

    // The programme reviewer returns it, in their own session.
    const reviewer = await browser.newContext({ storageState: authFile('location-manager') });
    const reviewerPage = await reviewer.newPage();
    await reviewerPage.goto('/wallets/review');
    await expect(
      reviewerPage.getByRole('heading', { name: 'Wallet claims to review' }),
    ).toBeVisible();
    const row = reviewerPage.getByTestId(`review-claim-${claim!.id}`);
    await expect(row).toContainText(merchant);
    await reviewerPage.getByTestId(`return-${claim!.id}`).click();
    await reviewerPage
      .getByTestId('decision-reason')
      .fill('The receipt is for a different person; please attach your own.');
    await reviewerPage.getByTestId('decision-confirm').click();
    await expect(reviewerPage.getByTestId(`review-claim-${claim!.id}`)).toHaveCount(0);
    await reviewer.close();

    // Returning releases the pre-encumbrance in full, and the employee is told why.
    const afterReturn = await getJson<WalletOverview>('event-organizer', '/api/wallets');
    const returned = afterReturn.claims.find((c) => c.id === claim!.id);
    expect(returned!.status).toBe('returned');
    expect(returned!.decisionReason).toContain('different person');
    expect(walletFor(afterReturn, FEEL_GOOD).balance.amountMinor).toBe(wallet.balance.amountMinor);

    await page.reload();
    const historyRow = page.getByTestId(`claim-${claim!.id}`);
    await expect(historyRow).toContainText('Returned');
    await expect(historyRow).toContainText('different person');
  });
});
