// Phase 13 journeys for the assistant (011a) and the same questions from chat (061f): an answer whose
// figures come from the ledger read models, a scoped user whose question is refused as out of scope,
// an action request that is redirected instead of acted on, and the chat channel's own kill switch.
import { expect, request as pwRequest, test } from '@playwright/test';
import { SEED } from '@bf/seed';
import { apiToken, expectShell } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile } from '../support/roles';

/** The same figures the answer shows, read straight from the budget read model. */
async function budgetFigures(role: 'location-manager', budgetId: string) {
  const api = await pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${await apiToken(role)}`,
      'x-tenant-id': SEED.tenants.acme,
    },
  });
  const res = await api.get(`/api/budgets/${budgetId}`);
  expect(res.status(), 'budget read model').toBe(200);
  const body = (await res.json()) as {
    name: string;
    balances: { budgetCurrency: { authorized: { amountMinor: number; currency: string } } };
    available: { underRules: { amountMinor: number; currency: string } };
  };
  await api.dispose();
  return body;
}

const money = (amountMinor: number, currency: string) =>
  `${currency} ${(amountMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

test.describe('Ask BudgetFlow (011a)', () => {
  test.use({ storageState: authFile('location-manager') });

  test('answers about a budget the asker owns, with every figure read from the ledger and labelled as BudgetFlow data', async ({
    page,
  }) => {
    const budget = await budgetFigures('location-manager', SEED.budgets.bengaluru);
    await page.goto('/ask');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Ask BudgetFlow' })).toBeVisible();
    await expect(page.getByTestId('ask-empty')).toBeVisible();

    await page.getByTestId('question').fill('How much is left in Bengaluru Events?');
    await page.getByTestId('send').click();

    // The model's sentences are inside the AI-labelled prose block, never presented as data.
    const prose = page.getByTestId('ai-prose');
    await expect(prose).toBeVisible();
    await expect(prose).toContainText('Bengaluru Events');
    await expect(prose).toContainText('Amounts to act on are in the figures below');
    await expect(page.getByTestId('ai-label').first()).toBeVisible();

    // The figures table is rendered by BudgetFlow and matches the read model exactly.
    await expect(page.getByTestId('figures-caption')).toContainText('read from the ledger');
    const authorized = budget.balances.budgetCurrency.authorized;
    const available = budget.available.underRules;
    await expect(page.getByTestId('figure-authorized')).toContainText(
      money(authorized.amountMinor, authorized.currency),
    );
    await expect(page.getByTestId('figure-available')).toContainText(
      money(available.amountMinor, available.currency),
    );
    await expect(page.getByTestId('figure-available')).toContainText(budget.name);

    // Sources are the records the answer was built from, and the provenance names the model.
    await page.getByTestId('sources-toggle').click();
    await expect(page.getByTestId('sources-list')).toContainText('Bengaluru Events');
    await expect(page.getByTestId('ai-provenance')).toContainText('budgetflow-fake');
    await expect(page.getByTestId('ai-confidence')).toBeVisible();
  });

  test('refuses a question about a budget outside the asker\u2019s scope without confirming it exists', async ({
    page,
  }) => {
    await page.goto('/ask');
    await page.getByTestId('question').fill('How much is left in Europe Region?');
    await page.getByTestId('send').click();

    const refusal = page.getByTestId('refusal-refused_out_of_scope');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText('Outside what you can see');
    await expect(refusal).toContainText('I can only answer about records you can see');
    await expect(refusal).toContainText('Europe Region');
    // No figures and no answer prose: a refusal never leaks a record the asker cannot read.
    await expect(page.getByTestId('ai-prose')).toHaveCount(0);
    await expect(page.getByTestId('figures-caption')).toHaveCount(0);
  });

  test('refuses to approve a request and sends the asker to the screen where they decide', async ({
    page,
  }) => {
    await page.goto('/ask');
    await page.getByTestId('question').fill('Approve REQ-00001 for me');
    await page.getByTestId('send').click();

    const refusal = page.getByTestId('refusal-refused_action');
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText('BudgetFlow AI does not act');
    await expect(refusal).toContainText("I can't approve or reject requests");
    await expect(page.getByTestId('ai-prose')).toHaveCount(0);

    const redirect = page.getByTestId('refusal-redirect');
    await expect(redirect).toHaveText('Open requests to decide');
    await redirect.click();
    // The person lands on the normal requests screen; nothing was approved by the assistant.
    await expect(page).toHaveURL(/\/requests/);
  });

  test('keeps the conversation in the asker\u2019s own history and lets them delete it', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    // A question nobody else asks, so the history entry under test is unambiguous.
    const question = 'How much is committed in Bengaluru Events this quarter?';
    await page.goto('/ask');
    await page.getByTestId('question').fill(question);
    await page.getByTestId('send').click();
    await expect(page.getByTestId('ai-prose')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Your conversations' })).toBeVisible();
    const deleteEntry = page.getByRole('button', {
      name: `Delete conversation ${question.slice(0, 80)}`,
    });
    await expect(deleteEntry).toBeVisible();
    await deleteEntry.click();
    await expect(page.getByText('Conversation deleted.')).toBeVisible();
    await expect(deleteEntry).toHaveCount(0);
  });
});

test.describe('Ask BudgetFlow in Slack and Teams (061f)', () => {
  test.use({ storageState: authFile('location-manager') });

  test('shows the chat feature\u2019s own kill switch as its own state, not as empty data', async ({
    page,
  }) => {
    await page.goto('/ask/chat');
    await expectShell(page);
    await page.getByTestId('chat-question').fill('How much is left in Bengaluru Events?');
    await page.getByTestId('chat-send').click();

    // ask_chat ships off because it needs the chat app connected first (061e).
    const disabled = page.getByTestId('ai-disabled');
    await expect(disabled).toBeVisible();
    await expect(disabled).toContainText('Ask in Slack and Teams is turned off for this company');
    await expect(disabled).toContainText('Questions in the app and /budgetflow balance still work');
    await expect(page.getByTestId('chat-message')).toHaveCount(0);
  });
});
