// Navan live integration journeys (16a, gap B1), against the mock provider: an Integration Admin
// connects Navan with OAuth client credentials and tests it, maps the Navan fields that carry the
// event code and the cost center, turns on Expense: Write and publishes the event codes; Finance sees
// Navan spend that arrived above the remaining budget in the post-spend exception queue and settles
// it. Numbers and states are cross-checked against the API.
import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SEED } from '@bf/seed';
import { apiToken } from '../support/auth';
import { API_URL, env } from '../support/env';
import { authFile, type RoleId } from '../support/roles';
import { desktopOnly } from '../spend/api';

// One connection carries the whole story, so the journeys run in order.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MOCK = `http://localhost:${env('BF_MOCK_PROVIDERS_PORT')}`;
/** Placeholder for the mock only; never a real credential. */
const SECRET = 'navan-mock-secret-0001';
const CLIENT_ID = 'budgetflow-eu-client';
const tag = randomUUID().slice(0, 6).toUpperCase();

interface Detail {
  summary: { id: string; provider: string; status: string };
  settings: Record<string, unknown>;
}
interface Run {
  id: string;
  status: string;
  errorSummary: string | null;
}

const tokens = new Map<RoleId, Promise<string>>();
async function apiAs(role: RoleId): Promise<APIRequestContext> {
  const t = tokens.get(role) ?? apiToken(role);
  tokens.set(role, t);
  return pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${await t}`,
      'x-tenant-id': SEED.tenants.acme,
      accept: 'application/json',
    },
  });
}

async function call<T>(role: RoleId, method: 'get' | 'post', path: string, data?: unknown) {
  const ctx = await apiAs(role);
  const res =
    method === 'get'
      ? await ctx.get(path)
      : await ctx.post(path, { data, headers: { 'idempotency-key': randomUUID() } });
  expect(res.status(), `${role} ${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  const body = (await res.json()) as T;
  await ctx.dispose();
  return body;
}

async function navanConnection(): Promise<Detail | null> {
  const hub = await call<{ connections: { id: string; provider: string }[] }>(
    'integration-admin',
    'get',
    '/api/integrations',
  );
  const c = hub.connections.find((x) => x.provider === 'navan');
  return c
    ? call<Detail>('integration-admin', 'get', `/api/integrations/connections/${c.id}`)
    : null;
}

async function waitForRun(id: string): Promise<Run> {
  let run: Run | null = null;
  await expect
    .poll(
      async () => {
        run = await call<Run>('integration-admin', 'get', `/api/integrations/sync-runs/${id}`);
        return run.status;
      },
      { timeout: 60_000 },
    )
    .not.toBe('running');
  return run!;
}

test.describe('connect Navan (095, 16a)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('an Integration Admin connects Navan with client credentials and the test proves the scope', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    await pwRequest.newContext({ baseURL: MOCK }).then((m) => m.post('/_control/reset'));
    // The seed leaves Navan to be connected; a rerun on the same stack starts from there too.
    const earlier = await navanConnection();
    if (earlier) {
      const ctx = await apiAs('integration-admin');
      await ctx.delete(`/api/integrations/connections/${earlier.summary.id}`, {
        headers: { 'idempotency-key': randomUUID() },
      });
      await ctx.dispose();
    }

    await page.goto('/admin/integrations');
    await page.getByTestId('connect-system').click();
    await page.getByTestId('connect-provider').click();
    await page.getByRole('option', { name: /^Navan/ }).click();
    // Navan asks for the OAuth client id and the account's region, next to the secret.
    await page.getByTestId('connect-client-id').fill(CLIENT_ID);
    await page.getByTestId('connect-region').click();
    await page.getByRole('option', { name: /European Union/ }).click();
    await page.getByTestId('connect-credential').fill(SECRET);
    await page.getByTestId('connect-submit').click();

    await expect(page).toHaveURL(/\/admin\/integrations\/connections\//);
    await expect(page.getByRole('heading', { level: 1, name: 'Navan' })).toBeVisible();
    await expect(page.getByTestId('connector-status')).toHaveText('Connected');

    await page.getByTestId('tab-connection').click();
    await page.getByTestId('test-connection').click();
    const result = page.getByTestId('test-result');
    await expect(result).toContainText('The provider answered');
    await expect(result).toContainText('Expense: Write');
    // The secret went to the server once; it is never on the page again.
    expect((await page.locator('body').innerText()).includes(SECRET)).toBe(false);

    const detail = await navanConnection();
    expect(detail?.settings).toMatchObject({ region: 'eu', expenseWrite: false });
  });

  test('the field mapping names the Navan fields, write is turned on with its consequence, and event codes are published', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const navan = await navanConnection();
    expect(navan, 'Navan is connected by the previous journey').not.toBeNull();
    await page.goto(`/admin/integrations/connections/${navan!.summary.id}`);

    await page.getByTestId('tab-fields').click();
    await expect(page.getByTestId('navan-boundary')).toContainText(
      'BudgetFlow never approves inside Navan',
    );
    await page.getByTestId('navan-event-code-field').click();
    await page.getByRole('option', { name: /^Event code/ }).click();
    await page.getByTestId('navan-cost-center-field').click();
    // Only list fields are offered: a text field cannot hold event codes.
    await expect(page.getByRole('option', { name: /Trip purpose/ })).toHaveCount(0);
    await page.getByRole('option', { name: /^Cost center/ }).click();
    await page.getByTestId('navan-fields-save').click();
    await expect(page.getByTestId('connector-notice')).toContainText('Setting saved.');
    expect((await navanConnection())?.settings).toMatchObject({
      eventCodeFieldId: 'cf-event-code',
      costCenterFieldId: 'cf-cost-center',
    });

    // Turning write on says what it does in Navan before anything changes.
    await page.getByTestId('tab-connection').click();
    await page.getByTestId('setting-expenseWrite').click();
    await expect(page.getByTestId('setting-confirm')).toContainText(
      'never approves anything in Navan',
    );
    await page.getByTestId('setting-confirm-submit').click();
    await expect(page.getByTestId('connector-notice')).toContainText('Setting saved.');
    expect((await navanConnection())?.settings['expenseWrite']).toBe(true);

    // Publish the event codes: the run is queued for the worker and the page follows it.
    await page.getByTestId('tab-sync').click();
    await page.getByTestId('run-object').click();
    await page.getByRole('option', { name: 'Event codes · Outbound' }).click();
    await page.getByTestId('run-sync').click();
    const result = page.getByTestId('run-sync-result');
    await expect(result).toContainText('Event codes: Succeeded', { timeout: 60_000 });
    // On a fresh seed this run creates the options; on a reused stack they already match.
    await expect(result).toContainText(/option\(s\) created|already matches/);

    await page.getByTestId('tab-push').click();
    // A seeded event that accepts spend is now an option in Navan.
    const row = page
      .getByRole('table', { name: 'Pushed items' })
      .getByRole('row')
      .filter({ hasText: 'NYC-OFFSITE-26' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Sent');
  });
});

