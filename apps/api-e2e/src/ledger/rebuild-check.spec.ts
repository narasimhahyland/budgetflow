// Invariants 6 and 20: the worker's ledger rebuild check recomputes balances from ledger lines and finds
// them equal to the cached balances; parents' allocated out equals children's authorized; roots tie to the
// approved plan version; the audit chain verifies. Injected drift (sandbox tenant only) raises flags.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { IntegrityCheckRun } from '@bf/contracts';
import { SEED, type SeedUserId } from '@bf/seed';
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
});
