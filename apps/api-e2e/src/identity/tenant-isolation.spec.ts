// Tenant isolation against the scenario-only second tenant (Globex) with real tokens (Phase 2): Hyland is
// the only company in the product, but tenant_id + RLS hold. A forged X-Tenant-Id is refused both ways,
// and each tenant's admin sees only its own identity, budgets and audit trail.
import { expect, test } from '@playwright/test';
import { AuditEventList, BudgetList, MeResponse } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole } from '../support/db';

const { acme: hyland, globex } = SEED.tenants;

test.describe('isolation from the scenario-only second tenant', () => {
  test('each user resolves only to their own tenant; forged tenant headers are refused', async ({
    request,
  }) => {
    const other = await expectContract(
      await request.get('/api/me', { headers: await as('globex-admin', {}, null) }),
      200,
      MeResponse,
    );
    expect(other.tenantId).toBe(globex);
    expect(other.memberships.map((m) => m.tenantId)).toEqual([globex]);

    for (const path of ['/api/me', '/api/budgets', '/api/audit/events']) {
      await expectProblem(
        await request.get(path, { headers: await as('globex-admin', {}, hyland) }),
        403,
        'TENANT_NOT_MEMBER',
      );
      await expectProblem(
        await request.get(path, { headers: await as('finance-admin', {}, globex) }),
        403,
        'TENANT_NOT_MEMBER',
      );
    }
  });

  test("neither tenant's admin lists or audits the other's data", async ({ request }) => {
    const theirs = await expectContract(
      await request.get('/api/budgets?limit=200', { headers: await as('globex-admin') }),
      200,
      BudgetList,
    );
    expect(theirs.items.some((b) => b.code?.startsWith('EX-'))).toBe(false);
    const ours = await expectContract(
      await request.get('/api/budgets?limit=200', { headers: await as('finance-admin') }),
      200,
      BudgetList,
    );
    expect(ours.items.map((b) => b.id)).not.toContain(SEED.budgets.globexOperations);

    const audit = await expectContract(
      await request.get('/api/audit/events?limit=200', { headers: await as('globex-admin') }),
      200,
      AuditEventList,
    );
    const hylandBudgetIds = new Set<string>(Object.values(SEED.budgets));
    expect(
      audit.items.some(
        (e) =>
          e.resourceId &&
          hylandBudgetIds.has(e.resourceId) &&
          e.resourceId !== SEED.budgets.globexOperations,
      ),
    ).toBe(false);
  });

  test('the database hides other tenants\u2019 memberships and role grants (RLS)', async () => {
    const seen = await asAppRole(globex, async (c) => ({
      memberships: (await c.query('select distinct tenant_id from memberships')).rows,
      grants: (await c.query('select distinct tenant_id from role_grants')).rows,
      tenants: (await c.query('select name from tenants')).rows,
    }));
    expect(seen.memberships).toEqual([{ tenant_id: globex }]);
    expect(seen.grants).toEqual([{ tenant_id: globex }]);
    expect(seen.tenants).toEqual([{ name: 'Globex Corporation' }]);
  });
});
