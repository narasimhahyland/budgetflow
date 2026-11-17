// Gap B7 journeys: a Finance Admin imports the Adaptive Planning plan as a Draft plan version from
// the connector's Plan tab (094a), and a requester hands an approved request off to a prefilled
// draft expense in Concur (117a), while the approver sees the request but not the action. What the
// screen shows is cross-checked against the API.
import { expect, request as pwRequest, test } from '@playwright/test';
import { P12_IDS, SEED, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { api } from '../budgets/api';
import { decide, desktopOnly, directorTree, pageAs, spendingRequest, taskOf } from '../spend/api';
import { apiToken } from '../support/auth';
import { API_URL, env } from '../support/env';
import { authFile } from '../support/roles';

const ADAPTIVE = P12_IDS.connections.adaptivePlanning;
const MOCK_URL = `http://localhost:${env('BF_MOCK_PROVIDERS_PORT')}`;

async function call(user: SeedUserId, method: 'PUT' | 'POST', path: string, data: unknown) {
  const ctx = await pwRequest.newContext();
  const res = await ctx.fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await apiToken(user)}`,
      'idempotency-key': randomUUID(),
      'x-tenant-id': SEED.tenants.acme,
      'content-type': 'application/json',
    },
    data,
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
}

test.describe('the Adaptive Planning plan becomes a Draft plan version (094a)', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('a Finance Admin previews the plan, imports it, and the draft is waiting on Plan versions', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const connectionId = ADAPTIVE;
    await call(
      'integration-admin',
      'PUT',
      `/api/integrations/connections/${connectionId}/mappings`,
      {
        entries: [
          {
            kind: 'plan_level',
            externalValue: 'Employee programs',
            internalValue: SEED.budgets.employeeExperience,
          },
          { kind: 'plan_level', externalValue: 'Reserve', internalValue: SEED.budgets.contingency },
        ],
      },
    );
    const version = `FY2027 Budget journey ${randomUUID().slice(0, 6)}`;
    const mock = await pwRequest.newContext({ baseURL: MOCK_URL });
    await mock.post('/_control/adaptive-plan', {
      data: {
        // The seeded credential stays expired (the hub journeys running alongside read that
        // state); the mock serves this plan to it anyway.
        ignoreCredential: true,
        version,
        fiscalYear: 'FY2027',
        currency: 'USD',
        levels: [
          { level: 'Employee programs', amount: '110000.00' },
          { level: 'Reserve', amount: '10000.00' },
        ],
      },
    });

    await page.goto(`/admin/integrations/connections/${connectionId}`);
    await page.getByTestId('tab-plan').click();
    await page.getByLabel('Version in the planning system').fill(version);
    await page.getByLabel('Fiscal year', { exact: true }).fill('FY2027');
    await page.getByRole('button', { name: 'Show the differences' }).click();
    await expect(page.getByTestId('plan-row-Employee programs')).toBeVisible();
    await expect(page.getByTestId('plan-row-Reserve')).toBeVisible();
    await expect(page.getByTestId('plan-refused')).toHaveCount(0);

    await page.getByRole('button', { name: 'Import as a draft plan version' }).click();
    const done = page.getByTestId('plan-imported');
    await expect(done).toContainText(
      `Draft plan version “${version} (Adaptive Planning)” created.`,
    );
    await expect(done).toContainText('Nothing has posted yet');
    await expect(
      page.getByRole('button', { name: 'Import as a draft plan version' }),
    ).toBeDisabled();

    // The API agrees: one draft version with that label in FY2027.
    const versions = await api<{ items: { label: string; status: string }[] }>(
      'finance-admin',
      'get',
      `/api/plan-versions?fiscalYearId=${SEED.fiscalYears.acmeFy2027}`,
    );
    const mine = versions.items.filter((v) => v.label === `${version} (Adaptive Planning)`);
    expect(mine).toEqual([expect.objectContaining({ status: 'draft' })]);
    await mock.post('/_control/reset');
  });
});

test.describe('hand-off of an approved request to a prefilled expense (117a)', () => {
  test.use({ storageState: authFile('budget-owner') });

  test('the requester checks the fields, creates the Concur draft once, and the approver only sees it', async ({
    page,
    browser,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const { team } = await directorTree();
    // TEAM-LUNCH maps to the Concur expense type "Meals - team" in the seed.
    const req = await api<{ id: string; ref: string }>('budget-owner', 'post', '/api/requests', {
      kind: 'spending',
      budgetId: team.id,
      amount: { amountMinor: 5_749, currency: 'USD' },
      spendType: 'team_lunch',
      category: 'TEAM-LUNCH',
      title: `Journey team lunch ${randomUUID().slice(0, 6)}`,
      purpose: 'Team lunch after the quarterly planning day',
    });
    await decide(await taskOf(req.id, 'department-head', 'requests'), 'department-head', {
      decision: 'approve',
    });

    await page.goto(`/requests/${req.id}`);
    const panel = page.getByTestId('expense-handoff');
    await expect(panel.getByRole('heading', { name: 'Expense' })).toBeVisible();
    await panel.getByRole('button', { name: 'Create expense in Concur' }).click();
    // The fields are listed as text before anything is sent.
    await expect(panel).toContainText(req.ref);
    await expect(panel).toContainText('USD 57.49');
    await expect(panel).toContainText('Meals - team');
    await expect(panel).toContainText('You submit it there.');
    await panel.getByRole('button', { name: 'Create draft expense' }).click();
    await expect(panel.getByTestId('handoff-status')).toContainText('Draft created in Concur');
    await expect(panel.getByRole('button', { name: 'Create draft expense' })).toHaveCount(0);

    const view = await api<{
      availability: string;
      handoff: { status: string; externalId: string };
    }>('budget-owner', 'get', `/api/requests/${req.id}/expense-handoff`);
    expect(view).toMatchObject({ availability: 'created', handoff: { status: 'draft_created' } });
    await expect(panel.getByTestId('handoff-status')).toContainText(view.handoff.externalId);

    // The approver sees the request and the draft's status, never the requester's action.
    const approver = await pageAs(browser, 'department-head');
    await approver.goto(`/requests/${req.id}`);
    const theirs = approver.getByTestId('expense-handoff');
    await expect(theirs.getByTestId('handoff-status')).toContainText('Draft created in Concur');
    await expect(theirs.getByRole('button', { name: /Create/ })).toHaveCount(0);
    await approver.context().close();
  });

  test('before approval the panel only says when the expense becomes available', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const { team } = await directorTree();
    const req = await spendingRequest(team.id, 2_500);
    await page.goto(`/requests/${req.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The panel is for approved spend: a pending request shows no Expense card at all.
    await expect(page.getByTestId('expense-handoff')).toHaveCount(0);
  });
});
