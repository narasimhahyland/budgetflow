// Break-glass access (112, Phase 18). What this proves: the platform operator reads no tenant financial
// data without a grant; a request opens nothing until an Organization Admin approves it; the requester
// can never decide it; an approved grant opens budget and ledger reads only, never a change; every
// request made under it is audited against the grant; revocation ends it at once; at most 240 minutes.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { AuditEventList, BreakGlassGrant, BreakGlassGrantList, BudgetList } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

test.describe.configure({ mode: 'serial' });

const reason = (what: string) => `Phase 18 scenario: ${what}.`;
const { india, bengaluru } = SEED.budgets;

async function grants(request: APIRequestContext, user: 'org-admin' | 'super-admin' | 'auditor') {
  return expectContract(
    await request.get('/api/admin/break-glass', { headers: await as(user) }),
    200,
    BreakGlassGrantList,
  );
}

/** Ends whatever an earlier, interrupted run left open, so the operator starts with no access. */
async function closeOpenGrants(request: APIRequestContext) {
  for (const g of (await grants(request, 'org-admin')).items) {
    if (g.status === 'requested')
      await request.post(`/api/admin/break-glass/${g.id}/decision`, {
        headers: await mutate('org-admin'),
        data: { decision: 'decline', reason: reason('clean up an interrupted run') },
      });
    if (g.status === 'active')
      await request.post(`/api/admin/break-glass/${g.id}/revocation`, {
        headers: await mutate('org-admin'),
        data: { reason: reason('clean up an interrupted run') },
      });
  }
}

test.beforeAll(async ({ request }) => closeOpenGrants(request));
test.afterAll(async ({ request }) => closeOpenGrants(request));

let grantId = '';

test('without a grant the platform operator cannot even see a budget', async ({ request }) => {
  expect(
    (await request.get(`/api/budgets/${india}`, { headers: await as('super-admin') })).status(),
  ).toBe(404);
  expect(
    (
      await request.get(`/api/budgets/${india}/ledger`, { headers: await as('super-admin') })
    ).status(),
  ).toBe(404);
});

test('a request longer than four hours is refused with a typed problem', async ({ request }) => {
  await expectProblem(
    await request.post('/api/admin/break-glass', {
      headers: await mutate('super-admin'),
      data: { reason: reason('too long'), durationMinutes: 241 },
    }),
    422,
    'VALIDATION_FAILED',
  );
});

test('only the platform operator can ask for access', async ({ request }) => {
  for (const user of ['org-admin', 'finance-admin', 'auditor'] as const)
    expect(
      (
        await request.post('/api/admin/break-glass', {
          headers: await mutate(user),
          data: { reason: reason('not an operator'), durationMinutes: 60 },
        })
      ).status(),
    ).toBe(403);
});

test('the operator asks; nothing opens while the request waits', async ({ request }) => {
  const key = randomUUID();
  const body = { reason: reason('investigate a sync error'), durationMinutes: 120 };
  const asked = await expectContract(
    await request.post('/api/admin/break-glass', {
      headers: await mutate('super-admin', key),
      data: body,
    }),
    201,
    BreakGlassGrant,
  );
  expect(asked.status).toBe('requested');
  expect(asked.requestedMinutes).toBe(120);
  expect(asked.scopeLabel).toContain('Read-only');
  expect(asked.startsAt).toBeNull();
  expect(asked.allowedActions).toEqual([]);
  grantId = asked.id;

  // Replaying the same key returns the same request without a second one.
  const replay = await request.post('/api/admin/break-glass', {
    headers: await mutate('super-admin', key),
    data: body,
  });
  expect(replay.status()).toBe(201);
  expect(replay.headers()['idempotent-replayed']).toBe('true');
  expect(((await replay.json()) as BreakGlassGrant).id).toBe(grantId);

  // A second open request is refused.
  await expectProblem(
    await request.post('/api/admin/break-glass', {
      headers: await mutate('super-admin'),
      data: { reason: reason('a second request'), durationMinutes: 30 },
    }),
    409,
    'CONFLICT',
  );

  expect(
    (await request.get(`/api/budgets/${india}`, { headers: await as('super-admin') })).status(),
  ).toBe(404);

  const mine = await grants(request, 'super-admin');
  expect(mine.canRequest).toBe(true);
  expect(mine.canDecide).toBe(false);
  expect(mine.items.map((g) => g.id)).toContain(grantId);

  const admin = await grants(request, 'org-admin');
  expect(admin.canDecide).toBe(true);
  const waiting = admin.items.find((g) => g.id === grantId);
  expect(waiting?.allowedActions).toEqual(['approve', 'decline']);

  // The auditor and finance admin read the history but decide nothing.
  const auditor = await grants(request, 'auditor');
  expect(auditor.canDecide).toBe(false);
  expect(auditor.items.find((g) => g.id === grantId)?.allowedActions).toEqual([]);
});

test('the requester and read-only roles cannot decide it', async ({ request }) => {
  // The operator without a grant cannot even see the tenant (404, as everywhere else); finance
  // admins and auditors read the history but are refused the decision (403).
  for (const [user, status] of [
    ['super-admin', 404],
    ['finance-admin', 403],
    ['auditor', 403],
  ] as const)
    expect(
      (
        await request.post(`/api/admin/break-glass/${grantId}/decision`, {
          headers: await mutate(user),
          data: { decision: 'approve', reason: reason('not the approver') },
        })
      ).status(),
      user,
    ).toBe(status);
});

