// Role scope with real Keycloak tokens for all 14 personas (Phase 2): which seeded budgets each role can
// list and open, who can read the audit trail, and that read-only or unrelated roles cannot allocate.
import { expect, test } from '@playwright/test';
import { BudgetList } from '@bf/contracts';
import { ROLES, SEED, type RoleId } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';

const REFERENCE = ['EX-2026', 'EX-IN', 'EX-IN-BLR', 'EX-IN-HYD', 'EX-US', 'EX-EU'];

/** Seeded reference budgets each persona may see (tenant-wide roles see them all). */
const VISIBLE: Record<RoleId, string[]> = {
  'super-admin': [],
  'org-admin': [],
  ceo: REFERENCE,
  'finance-admin': REFERENCE,
  'finance-controller': REFERENCE,
  'budget-owner': ['EX-US'],
  'department-head': ['EX-EU'],
  'regional-manager': ['EX-IN', 'EX-IN-BLR', 'EX-IN-HYD'],
  'location-manager': ['EX-IN-BLR'],
  'event-organizer': [],
  employee: [],
  auditor: REFERENCE,
  'integration-admin': [],
  analyst: REFERENCE,
};

const AUDIT_READERS: RoleId[] = ['ceo', 'finance-admin', 'finance-controller', 'auditor'];

test.describe('budget visibility by role', () => {
  for (const role of ROLES) {
    test(`${role.id} lists exactly its seeded budgets`, async ({ request }) => {
      const list = await expectContract(
        await request.get('/api/budgets?limit=200', { headers: await as(role.id) }),
        200,
        BudgetList,
      );
      const seeded = list.items
        .map((b) => b.code)
        .filter((c): c is string => REFERENCE.includes(c ?? ''));
      expect(seeded.sort()).toEqual([...VISIBLE[role.id]].sort());
    });
  }

  test('a budget outside the role is not found, and one in scope opens', async ({ request }) => {
    const { india, unitedStates } = SEED.budgets;
    expect(
      (
        await request.get(`/api/budgets/${india}`, { headers: await as('location-manager') })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get(`/api/budgets/${unitedStates}`, { headers: await as('employee') })
      ).status(),
    ).toBe(404);
    expect(
      (await request.get(`/api/budgets/${india}`, { headers: await as('analyst') })).status(),
    ).toBe(200);
  });
});

test.describe('audit trail and changes by role', () => {
  for (const role of ROLES) {
    const reads = AUDIT_READERS.includes(role.id);
    test(`${role.id} ${reads ? 'reads' : 'cannot read'} the audit trail`, async ({ request }) => {
      const res = await request.get('/api/audit/events?limit=1', { headers: await as(role.id) });
      // Members without the grant get 403; a platform operator cannot even see the tenant's trail (404).
      expect(res.status()).toBe(reads ? 200 : role.id === 'super-admin' ? 404 : 403);
    });
  }

  test('read-only and unrelated roles cannot allocate from a budget', async ({ request }) => {
    const { india, bengaluru } = SEED.budgets;
    for (const role of ['analyst', 'auditor', 'employee', 'org-admin'] as RoleId[]) {
      const res = await request.post(`/api/budgets/${india}/allocations`, {
        headers: await mutate(role),
        data: { childBudgetId: bengaluru, amount: { amountMinor: 1, currency: 'INR' } },
      });
      expect([403, 404], `${role} allocating`).toContain(res.status());
    }
  });
});
