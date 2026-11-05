// Phase 5 approval journeys: the approver decides in the inbox with the budget-impact card and the
// delegation-of-authority route, decides from the actionable email (approve, and reject through the
// one-step reason page), and the requester sees freeze holding and set to zero cancelling a request.
// Each journey builds its own budget tree through the API and runs once, on desktop.
import { expect, test } from '@playwright/test';
import { authFile } from '../support/roles';
import {
  control,
  desktopOnly,
  directorTree,
  getRequest,
  linkPath,
  mailTo,
  pageAs,
  spendingRequest,
  taskOf,
  usdText,
} from './api';

test.describe('approval inbox', () => {
  test.use({ storageState: authFile('department-head') });

  test('Lena approves a request with the budget-impact card and her DoA limit on the route', async ({
    page,
    browser,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const { team } = await directorTree();
    const r = await spendingRequest(team.id, 120_000);
    const taskId = await taskOf(r.id, 'department-head', 'requests');

    await page.goto(`/approvals?task=${taskId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Approval inbox' })).toBeVisible();
    const detail = page.getByRole('region', { name: 'Approval detail' });
    await expect(detail.getByText(r.ref).first()).toBeVisible();
    await expect(detail.locator('bf-budget-impact')).toContainText('USD');
    await expect(
      detail.getByRole('complementary', { name: 'Check before you decide' }),
    ).toBeVisible();
    await expect(detail.locator('bf-approval-route')).toContainText('Lena Fischer');

    await detail.getByRole('checkbox', { name: 'I have no conflict of interest' }).check();
    await detail.getByRole('button', { name: `Approve ${usdText(120_000)}` }).click();
    await expect.poll(async () => (await getRequest(r.id)).status).toBe('approved');

    const requester = await pageAs(browser, 'budget-owner');
    await requester.goto(`/requests/${r.id}?tab=history`);
    const history = requester.getByTestId('request-history');
    await expect(history).toContainText('Lena Fischer');
    await expect(history).toContainText('Within DoA');
    await requester.context().close();
  });
});

test.describe('actionable approval email', () => {
  test.use({ storageState: authFile('department-head') });

  test('approve from the email link, then reject another request on the reason page', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const { team } = await directorTree();
    const ok = await spendingRequest(team.id, 45_000);
    const okMail = await mailTo('department-head', ok.ref);
    await page.goto(linkPath(okMail.Text, 'Approve '));
    await expect(page.getByTestId('email-action-result')).toBeVisible();
    await expect.poll(async () => (await getRequest(ok.id)).status).toBe('approved');

    const no = await spendingRequest(team.id, 30_000);
    const noMail = await mailTo('department-head', no.ref);
    await page.goto(linkPath(noMail.Text, 'Reject:'));
    const rejectButton = page.getByRole('button', { name: `Reject ${no.ref}` });
    await expect(rejectButton).toBeDisabled();
    await page.getByLabel('Reason for the requester').fill('Use the team lunch allowance instead.');
    await rejectButton.click();
    await expect(page.getByTestId('email-action-result')).toBeVisible();
    await expect.poll(async () => (await getRequest(no.id)).status).toBe('rejected');

    await page.goto(linkPath(noMail.Text, 'Reject:'));
    await expect(page.getByRole('link', { name: 'Open in BudgetFlow' })).toBeVisible();
  });
});

test.describe('budget controls seen by the requester', () => {
  test.use({ storageState: authFile('budget-owner') });

  test('freeze holds a waiting request; set to zero cancels it with the reason', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const { team } = await directorTree();
    const r = await spendingRequest(team.id, 80_000);

    await control(team.id, 'freeze');
    await expect.poll(async () => (await getRequest(r.id)).onHold, { timeout: 30_000 }).toBe(true);
    await page.goto(`/requests/${r.id}`);
    await expect(page.getByRole('heading', { level: 1, name: /Journey request/ })).toBeVisible();
    await expect(
      page.getByText('Budget frozen: decisions wait until it is unfrozen'),
    ).toBeVisible();

    await control(team.id, 'set_to_zero');
    await expect
      .poll(async () => (await getRequest(r.id)).status, { timeout: 30_000 })
      .toBe('cancelled');
    await page.reload();
    await expect(
      page.getByText('Cancelled: budget set to zero. Nothing was charged.'),
    ).toBeVisible();
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('request-history')).toContainText('BudgetFlow');
  });
});