test('an Organization Admin approves; budgets and the ledger open read-only', async ({
  request,
}) => {
  const approved = await expectContract(
    await request.post(`/api/admin/break-glass/${grantId}/decision`, {
      headers: await mutate('org-admin'),
      data: { decision: 'approve', reason: reason('sync error confirmed') },
    }),
    201,
    BreakGlassGrant,
  );
  expect(approved.status).toBe('active');
  expect(approved.decidedByName).toBeTruthy();
  const window =
    new Date(approved.endsAt ?? '').getTime() - new Date(approved.startsAt ?? '').getTime();
  expect(window).toBe(120 * 60_000);
  expect(approved.allowedActions).toEqual(['revoke']);

  // A decided request cannot be decided again.
  await expectProblem(
    await request.post(`/api/admin/break-glass/${grantId}/decision`, {
      headers: await mutate('org-admin'),
      data: { decision: 'decline', reason: reason('too late') },
    }),
    409,
    'CONFLICT',
  );

  expect(
    (await request.get(`/api/budgets/${india}`, { headers: await as('super-admin') })).status(),
  ).toBe(200);
  expect(
    (
      await request.get(`/api/budgets/${india}/ledger`, { headers: await as('super-admin') })
    ).status(),
  ).toBe(200);
  const list = await expectContract(
    await request.get('/api/budgets', { headers: await as('super-admin') }),
    200,
    BudgetList,
  );
  expect(list.items.map((b) => b.id)).toContain(india);

  // Read-only: no allocation, no settings change, no audit trail.
  expect(
    (
      await request.post(`/api/budgets/${india}/allocations`, {
        headers: await mutate('super-admin'),
        data: { childBudgetId: bengaluru, amount: { amountMinor: 1, currency: 'USD' } },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.put('/api/admin/settings/security', {
        headers: await mutate('super-admin'),
        data: {
          idleTimeoutMinutes: 30,
          maxSessionHours: 12,
          localAccountsForServiceUsersOnly: true,
          biometricUnlockAllowed: true,
          reason: reason('not allowed'),
        },
      })
    ).status(),
  ).toBe(403);
});

test('every request under the grant is audited against it', async ({ request }) => {
  const reads = await expectContract(
    await request.get(
      `/api/audit/events?resourceType=break_glass_grant&resourceId=${grantId}&action=break_glass.read_under_grant&limit=50`,
      { headers: await as('auditor') },
    ),
    200,
    AuditEventList,
  );
  // budget, ledger, budget list and the three successful reads from the previous test.
  const paths = reads.items.map((e) => (e.changes as { path?: string }).path);
  expect(paths).toEqual(
    expect.arrayContaining([
      `/api/budgets/${india}`,
      `/api/budgets/${india}/ledger`,
      '/api/budgets',
    ]),
  );
  // Refused attempts write nothing.
  expect(paths).not.toContain(`/api/budgets/${india}/allocations`);
  expect(reads.items.every((e) => e.actorSubject !== null)).toBe(true);

  const shown = (await grants(request, 'org-admin')).items.find((g) => g.id === grantId);
  expect(shown?.actionsTaken).toBeGreaterThanOrEqual(3);

  for (const action of ['break_glass.requested', 'break_glass.approved']) {
    const steps = await expectContract(
      await request.get(
        `/api/audit/events?resourceType=break_glass_grant&resourceId=${grantId}&action=${action}`,
        { headers: await as('auditor') },
      ),
      200,
      AuditEventList,
    );
    expect(steps.items).toHaveLength(1);
  }
});

test('revoking ends access at once, and only an active grant can be revoked', async ({
  request,
}) => {
  const revoked = await expectContract(
    await request.post(`/api/admin/break-glass/${grantId}/revocation`, {
      headers: await mutate('org-admin'),
      data: { reason: reason('investigation finished') },
    }),
    201,
    BreakGlassGrant,
  );
  expect(revoked.status).toBe('revoked');
  expect(revoked.revokedByName).toBeTruthy();
  expect(
    (await request.get(`/api/budgets/${india}`, { headers: await as('super-admin') })).status(),
  ).toBe(404);
  await expectProblem(
    await request.post(`/api/admin/break-glass/${grantId}/revocation`, {
      headers: await mutate('org-admin'),
      data: { reason: reason('again') },
    }),
    409,
    'CONFLICT',
  );
});

test('a declined request opens nothing', async ({ request }) => {
  const asked = await expectContract(
    await request.post('/api/admin/break-glass', {
      headers: await mutate('super-admin'),
      data: { reason: reason('check a report'), durationMinutes: 15 },
    }),
    201,
    BreakGlassGrant,
  );
  const declined = await expectContract(
    await request.post(`/api/admin/break-glass/${asked.id}/decision`, {
      headers: await mutate('org-admin'),
      data: { decision: 'decline', reason: reason('use the support export instead') },
    }),
    201,
    BreakGlassGrant,
  );
  expect(declined.status).toBe('declined');
  expect(declined.startsAt).toBeNull();
  expect(
    (await request.get(`/api/budgets/${india}`, { headers: await as('super-admin') })).status(),
  ).toBe(404);
});
