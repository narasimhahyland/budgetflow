// Invariant 18: a budget only references its own tenant's parent and master data. The API looks references
// up under RLS (422 naming the field); the database enforces it with (tenant_id, id) foreign keys, which
// hold even for the application role because foreign-key checks ignore row-level security.
import { expect, test } from '@playwright/test';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { mutate } from '../support/auth';
import { expectProblem } from '../support/contract';
import { asAppRole, asOwner, pgError } from '../support/db';
import { createRoot } from '../support/factory';

const GLOBEX = {
  costCenterId: SEED.costCenters.globex,
  orgUnitId: SEED.orgUnits.globex,
  ownerPersonId: userById('globex-admin').personId!,
};

test.describe('tenant-scoped references', () => {
  test("a child budget cannot reference another tenant's cost center, org unit or owner", async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    for (const [field, id] of Object.entries(GLOBEX)) {
      const name = `Scenario child cross-tenant ${field} ${randomUUID().slice(0, 8)}`;
      const p = await expectProblem(
        await request.post('/api/budgets', {
          headers: await mutate('ceo'),
          data: {
            name,
            parentId: root.id,
            legalEntityId: SEED.legalEntities.acmeUs,
            currency: 'USD',
            fiscalYearId: SEED.fiscalYears.acmeFy2026,
            [field]: id,
          },
        }),
        422,
        'VALIDATION_FAILED',
      );
      expect(p.params).toEqual({ field });
      expect(p.detail).not.toContain(id);
      const created = await asOwner((c) =>
        c.query(`select count(*)::int as n from budgets where name = $1`, [name]),
      );
      expect(created.rows[0].n).toBe(0);
    }
  });

  test("the database refuses another tenant's parent or master data even for the application role", async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    const insert = (column: string, value: string) =>
      pgError(
        asAppRole(SEED.tenants.acme, (c) =>
          c.query(
            `insert into budgets (tenant_id, path, depth, name, legal_entity_id, currency, fiscal_year_id, control_basis, ${column})
             values ($1, '/scenario/', 1, 'Scenario direct insert', $2, 'USD', $3, '{actual}', $4)`,
            [SEED.tenants.acme, SEED.legalEntities.acmeUs, SEED.fiscalYears.acmeFy2026, value],
          ),
        ),
      );
    for (const [column, value, constraint] of [
      ['cost_center_id', GLOBEX.costCenterId, 'budgets_cost_center_same_tenant_fk'],
      ['org_unit_id', GLOBEX.orgUnitId, 'budgets_org_unit_same_tenant_fk'],
      ['owner_person_id', GLOBEX.ownerPersonId, 'budgets_owner_same_tenant_fk'],
      ['parent_id', SEED.budgets.globexOperations, 'budgets_parent_same_tenant_fk'],
    ] as const) {
      const e = await insert(column, value);
      expect(e?.code, column).toBe('23503');
      expect(e?.message, column).toContain(constraint);
    }
    // The same columns accept the tenant's own rows.
    expect(await insert('parent_id', root.id)).toBeNull();
  });

  test('authorization is checked before references are looked up, so refusals reveal nothing', async ({
    request,
  }) => {
    // An employee may not create root budgets: refused before the (unknown) legal entity is looked up.
    await expectProblem(
      await request.post('/api/budgets', {
        headers: await mutate('employee'),
        data: {
          name: 'Scenario root without permission',
          legalEntityId: randomUUID(),
          currency: 'USD',
          fiscalYearId: randomUUID(),
          planVersionId: randomUUID(),
          originalAmount: { amountMinor: 100, currency: 'USD' },
        },
      }),
      403,
      'FORBIDDEN',
    );
    // An auditor may not reverse journals: refused whether or not the journal exists.
    await expectProblem(
      await request.post(`/api/ledger/journals/${randomUUID()}/reversals`, {
        headers: await mutate('auditor'),
        data: { reasonCode: 'REV-ERROR', reason: 'Probe' },
      }),
      403,
      'FORBIDDEN',
    );
  });
});
