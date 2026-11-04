// Invariant 5: every journal balances in transaction and reporting currency, its lines are written with it
// and never appended later, and corrections are single, linked reversals even under concurrency.
import { expect, test } from '@playwright/test';
import { AuditEventList, Journal } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole, pgError } from '../support/db';
import {
  allocate,
  allocateOk,
  createChild,
  createRoot,
  expectMoney,
  getBudget,
} from '../support/factory';

const INDIA = SEED.legalEntities.acmeIndia;
const reason = { reasonCode: 'REV-ERROR', reason: 'Posted against the wrong budget' };

test.describe('journals', () => {
  test('a journal balanced in INR posts with a reporting rounding line to FX variance', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    const india = await createChild(request, root.id, { currency: 'INR' });
    await allocateOk(request, root.id, india.id, { amountMinor: 1_000, currency: 'USD' });
    const credit = {
      budgetId: null,
      account: 'obligations',
      side: 'credit',
      amountMinor: 100,
      legalEntityId: INDIA,
    };
    // INR 3.00 = USD 0.036 → 4 cents; each INR 1.00 = USD 0.012 → 1 cent: 4 against 3 in reporting.
    const journal = await expectContract(
      await request.post('/api/ledger/journals', {
        headers: await mutate('finance-admin'),
        data: {
          transactionCurrency: 'INR',
          reasonCode: 'ADJ-OPENING',
          reason: 'Opening actual split across three suppliers',
          lines: [
            { budgetId: india.id, account: 'actual', side: 'debit', amountMinor: 300 },
            credit,
            credit,
            credit,
          ],
        },
      }),
      201,
      Journal,
    );
    expect(journal.balanced).toBe(true);
    expect(journal.totals).toEqual({
      debitTransactionMinor: 300,
      creditTransactionMinor: 300,
      debitReportingMinor: 4,
      creditReportingMinor: 4,
    });
    expect(
      journal.lines.map((l) => [
        l.account,
        l.transaction.amountMinor,
        l.budget?.amountMinor ?? null,
        l.reporting.amountMinor,
      ]),
    ).toEqual([
      ['actual', 300, 300, 4],
      ['obligations', -100, null, -1],
      ['obligations', -100, null, -1],
      ['obligations', -100, null, -1],
      ['fx_variance', 0, null, -1],
    ]);
    expectMoney((await getBudget(request, india.id)).balances.budgetCurrency.actual, 300, 'INR');

    // The audit entry records what was posted: accounts and amounts per line.
    const audit = await expectContract(
      await request.get(`/api/audit/events?resourceId=${journal.id}`, {
        headers: await as('auditor'),
      }),
      200,
      AuditEventList,
    );
    expect(audit.items.map((e) => e.action)).toEqual(['ledger.journal.posted']);
    expect(audit.items[0].changes).toMatchObject({
      transactionCurrency: { from: null, to: 'INR' },
      lines: {
        from: null,
        to: [
          {
            budgetId: india.id,
            account: 'actual',
            transactionMinor: 300,
            budgetMinor: 300,
            reportingMinor: 4,
          },
          { budgetId: null, account: 'obligations', transactionMinor: -100, reportingMinor: -1 },
          { budgetId: null, account: 'obligations', transactionMinor: -100, reportingMinor: -1 },
          { budgetId: null, account: 'obligations', transactionMinor: -100, reportingMinor: -1 },
          { budgetId: null, account: 'fx_variance', transactionMinor: 0, reportingMinor: -1 },
        ],
      },
    });

    // The reversal negates every line, the rounding line included.
    const reversal = await expectContract(
      await request.post(`/api/ledger/journals/${journal.id}/reversals`, {
        headers: await mutate('finance-admin'),
        data: reason,
      }),
      201,
      Journal,
    );
    expect(reversal.balanced).toBe(true);
    expect(reversal.lines.map((l) => l.reporting.amountMinor)).toEqual([-4, 1, 1, 1, 1]);
    expectMoney((await getBudget(request, india.id)).balances.budgetCurrency.actual, 0, 'INR');
  });

  test('a manual line worth less than one minor unit of its budget currency is rejected', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    const res = await request.post('/api/ledger/journals', {
      headers: await mutate('finance-admin'),
      data: {
        transactionCurrency: 'INR',
        reasonCode: 'ADJ-OPENING',
        reason: 'INR 0.41 against a USD budget',
        lines: [
          { budgetId: root.id, account: 'actual', side: 'debit', amountMinor: 41 },
          {
            budgetId: null,
            account: 'obligations',
            side: 'credit',
            amountMinor: 41,
            legalEntityId: INDIA,
          },
        ],
      },
    });
    const p = await expectProblem(res, 422, 'AMOUNT_ROUNDS_TO_ZERO');
    expect(p.params).toMatchObject({ line: 1, currency: 'USD' });
  });

  test('the database refuses lines appended to a committed journal, even balanced ones', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const alloc = await allocateOk(request, root.id, child.id, {
      amountMinor: 1_000,
      currency: 'USD',
    });
    const line = alloc.journal.lines.find((l) => l.account === 'authorized')!;
    const e = await pgError(
      asAppRole(SEED.tenants.acme, async (c) => {
        const insert = (lineNo: number, amount: number) =>
          c.query(
            `insert into ledger_lines (tenant_id, journal_id, line_no, budget_id, account, legal_entity_id, fiscal_period_id,
               accounting_date, transaction_currency, transaction_amount_minor, budget_currency, budget_amount_minor,
               reporting_currency, reporting_amount_minor, budget_rate_type, budget_rate, budget_rate_ids,
               reporting_rate_type, reporting_rate, reporting_rate_ids)
             values ($1, $2, $3, $4, 'actual', $5, $6, $7, 'USD', $8, 'USD', $8, 'USD', $8, 'plan', 1, '{}', 'plan', 1, '{}')`,
            [
              SEED.tenants.acme,
              alloc.journal.id,
              lineNo,
              child.id,
              line.legalEntityId,
              line.periodId,
              line.accountingDate,
              amount,
            ],
          );
        await insert(3, 777);
        await insert(4, -777);
      }),
    );
    expect(e?.code).toBe('BF001');
    expect(e?.message).toContain('was not created in this transaction');
    const after = await expectContract(
      await request.get(`/api/ledger/journals/${alloc.journal.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      Journal,
    );
    expect(after.lines).toHaveLength(2);
  });

  test('a reversal and a downstream allocation racing for the same money never both succeed', async ({
    request,
  }) => {
    for (let round = 0; round < 8; round++) {
      const root = await createRoot(request, { amountMinor: 100_000 });
      const child = await createChild(request, root.id, { currency: 'USD' });
      const grandchild = await createChild(request, child.id, { currency: 'USD' });
      const funded = await allocateOk(request, root.id, child.id, {
        amountMinor: 100_000,
        currency: 'USD',
      });
      const [reversal, allocation] = await Promise.all([
        mutate('finance-admin').then((headers) =>
          request.post(`/api/ledger/journals/${funded.journal.id}/reversals`, {
            headers,
            data: reason,
          }),
        ),
        allocate(request, child.id, grandchild.id, { amountMinor: 60_000, currency: 'USD' }),
      ]);
      const statuses = [reversal.status(), allocation.status()].sort();
      expect(statuses, `round ${round}`).toEqual([201, 409]);
      const c = await getBudget(request, child.id);
      expect(c.balances.budgetCurrency.allocatedOut.amountMinor).toBeLessThanOrEqual(
        c.balances.budgetCurrency.authorized.amountMinor,
      );
    }
  });

  test('ten parallel reversals of one journal with different keys post exactly one', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const alloc = await allocateOk(request, root.id, child.id, {
      amountMinor: 4_000,
      currency: 'USD',
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const res = await request.post(`/api/ledger/journals/${alloc.journal.id}/reversals`, {
          headers: await mutate('finance-admin'),
          data: reason,
        });
        return { status: res.status(), code: (await res.json()).code as string | undefined };
      }),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.code === 'ALREADY_REVERSED')).toHaveLength(
      9,
    );
    expectMoney((await getBudget(request, root.id)).balances.budgetCurrency.allocatedOut, 0, 'USD');
  });

  test('an idempotency key is bound to its actor and operation', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 20_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const key = randomUUID();
    const amount = { amountMinor: 1_000, currency: 'USD' };
    expect((await allocate(request, root.id, child.id, amount, { key })).status()).toBe(201);
    await expectProblem(
      await allocate(request, root.id, child.id, amount, { key, as: 'finance-admin' }),
      422,
      'IDEMPOTENCY_KEY_REUSED',
    );
    await expectProblem(
      await request.post('/api/ledger/journals', {
        headers: await mutate('finance-admin', key),
        data: {
          transactionCurrency: 'USD',
          reasonCode: 'ADJ-OPENING',
          reason: 'Same key, other operation',
          lines: [
            { budgetId: root.id, account: 'actual', side: 'debit', amountMinor: 1 },
            {
              budgetId: null,
              account: 'obligations',
              side: 'credit',
              amountMinor: 1,
              legalEntityId: SEED.legalEntities.acmeUs,
            },
          ],
        },
      }),
      422,
      'IDEMPOTENCY_KEY_REUSED',
    );
    expectMoney(
      (await getBudget(request, root.id)).balances.budgetCurrency.allocatedOut,
      1_000,
      'USD',
    );
  });

  test("another director cannot read a journal in someone else's subtree or learn whether a journal exists", async ({
    request,
  }) => {
    const us = SEED.budgets.unitedStates;
    const kid = await createChild(request, us, { currency: 'USD', as: 'budget-owner' });
    const alloc = await allocateOk(
      request,
      us,
      kid.id,
      { amountMinor: 100, currency: 'USD' },
      { as: 'budget-owner' },
    );
    await expectProblem(
      await request.get(`/api/ledger/journals/${alloc.journal.id}`, {
        headers: await as('regional-manager'),
      }),
      404,
      'NOT_FOUND',
    );
    for (const id of [alloc.journal.id, randomUUID()]) {
      await expectProblem(
        await request.post(`/api/ledger/journals/${id}/reversals`, {
          headers: await mutate('regional-manager'),
          data: reason,
        }),
        403,
        'FORBIDDEN',
      );
    }
  });
});
