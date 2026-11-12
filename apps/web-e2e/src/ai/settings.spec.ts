// Phase 13 journeys for 113a (AI settings, query log, accuracy), 016b (spending outlook) and 069a
// (policy assistant): who may change a switch, what a feature sends to the model before it is turned
// on, the finance confirmation a finance-affecting feature needs, and the query log's own permission.
import { expect, test } from '@playwright/test';
import { SEED } from '@bf/seed';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { apiAs } from './support';
import { onRecordedProvider, RECORDED_MODEL } from './recorded';

onRecordedProvider();

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
    await expect(detail.getByTestId('detail-model')).toContainText(RECORDED_MODEL);

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
    await expect(result.getByTestId('ai-provenance')).toContainText(RECORDED_MODEL);
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
