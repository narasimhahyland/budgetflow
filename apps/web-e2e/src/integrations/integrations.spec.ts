// Phase 12 integration journeys (092, 093-098, 094a, 099, 99a, 99b, 100, 101): the connector hub and
// its detail frame, running a sync and seeing what it moved, replacing a credential without the UI
// ever showing one, issuing and revoking an API key, webhook deliveries, SCIM tokens, resolving a
// cross-source duplicate, and what a reader and a role without integration permissions see.
//
// Figures and states are cross-checked against the API so the screen cannot quietly disagree with it.
import {
  expect,
  request as pwRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SEED } from '@bf/seed';
import { apiToken, expectShell } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile, type RoleId } from '../support/roles';
import { desktopOnly } from '../spend/api';

interface Health {
  connected: number;
  needsAttention: number;
  notConnected: number;
  retrying: number;
  deadLetter: number;
}
interface Connection {
  id: string;
  provider: string;
  displayName: string;
  category: string;
  status: string;
  attention: string | null;
}
interface Hub {
  health: Health;
  connections: Connection[];
  canManage: boolean;
}
interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: string;
}
interface SyncRun {
  id: string;
  provider: string;
  object: string;
  status: string;
  recordsRead: number;
  recordsApplied: number;
  recordsSkippedDuplicate: number;
}

// These journeys share one seeded tenant, so within a project they run in order in a single worker:
// that keeps the mutating ones off each other's data and the token cache below to one grant per role.
// (`default`, not `serial`: a failure must not hide the tests after it.) The journeys that change
// shared state are marked desktop-only one by one; the read-only ones run at every viewport.
test.describe.configure({ mode: 'default' });

// One token per role for the whole file: Keycloak refuses a burst of direct grants for one user.
const tokens = new Map<RoleId, Promise<string>>();
const tokenFor = (role: RoleId): Promise<string> => {
  const hit = tokens.get(role) ?? apiToken(role);
  tokens.set(role, hit);
  return hit;
};

async function apiAs(role: RoleId): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${await tokenFor(role)}`,
      'x-tenant-id': SEED.tenants.acme,
      accept: 'application/json',
    },
  });
}

async function getJson<T>(role: RoleId, path: string): Promise<T> {
  const ctx = await apiAs(role);
  const res = await ctx.get(path);
  expect(res.status(), `${role} GET ${path}: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as T;
  await ctx.dispose();
  return body;
}

async function postJson<T>(role: RoleId, path: string, data: unknown): Promise<T> {
  const ctx = await apiAs(role);
  const res = await ctx.post(path, {
    data,
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
  });
  expect(res.status(), `${role} POST ${path}: ${await res.text()}`).toBeLessThan(300);
  const body = (await res.json()) as T;
  await ctx.dispose();
  return body;
}

/** No page in this phase may ever render a stored credential, a key or a token it did not just issue. */
async function expectNoStoredSecretOnScreen(page: Page): Promise<void> {
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const placeholder of [
    'mock-erpnext-dev-only',
    'mock-ramp-dev-only',
    'mock-adaptive-expired',
  ])
    expect(body, `the stored credential must never reach the page`).not.toContain(placeholder);
}

