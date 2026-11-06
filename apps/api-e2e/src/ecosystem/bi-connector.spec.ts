// The BI connector (092a): curated read-only datasets a person points Power BI or Tableau at. Each
// connection acts as the person who made it, is bound to their tenant, is refused once the daily
// refresh limit is reached, and stops working the moment it is revoked.
import { expect, test } from '@playwright/test';
import { BiConnectorView, BiFeedPage, EcosystemConnectionList } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { connectBi, withToken } from './support';

test.describe('the connector and its datasets', () => {
  test('the Integration Admin sees the datasets and their field reference', async ({ request }) => {
    const view = await expectContract(
      await request.get('/api/ecosystem/bi', { headers: await as('integration-admin') }),
      200,
      BiConnectorView,
    );
    expect(view.enabled).toBe(true);
    expect(view.canManage).toBe(true);
    expect(view.refreshLimitPerDay).toBe(8);
    const budgets = view.datasets.find((d) => d.dataset === 'budgets');
    expect(budgets?.enabled).toBe(true);
    // Both Available figures are offered under names that cannot be confused for one another.
    expect(budgets?.fields.map((f) => f.name)).toContain('availableUnderRulesMinor');
    expect(
      view.datasets.find((d) => d.dataset === 'company_rollup')?.fields.map((f) => f.name),
    ).toContain('availableCompanyWideMinor');
  });

  test('the switch is per tenant: Globex sees the connector off while Hyland has it on', async ({
    request,
  }) => {
    const hyland = await expectContract(
      await request.get('/api/ecosystem/bi', { headers: await as('integration-admin') }),
      200,
      BiConnectorView,
    );
    const globex = await expectContract(
      await request.get('/api/ecosystem/bi', { headers: await as('globex-admin') }),
      200,
      BiConnectorView,
    );
    expect(hyland.enabled).toBe(true);
    expect(globex.enabled).toBe(false);
  });

  test('connecting needs report access, and only to datasets the company offers', async ({
    request,
  }) => {
    // The employee holds no report access, so there is nothing for a BI tool to read as them.
    await expectProblem(
      await request.post('/api/ecosystem/bi/connections', {
        headers: await mutate('employee'),
        data: { tool: 'power_bi', label: 'should not exist', datasets: ['budgets'] },
      }),
      403,
      'FORBIDDEN',
    );
    // `requests` is a real dataset the seeded company has not turned on.
    await expectProblem(
      await request.post('/api/ecosystem/bi/connections', {
        headers: await mutate('analyst'),
        data: { tool: 'power_bi', label: 'should not exist', datasets: ['requests'] },
      }),
      409,
      'BI_DATASET_DISABLED',
    );
  });
});

