// User and role administration (screens 103, 103a). The invariant this file exists for:
// administration cannot create authority. Nobody grants themselves a role, the platform-operator
// role is never granted inside a tenant, a role that gives money or approval authority the requester
// does not hold stays pending until someone who holds it confirms, and approval limits are never
// part of a grant - they come from the delegation-of-authority matrix.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { AdminUser, GrantRoleResult, MeResponse, RevokeRoleResult } from '@bf/contracts';
import { userById, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { reason, userByRoleUser, users } from './support';

test.describe.configure({ mode: 'serial' });

/** Actions only a finance role holds, used to prove a pending grant has given nothing away. */
const FINANCE_ACTIONS = ['budget.allocate', 'ledger.manual_journal', 'master_data.manage'];

async function permissionsOf(request: APIRequestContext, user: SeedUserId): Promise<string[]> {
  const me = await expectContract(
    await request.get('/api/me', { headers: await as(user) }),
    200,
    MeResponse,
  );
  return me.permissions;
}

test.describe('role administration', () => {
  test('nobody can give themselves a role', async ({ request }) => {
    const self = await userByRoleUser(request, 'org-admin');
    await expectProblem(
      await request.post(`/api/admin/users/${self.membershipId}/role-grants`, {
        headers: await mutate('org-admin'),
        data: { role: 'finance-admin', scopeOrgUnitId: null, reason: reason('self-promotion') },
      }),
      409,
      'SELF_ROLE_GRANT',
    );
    // Not even a harmless-looking one.
    await expectProblem(
      await request.post(`/api/admin/users/${self.membershipId}/role-grants`, {
        headers: await mutate('org-admin'),
        data: { role: 'analyst', scopeOrgUnitId: null, reason: reason('self-promotion, small') },
      }),
      409,
      'SELF_ROLE_GRANT',
    );
  });

  test('the platform-operator role is never granted inside a tenant', async ({ request }) => {
    const target = await userByRoleUser(request, 'employee');
    await expectProblem(
      await request.post(`/api/admin/users/${target.membershipId}/role-grants`, {
        headers: await mutate('org-admin'),
        data: { role: 'super-admin', scopeOrgUnitId: null, reason: reason('make an operator') },
      }),
      409,
      'PRIVILEGE_ESCALATION',
    );
  });

  test('a role grant never carries an approval limit', async ({ request }) => {
    const target = await userByRoleUser(request, 'employee');
    const res = await request.post(`/api/admin/users/${target.membershipId}/role-grants`, {
      headers: await mutate('org-admin'),
      data: {
        role: 'budget-owner',
        scopeOrgUnitId: null,
        reason: reason('try to smuggle a limit into a role grant'),
        limitMinor: 1_000_000,
      },
    });
    const problem = await expectProblem(res, 400, 'VALIDATION_FAILED');
    expect(
      problem.errors?.some((e) => e.message.toLowerCase().includes('unrecognized')),
      'the limit field is rejected outright: limits live in the delegation-of-authority matrix',
    ).toBe(true);
  });

  test('an administrator without financial authority cannot hand any out', async ({ request }) => {
    const target = await userByRoleUser(request, 'reset-user');
    expect(target.roles).not.toContain('finance-admin');
    const before = await permissionsOf(request, 'reset-user');
    for (const action of FINANCE_ACTIONS) expect(before).not.toContain(action);

    // The Organization Admin may administer users, but holds no money authority, so the grant waits.
    const requested = await expectContract(
      await request.post(`/api/admin/users/${target.membershipId}/role-grants`, {
        headers: await mutate('org-admin'),
        data: {
          role: 'finance-admin',
          scopeOrgUnitId: null,
          reason: reason('a new finance systems lead joins'),
        },
      }),
      201,
      GrantRoleResult,
    );
    expect(requested.applied, 'the grant is not applied by the administrator alone').toBe(false);
    expect(requested.grant).toBeNull();
    expect(requested.authorityBeyondRequester).toContain('budget.allocate');
    const changeId = requested.pendingChange?.id;
    expect(changeId).toBeTruthy();

    try {
      // Nothing has changed for the person while it waits.
      const waiting = await permissionsOf(request, 'reset-user');
      for (const action of FINANCE_ACTIONS) expect(waiting).not.toContain(action);
      const listed = await expectContract(
        await request.get(`/api/admin/users/${target.membershipId}`, {
          headers: await as('org-admin'),
        }),
        200,
        AdminUser,
      );
      expect(listed.roles).not.toContain('finance-admin');
      expect(listed.pendingRoleChanges.map((c) => c.id)).toContain(changeId);

      // The requester cannot wave their own request through.
      await expectProblem(
        await request.post(`/api/admin/role-grants/changes/${changeId}/decision`, {
          headers: await mutate('org-admin'),
          data: { decision: 'confirm', reason: reason('the requester confirms') },
        }),
        409,
        'SAME_PERSON_APPROVAL',
      );

      // Nor can somebody who does not hold the authority the role gives.
      const auditorRefusal = await expectProblem(
        await request.post(`/api/admin/role-grants/changes/${changeId}/decision`, {
          headers: await mutate('auditor'),
          data: { decision: 'confirm', reason: reason('an auditor confirms') },
        }),
        409,
        'PRIVILEGE_ESCALATION',
      );
      expect(auditorRefusal.detail).toContain('budget.allocate');

      // Still nothing granted after both refusals.
      const afterRefusals = await permissionsOf(request, 'reset-user');
      for (const action of FINANCE_ACTIONS) expect(afterRefusals).not.toContain(action);

      // Someone who already holds that authority can confirm, and only then does it take effect.
      const confirmed = await expectContract(
        await request.post(`/api/admin/role-grants/changes/${changeId}/decision`, {
          headers: await mutate('finance-admin'),
          data: { decision: 'confirm', reason: reason('finance confirms the new finance lead') },
        }),
        201,
        GrantRoleResult,
      );
      expect(confirmed.applied).toBe(true);
      expect(confirmed.grant?.role).toBe('finance-admin');
      const after = await permissionsOf(request, 'reset-user');
      for (const action of FINANCE_ACTIONS) expect(after).toContain(action);
    } finally {
      const revoked = await request.post(
        `/api/admin/users/${target.membershipId}/role-revocations`,
        {
          headers: await mutate('org-admin', randomUUID()),
          data: { role: 'finance-admin', reason: reason('scenario cleanup') },
        },
      );
      expect(revoked.status(), await revoked.text()).toBe(201);
    }

    // Revoking again says so rather than pretending.
    await expectProblem(
      await request.post(`/api/admin/users/${target.membershipId}/role-revocations`, {
        headers: await mutate('org-admin'),
        data: { role: 'finance-admin', reason: reason('revoke twice') },
      }),
      409,
      'ROLE_NOT_GRANTED',
    );
    const restored = await permissionsOf(request, 'reset-user');
    for (const action of FINANCE_ACTIONS) expect(restored).not.toContain(action);
  });

  test('a role that adds no financial authority applies straight away', async ({ request }) => {
    const target = await userByRoleUser(request, 'reset-user');
    const granted = await expectContract(
      await request.post(`/api/admin/users/${target.membershipId}/role-grants`, {
        headers: await mutate('org-admin'),
        data: {
          role: 'event-organizer',
          scopeOrgUnitId: null,
          reason: reason('the office coordinator also organises events'),
        },
      }),
      201,
      GrantRoleResult,
    );
    expect(granted.applied).toBe(true);
    expect(granted.authorityBeyondRequester).toEqual([]);
    expect(granted.grant?.validFrom).toBeTruthy();

    // The same role twice is refused.
    await expectProblem(
      await request.post(`/api/admin/users/${target.membershipId}/role-grants`, {
        headers: await mutate('org-admin'),
        data: { role: 'event-organizer', scopeOrgUnitId: null, reason: reason('grant twice') },
      }),
      409,
      'ROLE_ALREADY_GRANTED',
    );

    const revoked = await expectContract(
      await request.post(`/api/admin/users/${target.membershipId}/role-revocations`, {
        headers: await mutate('org-admin'),
        data: { role: 'event-organizer', reason: reason('scenario cleanup') },
      }),
      201,
      RevokeRoleResult,
    );
    expect(revoked.revoked).toBe(true);
  });

  test('only user administration can read or change people', async ({ request }) => {
    await expectProblem(
      await request.get('/api/admin/users', { headers: await as('finance-admin') }),
      403,
      'FORBIDDEN',
    );
    await expectProblem(
      await request.get('/api/admin/users', { headers: await as('employee') }),
      403,
      'FORBIDDEN',
    );
    const target = await userByRoleUser(request, 'employee');
    await expectProblem(
      await request.post(`/api/admin/users/${target.membershipId}/role-grants`, {
        headers: await mutate('finance-admin'),
        data: { role: 'analyst', scopeOrgUnitId: null, reason: reason('finance grants a role') },
      }),
      403,
      'FORBIDDEN',
    );
  });

  test('the people list is ordered by name then membership id', async ({ request }) => {
    const items = await users(request);
    expect(items.length).toBeGreaterThan(10);
    const keys = items.map((u) => `${u.displayName}|${u.membershipId}`);
    expect(keys).toEqual([...keys].sort());
    const auditor = items.find((u) => u.personId === userById('auditor').personId);
    expect(auditor?.privileged, 'the Auditor is a privileged role for access reviews').toBe(true);
    const employee = items.find((u) => u.personId === userById('employee').personId);
    expect(employee?.privileged).toBe(false);
    for (const user of items)
      expect(user.grants.map((g) => `${g.role}|${g.id}`)).toEqual(
        [...user.grants.map((g) => `${g.role}|${g.id}`)].sort(),
      );
  });
});
