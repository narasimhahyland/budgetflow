// Invariant 5: every journal balances; ledger rows are append-only; corrections are linked reversals.
import { expect, test } from '@playwright/test';
import { Journal } from '@bf/contracts';
import { periodId, SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole, pgError } from '../support/db';
import { allocateOk, createChild, createRoot, expectMoney, getBudget } from '../support/factory';

const reason = { reasonCode: 'REV-ERROR', reason: 'Allocated to the wrong team' };

test.describe('reversals instead of edits', () => {
  test('a reversal exactly negates the original, links both ways and restores balances', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'INR' });
    const alloc = await allocateOk(request, root.id, child.id, {
      amountMinor: 40_000,
      currency: 'USD',
    });
    expectMoney(alloc.child.balances.budgetCurrency.authorized, 3_330_000, 'INR');

    const res = await request.post(`/api/ledger/journals/${alloc.journal.id}/reversals`, {
      headers: await mutate('finance-controller'),
      data: reason,
    });
    const reversal = await expectContract(res, 201, Journal);
    expect(reversal.type).toBe('reversal');
    expect(reversal.reversalOfJournalId).toBe(alloc.journal.id);
    expect(reversal.balanced).toBe(true);
    expect(reversal.reasonCode).toBe('REV-ERROR');
    expect(
      reversal.lines.map((l) => [
        l.account,
        l.transaction.amountMinor,
        l.budget?.amountMinor,
        l.reporting.amountMinor,
      ]),
    ).toEqual(
      alloc.journal.lines.map((l) => [
        l.account,
        -l.transaction.amountMinor,
        l.budget ? -l.budget.amountMinor : undefined,
        -l.reporting.amountMinor,
      ]),
    );
    expect(reversal.lines.map((l) => l.reversalOfLineId)).toEqual(
      alloc.journal.lines.map((l) => l.id),
    );

    const original = await expectContract(
      await request.get(`/api/ledger/journals/${alloc.journal.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      Journal,
    );
    expect(original.reversedByJournalId).toBe(reversal.id);
    expect(original.lines).toEqual(alloc.journal.lines);
    expectMoney((await getBudget(request, root.id)).balances.budgetCurrency.allocatedOut, 0, 'USD');
    expectMoney((await getBudget(request, child.id)).balances.budgetCurrency.authorized, 0, 'INR');
  });

  test('a journal is reversed once, and a reversal is never reversed', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const alloc = await allocateOk(request, root.id, child.id, {
      amountMinor: 1_000,
      currency: 'USD',
    });
    const reversal = await expectContract(
      await request.post(`/api/ledger/journals/${alloc.journal.id}/reversals`, {
        headers: await mutate('finance-controller'),
        data: reason,
      }),
      201,
      Journal,
    );
    await expectProblem(
      await request.post(`/api/ledger/journals/${alloc.journal.id}/reversals`, {
        headers: await mutate('finance-controller'),
        data: reason,
      }),
      409,
      'ALREADY_REVERSED',
    );
    await expectProblem(
      await request.post(`/api/ledger/journals/${reversal.id}/reversals`, {
        headers: await mutate('finance-controller'),
        data: reason,
      }),
      409,
      'CANNOT_REVERSE_REVERSAL',
    );
  });

  test('a reversal that would leave a child with more allocated out than it holds is refused', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const a = await createChild(request, root.id, { currency: 'USD' });
    const b = await createChild(request, a.id, { currency: 'USD' });
    const first = await allocateOk(request, root.id, a.id, {
      amountMinor: 40_000,
      currency: 'USD',
    });
    await allocateOk(request, a.id, b.id, { amountMinor: 30_000, currency: 'USD' });
    await expectProblem(
      await request.post(`/api/ledger/journals/${first.journal.id}/reversals`, {
        headers: await mutate('finance-controller'),
        data: reason,
      }),
      409,
      'REVERSAL_WOULD_OVERDRAW',
    );
    expectMoney((await getBudget(request, a.id)).balances.budgetCurrency.authorized, 40_000, 'USD');
  });

  test('reversals need a reason and the reversal permission', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const alloc = await allocateOk(request, root.id, child.id, {
      amountMinor: 1_000,
      currency: 'USD',
    });
    await expectProblem(
      await request.post(`/api/ledger/journals/${alloc.journal.id}/reversals`, {
        headers: await mutate('finance-controller'),
        data: { reasonCode: 'REV-ERROR' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    await expectProblem(
      await request.post(`/api/ledger/journals/${alloc.journal.id}/reversals`, {
        headers: await mutate('auditor'),
        data: reason,
      }),
      403,
      'FORBIDDEN',
    );
    await expectProblem(
      await request.post(`/api/ledger/journals/${randomUUID()}/reversals`, {
        headers: await mutate('finance-controller'),
        data: reason,
      }),
      404,
      'NOT_FOUND',
    );
  });

  test('the database rejects UPDATE, DELETE and TRUNCATE on ledger rows for the application role', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 1_000 });
    const tenant = SEED.tenants.acme;
    for (const sql of [
      `update ledger_lines set transaction_amount_minor = 0 where budget_id = '${root.id}'`,
      `delete from ledger_lines where budget_id = '${root.id}'`,
      `update ledger_journals set reason = 'edited' where id in (select journal_id from ledger_lines where budget_id = '${root.id}')`,
      `delete from ledger_journals where id in (select journal_id from ledger_lines where budget_id = '${root.id}')`,
      'truncate ledger_lines',
    ]) {
      const e = await pgError(asAppRole(tenant, (c) => c.query(sql)));
      expect(e?.code, sql).toBe('42501');
    }
    expectMoney(
      (await getBudget(request, root.id)).balances.budgetCurrency.authorized,
      1_000,
      'USD',
    );
  });

  test('the database rejects an unbalanced journal at commit even when written directly', async () => {
    const tenant = SEED.tenants.acme;
    const nov = periodId(1, 2026, 11);
    const journalId = randomUUID();
    const e = await pgError(
      asAppRole(
        tenant,
        async (c) => {
          await c.query(
            `insert into ledger_journals (id, tenant_id, journal_type, transaction_currency, reporting_currency, accounting_date, fiscal_period_id, command)
             values ($1, $2, 'manual', 'USD', 'USD', '2026-11-16', $3, 'scenario')`,
            [journalId, tenant, nov],
          );
          for (const [n, account, amount] of [
            [1, 'obligations', 500],
            [2, 'fx_variance', -499],
          ] as const) {
            await c.query(
              `insert into ledger_lines (tenant_id, journal_id, line_no, account, legal_entity_id, fiscal_period_id, accounting_date, transaction_currency, transaction_amount_minor,
                 reporting_currency, reporting_amount_minor, reporting_rate_type, reporting_rate, reporting_rate_ids)
               values ($1, $2, $3, $4, $5, $6, '2026-11-16', 'USD', $7, 'USD', $7, 'plan', 1, '{}')`,
              [tenant, journalId, n, account, SEED.legalEntities.acmeUs, nov, amount],
            );
          }
        },
        { commit: true },
      ),
    );
    expect(e?.code).toBe('BF003');
    expect(e?.message).toContain('does not balance');
  });
});