test.describe('the feed', () => {
  test('a connection reads the budgets its person may read and nothing from another tenant', async ({
    request,
  }) => {
    const { token } = await connectBi(request, 'analyst', ['budgets']);
    // The X-Tenant-Id header is sent deliberately: the feed takes its tenant from the token, so a
    // caller naming another tenant changes nothing.
    const page = await expectContract(
      await request.get('/api/bi/v1/budgets', {
        headers: withToken(token, { 'x-tenant-id': SEED.tenants.globex }),
      }),
      200,
      BiFeedPage,
    );
    const ids = page.rows.map((r) => r['budgetId']);
    // Both halves matter: the Hyland budget proves the feed returned something, the Globex one
    // proves what it returned stopped at the tenant boundary.
    expect(ids).toContain(SEED.budgets.bengaluru);
    expect(ids).not.toContain(SEED.budgets.globexOperations);
    expect(page.rows.length).toBeGreaterThan(0);
  });

  test('rows come back in a stable order and carry the app definitions of every bucket', async ({
    request,
  }) => {
    const { token } = await connectBi(request, 'analyst', ['budgets']);
    const first = await expectContract(
      await request.get('/api/bi/v1/budgets', { headers: withToken(token) }),
      200,
      BiFeedPage,
    );
    const second = await expectContract(
      await request.get('/api/bi/v1/budgets', { headers: withToken(token) }),
      200,
      BiFeedPage,
    );
    expect(second.rows.map((r) => r['budgetId'])).toEqual(first.rows.map((r) => r['budgetId']));
    const row = first.rows.find((r) => r['budgetId'] === SEED.budgets.bengaluru);
    expect(row).toBeDefined();
    for (const field of [
      'authorizedMinor',
      'allocatedOutMinor',
      'heldMinor',
      'preEncumberedMinor',
      'encumberedMinor',
      'actualMinor',
      'availableUnderRulesMinor',
    ]) {
      expect(typeof row?.[field], field).toBe('number');
    }
  });

  test('a dataset the connection was not granted is refused even though the company offers it', async ({
    request,
  }) => {
    const { token } = await connectBi(request, 'analyst', ['budgets']);
    await expectProblem(
      await request.get('/api/bi/v1/company_rollup', { headers: withToken(token) }),
      403,
      'ECOSYSTEM_GRANT_MISSING',
    );
  });

  test('the ninth refresh in a day is refused', async ({ request }) => {
    const { token } = await connectBi(request, 'analyst', ['budgets']);
    for (let i = 1; i <= 8; i++) {
      const res = await request.get('/api/bi/v1/budgets', { headers: withToken(token) });
      expect(res.status(), `refresh ${i}`).toBe(200);
    }
    const problem = await expectProblem(
      await request.get('/api/bi/v1/budgets', { headers: withToken(token) }),
      429,
      'BI_REFRESH_LIMIT_REACHED',
    );
    expect(problem.detail).toContain('8');
  });

  test('a revoked connection stops reading, and a made-up token is never valid', async ({
    request,
  }) => {
    const { token, id } = await connectBi(request, 'analyst', ['budgets']);
    expect((await request.get('/api/bi/v1/budgets', { headers: withToken(token) })).status()).toBe(
      200,
    );
    await request.post(`/api/ecosystem/bi/connections/${id}/revoke`, {
      headers: await mutate('analyst'),
      data: { reason: 'scenario' },
    });
    await expectProblem(
      await request.get('/api/bi/v1/budgets', { headers: withToken(token) }),
      401,
      'ECOSYSTEM_CONNECTION_REVOKED',
    );
    // A token with a well-formed tenant tag but an unknown secret is invalid, not "not found":
    // a caller never learns whether a connection exists.
    const forged = `bf_bi_${SEED.tenants.globex.replace(/-/g, '')}_${'0'.repeat(48)}`;
    await expectProblem(
      await request.get('/api/bi/v1/budgets', { headers: withToken(forged) }),
      401,
      'ECOSYSTEM_CONNECTION_INVALID',
    );
  });
});

test.describe('who may see and revoke connections', () => {
  test('a person sees their own; the Integration Admin sees and can revoke everyone', async ({
    request,
  }) => {
    const { id } = await connectBi(request, 'analyst', ['budgets']);
    const mine = await expectContract(
      await request.get('/api/ecosystem/bi/connections', { headers: await as('analyst') }),
      200,
      EcosystemConnectionList,
    );
    expect(mine.seesAll).toBe(false);
    expect(mine.items.map((c) => c.id)).toContain(id);
    expect(mine.items.every((c) => c.personName !== null)).toBe(true);

    const admin = await expectContract(
      await request.get('/api/ecosystem/bi/connections', {
        headers: await as('integration-admin'),
      }),
      200,
      EcosystemConnectionList,
    );
    expect(admin.seesAll).toBe(true);
    expect(admin.canRevokeAll).toBe(true);
    expect(admin.items.map((c) => c.id)).toContain(id);

    const revoked = await request.post(`/api/ecosystem/bi/connections/${id}/revoke`, {
      headers: await mutate('integration-admin'),
      data: { reason: 'left the team' },
    });
    expect(revoked.status()).toBe(200);
  });

  test('a person cannot revoke someone else without integration access', async ({ request }) => {
    const { id } = await connectBi(request, 'analyst', ['budgets']);
    await expectProblem(
      await request.post(`/api/ecosystem/bi/connections/${id}/revoke`, {
        headers: await mutate('employee'),
        data: {},
      }),
      403,
      'FORBIDDEN',
    );
  });
});
