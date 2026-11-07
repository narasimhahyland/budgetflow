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

  test('a claim states the receipt it needs and refuses to submit without one', async ({
    page,
  }) => {
    const overview = await getJson<WalletOverview>('event-organizer', '/api/wallets');
    const wallet = walletFor(overview, FEEL_GOOD);
    const amountMinor = 1_200;
    expect(wallet.balance.amountMinor).toBeGreaterThan(amountMinor);

    await page.goto('/wallets');
    await page.getByTestId(`claim-from-${FEEL_GOOD}`).click();
    await page.getByTestId('claim-merchant').fill('Fitness First Indiranagar');
    await page.getByTestId('claim-amount').fill((amountMinor / 100).toFixed(2));

    // Within the allowance, so the check line is encouraging — and the claim is still refused,
    // because this programme pays nothing without a receipt and there is no way to attach one yet.
    await expect(page.getByTestId('claim-check')).toContainText(
      money(wallet.balance.amountMinor - amountMinor, wallet.balance.currency),
    );
    await expect(page.getByTestId('claim-receipt-blocked')).toContainText(
      'this programme pays nothing without one',
    );
    await expect(page.getByTestId('claim-submit')).toBeDisabled();

    // Nothing was submitted, so the programme budget is untouched.
    const after = await getJson<WalletOverview>('event-organizer', '/api/wallets');
    expect(walletFor(after, FEEL_GOOD).balance.amountMinor).toBe(wallet.balance.amountMinor);
    expect(after.claims.length).toBe(overview.claims.length);
  });
});

test.describe('the reviewer queue shows what is waiting, and nothing else (120b)', () => {
  test.use({ storageState: authFile('location-manager') });

  test('a programme reviewer sees the queue with its pre-encumbrance explained', async ({
    page,
  }) => {
    const queue = await getJson<{ items: WalletClaim[] }>(
      'location-manager',
      '/api/wallets/claims?status=submitted',
    );

    await page.goto('/wallets/review');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Wallet claims to review' })).toBeVisible();
    await expect(page.getByTestId('review-note')).toContainText(
      'has already pre-encumbered its programme budget',
    );

    // The deterministic seed submits no claim, so this queue is empty and has to say so rather
    // than render a headed table with nothing under it. Asserted outright instead of branching on
    // the count: were the queue to go empty because scoping broke, a branch would quietly take the
    // empty path and pass, and were a claim ever seeded, this fails here and asks to be extended.
    expect(queue.items, 'the deterministic seed leaves no claim waiting for review').toEqual([]);
    await expect(page.getByTestId('review-empty')).toContainText('No claims waiting');
  });
});
