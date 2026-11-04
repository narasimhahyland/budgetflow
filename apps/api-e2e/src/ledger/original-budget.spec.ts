import { expect, test } from '@playwright/test';
import { Journal, LedgerLineList } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { createRoot, expectMoney } from '../support/factory';

test.describe('original budget posts a balanced journal against the approved plan version', () => {
  test('the CEO creates a root budget: authorized and available equal the original amount', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000_000 });
    expect(root.status).toBe('active');
    expect(root.planVersionId).toBe(SEED.planVersions.acmeFy2026Original);
    expectMoney(root.balances.budgetCurrency.authorized, 10_000_000, 'USD');
    expectMoney(root.balances.available, 10_000_000, 'USD');
    expectMoney(root.balances.availableReporting, 10_000_000, 'USD');

    const lines = await expectContract(
      await request.get(`/api/budgets/${root.id}/ledger`, { headers: await as('finance-admin') }),
      200,
      LedgerLineList,
    );
    expect(lines.items).toHaveLength(1);
    expect(lines.items[0]).toMatchObject({
      account: 'authorized',
      transaction: { amountMinor: -10_000_000, currency: 'USD' },
      planVersionId: SEED.planVersions.acmeFy2026Original,
    });

    const journal = await expectContract(
      await request.get(`/api/ledger/journals/${lines.items[0].journalId}`, {
        headers: await as('finance-admin'),
      }),
      200,
      Journal,
    );
    expect(journal.type).toBe('original_budget');
    expect(journal.balanced).toBe(true);
    expect(journal.totals).toEqual({
      debitTransactionMinor: 10_000_000,
      creditTransactionMinor: 10_000_000,
      debitReportingMinor: 10_000_000,
      creditReportingMinor: 10_000_000,
    });
    expect(journal.lines.map((l) => [l.account, l.transaction.amountMinor])).toEqual([
      ['plan_funding', 10_000_000],
      ['authorized', -10_000_000],
    ]);
  });

  test('a root budget needs an approved plan version of the same fiscal year', async ({
    request,
  }) => {
    const base = {
      name: 'No plan',
      legalEntityId: SEED.legalEntities.acmeUs,
      currency: 'USD',
      fiscalYearId: SEED.fiscalYears.acmeFy2026,
      originalAmount: { amountMinor: 100, currency: 'USD' },
    };
    await expectProblem(
      await request.post('/api/budgets', { headers: await mutate('ceo'), data: base }),
      422,
      'ROOT_REQUIRES_PLAN_VERSION',
    );
    await expectProblem(
      await request.post('/api/budgets', {
        headers: await mutate('ceo'),
        data: { ...base, planVersionId: SEED.planVersions.acmeFy2027Draft },
      }),
      422,
      'ROOT_REQUIRES_PLAN_VERSION',
    );
  });

  test('invalid money is rejected at the boundary with field paths', async ({ request }) => {
    const data = {
      name: 'Bad money',
      legalEntityId: SEED.legalEntities.acmeUs,
      currency: 'USD',
      fiscalYearId: SEED.fiscalYears.acmeFy2026,
      planVersionId: SEED.planVersions.acmeFy2026Original,
    };
    const fractional = await expectProblem(
      await request.post('/api/budgets', {
        headers: await mutate('ceo'),
        data: { ...data, originalAmount: { amountMinor: 10.5, currency: 'USD' } },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(fractional.errors?.map((e) => e.path)).toContain('originalAmount.amountMinor');
    const lower = await expectProblem(
      await request.post('/api/budgets', {
        headers: await mutate('ceo'),
        data: { ...data, originalAmount: { amountMinor: 100, currency: 'usd' } },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(lower.errors?.map((e) => e.path)).toContain('originalAmount.currency');
    await expectProblem(
      await request.post('/api/budgets', {
        headers: await mutate('ceo'),
        data: { ...data, originalAmount: { amountMinor: 100, currency: 'USD' }, extra: true },
      }),
      400,
      'VALIDATION_FAILED',
    );
    await expectProblem(
      await request.post('/api/budgets', {
        headers: await mutate('ceo'),
        data: { ...data, currency: 'XXX', originalAmount: { amountMinor: 100, currency: 'XXX' } },
      }),
      422,
      'RATE_MISSING',
    );
  });

  test('only roles allowed to create root budgets can do so', async ({ request }) => {
    const data = {
      name: 'Forbidden root',
      legalEntityId: SEED.legalEntities.acmeUs,
      currency: 'USD',
      fiscalYearId: SEED.fiscalYears.acmeFy2026,
      planVersionId: SEED.planVersions.acmeFy2026Original,
      originalAmount: { amountMinor: 100, currency: 'USD' },
    };
    for (const role of ['regional-manager', 'finance-controller', 'auditor', 'employee'] as const) {
      await expectProblem(
        await request.post('/api/budgets', { headers: await mutate(role), data }),
        403,
        'FORBIDDEN',
      );
    }
  });

  test('mutations require an Idempotency-Key header', async ({ request }) => {
    await expectProblem(
      await request.post('/api/budgets', { headers: await as('ceo'), data: {} }),
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  });
});
