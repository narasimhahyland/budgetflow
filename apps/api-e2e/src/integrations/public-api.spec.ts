// The public API (101, 101a): scoped, expiring keys that act as a service identity. A key is bound to
// its tenant, authorizes through PolicyService on every request, holds only the actions its scopes
// name, is rate limited, and can feed the actuals review but never post to the ledger.
import { expect, test } from '@playwright/test';
import {
  ApiKeyCreated,
  ApiKeyList,
  ApiKeyUsage,
  ApiKeyView,
  ImportBatch,
  PublicApiMeta,
  PublicBudgetList,
  PublicEventList,
  PublicImportResult,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { withKey } from '../support/p12';

const owner = () => userById('integration-admin').personId;

async function issueKey(
  request: import('@playwright/test').APIRequestContext,
  scopes: string[],
  extra: Record<string, unknown> = {},
) {
  return expectContract(
    await request.post('/api/integrations/api-keys', {
      headers: await mutate('integration-admin'),
      data: {
        name: `scenario key ${randomUUID().slice(0, 8)}`,
        ownerPersonId: owner(),
        scopes,
        expiresInDays: 30,
        ...extra,
      },
    }),
    201,
    ApiKeyCreated,
  );
}

test.describe('issuing and revoking keys', () => {
  test('a key is shown once, lists only its prefix afterwards, and names its service owner', async ({
    request,
  }) => {
    const created = await issueKey(request, ['budgets.read']);
    expect(created.secret.startsWith('bf_live_')).toBe(true);
    expect(created.key.prefix.length).toBeLessThan(created.secret.length);
    expect(created.key.ownerName).toBeTruthy();
    expect(created.key.status).toBe('active');

    const listed = await request.get('/api/integrations/api-keys', {
      headers: await as('integration-admin'),
    });
    const list = await expectContract(listed, 200, ApiKeyList);
    expect(list.items.map((k) => k.id)).toContain(created.key.id);
    // The secret itself is gone: only the hash was stored.
    expect(JSON.stringify(list)).not.toContain(created.secret);
  });

  test('there is no scope that can approve, apply controls or move money', async ({ request }) => {
    await expectProblem(
      await request.post('/api/integrations/api-keys', {
        headers: await mutate('integration-admin'),
        data: {
          name: 'should not exist',
          ownerPersonId: owner(),
          scopes: ['approvals.decide'],
          expiresInDays: 30,
        },
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  test('a revoked key fails immediately', async ({ request }) => {
    const created = await issueKey(request, ['budgets.read']);
    await expectContract(
      await request.post(`/api/integrations/api-keys/${created.key.id}/revoke`, {
        headers: await mutate('integration-admin'),
        data: { confirmName: created.key.name },
      }),
      200,
      ApiKeyView,
    );
    await expectProblem(
      await request.get('/api/public/v1/meta', { headers: withKey(created.secret) }),
      401,
      'API_KEY_REVOKED',
    );
  });

  test('revoking needs the key name typed exactly', async ({ request }) => {
    const created = await issueKey(request, ['budgets.read']);
    await expectProblem(
      await request.post(`/api/integrations/api-keys/${created.key.id}/revoke`, {
        headers: await mutate('integration-admin'),
        data: { confirmName: 'something else' },
      }),
      422,
      'VALIDATION_FAILED',
    );
  });

  test('rotation issues a new key while the old one keeps working', async ({ request }) => {
    const created = await issueKey(request, ['budgets.read']);
    const rotated = await expectContract(
      await request.post(`/api/integrations/api-keys/${created.key.id}/rotate`, {
        headers: await mutate('integration-admin'),
        data: { overlapDays: 7 },
      }),
      201,
      ApiKeyCreated,
    );
    expect(rotated.key.rotatedFromId).toBe(created.key.id);
    await expectContract(
      await request.get('/api/public/v1/meta', { headers: withKey(rotated.secret) }),
      200,
      PublicApiMeta,
    );
    await expectContract(
      await request.get('/api/public/v1/meta', { headers: withKey(created.secret) }),
      200,
      PublicApiMeta,
    );
  });
});

test.describe('calling the public API', () => {
  test('a key reads budgets within its scope and sees its own limits', async ({ request }) => {
    const created = await issueKey(request, ['budgets.read', 'events.read']);
    const meta = await expectContract(
      await request.get('/api/public/v1/meta', { headers: withKey(created.secret) }),
      200,
      PublicApiMeta,
    );
    expect(meta.tenantId).toBe(SEED.tenants.acme);
    expect(meta.scopes).toEqual(expect.arrayContaining(['budgets.read', 'events.read']));
    expect(meta.notice).toContain('never approve');

    const budgets = await expectContract(
      await request.get('/api/public/v1/budgets', {
        headers: withKey(created.secret),
        params: { limit: 5 },
      }),
      200,
      PublicBudgetList,
    );
    expect(budgets.items.length).toBeGreaterThan(0);
    const b = budgets.items[0];
    expect(b.available.amountMinor).toBe(
      b.authorized.amountMinor -
        b.allocatedOut.amountMinor -
        b.held.amountMinor -
        b.preEncumbered.amountMinor -
        b.encumbered.amountMinor -
        b.actual.amountMinor,
    );

    await expectContract(
      await request.get('/api/public/v1/events', {
        headers: withKey(created.secret),
        params: { limit: 5 },
      }),
      200,
      PublicEventList,
    );
  });

  test('a key without the scope is refused', async ({ request }) => {
    const created = await issueKey(request, ['budgets.read']);
    await expectProblem(
      await request.get('/api/public/v1/events', { headers: withKey(created.secret) }),
      403,
      'API_KEY_SCOPE_MISSING',
    );
  });

  test('a request without a key, and a made-up key, are both refused', async ({ request }) => {
    await expectProblem(await request.get('/api/public/v1/budgets'), 401, 'API_KEY_INVALID');
    await expectProblem(
      await request.get('/api/public/v1/budgets', { headers: withKey('bf_live_aaaa_bbbb') }),
      401,
      'API_KEY_INVALID',
    );
  });

  test("a key cannot reach another tenant's data, however it asks", async ({ request }) => {
    const created = await issueKey(request, ['budgets.read']);
    // The key names its own tenant; an X-Tenant-Id header for Globex changes nothing.
    const forged = await expectContract(
      await request.get('/api/public/v1/budgets', {
        headers: withKey(created.secret, { 'x-tenant-id': SEED.tenants.globex }),
        params: { limit: 100 },
      }),
      200,
      PublicBudgetList,
    );
    expect(forged.items.length).toBeGreaterThan(0);
    expect(
      forged.items.some((b) => b.id === SEED.budgets.globexOperations),
      "Globex's budget must not be visible to a Hyland key",
    ).toBe(false);

    const meta = await expectContract(
      await request.get('/api/public/v1/meta', {
        headers: withKey(created.secret, { 'x-tenant-id': SEED.tenants.globex }),
      }),
      200,
      PublicApiMeta,
    );
    expect(meta.tenantId).toBe(SEED.tenants.acme);
  });

  test('the rate limit holds and the key reports what is left', async ({ request }) => {
    const created = await issueKey(request, ['budgets.read'], { rateLimitPerMinute: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request.get('/api/public/v1/meta', { headers: withKey(created.secret) });
      statuses.push(res.status());
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.at(-1)).toBe(429);
    const last = await request.get('/api/public/v1/meta', { headers: withKey(created.secret) });
    const problem = await last.json();
    expect(problem.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  test('calls made with a key are logged with its prefix', async ({ request }) => {
    const created = await issueKey(request, ['budgets.read']);
    await request.get('/api/public/v1/budgets', { headers: withKey(created.secret) });
    const usage = await expectContract(
      await request.get(`/api/integrations/api-keys/${created.key.id}/usage`, {
        headers: await as('integration-admin'),
      }),
      200,
      ApiKeyUsage,
    );
    expect(usage.recent.length).toBeGreaterThan(0);
    expect(usage.recent[0].path).toContain('/api/public/v1/');
  });
});

test.describe('the public API can feed the review queue but never the ledger', () => {
  test('an import lands in review with its batch, and the same lines are not counted twice', async ({
    request,
  }) => {
    const created = await issueKey(request, ['actuals.write']);
    const ref = `PUB-${randomUUID().slice(0, 8).toUpperCase()}`;
    const csv = [
      'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,merchant,memo',
      `${ref}-1,2026-11-06,120.00,USD,HYL-US,CC-US-NYC-300,6100,Northside Print,Public API line one`,
      `${ref}-2,2026-11-06,80.00,USD,HYL-US,CC-US-NYC-300,6100,Northside Print,Public API line two`,
    ].join('\n');

    const result = await expectContract(
      await request.post('/api/public/v1/actuals/imports', {
        headers: withKey(created.secret, { 'idempotency-key': randomUUID() }),
        data: { source: 'erp', fileName: `${ref}.csv`, csv },
      }),
      201,
      PublicImportResult,
    );
    expect(result.status).toBe('review');
    expect(result.imported).toBe(2);

    const batch = await expectContract(
      await request.get(`/api/actuals/imports/${result.importBatchId}`, {
        headers: await as('finance-admin'),
      }),
      200,
      ImportBatch,
    );
    expect(batch.status).toBe('review');

    // Sending the same lines again, even under another file name, imports none of them: the content
    // is recognised and, failing that, the source references are already known.
    const again = await request.post('/api/public/v1/actuals/imports', {
      headers: withKey(created.secret, { 'idempotency-key': randomUUID() }),
      data: { source: 'erp', fileName: `${ref}-again.csv`, csv },
    });
    const body = (await again.json()) as { code?: string; imported?: number };
    expect([201, 409, 422]).toContain(again.status());
    if (again.status() === 201) expect(body.imported).toBe(0);
    else expect(['IMPORT_ALREADY_UPLOADED', 'IMPORT_INVALID']).toContain(body.code);
  });

  test('a key with actuals.write cannot read budgets', async ({ request }) => {
    const created = await issueKey(request, ['actuals.write']);
    await expectProblem(
      await request.get('/api/public/v1/budgets', { headers: withKey(created.secret) }),
      403,
      'API_KEY_SCOPE_MISSING',
    );
  });
});
