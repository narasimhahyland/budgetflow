// Phase 13 journeys for 113a: who may change an AI feature switch, what a feature sends to the model
// before it is turned on, the finance confirmation a finance-affecting feature needs, and a feature's
// own kill switch shown as its own state.
import { expect, test } from '@playwright/test';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';
import { apiAs, setAiFeature } from './support';
import { onRecordedProvider, RECORDED_MODEL } from './recorded';

onRecordedProvider();

// AI feature switches are tenant-wide, so every test that turns one on or off, and every test whose
// subject is a feature being off, runs in one serial group. Otherwise they would decide each other's
// starting state. The group puts the tenant back as the seed had it.
//
// This file runs in its own `tenant-switches` project, once, after the desktop, tablet and mobile
// journeys (playwright.config.ts). Turning `matching` off or `ask_chat` on while another worker's
// journey relies on the seeded state made those journeys fail at random.
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
    }) => {
      // Two sessions, a dialog per switch and four API round trips: longer than the default budget
      // on a loaded local stack.
      test.setTimeout(90_000);
      await page.goto('/admin/ai/features');
      await expectShell(page);
      await expect(page.getByRole('heading', { name: 'AI settings' })).toBeVisible();
      await expect(page.getByTestId('provider')).toContainText(RECORDED_MODEL);
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
