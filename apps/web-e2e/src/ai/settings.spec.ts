// Phase 13 journeys for 113a (AI settings, query log, accuracy), 016b (spending outlook) and 069a
// (policy assistant): who may change a switch, what a feature sends to the model before it is turned
// on, the finance confirmation a finance-affecting feature needs, and the query log's own permission.
import { expect, test } from '@playwright/test';
import { SEED } from '@bf/seed';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { apiAs, setAiFeature } from './support';

// AI feature switches are tenant-wide, so every test that turns one on or off, and every test whose
// subject is a feature being off, runs in one serial group. Otherwise they would decide each other's
// starting state. The group puts the tenant back as the seed had it.
test.describe('AI feature switches and the states they produce', () => {
  test.describe.configure({ mode: 'serial', retries: 0 });

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
      await expect(disabled).toContainText(
        'Questions in the app and /budgetflow balance still work',
      );
      await expect(page.getByTestId('chat-message')).toHaveCount(0);
    });
  });

  test.describe('AI settings (113a)', () => {
    test.use({ storageState: authFile('org-admin') });

    test('shows the exact fields a feature would send before it is turned on, and holds a finance feature pending until a Finance Admin confirms', async ({
      page,
      browser,
    }, info) => {
      test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
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
      // Still off for everyone until finance agrees. Asked as the finance controller, who holds the
      // actuals permission the feature needs, so the only thing standing in the way is the switch.
      const financeApi = await apiAs('finance-controller');
      const refused = await financeApi.post('/api/ai/matching-suggestions/run', {
        data: {},
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      expect(refused.status()).toBe(409);
      expect((await refused.json()) as { code: string }).toMatchObject({
        code: 'AI_FEATURE_DISABLED',
      });

      // The Organization Admin cannot confirm it themselves; the Finance Admin can, in their own right.
      await expect(page.getByTestId('confirm-finance-matching')).toHaveCount(0);
      const financePage = await (
        await browser.newContext({
          storageState: authFile('finance-admin'),
        })
      ).newPage();
      await financePage.goto('/admin/ai/features');
      await financePage.getByTestId('confirm-finance-matching').click();
      await expect(financePage.getByTestId('status-matching')).toContainText('On');
      await financePage.context().close();

      const allowed = await financeApi.post('/api/ai/matching-suggestions/run', {
        data: {},
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      expect(allowed.status(), 'the feature runs once finance has confirmed it').toBe(200);

      // Leave the tenant as the seed had it, so no other journey inherits this one's switches.
      await setAiFeature('ask_chat', false);
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
    // The scope applied (budget.read) is shown in words.
    await expect(row).toContainText('Read budget');
    // The question text never reaches the log; only the records and the scope do.
    await expect(page.getByRole('table', { name: 'AI query log' })).not.toContainText(
      'Europe Region',
    );
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

  test('leads with the rules engine outcome and never repeats it back as an AI explanation', async ({
    page,
  }) => {
    await page.goto('/policy-assistant');
    await expectShell(page);
    await page.getByTestId('policy-question').fill('Can I buy gifts for my team in Bengaluru?');
    await page.getByTestId('policy-explain').click();

    const result = page.getByTestId('policy-result');
    await expect(result).toBeVisible();
    // The outcome and its wording come from the rules engine, unchanged.
    await expect(result.getByTestId('outcome-not_covered')).toContainText('No policy covers this');
    await expect(result.getByTestId('policy-headline')).toContainText(
      'No BudgetFlow policy limits this. Normal approval applies.',
    );
    // On the seeded data the model's sentence is the engine's own, so nothing appears under an AI
    // label: the assistant explains a decision, it never restates one as if it were its own.
    await expect(result.getByTestId('policy-no-extra')).toBeVisible();
    await expect(result.getByTestId('ai-prose')).toHaveCount(0);
    await expect(result.getByTestId('ai-provenance')).toContainText('budgetflow-fake');
  });

  test('refuses to explain a request that belongs to someone else', async ({ page }) => {
    await page.goto('/policy-assistant');
    // The seeded team lunch request is not this employee's, so the assistant will not explain it.
    await page.getByTestId('policy-request-id').fill(TEAM_LUNCH_REQUEST);
    await page.getByTestId('policy-explain').click();

    const refusal = page.getByTestId('policy-result').getByTestId('refusal-refused_out_of_scope');
    await expect(refusal).toContainText(
      "I can only explain your own requests or requests you're deciding.",
    );
    await expect(page.getByTestId('ai-prose')).toHaveCount(0);
  });
});

/** The seeded Phase 5 team lunch request (libs/seed P5_IDS.requests.teamLunch). */
const TEAM_LUNCH_REQUEST = '73000000-0000-4000-8000-000000000010';
