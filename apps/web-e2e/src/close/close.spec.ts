// Period close journeys (80e): the checklist tells finance plainly why November cannot close, a soft
// check is accepted with a reason and stops holding the close while the hard ones still do, and the
// break-glass reopen of a closed period takes two different people — the requester's own approval is
// refused by the API and the screen says so instead of pretending the period moved.
import { expect, test } from '@playwright/test';
import { periodId, CALENDAR_INDEX } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { expectShell } from '../support/auth';
import { authFile } from '../support/roles';

const NOVEMBER = periodId(CALENDAR_INDEX.acmeGroup, 2026, 11);
/**
 * Reopening a period changes what its neighbours allow, so the break-glass journey works on the
 * India calendar (Apr-Mar, so Sep 2026 is period 6 of FY2027), which no other check asserts on, and
 * every assertion about September lives inside that one journey rather than beside it.
 */
const SEPTEMBER = periodId(CALENDAR_INDEX.acmeIndia, 2027, 6);

/**
 * Accepting a soft check and reopening a period both change what the checks above them report, so
 * within a project these run in declaration order in one worker. (`default`, not `serial`: a failure
 * must not hide the tests after it.)
 */
test.describe.configure({ mode: 'default' });

test.describe('period close checklist', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('November lists every period of the fiscal year and opens its checklist', async ({
    page,
  }) => {
    await page.goto('/finance/close');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Period close' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Oct 2026' })).toBeVisible();
    await page.getByRole('link', { name: 'Nov 2026' }).click();
    await expect(page).toHaveURL(new RegExp(`/finance/close/${NOVEMBER}$`));
    await expect(page.getByRole('heading', { name: 'Nov 2026' })).toBeVisible();
  });

  test('a close that cannot happen says so and leaves the button disabled', async ({ page }) => {
    await page.goto(`/finance/close/${NOVEMBER}`);
    await expectShell(page);
    const blocked = page.getByTestId('close-blocked');
    await expect(blocked).toContainText('Nov 2026 cannot close yet.');
    await expect(blocked).toContainText('gl tieout signed off');
    await expect(page.getByTestId('close-period')).toBeDisabled();
    await expect(page.getByTestId('close-ready')).toHaveCount(0);
  });

  test('a hard check cannot be accepted; only soft checks offer a reason', async ({ page }) => {
    await page.goto(`/finance/close/${NOVEMBER}`);
    await expectShell(page);
    await expect(page.getByText('GL tie-out signed off').first()).toBeVisible();
    await expect(page.getByTestId('acknowledge-gl_tieout_signed_off')).toHaveCount(0);
    await expect(page.getByTestId('acknowledge-accruals_reviewed').first()).toBeVisible();
  });
});

test.describe('accepting a soft check', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('the controller accepts a soft check with a reason and it stops holding the close', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    await page.goto(`/finance/close/${NOVEMBER}`);
    await expectShell(page);
    // Named outright rather than "whichever check still offers a button": a subject picked by what
    // happens to be acknowledgeable turns into a different check without the journey noticing.
    const accept = page.getByTestId('acknowledge-accruals_reviewed').first();
    await expect(accept).toBeVisible();
    await accept.click();

    await page.getByTestId('ack-reason-code').click();
    await page.getByRole('option').first().click();
    await page
      .getByTestId('ack-reason')
      .fill('Receipts arrive after the close; the lines post to December flagged as late.');
    await page.getByTestId('confirm-acknowledge').click();

    await expect(page.getByTestId('close-notice')).toContainText('accepted for');
    await expect(page.getByTestId('acknowledgement').first()).toContainText('Accepted by');
    // The hard checks are untouched, so the close is still refused and still says why.
    await expect(page.getByTestId('close-blocked')).toContainText('Nov 2026 cannot close yet.');
    await expect(page.getByTestId('close-period')).toBeDisabled();
  });
});

test.describe('break-glass reopen', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('reopening a closed period needs two different people', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const reason = `Auditor asked for an adjustment in the original period (${randomUUID().slice(0, 8)}).`;

    // A closed period offers no ordinary reopen: only the break-glass panel, away from the actions.
    await page.goto(`/finance/close/${SEPTEMBER}`);
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Sep 2026' })).toBeVisible();
    await expect(page.getByTestId('close-period')).toHaveCount(0);

    // The controller asks. The seed leaves September closed with nothing pending, so the request and
    // what it says are asserted outright: wrapping them in "if nothing is pending yet" would let the
    // journey pass without ever asking, and without reading the notice that says nothing has moved.
    await expect(page.getByTestId('break-glass-pending')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Break glass: reopen Sep 2026' })).toBeVisible();
    await page.getByTestId('request-break-glass').click();
    await page.getByTestId('break-glass-reason-code').click();
    await page.getByRole('option').first().click();
    await page.getByTestId('break-glass-reason').fill(reason);
    // Reopening is irreversible enough to be typed out, like set to zero.
    await page.getByTestId('break-glass-confirmation').fill('Sep 2026');
    await page.getByTestId('confirm-break-glass').click();
    await expect(page.getByTestId('close-notice')).toContainText(
      'does not move until a different person approves it',
    );
    await expect(page.getByTestId('break-glass-pending')).toContainText(reason);
    await expect(page.getByTestId('break-glass-pending')).toContainText('needs a second person');
    await expect(page.getByRole('heading', { level: 1, name: 'Sep 2026' })).toBeVisible();
    await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();

    // The same person cannot wave it through: the API refuses and the dialog shows why.
    await page.getByTestId('decide-break-glass').click();
    await page.getByTestId('decision-approve').click();
    await page.getByTestId('decision-reason').fill('Trying to approve my own request.');
    await page.getByTestId('confirm-decision').click();
    await expect(page.getByRole('dialog')).toContainText('two different people');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('break-glass-pending')).toBeVisible();

    // A second person approves, and only then does the period move.
    const second = await browser.newContext({ storageState: authFile('finance-admin') });
    const admin = await second.newPage();
    await admin.goto(`/finance/close/${SEPTEMBER}`);
    await expectShell(admin);
    await admin.getByTestId('decide-break-glass').click();
    await admin.getByTestId('decision-approve').click();
    await admin.getByTestId('decision-reason').fill('Agreed: restate in the original period.');
    await admin.getByTestId('confirm-decision').click();
    await expect(admin.getByTestId('close-notice')).toContainText('Approved');
    await expect(admin.getByRole('heading', { level: 1, name: 'Sep 2026' })).toBeVisible();
    await expect(admin.getByTestId('close-blocked')).toContainText('Sep 2026 cannot close yet.');
    await admin.close();
    await second.close();
  });
});

test.describe('period close scope', () => {
  test.use({ storageState: authFile('employee') });

  test('someone without ledger access is told so instead of seeing a blank page', async ({
    page,
  }) => {
    await page.goto('/finance/close');
    await expectShell(page);
    await expect(
      page.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
    await expect(
      page.getByText('Period close and year-end is not part of your role'),
    ).toBeVisible();
  });
});
