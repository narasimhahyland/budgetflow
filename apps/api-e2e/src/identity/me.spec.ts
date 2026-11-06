// Identity with real Keycloak tokens (Phase 2): every role persona resolves to the single Hyland tenant
// with the permissions PolicyService grants it, its own timezone, and the platform-operator flag only for
// Super Admin. Sign-in settings are public; requests without a valid token are refused.
import { expect, request as pwRequest, test } from '@playwright/test';
import { AuthConfigResponse, MeResponse } from '@bf/contracts';
import { ROLES, SEED, userById, type RoleId } from '@bf/seed';
import { as, token } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { env, KEYCLOAK_ISSUER } from '../support/env';
import { freshTotp } from './totp';

/** Permissions each persona must and must not hold (from the role grants and seeded ownership). */
const SCOPE: Record<RoleId, { has: string[]; lacks: string[] }> = {
  'super-admin': { has: [], lacks: ['tenant.read', 'budget.read', 'audit.read'] },
  'org-admin': {
    has: ['tenant.read', 'users.manage', 'org.manage', 'tenant.settings.manage'],
    lacks: ['budget.read', 'audit.read', 'ledger.read'],
  },
  ceo: {
    has: ['budget.read', 'budget.create_root', 'audit.read'],
    lacks: ['ledger.manual_journal'],
  },
  'finance-admin': {
    has: ['budget.allocate', 'ledger.manual_journal', 'period.manage', 'fx.manage', 'doa.manage'],
    lacks: ['users.manage', 'integration.manage'],
  },
  'finance-controller': {
    has: ['budget.read', 'ledger.reverse', 'period.manage', 'request.approve', 'audit.read'],
    lacks: ['budget.allocate', 'budget.create_root', 'fx.manage'],
  },
  'budget-owner': {
    has: ['budget.read', 'budget.allocate'],
    lacks: ['audit.read', 'budget.create_root'],
  },
  'department-head': { has: ['budget.read', 'budget.allocate'], lacks: ['audit.read'] },
  'regional-manager': {
    has: ['budget.read', 'budget.allocate', 'budget.control'],
    lacks: ['audit.read'],
  },
  'location-manager': { has: ['budget.read', 'budget.allocate'], lacks: ['audit.read'] },
  'event-organizer': {
    has: ['tenant.read', 'event.manage'],
    lacks: ['budget.read', 'budget.allocate'],
  },
  employee: { has: ['tenant.read', 'request.create'], lacks: ['budget.read', 'request.approve'] },
  auditor: {
    // P14 (screen 113): the Auditor runs the integrity checks on demand and manages legal holds.
    has: ['budget.read', 'ledger.read', 'audit.read', 'integrity.read', 'integrity.run'],
    lacks: ['budget.allocate', 'ledger.reverse', 'retention.confirm'],
  },
  'integration-admin': { has: ['integration.manage'], lacks: ['budget.read', 'audit.read'] },
  analyst: { has: ['budget.read', 'report.read'], lacks: ['budget.allocate', 'audit.read'] },
};

const TIMEZONE: Partial<Record<RoleId, string>> = {
  'super-admin': 'America/New_York',
  ceo: 'America/New_York',
  'finance-controller': 'Europe/Berlin',
  'regional-manager': 'Asia/Kolkata',
  employee: 'Asia/Kolkata',
};

test.describe('current user per role', () => {
  for (const role of ROLES) {
    test(`${role.id} belongs to Hyland with the permissions of the role`, async ({ request }) => {
      const me = await expectContract(
        await request.get('/api/me', { headers: await as(role.id, {}, null) }),
        200,
        MeResponse,
      );
      expect(me).toMatchObject({
        subject: role.subject,
        tenantId: SEED.tenants.acme,
        tenantName: 'Hyland',
        reportingCurrency: 'USD',
        displayName: role.displayName,
        roles: [role.id],
        platformOperator: role.id === 'super-admin',
      });
      expect(me.memberships).toEqual([
        { tenantId: SEED.tenants.acme, tenantName: 'Hyland', roles: [role.id] },
      ]);
      const { has, lacks } = SCOPE[role.id];
      expect(me.permissions).toEqual(expect.arrayContaining(has));
      for (const p of lacks)
        expect(me.permissions, `${role.id} must not hold ${p}`).not.toContain(p);
      if (TIMEZONE[role.id]) expect(me.timezone).toBe(TIMEZONE[role.id]);
      expect(me.tenantTimezone).toBe('America/New_York');
      expect(me.fiscalYears.map((y) => y.label)).toContain('FY2026');
    });
  }
});

test.describe('sign-in settings and tokens', () => {
  test('the sign-in settings are public and name the realm and the web client', async ({
    request,
  }) => {
    const cfg = await expectContract(
      await request.get('/api/auth/config'),
      200,
      AuthConfigResponse,
    );
    expect(cfg).toEqual({ issuer: KEYCLOAK_ISSUER, clientId: 'budgetflow-web' });
  });

  test('requests without a token or with a tampered token are refused', async ({ request }) => {
    await expectProblem(await request.get('/api/me'), 401, 'UNAUTHENTICATED');
    const [h, p, s] = (await token('ceo')).split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(p, 'base64url').toString()),
        sub: 'someone-else',
      }),
    ).toString('base64url');
    await expectProblem(
      await request.get('/api/me', { headers: { authorization: `Bearer ${h}.${forged}.${s}` } }),
      401,
      'UNAUTHENTICATED',
    );
    await expectProblem(
      await request.get('/api/budgets', { headers: { authorization: 'Bearer not-a-jwt' } }),
      401,
      'UNAUTHENTICATED',
    );
  });

  test('an MFA-enrolled user gets no token without the authenticator code', async ({ request }) => {
    const mfa = userById('mfa-user');
    const kc = await pwRequest.newContext();
    const form = {
      grant_type: 'password',
      client_id: env('BF_E2E_CLIENT_ID'),
      username: mfa.username,
      password: env('BF_E2E_PASSWORD'),
    };
    const denied = await kc.post(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, { form });
    expect(denied.status()).toBe(401);
    expect(((await denied.json()) as { error: string }).error).toBe('invalid_grant');
    // The refused attempt trips Keycloak's quick-login lockout; restore the user (local admin API) so the
    // success below and later journeys are not blocked by this deliberate failure.
    const admin = await kc.post(
      `${KEYCLOAK_ISSUER.replace(/\/realms\/.*$/, '')}/realms/master/protocol/openid-connect/token`,
      {
        form: {
          grant_type: 'password',
          client_id: 'admin-cli',
          username: env('BF_KC_ADMIN_USER'),
          password: env('BF_KC_ADMIN_PASSWORD'),
        },
      },
    );
    const { access_token: adminToken } = (await admin.json()) as { access_token: string };
    const cleared = await kc.delete(
      `${KEYCLOAK_ISSUER.replace('/realms/', '/admin/realms/')}/attack-detection/brute-force/users/${mfa.subject}`,
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    expect(cleared.status()).toBe(204);

    const granted = await kc.post(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
      form: { ...form, totp: await freshTotp(env('BF_E2E_TOTP_SECRET')) },
    });
    expect(granted.status()).toBe(200);
    const { access_token } = (await granted.json()) as { access_token: string };
    await kc.dispose();

    const me = await expectContract(
      await request.get('/api/me', { headers: { authorization: `Bearer ${access_token}` } }),
      200,
      MeResponse,
    );
    expect(me).toMatchObject({ displayName: 'Noor Saleh', roles: ['finance-controller'] });
  });
});
