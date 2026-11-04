// Actuals journeys (80a, 80b, 80d, 85a, 53, 54): the seeded November ERP import with matches by currency at the
// locked plan rate, a fresh import whose unmatched lines are resolved from the queue drawer (charged to a
// budget, marked not budget-relevant), accruals and prepaids, commitment hygiene prompts, and an event whose
// close is blocked by an unmatched actual. Mutating journeys run once, on desktop.
import { expect, request as pwRequest, test } from '@playwright/test';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { apiToken, expectShell } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile } from '../support/roles';

const uniq = () => randomUUID().slice(0, 8).toUpperCase();

test.describe('actuals import and matching', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('shows the November ERP import: auto-matched, partial and unmatched lines by currency at the plan rate', async ({
    page,
  }) => {
    await page.goto('/finance/actuals?file=erp-actuals-2026-11.csv');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Actuals import' })).toBeVisible();
    await expect(page.getByTestId('batch-file')).toHaveText('erp-actuals-2026-11.csv');
    await expect(page.getByTestId('batch-status')).toContainText('Posted');
    await expect(page.getByTestId('kpi-read')).toHaveText('9');
    await expect(page.getByTestId('kpi-auto')).toHaveText('3');
    await expect(page.getByTestId('kpi-partial')).toHaveText('3');
    await expect(page.getByTestId('kpi-unmatched')).toHaveText('3');
    const byCurrency = page.getByRole('table', { name: 'Imported lines by transaction currency' });
    await expect(byCurrency.getByRole('row', { name: /INR/ })).toContainText('83.2500');
    await expect(page.getByText('Budget consumption uses the locked plan rate.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Unmatched queue' })).toBeVisible();
  });

  test('imports a file, resolves its unmatched lines from the queue drawer and cross-checks them through the API', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mutating journey runs once, on desktop');
    const ref = `JRN-${uniq()}`;
    const csv = [
      'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,memo',
      `${ref}-1,2026-11-04,4162.50,INR,HYL-IN,CC-IN-BLR-200,6100,Journey team snacks ${ref}`,
      `${ref}-2,2026-11-04,15.00,USD,HYL-IN,,6100,Personal item ${ref}`,
    ].join('\n');
    await page.goto('/finance/actuals');
    await page.getByTestId('import-another').click();
    await page.getByTestId('csv-text').fill(csv);
    await page.getByRole('button', { name: 'Continue to column mapping' }).click();
    await expect(page.getByRole('heading', { name: 'Map columns' })).toBeVisible();
    await expect(page.getByTestId('map-source_ref')).toContainText('source_ref');
    await page.getByRole('button', { name: 'Review 2 lines' }).click();
    await expect(page.getByTestId('kpi-unmatched')).toHaveText('2');
    await page.getByTestId('post-import').click();
    await expect(page.getByTestId('import-notice')).toContainText('2 sent to the unmatched queue');

    await page.getByRole('link', { name: 'Go to unmatched queue' }).click();
    await page.getByTestId('queue-search').fill(ref);
    await page.getByTestId(`queue-row-${ref}-1`).click();
    const drawer = page.getByTestId('match-drawer');
    await expect(drawer.getByTestId('fx-plan')).toContainText('USD 50.00');
    await drawer.getByTestId('candidate-budget').click();
    await drawer.getByTestId('direct-budget').click();
    await page.getByRole('option', { name: 'Bengaluru Events' }).click();
    await drawer.getByTestId('match-button').click();
    await expect(page.getByTestId('queue-notice')).toContainText(
      `${ref}-1 matched to Bengaluru Events`,
    );

    await page.getByTestId(`queue-row-${ref}-2`).click();
    await drawer.getByTestId('not-relevant').click();
    await drawer.getByTestId('exclude-reason').fill('Personal spend, recovered from the employee');
    await drawer.getByTestId('confirm-exclude').click();
    await expect(page.getByTestId('queue-notice')).toContainText('marked not budget-relevant');

    const api = await pwRequest.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: {
        authorization: `Bearer ${await apiToken('finance-controller')}`,
        'x-tenant-id': SEED.tenants.acme,
      },
    });
    const body = (await (await api.get(`/api/actuals?status=all&q=${ref}`)).json()) as {
      items: { sourceRef: string; status: string; budget: { amountMinor: number } | null }[];
    };
    const byRef = Object.fromEntries(body.items.map((i) => [i.sourceRef, i]));
    expect(byRef[`${ref}-1`]).toMatchObject({ status: 'matched' });
    expect(byRef[`${ref}-2`]).toMatchObject({ status: 'excluded' });
    await api.dispose();
  });

  test('employees cannot open the actuals screens', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile('employee') });
    const page = await ctx.newPage();
    await page.goto('/finance/actuals');
    await expect(
      page.getByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
    await ctx.close();
  });
});

test.describe('accruals, commitment hygiene and event close', () => {
  test.use({ storageState: authFile('finance-controller') });

  test('accruals and prepaids list the seeded Hack Week accrual and the Annual Day venue deposit', async ({
    page,
  }) => {
    await page.goto('/finance/actuals/accruals');
    await expect(page.getByRole('heading', { name: 'Accruals and prepaids' })).toBeVisible();
    const accruals = page.getByRole('table', { name: 'Accruals' });
    await expect(accruals.getByRole('row', { name: /Hack Week meals and venue/ })).toContainText(
      'INR 33,000.00',
    );
    const prepaids = page.getByRole('table', { name: 'Prepaids' });
    await expect(prepaids.getByRole('row', { name: /CMT-00000002/ })).toContainText(
      'INR 60,000.00',
    );
  });

  test('commitment hygiene prompts to release the stale team lunch commitment', async ({
    page,
  }) => {
    await page.goto('/finance/actuals/commitments');
    const row = page
      .getByRole('table', { name: 'Open commitments' })
      .getByRole('row', { name: /Quarterly team lunch/ });
    await expect(row).toContainText('Release suggested');
    await expect(row).toContainText('USD 2,000.00');
  });

  test('the New York offsite cannot close while an actual with its event code is unmatched', async ({
    page,
  }) => {
    await page.goto('/finance/actuals/events');
    await page.getByTestId('event-NYC-OFFSITE-26').click();
    await expect(page.getByRole('heading', { name: 'New York Team Offsite' })).toBeVisible();
    await expect(page.getByTestId('blocker-EVENT_HAS_UNMATCHED_ACTUALS')).toContainText(
      'Match or exclude every actual',
    );
    await page.getByTestId('close-reason').fill('Trying to close early');
    await expect(page.getByTestId('close-event')).toBeDisabled();
  });
});