test.describe('the post-spend exception queue (074a) for Navan spend', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('Navan spend above the remaining budget waits for Finance, who settles it with a reason', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const navan = await navanConnection();
    expect(navan, 'Navan is connected by the first journey').not.toBeNull();

    // A rule sends this spend to the United States budget; nine million dollars is more than it has.
    await call('finance-admin', 'post', '/api/actuals/mapping-rules', {
      name: `Navan journey ${tag}`,
      priority: 10,
      match: { memoContains: `JRNY-${tag}` },
      targetBudgetId: SEED.budgets.unitedStates,
    });
    const id = `NVN-J-${tag}`;
    const mock = await pwRequest.newContext({ baseURL: MOCK });
    await mock.post('/_control/navan/transactions', {
      data: {
        items: [
          {
            id,
            type: 'CARD',
            transactionDate: '2026-11-14',
            modifiedAt: '2026-11-15T10:00:00.000Z',
            amount: '9000000.00',
            currency: 'USD',
            merchant: 'Harbor View Hotel Group',
            description: `JRNY-${tag} leadership summit`,
            user: { id: 'nvn-u-06', email: 'budget.owner@example.test' },
            hrFields: { subsidiary: 'HYL-US', costCenter: 'CC-US-NYC-300' },
            glCode: '6100',
          },
        ],
      },
    });
    const queued = await call<Run>(
      'integration-admin',
      'post',
      `/api/integrations/connections/${navan!.summary.id}/sync`,
      { object: 'transactions', direction: 'inbound', since: '2026-11-15' },
    );
    const run = await waitForRun(queued.id);
    expect(run.errorSummary).toContain('post-spend exception queue');

    await page.goto('/admin/rules/exceptions');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Post-spend exceptions' }),
    ).toBeVisible();
    const queue = page.getByRole('region', { name: /exception/ });
    const subject = queue.getByRole('row').filter({ hasText: id });
    await expect(subject).toContainText('Spend above the remaining budget');
    await expect(subject).toContainText('approved in Navan under its own policy');
    await expect(subject).toContainText('Jordan Smith');
    await subject.getByRole('button', { name: 'Settle' }).click();
    await page
      .getByRole('textbox', { name: 'Reason' })
      .fill('Summit agreed by the CEO; the United States budget is topped up next month.');
    await page.getByRole('button', { name: 'Settle this exception' }).click();
    await expect(page.getByText('The exception is settled')).toBeVisible();
    await expect(queue.getByRole('row').filter({ hasText: id })).toHaveCount(0);

    const list = await call<{ items: { sourceRef: string; status: string; resolution: string }[] }>(
      'finance-admin',
      'get',
      '/api/rules/exceptions?type=over_budget',
    );
    expect(list.items.find((e) => e.sourceRef === id)).toMatchObject({
      status: 'resolved',
      resolution: 'accept_with_reason',
    });
  });
});
