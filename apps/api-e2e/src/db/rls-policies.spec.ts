// Invariant 18 (database): every tenant table enables and forces RLS with the tenant_isolation policy, and
// the application role (no BYPASSRLS) cannot read or write another tenant's rows with app.tenant_id set.
import { expect, test } from '@playwright/test';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { asAppRole, pgError } from '../support/db';

const { acme, globex } = SEED.tenants;

test.describe('row-level security as the application role', () => {
  test('every table with tenant_id has RLS enabled, forced and a tenant_isolation policy', async () => {
    const rows = await asAppRole(
      null,
      async (c) =>
        (
          await c.query(`
          select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
                 exists (select 1 from pg_policies p where p.tablename = c.relname and p.policyname = 'tenant_isolation') as policy
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and (exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'tenant_id') or c.relname = 'tenants')
          order by 1`)
        ).rows,
    );
    expect(rows.length).toBeGreaterThanOrEqual(70);
    const missing = rows.filter((r) => !(r.enabled && r.forced && r.policy)).map((r) => r.table);
    expect(missing).toEqual([]);
  });

  test('the application role is not a superuser and has no BYPASSRLS', async () => {
    const r = await asAppRole(
      null,
      async (c) =>
        (await c.query(`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`))
          .rows[0],
    );
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  test('tenant A cannot select, insert, update or delete tenant B rows', async () => {
    await asAppRole(acme, async (c) => {
      const visible = await c.query(`select count(*)::int as n from budgets where tenant_id = $1`, [
        globex,
      ]);
      expect(visible.rows[0].n).toBe(0);
      const own = await c.query(`select count(*)::int as n from budgets where tenant_id = $1`, [
        acme,
      ]);
      expect(own.rows[0].n).toBeGreaterThan(0);
      const updated = await c.query(`update budgets set name = 'hijacked' where id = $1`, [
        SEED.budgets.globexOperations,
      ]);
      expect(updated.rowCount).toBe(0);
      const deleted = await c.query(`delete from budget_categories where tenant_id = $1`, [globex]);
      expect(deleted.rowCount).toBe(0);
    });
    const insert = await pgError(
      asAppRole(acme, (c) =>
        c.query(
          `insert into budget_categories (id, tenant_id, code, name) values ($1, $2, 'x', 'Injected')`,
          [randomUUID(), globex],
        ),
      ),
    );
    expect(insert?.code).toBe('42501');
  });

  test('without a tenant context nothing is visible', async () => {
    await asAppRole(null, async (c) => {
      for (const table of ['budgets', 'ledger_lines', 'audit_events', 'memberships', 'tenants']) {
        const r = await c.query(`select count(*)::int as n from ${table}`);
        expect(r.rows[0].n, table).toBe(0);
      }
    });
  });

  // Migration 0015: the forecast cycle (87a) and the board pack (16a) carry a tenant's financial
  // plans and its rendered board reporting, so they are isolated like every other tenant table.
  test('the forecast cycle and board pack tables isolate tenants', async () => {
    for (const table of ['forecast_cycles', 'forecast_snapshots', 'board_pack_generations']) {
      const meta = await asAppRole(
        null,
        async (c) =>
          (
            await c.query(
              `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
                      exists (select 1 from pg_policies p where p.tablename = c.relname and p.policyname = 'tenant_isolation') as policy
               from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = $1`,
              [table],
            )
          ).rows[0],
      );
      expect(meta, table).toEqual({ enabled: true, forced: true, policy: true });
      await asAppRole(acme, async (c) => {
        const other = await c.query(
          `select count(*)::int as n from ${table} where tenant_id = $1`,
          [globex],
        );
        expect(other.rows[0].n, `${table} leaks tenant B rows`).toBe(0);
      });
    }
    // Hyland's own forecast cycles are visible to Hyland, so the check above is not vacuous.
    await asAppRole(acme, async (c) => {
      const own = await c.query(
        `select count(*)::int as n from forecast_cycles where tenant_id = $1`,
        [acme],
      );
      expect(own.rows[0].n).toBeGreaterThan(0);
    });
    // Writing another tenant's forecast cycle is refused by the policy, not silently ignored.
    const insert = await pgError(
      asAppRole(acme, (c) =>
        c.query(
          `insert into forecast_cycles (id, tenant_id, name, as_of_date, due_date, fiscal_year_id, currency)
           values ($1, $2, 'Injected', '2026-09-30', '2026-10-12', $3, 'USD')`,
          [randomUUID(), globex, SEED.fiscalYears.globexFy2026],
        ),
      ),
    );
    expect(insert?.code).toBe('42501');
  });
});
