// Phase 13 journeys for 113a (AI settings, query log, accuracy), 016b (spending outlook) and 069a
// (policy assistant): who may change a switch, what a feature sends to the model before it is turned
// on, the finance confirmation a finance-affecting feature needs, and the query log's own permission.
import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { SEED } from '@bf/seed';
import { apiToken, expectShell } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile, type RoleId } from '../support/roles';

async function apiAs(role: RoleId): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${await apiToken(role)}`,
      'x-tenant-id': SEED.tenants.acme,
    },
  });
}

// Turning a feature on changes tenant state, so a retry would start from what the first attempt
// left behind. These journeys do not retry: a failure is real on a freshly seeded stack.
test.describe('AI settings (113a)', () => {
  test.describe.configure({ retries: 0 });
  test.use({ storageState: authFile('org-admin') });

  test('shows the exact fields a feature would send before it is turned on, and holds a finance feature pending', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const api = await apiAs('org-admin');

    await page.goto('/admin/ai/features');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'AI settings' })).toBeVisible();
    await expect(page.getByTestId('provider')).toContainText('budgetflow-fake');
    await expect(page.getByTestId('provider')).toContainText(
      'Provider keys are held in the server environment',
    );

    // Ask in Slack and Teams ships off, so this row is the turn-on path.
    await expect(page.getByTestId('status-ask_chat')).toContainText('Off');
    await page.getByTestId('switch-ask_chat').click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Turn on Ask in Slack and Teams?' }),
    ).toBeVisible();
    // The dialog lists the field names from the API, so nobody turns a feature on blind.
    const sent = dialog.getByTestId('data-sent');
    await expect(sent).toContainText('availableMinor');
    await expect(sent).toContainText('authorizedMinor');
    await expect(dialog).toContainText('It cannot approve, reject, move money');
    await dialog.getByTestId('confirm-turn-on').click();

    await expect(page.getByTestId('status-ask_chat')).toContainText('On');

    // Now the chat channel answers instead of refusing, through the same ask endpoint. Asked as the
    // budget's regional manager: the switch opens the channel, it never widens anyone's scope.
    const askApi = await apiAs('regional-manager');
    const answered = await askApi.post('/api/ai/ask', {
      data: { question: 'How much is left in India Region?', channel: 'slack' },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(answered.status()).toBe(200);
    expect((await answered.json()) as { outcome: string }).toMatchObject({ outcome: 'answered' });

    // A finance-affecting feature cannot be turned on by the Organization Admin alone.
    await page.getByTestId('switch-matching').click();
    await page.getByRole('dialog').getByTestId('confirm-turn-off').click();
    await expect(page.getByTestId('status-matching')).toContainText('Off');

    await page.getByTestId('switch-matching').click();
    const financeDialog = page.getByRole('dialog');
    await expect(financeDialog.getByTestId('needs-finance')).toContainText(
      'stays pending until a Finance Admin confirms it',
    );
    await financeDialog.getByTestId('confirm-turn-on').click();

    await expect(page.getByTestId('status-matching')).toContainText(
      'Waiting for Finance Admin confirmation',
    );
    await expect(page.getByTestId('pending-banner')).toContainText(
      'Transaction matching suggestions',
    );
    // Still off for everyone until finance agrees.
    const refused = await api.post('/api/ai/matching-suggestions/run', {
      data: {},
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(refused.status()).toBe(409);
    expect((await refused.json()) as { code: string }).toMatchObject({
      code: 'AI_FEATURE_DISABLED',
    });
    await askApi.dispose();
    await api.dispose();
  });

  test('validates the limits in plain English before they can be saved', async ({ page }) => {
    await page.goto('/admin/ai/features');
    await page.getByTestId('history-days').fill('200');
    await expect(page.getByTestId('settings-validation')).toContainText(
      'History must be 7 to 90 days.',
    );
    await expect(page.getByTestId('save-settings')).toBeDisabled();
  });
});

test.describe('AI query log and accuracy (113a)', () => {
  test('the auditor reads the log, which records the scope applied and never the question text', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: authFile('auditor') });
    const page = await ctx.newPage();
    const api = await apiAs('location-manager');
    // One real call to log: a question that is refused for being outside the asker's scope.
    await api.post('/api/ai/ask', {
      data: { question: 'How much is left in Europe Region?' },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });

    await page.goto('/admin/ai/log');
    await expect(page.getByRole('heading', { name: 'AI query log' })).toBeVisible();
    await expect(page.getByTestId('log-retention')).toContainText('append-only and kept 13 months');

    const row = page.getByRole('row', { name: /Rahul Menon/ }).first();
    await expect(row).toContainText('Refused \u2013 out of scope');
    await expect(row).toContainText('budget.read');
    // The question text never reaches the log; only the records and the scope do.
    await expect(page.getByRole('table', { name: 'AI query log' })).not.toContainText(
      'Europe Region',
    );
    await api.dispose();
    await ctx.close();
  });

  test('accuracy shows every metric against its threshold', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile('finance-admin') });
    const page = await ctx.newPage();
    await page.goto('/admin/ai/accuracy');
    await expect(page.getByRole('heading', { name: 'AI accuracy' })).toBeVisible();
    await expect(page.getByTestId('all-passed')).toContainText('at or above its threshold');
    const row = page.getByTestId('accuracy-row-ask-refuses_out_of_scope');
    await expect(row).toContainText('Refuses out-of-scope questions');
    await expect(row).toContainText('Pass');
    await ctx.close();
  });

  test('an employee is refused the query log in place, with the URL kept', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile('employee') });
    const page = await ctx.newPage();
    await page.goto('/admin/ai/log');
    await expect(
      page.getByRole('heading', { name: 'You cannot see the AI query log' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/ai\/log/);
    await ctx.close();
  });
});

test.describe('Spending outlook (016b)', () => {
  test.describe.configure({ retries: 0 });
  test.use({ storageState: authFile('finance-admin') });

  test('keeps the projection apart from the ledger figures and only offers steps the owner takes', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto('/insights/outlook');
    await expectShell(page);
    await page.getByTestId('run-outlook').click();
    await expect(page.getByText('Outlook recomputed from the ledger.')).toBeVisible();

    const row = page.getByTestId(`outlook-row-${SEED.budgets.bengaluru}`);
    await expect(row).toContainText('Rahul Menon');
    await expect(row).toContainText('Likely unused');
    // Authorized is the ledger figure; the year-end column is the AI projection, named as such.
    await expect(page.getByRole('columnheader', { name: 'Year-end outlook (AI)' })).toBeVisible();
    await expect(page.getByTestId(`range-${SEED.budgets.bengaluru}`)).toContainText('between');

    await page.getByTestId(`open-outlook-${SEED.budgets.bengaluru}`).click();
    const detail = page.getByTestId('outlook-detail');
    await expect(detail.getByTestId('figures-caption')).toContainText('read from the ledger');
    await expect(detail.getByTestId('detail-range')).toContainText('not spent money');
    await expect(detail.getByTestId('ai-provenance')).toHaveCount(0);
    await expect(detail.getByTestId('detail-model')).toContainText('budgetflow-fake');

    const nudge = detail.getByTestId(`nudge-${SEED.budgets.bengaluru}`);
    await expect(nudge).toContainText('may not use all of its budget');
    await expect(nudge).toContainText('Nothing is released or reduced from here');
    await expect(nudge.getByTestId('nudge-not-useful')).toBeVisible();
  });
});

test.describe('Policy assistant (069a)', () => {
  test.use({ storageState: authFile('employee') });

  test('shows the rules engine outcome first and the plain-English version under an AI label', async ({
    page,
  }) => {
    await page.goto('/policy-assistant');
    await expectShell(page);
    await page.getByTestId('policy-question').fill('Can I buy gifts for my team in Bengaluru?');
    await page.getByTestId('policy-explain').click();

    const result = page.getByTestId('policy-result');
    await expect(result).toBeVisible();
    // The headline is the rules engine's own outcome; the AI text sits beside it, labelled.
    await expect(result.getByTestId('policy-headline')).toBeVisible();
    await expect(result.getByTestId('ai-label')).toBeVisible();
    await expect(result.getByTestId('ai-provenance')).toContainText('budgetflow-fake');
  });
});
