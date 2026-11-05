// Identity, single sign-on and SCIM (098). Tokens are shown once and stored hashed; provisioning
// creates and updates people and never deletes them; deactivation ends the membership and its role
// grants the same day and reports what still needs a person's attention; a revoked token fails.
import { expect, test } from '@playwright/test';
import { IdentityOverview, ScimTokenCreated } from '@bf/contracts';
import { userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

const scimUser = (email: string, active = true) => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId: `WD-${email.split('@')[0]}`,
  userName: email,
  displayName: 'Priya Raman',
  active,
});

async function newToken(request: import('@playwright/test').APIRequestContext) {
  return expectContract(
    await request.post('/api/integrations/identity/tokens', {
      headers: await mutate('integration-admin'),
      data: { expiresInDays: 30 },
    }),
    201,
    ScimTokenCreated,
  );
}

test.describe('SCIM tokens', () => {
  test('a token is shown once and only its prefix appears afterwards', async ({ request }) => {
    const created = await newToken(request);
    expect(created.secret.startsWith('bf_scim_')).toBe(true);

    const overview = await expectContract(
      await request.get('/api/integrations/identity', {
        headers: await as('integration-admin'),
      }),
      200,
      IdentityOverview,
    );
    expect(overview.ssoStatus).toBe('connected');
    expect(overview.tokens.map((t) => t.id)).toContain(created.token.id);
    expect(JSON.stringify(overview)).not.toContain(created.secret);
  });

  test('only an Integration Admin may generate a token', async ({ request }) => {
    await expectProblem(
      await request.post('/api/integrations/identity/tokens', {
        headers: await mutate('finance-admin'),
        data: { expiresInDays: 30 },
      }),
      403,
      'FORBIDDEN',
    );
  });

  test('a revoked token fails with 401', async ({ request }) => {
    const created = await newToken(request);
    await request.delete(`/api/integrations/identity/tokens/${created.token.id}`, {
      headers: await mutate('integration-admin'),
    });
    await expectProblem(
      await request.post('/scim/v2/Users', {
        headers: { authorization: `Bearer ${created.secret}` },
        data: scimUser(`revoked.${randomUUID().slice(0, 8)}@example.test`),
      }),
      401,
      'API_KEY_REVOKED',
    );
  });

  test('a public API key cannot be used as a SCIM token', async ({ request }) => {
    const key = await request.post('/api/integrations/api-keys', {
      headers: await mutate('integration-admin'),
      data: {
        name: `not a scim token ${randomUUID().slice(0, 8)}`,
        ownerPersonId: userById('integration-admin').personId,
        scopes: ['budgets.read'],
        expiresInDays: 30,
      },
    });
    const created = (await key.json()) as { secret: string };
    await expectProblem(
      await request.post('/scim/v2/Users', {
        headers: { authorization: `Bearer ${created.secret}` },
        data: scimUser(`wrong.kind.${randomUUID().slice(0, 8)}@example.test`),
      }),
      401,
      'API_KEY_INVALID',
    );
  });
});

test.describe('provisioning', () => {
  test('a joiner is created, updated and then deactivated without anything being deleted', async ({
    request,
  }) => {
    const token = await newToken(request);
    const email = `priya.raman.${randomUUID().slice(0, 8)}@example.test`;
    const headers = { authorization: `Bearer ${token.secret}` };

    const created = await request.post('/scim/v2/Users', {
      headers,
      data: scimUser(email),
    });
    expect(created.status()).toBe(200);
    const createdBody = (await created.json()) as { id: string; active: boolean };
    expect(createdBody.active).toBe(true);

    const updated = await request.post('/scim/v2/Users', {
      headers,
      data: { ...scimUser(email), displayName: 'Priya Raman (Engineering)' },
    });
    const updatedBody = (await updated.json()) as { id: string; displayName: string };
    expect(updatedBody.id).toBe(createdBody.id);
    expect(updatedBody.displayName).toBe('Priya Raman (Engineering)');

    const deactivated = await request.post('/scim/v2/Users', {
      headers,
      data: scimUser(email, false),
    });
    const body = (await deactivated.json()) as {
      active: boolean;
      budgetflow: { held: boolean; endedRoleGrants: number; budgetsFlaggedForNewOwner: number };
    };
    expect(body.active).toBe(false);
    expect(body.budgetflow.held).toBe(false);

    // The person is still there with their history; only access ended.
    const overview = await expectContract(
      await request.get('/api/integrations/identity', {
        headers: await as('integration-admin'),
      }),
      200,
      IdentityOverview,
    );
    const entry = overview.log.find((l) => l.externalId === `WD-${email.split('@')[0]}`);
    expect(entry?.operation).toBe('deactivate');
    expect(entry?.result).toBe('applied');
    expect(entry?.detail).toContain('role grant');
  });

  test('deactivating somebody BudgetFlow has never seen answers 404', async ({ request }) => {
    const token = await newToken(request);
    await expectProblem(
      await request.post('/scim/v2/Users', {
        headers: { authorization: `Bearer ${token.secret}` },
        data: scimUser(`nobody.${randomUUID().slice(0, 8)}@example.test`, false),
      }),
      404,
      'NOT_FOUND',
    );
  });

  test('the SCIM endpoint needs a bearer token', async ({ request }) => {
    await expectProblem(
      await request.post('/scim/v2/Users', { data: scimUser('nobody@example.test') }),
      401,
      'API_KEY_INVALID',
    );
  });
});
