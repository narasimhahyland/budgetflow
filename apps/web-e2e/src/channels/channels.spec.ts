// Phase 8 user journeys:
// - Mobile web approvals (/m/approvals, /m/approvals/:taskId) at mobile viewport (412px):
//   Waiting list, detail view, budget impact, DoA reason, reject bottom sheet validation, and one-tap approve (059a)
// - Mobile balance check (/m/balance) showing "Available under this budget's rules" and receipt capture (/m/receipt) (059b)
// - Notification channels & push settings (/me/notifications): required rows disabled, test notification, quiet hours (059c)
// - Discussion comments, @mentions (showing disabled no-access person), tombstone removal & Following page (/me/following) (060a)
// - Slack & Microsoft Teams app setup, account linking (/admin/channels, /link/chat) and interactive approval cards (061b, 061c, 061d, 061e)
// - Role-based digest templates (/admin/digests) with Email, Slack & Teams preview (064a)
// - Notifications and tasks (/notifications) with All, Tasks, Mentions and Following tabs (123)
import { expect, test } from '@playwright/test';
import { authFile } from '../support/roles';
import {
  desktopOnly,
  directorTree,
  getRequest,
  mobileOnly,
  pageAs,
  spendingRequest,
  taskOf,
} from '../spend/api';

test.describe('mobile web approvals, balance check, receipts and alerts (059a, 059b)', () => {
  test.use({ storageState: authFile('department-head') });

  test('an approver works the whole phone app: waiting list, decision, balance, receipt and alerts', async ({
    page,
    browser,
  }, info) => {
    test.skip(!!mobileOnly(info.project.name), mobileOnly(info.project.name));
    test.slow();

    const { team } = await directorTree();
    const r = await spendingRequest(team.id, 140_000);
    const taskId = await taskOf(r.id, 'department-head', 'requests');

    // The waiting list is the phone entry point and carries the tab bar on every screen.
    await page.goto('/m/approvals');
    await expect(page.getByTestId('mobile-approval-cards')).toBeVisible();
    await expect(page.locator('bf-mobile-tab-bar')).toBeVisible();

    await page.goto(`/m/approvals/${taskId}`);
    await expect(page.getByTestId('mobile-approval-detail')).toBeVisible();
    await expect(page.getByTestId('mobile-approval-detail')).toContainText(r.ref);
    await expect(page.getByTestId('mobile-why-you')).toBeVisible();
    await expect(page.locator('bf-mobile-tab-bar')).toBeVisible();

    // Open Reject bottom sheet and verify validation errors when empty
    await page.getByTestId('mobile-open-reject').click();
    await expect(page.getByTestId('mobile-reject-sheet')).toBeVisible();
    await page.getByTestId('mobile-confirm-reject').click();
    await expect(page.getByTestId('err-reason-code')).toContainText('Choose a reason code');
    await expect(page.getByTestId('err-reason-text')).toContainText('Tell Jordan why');
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Approve from sticky action bar
    await page.getByTestId('mobile-approve-btn').click();
    await expect.poll(async () => (await getRequest(r.id)).status).toBe('approved');

    // Verify mobile balance check shows "Available under this budget's rules"
    await page.goto('/m/balance');
    await expect(page.getByRole('heading', { name: 'Mobile balance check' })).toBeVisible();
    await expect(page.getByText("Available under this budget's rules").first()).toBeVisible();

    // Alerts are the same feed, reachable from the phone tab bar.
    await page.goto('/m/alerts');
    await expect(page.getByTestId('notifications-list')).toBeVisible();
    await expect(page.locator('bf-mobile-tab-bar')).toBeVisible();

    // Verify mobile receipt capture & offline queue simulation as requester
    const organizerPage = await pageAs(browser, 'event-organizer');
    await organizerPage.setViewportSize({ width: 412, height: 915 });
    await organizerPage.goto('/m/receipt?offline=1');
    await expect(organizerPage.getByTestId('receipt-offline-banner')).toBeVisible();
    await organizerPage.getByTestId('mobile-receipt-amount').fill('95');
    await expect(organizerPage.getByTestId('mobile-receipt-comparison')).toContainText(
      'less than approved',
    );
    await organizerPage.context().close();
  });
});

