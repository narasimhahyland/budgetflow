// Invariant 7: a journal posts within its budgets' fiscal year. FY2026 runs 2026-01-01 to 2026-12-31 on the
// Acme group calendar; dates outside it are rejected for allocations, root budgets, manual journals and
// reversals alike, while closed periods inside the year still move late items to the next open period.
import { expect, test } from '@playwright/test';
import { Journal } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import {
  allocate,
  allocateOk,
  createChild,
  createRoot,
  expectMoney,
  getBudget,
} from '../support/factory';

const FY2026 = { fiscalYear: 'FY2026', startDate: '2026-01-01', endDate: '2026-12-31' };

test.describe('accounting dates within the fiscal year', () => {
  test('an FY2026 allocation dated outside FY2026 is rejected; the last day of the year passes', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 50_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    for (const accountingDate of ['2028-06-15', '2027-01-01', '2025-12-31']) {
      const p = await expectProblem(
        await allocate(
          request,
          root.id,
          child.id,
          { amountMinor: 1_000, currency: 'USD' },
          { accountingDate },
        ),
        422,
        'ACCOUNTING_DATE_OUTSIDE_FISCAL_YEAR',
      );
      expect(p.params).toEqual({ accountingDate, ...FY2026 });
    }
    expectMoney((await getBudget(request, root.id)).balances.budgetCurrency.allocatedOut, 0, 'USD');
    const last = await allocateOk(
      request,
      root.id,
      child.id,
      { amountMinor: 1_000, currency: 'USD' },
      { accountingDate: '2026-12-31' },
    );
    expect(last.journal).toMatchObject({ periodLabel: 'Dec 2026', late: false });
    // The first day of the year is in a locked period: it stays in FY2026 and lands late in Nov 2026.
    const first = await allocateOk(
      request,
      root.id,
      child.id,
      { amountMinor: 1_000, currency: 'USD' },
      { accountingDate: '2026-01-01' },
    );
    expect(first.journal).toMatchObject({ periodLabel: 'Nov 2026', late: true });
  });

  test('a root budget with an original amount dated outside its fiscal year is not created', async ({
    request,
  }) => {
    const name = `Scenario root outside FY ${randomUUID().slice(0, 8)}`;
    await expectProblem(
      await request.post('/api/budgets', {
        headers: await mutate('ceo'),
        data: {
          name,
          legalEntityId: SEED.legalEntities.acmeUs,
          currency: 'USD',
          fiscalYearId: SEED.fiscalYears.acmeFy2026,
          planVersionId: SEED.planVersions.acmeFy2026Original,
          originalAmount: { amountMinor: 10_000, currency: 'USD' },
          accountingDate: '2027-02-01',
        },
      }),
      422,
      'ACCOUNTING_DATE_OUTSIDE_FISCAL_YEAR',
    );
    const created = await asOwner((c) =>
      c.query(`select count(*)::int as n from budgets where name = $1`, [name]),
    );
    expect(created.rows[0].n).toBe(0);
  });

  test('manual journals and reversals post within the fiscal year of their budgets', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 50_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const alloc = await allocateOk(request, root.id, child.id, {
      amountMinor: 5_000,
      currency: 'USD',
    });
    const manual = (accountingDate: string) =>
      mutate('finance-admin').then((headers) =>
        request.post('/api/ledger/journals', {
          headers,
          data: {
            transactionCurrency: 'USD',
            accountingDate,
            reasonCode: 'ADJ-OPENING',
            reason: 'Opening actual',
            lines: [
              { budgetId: root.id, account: 'actual', side: 'debit', amountMinor: 100 },
              {
                budgetId: null,
                account: 'obligations',
                side: 'credit',
                amountMinor: 100,
                legalEntityId: SEED.legalEntities.acmeUs,
              },
            ],
          },
        }),
      );
    await expectProblem(await manual('2027-03-01'), 422, 'ACCOUNTING_DATE_OUTSIDE_FISCAL_YEAR');
    await expectContract(await manual('2026-12-01'), 201, Journal);

    const reverse = (accountingDate: string) =>
      mutate('finance-admin').then((headers) =>
        request.post(`/api/ledger/journals/${alloc.journal.id}/reversals`, {
          headers,
          data: { reasonCode: 'REV-ERROR', reason: 'Wrong child', accountingDate },
        }),
      );
    await expectProblem(await reverse('2027-01-15'), 422, 'ACCOUNTING_DATE_OUTSIDE_FISCAL_YEAR');
    const original = await expectContract(
      await request.get(`/api/ledger/journals/${alloc.journal.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      Journal,
    );
    expect(original.reversedByJournalId).toBeNull();
    const reversal = await expectContract(await reverse('2026-12-15'), 201, Journal);
    expect(reversal.periodLabel).toBe('Dec 2026');
  });
});
