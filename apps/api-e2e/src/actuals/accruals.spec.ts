// Invariant 16 (P6): accruals are proposed from commitments past their service end, approved and posted to
// the accrued bucket (never consuming budget), exported for the ERP, and auto-reversed - when the actual
// arrives or when their reversal period starts - so the cost is consumed exactly once.
import { expect, test } from '@playwright/test';
import { Accrual, AccrualList, AccrualRunResponse, FileExport } from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  buckets,
  commitmentState,
  createCommitment,
  csv,
  importAndPost,
  spendBudget,
  uniq,
} from './support';

test.describe('accruals', () => {
  test('a proposal is approved, exported, and auto-reversed when the actual arrives (consumed once)', async ({
    request,
  }) => {
    const budget = await spendBudget(request);
    const c = await createCommitment(request, {
      budgetId: budget.id,
      amountMinor: 80_000,
      serviceStart: '2026-10-20',
      serviceEnd: '2026-10-22',
      // Starts with a formula: the export must carry it as text (CSV formula injection, Phase 18).
      description: '=HYPERLINK("https://example.test","Workshop facilitation")',
    });
    await createCommitment(request, {
      budgetId: budget.id,
      amountMinor: 10_000,
      serviceStart: '2026-12-01',
      serviceEnd: '2026-12-02',
      description: 'Future service, not due',
    });

    const run = await expectContract(
      await request.post('/api/actuals/accruals/proposals', {
        headers: await mutate('finance-controller'),
        data: { asOfDate: '2026-11-05', budgetId: budget.id },
      }),
      201,
      AccrualRunResponse,
    );
    expect(run.count).toBe(1);
    const proposal = run.items[0];
    expect(proposal).toMatchObject({
      commitmentId: c.id,
      status: 'proposed',
      amount: { amountMinor: 80_000, currency: 'USD' },
      period: { label: 'Nov 2026' },
      autoReversePeriod: { label: 'Dec 2026' },
    });
    // Proposing again creates nothing new.
    const again = await expectContract(
      await request.post('/api/actuals/accruals/proposals', {
        headers: await mutate('finance-controller'),
        data: { asOfDate: '2026-11-05', budgetId: budget.id },
      }),
      201,
      AccrualRunResponse,
    );
    expect(again.count).toBe(0);

    const availableBefore = (await buckets(request, budget.id)).balances.available.amountMinor;
    const posted = await expectContract(
      await request.post(`/api/actuals/accruals/${proposal.id}/approval`, {
        headers: await mutate('finance-controller'),
      }),
      200,
      Accrual,
    );
    expect(posted).toMatchObject({ status: 'posted' });
    expect(posted.journalId).not.toBeNull();
    const withAccrual = await buckets(request, budget.id);
    expect(withAccrual.balances.budgetCurrency.accrued.amountMinor).toBe(80_000);
    expect(withAccrual.balances.available.amountMinor).toBe(availableBefore);
    await expectProblem(
      await request.post(`/api/actuals/accruals/${proposal.id}/approval`, {
        headers: await mutate('finance-controller'),
      }),
      409,
      'INVALID_TRANSITION',
    );

    const file = await expectContract(
      await request.post('/api/actuals/accruals/exports', {
        headers: await mutate('finance-controller'),
      }),
      200,
      FileExport,
    );
    expect(file.content.split('\n')[0]).toContain('debit_account,credit_account');
    expect(file.content).toContain(`CMT-${c.id.slice(-8).toUpperCase()}`);
    expect(file.content).toContain('800.00,USD');
    // The description is neutralised: an apostrophe makes the spreadsheet show it as text.
    expect(file.content).toContain(
      `"'=HYPERLINK(""https://example.test"",""Workshop facilitation"")"`,
    );
    expect(file.content).not.toMatch(/(^|,)=HYPERLINK/m);
    const exported = await expectContract(
      await request.get('/api/actuals/accruals?status=posted', {
        headers: await as('finance-controller'),
      }),
      200,
      AccrualList,
    );
    expect(exported.items.find((a) => a.id === proposal.id)?.exportedAt).not.toBeNull();

    const p = `A${uniq()}`;
    await importAndPost(
      request,
      csv([
        `${p}-1,2026-11-04,800.00,USD,HYL-IN,,6130,,,Workshop invoice,CMT-${c.id.slice(-8).toUpperCase()},,charge`,
      ]),
    );
    const after = await buckets(request, budget.id);
    expect(after.balances.budgetCurrency).toMatchObject({
      accrued: { amountMinor: 0 },
      actual: { amountMinor: 80_000 },
    });
    expect(after.balances.budgetCurrency.encumbered.amountMinor).toBe(10_000);
    expect(after.balances.available.amountMinor).toBe(availableBefore);
    const list = await expectContract(
      await request.get('/api/actuals/accruals?status=reversed', {
        headers: await as('finance-controller'),
      }),
      200,
      AccrualList,
    );
    expect(list.items.find((a) => a.id === proposal.id)).toMatchObject({
      status: 'reversed',
      reversalTrigger: 'actual',
    });
    expect(await commitmentState(request, budget.id, c.id)).toMatchObject({
      status: 'consumed',
      accrued: { amountMinor: 0 },
    });
  });

  test('an unreversed accrual reverses automatically when its reversal period starts; rejected proposals post nothing', async ({
    request,
  }) => {
    const budget = await spendBudget(request);
    const c = await createCommitment(request, {
      budgetId: budget.id,
      amountMinor: 25_000,
      serviceStart: '2026-10-01',
      serviceEnd: '2026-10-02',
      description: 'Speaker fee',
    });
    const other = await createCommitment(request, {
      budgetId: budget.id,
      amountMinor: 5_000,
      serviceStart: '2026-10-01',
      serviceEnd: '2026-10-02',
      description: 'Gifts (in dispute)',
    });
    const run = await expectContract(
      await request.post('/api/actuals/accruals/proposals', {
        headers: await mutate('finance-controller'),
        data: { asOfDate: '2026-11-05', budgetId: budget.id },
      }),
      201,
      AccrualRunResponse,
    );
    const speaker = run.items.find((a) => a.commitmentId === c.id)!;
    const gifts = run.items.find((a) => a.commitmentId === other.id)!;
    await expectContract(
      await request.post(`/api/actuals/accruals/${speaker.id}/approval`, {
        headers: await mutate('finance-controller'),
      }),
      200,
      Accrual,
    );
    await expectProblem(
      await request.post(`/api/actuals/accruals/${gifts.id}/rejection`, {
        headers: await mutate('finance-controller'),
        data: { reason: '' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    const rejected = await expectContract(
      await request.post(`/api/actuals/accruals/${gifts.id}/rejection`, {
        headers: await mutate('finance-controller'),
        data: { reason: 'Supplier dispute, no liability yet' },
      }),
      200,
      Accrual,
    );
    expect(rejected).toMatchObject({ status: 'rejected', journalId: null });
    expect((await buckets(request, budget.id)).balances.budgetCurrency.accrued.amountMinor).toBe(
      25_000,
    );

    const notYet = await expectContract(
      await request.post('/api/actuals/accruals/auto-reversals', {
        headers: await mutate('finance-controller'),
        data: { asOfDate: '2026-11-30', budgetId: budget.id },
      }),
      200,
      AccrualRunResponse,
    );
    expect(notYet.count).toBe(0);
    const due = await expectContract(
      await request.post('/api/actuals/accruals/auto-reversals', {
        headers: await mutate('finance-controller'),
        data: { asOfDate: '2026-12-01', budgetId: budget.id },
      }),
      200,
      AccrualRunResponse,
    );
    expect(due.items).toEqual([
      expect.objectContaining({ id: speaker.id, status: 'reversed', reversalTrigger: 'period' }),
    ]);
    expect((await buckets(request, budget.id)).balances.budgetCurrency.accrued.amountMinor).toBe(0);
  });
});