test.describe('connector hub (092)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('an integration admin sees every connector, and the broken one is named', async ({
    page,
  }) => {
    const hub = await getJson<Hub>('integration-admin', '/api/integrations');
    expect(hub.canManage).toBe(true);
    const degraded = hub.connections.filter((c) => c.status === 'needs_attention');
    expect(degraded.length, 'at least one connector is not working').toBeGreaterThan(0);

    await page.goto('/admin/integrations');
    await expectShell(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();

    // The health strip reports what the API reports, not a number the browser worked out.
    await expect(page.getByTestId('health-connected')).toHaveText(String(hub.health.connected));
    await expect(page.getByTestId('health-attention')).toHaveText(
      String(hub.health.needsAttention),
    );

    // Every failing connector is stated, with its reason, not hidden behind a green tick.
    const banner = page.getByTestId('hub-attention');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('is not reaching BudgetFlow');
    for (const c of degraded) {
      await expect(banner).toContainText(c.displayName);
      const tile = page.getByTestId(`connector-tile-${c.provider}`);
      await expect(tile).toContainText('Needs attention');
      await expect(tile).toContainText(c.attention!);
    }

    for (const c of hub.connections)
      await expect(page.getByTestId(`connector-tile-${c.provider}`)).toContainText(c.displayName);

    await expectNoStoredSecretOnScreen(page);
  });

  test('a connector the provider refuses says what stopped and offers the fix', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    // The journey breaks the planning connector itself instead of trusting the seeded one to still
    // be broken: other suites on this stack repair it. The credential below is the placeholder the
    // mock planning provider rejects.
    const hub = await getJson<Hub>('integration-admin', '/api/integrations');
    const planning = hub.connections.find((c) => c.category === 'planning');
    expect(planning, 'a planning connector is connected').toBeTruthy();

    await page.goto(`/admin/integrations/connections/${planning!.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: planning!.displayName }),
    ).toBeVisible();
    await page.getByTestId('tab-connection').click();
    await page.getByTestId('replace-credential').fill('mock-adaptive-expired');
    await page.getByTestId('replace-credential-submit').click();

    // The refusal is reported in the provider's own words, not swallowed.
    await page.getByTestId('test-connection').click();
    await expect(page.getByTestId('test-result')).toContainText('The provider refused the call');

    const degraded = page.getByTestId('connector-degraded');
    await expect(degraded).toBeVisible();
    await expect(degraded).toContainText('stops at the last successful run');

    // Its plan import is blocked for the same reason, in the same words.
    await page.getByTestId('tab-plan').click();
    await expect(page.getByTestId('plan-blocked-credentials')).toContainText(
      'refusing BudgetFlow’s credentials',
    );
  });
});

test.describe('credentials (092 Connection tab)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('a stored credential is never shown, only when it was set and by whom', async ({ page }) => {
    const hub = await getJson<Hub>('integration-admin', '/api/integrations');
    const erp = hub.connections.find((c) => c.provider === 'erpnext')!;

    await page.goto(`/admin/integrations/connections/${erp.id}`);
    await page.getByTestId('tab-connection').click();

    await expect(page.getByTestId('credential-state')).toContainText('Stored, encrypted');
    await expect(page.getByTestId('credential-note')).toContainText(
      'never shows a stored credential',
    );
    // The replace field is write-only: it starts empty and is a password field.
    const field = page.getByTestId('replace-credential');
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('type', 'password');
    await expectNoStoredSecretOnScreen(page);
  });

  test('replacing a credential keeps it off the screen and tells the admin to test it', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const hub = await getJson<Hub>('integration-admin', '/api/integrations');
    const outlook = hub.connections.find((c) => c.provider === 'outlook')!;

    await page.goto(`/admin/integrations/connections/${outlook.id}`);
    await page.getByTestId('tab-connection').click();
    await page.getByTestId('replace-credential').fill('mock-outlook-rotated-dev-only-0002');
    await page.getByTestId('replace-credential-submit').click();

    await expect(page.getByTestId('connector-notice')).toContainText('Credential replaced');
    await expect(page.getByTestId('connector-notice')).toContainText('never be shown again');
    // The field is cleared the moment the server has it.
    await expect(page.getByTestId('replace-credential')).toHaveValue('');
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('mock-outlook-rotated-dev-only-0002');

    await page.getByTestId('test-connection').click();
    await expect(page.getByTestId('test-result')).toContainText('The provider answered');
  });
});

test.describe('running a sync (092 Sync tab, 099)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('a run reports what it moved, and running it again applies nothing twice', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    const hub = await getJson<Hub>('integration-admin', '/api/integrations');
    const erp = hub.connections.find((c) => c.provider === 'erpnext')!;

    await page.goto(`/admin/integrations/connections/${erp.id}`);
    await page.getByTestId('tab-sync').click();
    await page.getByTestId('run-sync').click();

    const result = page.getByTestId('run-sync-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText('GL lines');
    await expect(result).toContainText(/\d+ read/);

    // The same connector and object again. The second run re-reads whatever its watermark still
    // covers and applies none of it: the counts separate "already seen" from "failed", so a repeat
    // reads as safe rather than broken.
    await page.getByTestId('run-sync').click();
    await expect(result).toContainText('0 applied');
    const second = await result.innerText();
    const read = Number(/(\d+) read/.exec(second)![1]);
    const skipped = Number(/(\d+) skipped as already seen/.exec(second)![1]);
    expect(read, 'the second run still sees lines').toBeGreaterThan(0);
    expect(skipped, 'and recognises every one of them').toBe(read);

    const runs = await getJson<{ items: SyncRun[] }>(
      'integration-admin',
      '/api/integrations/sync-runs',
    );
    const mine = runs.items.filter((r) => r.provider === 'erpnext' && r.object === 'gl_lines');
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(
      mine.some(
        (r) =>
          r.recordsApplied === 0 &&
          r.recordsRead > 0 &&
          r.recordsSkippedDuplicate === r.recordsRead,
      ),
      'a repeated run applied nothing a second time',
    ).toBe(true);

    // The same runs are on the sync status screen, with the same counts.
    await page.goto('/admin/integrations/sync');
    await expect(page.getByTestId('summary-runs')).not.toHaveText('0');
    const row = page.getByTestId('run-row-erpnext-gl_lines').first();
    // Read, applied, held and failed are their own number columns.
    await expect(row.getByTestId('records-read')).not.toHaveText('0');
    await row.click();
    await expect(page.getByTestId('run-detail')).toContainText('Repeating this run is safe');
  });
});

test.describe('API keys (101)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('a key is shown once, then only by its prefix, and cannot approve anything', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    await page.goto('/admin/integrations/api-keys');
    await expectShell(page);
    await expect(page.getByTestId('scope-limits')).toContainText(
      'No API key can approve or reject a request',
    );

    await page.getByTestId('create-key').click();
    await page.getByTestId('key-name').fill('Journey widget');
    await page.getByTestId('scope-budgets.read').getByRole('checkbox').check();
    await page.getByTestId('create-key-submit').click();

    // The one-time panel will not let the admin move on until they say they stored it.
    const created = page.getByTestId('key-created');
    await expect(created).toContainText('You will not see it again');
    const secret = (await created.locator('code').innerText()).trim();
    expect(secret.length).toBeGreaterThan(16);
    await expect(page.getByTestId('api-key-secret-done')).toBeDisabled();
    await page.getByTestId('api-key-secret-stored').getByRole('checkbox').check();
    await page.getByTestId('api-key-secret-done').click();
    await expect(created).toHaveCount(0);

    // Afterwards the list holds the prefix only; the secret is gone from the page for good.
    const keys = await getJson<{ items: ApiKey[] }>(
      'integration-admin',
      '/api/integrations/api-keys',
    );
    const mine = keys.items.find((k) => k.name === 'Journey widget')!;
    expect(mine.scopes).toEqual(['budgets.read']);
    await expect(page.getByTestId(`key-row-${mine.prefix}`)).toContainText(mine.prefix);
    expect(await page.locator('body').innerText()).not.toContain(secret);

    await page.reload();
    expect(await page.locator('body').innerText()).not.toContain(secret);
  });

  test('revoking states the consequence and needs the key name typed', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    await page.goto('/admin/integrations/api-keys');
    await page.getByTestId('create-key').click();
    await page.getByTestId('key-name').fill('Journey key to revoke');
    await page.getByTestId('scope-budgets.read').getByRole('checkbox').check();
    await page.getByTestId('create-key-submit').click();
    await page.getByTestId('api-key-secret-stored').getByRole('checkbox').check();
    await page.getByTestId('api-key-secret-done').click();

    const keys = await getJson<{ items: ApiKey[] }>(
      'integration-admin',
      '/api/integrations/api-keys',
    );
    const key = keys.items.find((k) => k.name === 'Journey key to revoke')!;
    await page.getByTestId(`revoke-${key.prefix}`).click();

    const panel = page.getByTestId('revoke-panel');
    await expect(panel).toContainText('Every call using this key starts failing immediately');
    await expect(panel).toContainText('There is no undo');
    await expect(page.getByTestId('revoke-submit')).toBeDisabled();

    await page.getByTestId('revoke-confirm').fill('Journey key to revoke');
    await page.getByTestId('revoke-submit').click();

    await expect(page.getByTestId('keys-notice')).toContainText('is revoked');
    const after = await getJson<{ items: ApiKey[] }>(
      'integration-admin',
      '/api/integrations/api-keys',
    );
    expect(after.items.find((k) => k.id === key.id)!.status).toBe('revoked');
  });
});

test.describe('webhooks (101)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('a test ping is reported honestly and lands in the delivery log', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    await page.goto('/admin/integrations/webhooks');
    await expectShell(page);

    const endpoints = await getJson<{ items: { id: string; url: string }[]; verification: string }>(
      'integration-admin',
      '/api/integrations/webhook-endpoints',
    );
    const endpoint = endpoints.items[0];
    await expect(page.getByTestId(`endpoint-row-${endpoint.id}`)).toContainText(endpoint.url);
    await expect(page.getByTestId('webhook-verification')).toContainText('BudgetFlow-Signature');

    await page.getByTestId(`test-ping-${endpoint.id}`).click();
    const result = page.getByTestId('ping-result');
    await expect(result).toBeVisible();
    await expect(result).toContainText(/accepted the test ping|refused the test ping/);

    await page.getByTestId(`deliveries-${endpoint.id}`).click();
    await expect(
      page.getByRole('heading', { name: `Deliveries to ${endpoint.url}` }),
    ).toBeVisible();
  });

  test('removing an endpoint says what goes quiet first', async ({ page }) => {
    await page.goto('/admin/integrations/webhooks');
    const endpoints = await getJson<{ items: { id: string }[] }>(
      'integration-admin',
      '/api/integrations/webhook-endpoints',
    );
    await page.getByTestId(`remove-${endpoints.items[0].id}`).click();
    await expect(page.getByTestId('remove-panel')).toContainText(
      'stops receiving events immediately',
    );
    await expect(page.getByTestId('remove-panel')).toContainText('delivery log stays for audit');
  });
});

test.describe('identity and SCIM (098)', () => {
  test.use({ storageState: authFile('integration-admin') });

  test('a SCIM token is shown once and the list keeps only its prefix', async ({ page }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    await page.goto('/admin/integrations/identity');
    await expectShell(page);
    await expect(page.getByTestId('sso-status')).toBeVisible();
    await expect(page.getByTestId('deprovision-rule')).toContainText('Nothing is deleted');

    await page.getByTestId('generate-token').click();
    const created = page.getByTestId('scim-token-created');
    await expect(created).toContainText('You will not see it again');
    const token = (await created.locator('code').innerText()).trim();
    await page.getByTestId('scim-token-stored').getByRole('checkbox').check();
    await page.getByTestId('scim-token-done').click();

    await expect(created).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain(token);
    await page.reload();
    expect(await page.locator('body').innerText()).not.toContain(token);
  });
});

test.describe('cross-source duplicates (99a)', () => {
  test.use({ storageState: authFile('finance-admin') });

  test('finance keeps one line as the record and the other is excluded, not deleted', async ({
    page,
  }, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    // The journey brings its own spend rather than deciding the seeded duplicate: resolving a group
    // excludes a line, and the seeded one sits on an account the GL tie-out journey reads.
    const ref = randomUUID().slice(0, 8).toUpperCase();
    const row = (id: string) =>
      [
        'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,merchant,memo',
        `${id},2026-11-07,142.75,USD,HYL-US,CC-US-NYC-300,6100,Harbour Coffee,Team coffee`,
      ].join('\n');
    await postJson('finance-admin', '/api/actuals/imports', {
      source: 'card',
      fileName: `dup-card-${ref}.csv`,
      content: row(`CARD-${ref}`),
    });
    const held = await postJson<{ summary: { crossSourceDuplicates: number } }>(
      'finance-admin',
      '/api/actuals/imports',
      { source: 'expense', fileName: `dup-expense-${ref}.csv`, content: row(`EXP-${ref}`) },
    );
    expect(held.summary.crossSourceDuplicates, 'the second source is held, not counted twice').toBe(
      1,
    );

    const before = await getJson<{
      items: { flagId: string; lines: { actualId: string; sourceRef: string }[] }[];
      open: number;
    }>('finance-admin', '/api/integrations/duplicates?status=open');
    const group = before.items.find((g) => g.lines.some((l) => l.sourceRef === `EXP-${ref}`));
    expect(group, 'the pair is on the review queue').toBeTruthy();

    await page.goto('/finance/actuals/duplicates');
    await expectShell(page);
    await expect(page.getByTestId('duplicates-held')).toContainText('do not consume budget');

    const card = page.getByTestId(`duplicate-group-${group!.flagId}`);
    await expect(card).toBeVisible();
    // Both sides are on screen with their own amounts before anyone decides.
    for (const line of group!.lines)
      await expect(page.getByTestId(`duplicate-line-${line.actualId}`)).toBeVisible();

    await page.getByTestId(`decide-${group!.flagId}`).click();
    // The consequence is on screen before anyone commits to it.
    await expect(card).toContainText('excluded from consumption and linked to the one you keep');

    await page.getByTestId('duplicate-reason-code').fill('CARD_ITEMIZATION');
    await page
      .getByTestId('duplicate-reason')
      .fill('The expense claim is the same payment as the card line.');
    await page.getByTestId('duplicate-resolve').click();

    await expect(page.getByTestId('duplicates-notice')).toContainText('nothing was deleted');
    const after = await getJson<{ open: number }>(
      'finance-admin',
      '/api/integrations/duplicates?status=open',
    );
    expect(after.open).toBe(before.open - 1);
  });
});

test.describe('who may do what', () => {
  test.describe('as an auditor', () => {
    test.use({ storageState: authFile('auditor') });

    test('the connectors are readable and every action is absent', async ({ page }) => {
      const hub = await getJson<Hub>('auditor', '/api/integrations');
      expect(hub.canManage).toBe(false);

      await page.goto('/admin/integrations');
      await expectShell(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
      await expect(page.getByTestId('hub-read-only')).toContainText('need the Integration Admin');
      await expect(page.getByTestId('connect-system')).toHaveCount(0);

      await page.goto('/admin/integrations/api-keys');
      await expect(page.getByTestId('keys-read-only')).toBeVisible();
      await expect(page.getByTestId('create-key')).toHaveCount(0);
      await expectNoStoredSecretOnScreen(page);
    });
  });

  test.describe('as an employee', () => {
    test.use({ storageState: authFile('employee') });

    test('integrations are refused, in place, with the URL kept', async ({ page }) => {
      await page.goto('/admin/integrations');
      await expectShell(page);
      await expect(
        page.getByRole('heading', { name: 'You do not have access to this page' }),
      ).toBeVisible();
      await expect(page.getByText('Integrations is not part of your role')).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/admin/integrations');

      const ctx = await apiAs('employee');
      const res = await ctx.get('/api/integrations');
      expect(res.status(), 'the API refuses it too; hiding the page is only convenience').toBe(403);
      await ctx.dispose();
    });
  });
});
