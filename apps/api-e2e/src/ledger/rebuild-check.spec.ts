// Invariants 6 and 20: the worker's ledger rebuild check recomputes balances from ledger lines and finds
// them equal to the cached balances; no bucket is negative and no budget allocated out more than it holds;
// every line's triplet matches its stored rates; parents' allocated out equals children's authorized in
// the parent currency at the locked plan rate; roots tie to the approved plan version; the audit chain
// verifies. Injected drift and corruption (sandbox tenant only, removed afterwards) raise flags.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { IntegrityCheckRun } from '@bf/contracts';
import { periodId, SEED, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import { allocateOk, createChild, createRoot } from '../support/factory';

async function runCheck(request: APIRequestContext, user: SeedUserId) {
  const queued = await expectContract(
    await request.post('/api/integrity/ledger-checks', { headers: await mutate(user) }),
    202,
    IntegrityCheckRun,
  );
  expect(queued.status).toBe('queued');
  let run = queued;
  await expect
    .poll(
      async () => {
        run = await expectContract(
          await request.get(`/api/integrity/ledger-checks/${queued.id}`, {
            headers: await as(user),
          }),
          200,
          IntegrityCheckRun,
        );
        return run.status;
      },
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toMatch(/^(clean|drift_detected|failed)$/);
  return run;
}

test.describe('ledger rebuild check (worker job)', () => {
  test('after allocations across currencies, rebuilt balances equal cached ones and the hierarchy reconciles', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 500_000 });
    const india = await createChild(request, root.id, { currency: 'INR' });
    const europe = await createChild(request, root.id, { currency: 'EUR' });
    const bengaluru = await createChild(request, india.id, { currency: 'INR' });
    await allocateOk(request, root.id, india.id, { amountMinor: 120_000, currency: 'USD' });
    await allocateOk(request, root.id, europe.id, { amountMinor: 30_000, currency: 'EUR' });
    await allocateOk(request, india.id, bengaluru.id, { amountMinor: 1_000_000, currency: 'INR' });

    const run = await runCheck(request, 'finance-controller');
    expect(run.status).toBe('clean');
    expect(run.flagsRaised).toBe(0);
    expect(run.summary).toMatchObject({
      unbalancedJournals: [],
      balanceDrifts: [],
      hierarchyMismatches: [],
      negativeBuckets: [],
      overAllocatedBudgets: [],
      tripletMismatches: [],
      planTieMismatches: [],
      auditChain: { valid: true, firstBrokenSeq: null },
    });
    expect(run.summary!.budgetsChecked).toBeGreaterThanOrEqual(10);
    expect(run.summary!.journalsChecked).toBeGreaterThan(0);
  });

  test('roles without the integrity permission cannot run or read checks', async ({ request }) => {
    await expectProblem(
      await request.post('/api/integrity/ledger-checks', { headers: await mutate('employee') }),
      403,
      'FORBIDDEN',
    );
    await expectProblem(
      await request.post('/api/integrity/ledger-checks', {
        headers: await mutate('regional-manager'),
      }),
      403,
      'FORBIDDEN',
    );
    const run = await runCheck(request, 'finance-admin');
    await expectProblem(
      await request.get(`/api/integrity/ledger-checks/${run.id}`, { headers: await as('analyst') }),
      403,
      'FORBIDDEN',
    );
  });

  test('injected drift in cached balances is detected and flagged, never repaired', async ({
    request,
  }) => {
    const child = SEED.budgets.sandboxChild;
    await asOwner((c) =>
      c.query(
        `update ledger_balances set budget_amount_minor = budget_amount_minor + 1 where budget_id = $1 and bucket = 'authorized'`,
        [child],
      ),
    );
    try {
      const run = await runCheck(request, 'sandbox-admin');
      expect(run.status).toBe('drift_detected');
      expect(run.flagsRaised).toBeGreaterThanOrEqual(1);
      const drift = run.summary!.balanceDrifts.find(
        (d) => d.budgetId === child && d.bucket === 'authorized',
      )!;
      expect(drift.cachedBudgetMinor - drift.rebuiltBudgetMinor).toBe(1);
      const flags = await asOwner((c) =>
        c.query(`select kind, status from integrity_flags where check_run_id = $1`, [run.id]),
      );
      expect(flags.rows).toContainEqual({ kind: 'ledger_drift', status: 'open' });
      // Not auto-repaired: the cache still differs until someone fixes it.
      const still = await asOwner((c) =>
        c.query(
          `select budget_amount_minor::text as v from ledger_balances where budget_id = $1 and bucket = 'authorized'`,
          [child],
        ),
      );
      expect(Number(still.rows[0].v)).toBe(drift.cachedBudgetMinor);
    } finally {
      await asOwner((c) =>
        c.query(
          `update ledger_balances set budget_amount_minor = budget_amount_minor - 1 where budget_id = $1 and bucket = 'authorized'`,
          [child],
        ),
      );
    }
    expect((await runCheck(request, 'sandbox-admin')).status).toBe('clean');
  });

  test('seeded ledger corruption is flagged: negative bucket, over-allocation, wrong triplet, hierarchy', async ({
    request,
  }) => {
    const { sandboxProgram: program, sandboxChild: child } = SEED.budgets;
    const tenant = SEED.tenants.sandbox;
    const entity = SEED.legalEntities.sandbox;
    const nov = periodId(4, 2026, 11);
    const journalId = randomUUID();
    // One balanced USD journal written past every API guard: [account, budget, transaction, budget amount].
    const lines: [string, string | null, number, number | null][] = [
      ['actual', child, -100, -100], // actual below zero
      ['allocated_out', child, 300_000, 300_000], // more allocated out than authorized, and no children
      ['authorized', child, -50, -50], // child worth more than its parent gave up
      ['encumbered', child, 100, 101], // budget amount does not match the stored rate
      ['obligations', null, -299_950, null],
    ];
    await asOwner(async (c) => {
      await c.query('begin');
      await c.query(
        `insert into ledger_journals (id, tenant_id, journal_type, transaction_currency, reporting_currency, accounting_date, fiscal_period_id, command)
         values ($1, $2, 'manual', 'USD', 'USD', '2026-11-16', $3, 'scenario')`,
        [journalId, tenant, nov],
      );
      for (const [i, [account, budgetId, t, b]] of lines.entries()) {
        await c.query(
          `insert into ledger_lines (tenant_id, journal_id, line_no, budget_id, account, legal_entity_id, fiscal_period_id, accounting_date,
             transaction_currency, transaction_amount_minor, budget_currency, budget_amount_minor, reporting_currency, reporting_amount_minor,
             budget_rate_type, budget_rate, budget_rate_ids, reporting_rate_type, reporting_rate, reporting_rate_ids)
           values ($1, $2, $3, $4, $5, $6, $7, '2026-11-16', 'USD', $8, $9, $10, 'USD', $8,
                   $11, $12, $13, 'plan', 1, '{}')`,
          [
            tenant,
            journalId,
            i + 1,
            budgetId,
            account,
            entity,
            nov,
            t,
            budgetId ? 'USD' : null,
            b,
            budgetId ? 'plan' : null,
            budgetId ? 1 : null,
            budgetId ? '{}' : null,
          ],
        );
      }
      await c.query('commit');
    });
    try {
      const run = await runCheck(request, 'sandbox-admin');
      expect(run.status).toBe('drift_detected');
      const s = run.summary!;
      expect(s.negativeBuckets).toContainEqual({
        budgetId: child,
        bucket: 'actual',
        balanceMinor: -100,
      });
      expect(s.overAllocatedBudgets).toContainEqual({
        budgetId: child,
        authorizedMinor: 250_050,
        allocatedOutMinor: 300_000,
      });
      expect(s.tripletMismatches).toContainEqual(
        expect.objectContaining({
          journalId,
          view: 'budget',
          expectedMinor: 100,
          storedMinor: 101,
        }),
      );
      expect(s.hierarchyMismatches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            parentId: program,
            allocatedOutMinor: 250_000,
            childrenAuthorizedAtPlanMinor: 250_050,
          }),
          expect.objectContaining({
            parentId: child,
            allocatedOutMinor: 300_000,
            childrenAuthorizedAtPlanMinor: 0,
          }),
        ]),
      );
      const flags = await asOwner((c) =>
        c.query(`select distinct kind::text as kind from integrity_flags where check_run_id = $1`, [
          run.id,
        ]),
      );
      expect(flags.rows.map((r) => r.kind).sort()).toEqual([
        'hierarchy_mismatch',
        'ledger_drift',
        'negative_bucket',
        'over_allocated',
        'triplet_mismatch',
      ]);
    } finally {
      await asOwner(async (c) => {
        await c.query('begin');
        await c.query('alter table ledger_lines disable trigger ledger_lines_append_only');
        await c.query('alter table ledger_journals disable trigger ledger_journals_append_only');
        await c.query('delete from ledger_lines where journal_id = $1', [journalId]);
        await c.query('delete from ledger_journals where id = $1', [journalId]);
        await c.query('alter table ledger_journals enable trigger ledger_journals_append_only');
        await c.query('alter table ledger_lines enable trigger ledger_lines_append_only');
        await c.query('commit');
      });
    }
    expect((await runCheck(request, 'sandbox-admin')).status).toBe('clean');
  });
});