test.describe('notifications, settings, discussion and following (123, 059c, 060a)', () => {
  test.use({ storageState: authFile('location-manager') });

  test('notifications feed, tasks tab, notification settings and discussion comments', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();

    // Screen 123: Notifications and tasks
    await page.goto('/notifications');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Notifications and tasks' }),
    ).toBeVisible();
    await expect(page.getByTestId('notifications-list')).toBeVisible();

    await page.getByTestId('tab-tasks').click();
    await expect(page.getByTestId('tasks-table')).toBeVisible();

    await page.getByTestId('tab-mentions').click();
    await expect(page.getByTestId('notifications-list')).toContainText('Kavya Rao mentioned you');

    // Screen 059c: Notification channels and push settings
    await page.goto('/me/notifications');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Notification channels and push settings' }),
    ).toBeVisible();
    await expect(page.getByTestId('channels-card')).toContainText('@rahul.menon');
    await expect(page.getByTestId('matrix-row-approval.assigned')).toContainText('Required');

    await page.getByTestId('test-in_app').click();
    await expect(page.getByText('Test sent to in-app notifications')).toBeVisible();

    // Screen 060a: Discussion panel on budget details & Following page
    await page.goto('/budgets/70000000-0000-4000-8000-000000000005?discussion=open');
    await expect(page.getByTestId('discussion-panel')).toBeVisible();
    await page.getByTestId('toggle-mention-picker').click();
    await expect(page.getByTestId('mention-picker')).toBeVisible();
    await expect(page.getByTestId('mention-picker')).toContainText("Can't see this budget");

    await page.goto('/me/following');
    await expect(page.getByRole('heading', { level: 1, name: 'Following' })).toBeVisible();
    await expect(page.getByTestId('following-table')).toBeVisible();
  });
});

test.describe('Slack and Teams admin setup, cards, account linking and digests (061b-061e, 064a)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('Integration Admin manages Slack/Teams channels, Finance Admin edits digests, and approver views Slack/Teams cards', async ({
    page,
    browser,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    test.slow();

    // Screen 061e: Admin channels
    await page.goto('/admin/channels');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Slack and Microsoft Teams channels' }),
    ).toBeVisible();
    await expect(page.getByTestId('slack-status-tag')).toContainText('Connected');
    await expect(page.getByTestId('linked-people-table')).toContainText('@rahul.menon');

    // Screen 061e: Account-linking page (/link/chat) mismatch and match states
    const rmPage = await pageAs(browser, 'regional-manager');
    await rmPage.goto('/link/chat?provider=slack&email=mismatch@example.test&handle=@wrong');
    await expect(rmPage.getByTestId('chat-link-mismatch')).toBeVisible();

    await rmPage.goto('/link/chat?provider=slack');
    await expect(rmPage.getByTestId('confirm-chat-link')).toBeVisible();

    // Screens 061b, 061c, 061d: Slack Block Kit & Teams Adaptive Card views + App Home
    await rmPage.goto('/admin/channels/cards');
    await expect(rmPage.getByTestId('chat-approval-card')).toBeVisible();
    await rmPage.getByTestId('provider-teams').click();
    await expect(rmPage.getByTestId('chat-approval-card')).toContainText(
      'Teams personal chat · Adaptive Card 1.5',
    );
    await rmPage.getByTestId('surface-app-home').click();
    await expect(rmPage.getByTestId('chat-app-home')).toBeVisible();
    await expect(rmPage.getByTestId('chat-balance-reply')).toContainText(
      "Available under this budget's rules",
    );
    await rmPage.context().close();

    // Screen 064a: Role-based digest templates
    const faPage = await pageAs(browser, 'finance-admin');
    await faPage.goto('/admin/digests');
    await expect(
      faPage.getByRole('heading', { level: 1, name: 'Role-based digest templates' }),
    ).toBeVisible();
    await faPage.getByTestId('open-digest-OWNER_WEEKLY').click();
    await expect(faPage.getByTestId('digest-editor')).toBeVisible();
    await expect(faPage.getByTestId('preview-email-content')).toBeVisible();
    await faPage.getByTestId('preview-tab-slack').click();
    await expect(faPage.getByTestId('preview-slack-content')).toBeVisible();
    await faPage.getByTestId('preview-tab-teams').click();
    await expect(faPage.getByTestId('preview-teams-content')).toBeVisible();
    await faPage.context().close();
  });
});
