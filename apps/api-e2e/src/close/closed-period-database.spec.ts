// Invariant 7 and 20 at the database level: a posting into a closed or locked period is refused by
// Postgres, not only by application code; ledger rows and close evidence are append-only, so a
// correction can only be a reversal in an open period; and the Phase 11 tables are under RLS.
// Every statement runs as the application role and rolls back.
import { expect, test } from '@playwright/test';
import { periodId, SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { asAppRole, pgError } from '../support/db';

const acme = SEED.tenants.acme;
const globex = SEED.tenants.globex;

/**
 * Append-only is enforced twice: the application role has no UPDATE or DELETE grant (Postgres
 * 42501) and a trigger refuses the statement anyway (BF001). Either answer proves the row cannot
 * be rewritten; the grant simply fires first.
 */
const APPEND_ONLY = ['BF001', '42501'];

const insertJournal = (fiscalPeriodId: string) => `
  insert into ledger_journals (id, tenant_id, journal_type, transaction_currency, reporting_currency,
                               accounting_date, fiscal_period_id, command)
  values ($1, $2, 'manual', 'USD', 'USD', '2026-08-14', '${fiscalPeriodId}', 'scenario')`;

test.describe('the database refuses postings into a closed or locked period', () => {
  test('a ledger journal cannot be inserted into a closed period', async () => {
    const e = await pgError(
      asAppRole(acme, (c) => c.query(insertJournal(periodId(1, 2026, 8)), [randomUUID(), acme])),
    );
    expect(e?.code).toBe('BF002');
    expect(e?.message).toContain('is closed');
  });

  test('a ledger journal cannot be inserted into a locked period either', async () => {
    const e = await pgError(
      asAppRole(acme, (c) => c.query(insertJournal(periodId(1, 2026, 3)), [randomUUID(), acme])),
    );
    expect(e?.code).toBe('BF002');
    expect(e?.message).toContain('is locked');
  });

  test('a ledger line cannot be inserted into a closed period even under an open journal', async () => {
    const e = await pgError(
      asAppRole(acme, async (c) => {
        const journalId = randomUUID();
        await c.query(insertJournal(periodId(1, 2026, 11)), [journalId, acme]);
        await c.query(
          `insert into ledger_lines (id, tenant_id, journal_id, line_no, account, legal_entity_id,
                                     fiscal_period_id, accounting_date, transaction_currency,
                                     transaction_amount_minor, reporting_currency, reporting_amount_minor,
                                     reporting_rate_type, reporting_rate, reporting_rate_ids)
           values ($1, $2, $3, 1, 'actual', $4, $5, '2026-08-14', 'USD', 100, 'USD', 100, 'plan', 1, '{}')`,
          [randomUUID(), acme, journalId, SEED.legalEntities.acmeUs, periodId(1, 2026, 8)],
        );
      }),
    );
    expect(e?.code).toBe('BF002');
  });

  test('ledger rows are append-only, so a correction can only be a reversal', async () => {
    const update = await pgError(
      asAppRole(acme, (c) => c.query(`update ledger_journals set reason = 'edited'`)),
    );
    expect(APPEND_ONLY).toContain(update?.code);
    const remove = await pgError(
      asAppRole(acme, (c) => c.query(`delete from ledger_lines where tenant_id = $1`, [acme])),
    );
    expect(APPEND_ONLY).toContain(remove?.code);
  });

  test('audit events and close snapshots are append-only', async () => {
    const audit = await pgError(
      asAppRole(acme, (c) => c.query(`update audit_events set reason = 'edited'`)),
    );
    expect(APPEND_ONLY).toContain(audit?.code);
    const snapshot = await pgError(
      asAppRole(acme, (c) =>
        c.query(`delete from period_close_snapshots where tenant_id = $1`, [acme]),
      ),
    );
    expect(APPEND_ONLY).toContain(snapshot?.code);
  });

  test('close acknowledgements and commitment carries are append-only evidence', async () => {
    const ack = await pgError(
      asAppRole(acme, (c) =>
        c.query(`update period_close_acknowledgements set reason = 'rewritten'`),
      ),
    );
    expect(APPEND_ONLY).toContain(ack?.code);
    const carry = await pgError(
      asAppRole(acme, (c) => c.query(`delete from year_end_commitment_carries`)),
    );
    expect(APPEND_ONLY).toContain(carry?.code);
  });

  test('the Phase 11 tables enforce tenant isolation', async () => {
    for (const table of [
      'period_close_acknowledgements',
      'period_reopen_requests',
      'year_end_run_lines',
      'year_end_commitment_carries',
    ]) {
      const row = await asAppRole(
        acme,
        async (c) =>
          (
            await c.query(
              `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
                      exists (select 1 from pg_policies p where p.tablename = c.relname and p.policyname = 'tenant_isolation') as policy
               from pg_class c where c.relname = $1`,
              [table],
            )
          ).rows[0],
      );
      expect({ table, ...row }).toEqual({ table, enabled: true, forced: true, policy: true });
      const visible = await asAppRole(
        acme,
        async (c) =>
          (await c.query(`select count(*)::int as n from ${table} where tenant_id = $1`, [globex]))
            .rows[0].n,
      );
      expect(visible).toBe(0);
    }
    const insert = await pgError(
      asAppRole(acme, (c) =>
        c.query(
          `insert into period_reopen_requests (id, tenant_id, fiscal_period_id, action, reason_code, reason)
           values ($1, $2, $3, 'reopen', 'X', 'injected')`,
          [randomUUID(), globex, periodId(1, 2026, 8)],
        ),
      ),
    );
    expect(insert?.code).toBe('42501');
  });
});
