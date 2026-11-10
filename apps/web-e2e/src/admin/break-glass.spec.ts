// Break-glass access (112, Phase 18) as the Organization Admin who decides it. The platform operator's
// request and reads go through the API (the operator has no tenant screens to sign in to); the
// journey proves what the admin sees: the waiting request, the approval, the active-access banner,
// the audited actions-taken count and the revocation.
//
// One subject: the request this journey creates, found by its unique reason. Desktop only, once,
// because it mutates; anything an interrupted run left open is closed first and again at the end.
import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { SEED } from '@bf/seed';
import { apiToken, expectShell } from '../support/auth';
import { API_URL } from '../support/env';
import { authFile } from '../support/roles';
import { desktopOnly } from '../spend/api';

type Grant = { id: string; status: string; reason: string };

async function api(user: 'super-admin' | 'org-admin'): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${await apiToken(user)}`,
      'x-tenant-id': SEED.tenants.acme,
    },
  });
}

async function closeOpen(): Promise<void> {
  const admin = await api('org-admin');
  const list = (await (await admin.get('/api/admin/break-glass')).json()) as { items: Grant[] };
  for (const g of list.items) {
    const data = { reason: 'Journey clean-up of an interrupted run.' };
    if (g.status === 'requested')
      await admin.post(`/api/admin/break-glass/${g.id}/decision`, {
        headers: { 'idempotency-key': randomUUID() },
        data: { ...data, decision: 'decline' },
      });
    if (g.status === 'active')
      await admin.post(`/api/admin/break-glass/${g.id}/revocation`, {
        headers: { 'idempotency-key': randomUUID() },
        data,
      });
  }
  await admin.dispose();
}

test.describe('break-glass access (112) as the Organization Admin', () => {
  test.use({ storageState: authFile('org-admin') });

  test.beforeEach(async ({}, info) => {
    test.skip(!!desktopOnly(info.project.name), desktopOnly(info.project.name));
    await closeOpen();
  });
  test.afterEach(async ({}, info) => {
    if (!desktopOnly(info.project.name)) await closeOpen();
  });

  test('reviews a request, approves it, sees the audited reads and revokes it', async ({
    page,
  }) => {
    const why = `Journey: investigate a sync error ${randomUUID().slice(0, 8)}`;
    const operator = await api('super-admin');
    const asked = await operator.post('/api/admin/break-glass', {
      headers: { 'idempotency-key': randomUUID() },
      data: { reason: why, durationMinutes: 120 },
    });
    expect(asked.status()).toBe(201);

    await page.goto('/admin/security/break-glass');
    await expectShell(page);
    await expect(page.getByRole('heading', { name: 'Break-glass access', level: 1 })).toBeVisible();
    await expect(page.getByTestId('break-glass-requested')).toContainText(
      `requests 2 hours of read access: ${why}`,
    );

    const row = page.getByRole('row').filter({ hasText: why });
    await expect(row).toContainText('Requested');
    await expect(row).toContainText('Read-only: budgets and the ledger');
    await row.getByRole('button', { name: 'Approve' }).click();
    await page.getByLabel('Approve: reason').fill('Sync error confirmed with support.');
    await page.getByRole('button', { name: /^Approve for / }).click();

    await expect(page.getByTestId('break-glass-notice')).toContainText('Access approved');
    await expect(page.getByTestId('break-glass-active')).toContainText(
      'Break-glass access is active',
    );
    await expect(row).toContainText('Active');
    await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0);

    // The operator reads one budget under the grant; the admin sees it counted.
    const read = await operator.get(`/api/budgets/${SEED.budgets.india}`);
    expect(read.status()).toBe(200);
    await operator.dispose();
    await page.reload();
    await expect(row.getByTestId('break-glass-actions')).not.toHaveText('0');

    await row.getByRole('button', { name: 'Revoke' }).click();
    await page.getByLabel('Revoke: reason').fill('Investigation finished.');
    await page.getByRole('button', { name: /^Revoke for / }).click();
    await expect(page.getByTestId('break-glass-notice')).toContainText('is revoked');
    await expect(row).toContainText('Revoked');
    await expect(page.getByTestId('break-glass-active')).toHaveCount(0);
  });
});
