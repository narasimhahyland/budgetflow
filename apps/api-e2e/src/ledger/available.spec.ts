// Invariant 1: available = authorized − allocated out − held − pre-encumbered − encumbered − actual,
// counting only the buckets the control basis selects; accrued never consumes budget. No bucket is ever
// negative, and manual journals only exchange amounts between budgets and counter accounts.
import { expect, test } from '@playwright/test';
import { Journal } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  allocate,
  allocateOk,
  createChild,
  createRoot,
  expectMoney,
  getBudget,
} from '../support/factory';

const US = SEED.legalEntities.acmeUs;

async function openingBalances(
  request: Parameters<typeof createRoot>[0],
  budgetId: string,
  lines: [string, number][],
) {
  const res = await request.post('/api/ledger/journals', {
    headers: await mutate('finance-admin'),
    data: {
      transactionCurrency: 'USD',
      reasonCode: 'ADJ-OPENING',
      reason: 'Opening balances at go-live',
      lines: lines.flatMap(([account, amountMinor]) => [
        { budgetId, account, side: 'debit', amountMinor },
        {
          budgetId: null,
          account: account === 'held' ? 'earmark_reserve' : 'obligations',
          side: 'credit',
          amountMinor,
          legalEntityId: US,
        },
      ]),
    },
  });
  return res;
}

test.describe('available amount per control basis', () => {
  test('every consuming bucket reduces available; accrued does not', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 1_000_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, child.id, { amountMinor: 150_000, currency: 'USD' });
    const journal = await expectContract(
      await openingBalances(request, root.id, [
        ['held', 25_000],
        ['pre_encumbered', 100_000],
        ['encumbered', 200_000],
        ['actual', 50_000],
        ['accrued', 30_000],
      ]),
      201,
      Journal,
    );
    expect(journal.balanced).toBe(true);
    const b = await getBudget(request, root.id);
    expectMoney(b.balances.budgetCurrency.allocatedOut, 150_000, 'USD');
    expectMoney(b.balances.budgetCurrency.held, 25_000, 'USD');
    expectMoney(b.balances.budgetCurrency.preEncumbered, 100_000, 'USD');
    expectMoney(b.balances.budgetCurrency.encumbered, 200_000, 'USD');
    expectMoney(b.balances.budgetCurrency.actual, 50_000, 'USD');
    expectMoney(b.balances.budgetCurrency.accrued, 30_000, 'USD');
    // 1,000,000 − 150,000 − 25,000 − 100,000 − 200,000 − 50,000 = 475,000 (accrued 30,000 not counted)
    expectMoney(b.balances.available, 475_000, 'USD');
    expectMoney(b.balances.allocationAvailable, 475_000, 'USD');
  });

  test('a control basis that excludes held and pre-encumbered leaves them out of available', async ({
    request,
  }) => {
    const root = await createRoot(request, {
      amountMinor: 1_000_000,
      control: { basis: ['allocated_out', 'encumbered', 'actual'], mode: 'hard', toleranceBps: 0 },
    });
    await expectContract(
      await openingBalances(request, root.id, [
        ['held', 25_000],
        ['pre_encumbered', 100_000],
        ['encumbered', 200_000],
        ['actual', 50_000],
      ]),
      201,
      Journal,
    );
    const b = await getBudget(request, root.id);
    expect(b.control.basis).toEqual(['allocated_out', 'encumbered', 'actual']);
    expectMoney(b.balances.available, 750_000, 'USD');
  });

  test('hard mode rejects a posting that would make available negative; track mode records it', async ({
    request,
  }) => {
    const hard = await createRoot(request, { amountMinor: 100_000 });
    await expectContract(
      await openingBalances(request, hard.id, [['encumbered', 100_000]]),
      201,
      Journal,
    );
    const over = await expectProblem(
      await openingBalances(request, hard.id, [['actual', 1]]),
      409,
      'INSUFFICIENT_AVAILABLE',
    );
    expect(over.params?.availableMinor).toBe(-1);
    expectMoney((await getBudget(request, hard.id)).balances.available, 0, 'USD');

    const track = await createRoot(request, {
      amountMinor: 100_000,
      control: {
        basis: ['allocated_out', 'held', 'pre_encumbered', 'encumbered', 'actual'],
        mode: 'track',
        toleranceBps: 0,
      },
    });
    await expectContract(
      await openingBalances(request, track.id, [['actual', 100_001]]),
      201,
      Journal,
    );
    expectMoney((await getBudget(request, track.id)).balances.available, -1, 'USD');
  });

  test('manual journals cannot touch hierarchy buckets and must balance', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const hierarchy = await request.post('/api/ledger/journals', {
      headers: await mutate('finance-admin'),
      data: {
        transactionCurrency: 'USD',
        reasonCode: 'ADJ-CORRECTION',
        reason: 'Attempt to raise authorized by hand',
        lines: [
          { budgetId: root.id, account: 'authorized', side: 'credit', amountMinor: 500 },
          {
            budgetId: null,
            account: 'obligations',
            side: 'debit',
            amountMinor: 500,
            legalEntityId: US,
          },
        ],
      },
    });
    await expectProblem(hierarchy, 422, 'MANUAL_JOURNAL_BUCKET_NOT_ALLOWED');
    const unbalanced = await request.post('/api/ledger/journals', {
      headers: await mutate('finance-admin'),
      data: {
        transactionCurrency: 'USD',
        reasonCode: 'ADJ-CORRECTION',
        reason: 'Unbalanced on purpose',
        lines: [
          { budgetId: root.id, account: 'actual', side: 'debit', amountMinor: 500 },
          {
            budgetId: null,
            account: 'obligations',
            side: 'credit',
            amountMinor: 499,
            legalEntityId: US,
          },
        ],
      },
    });
    const p = await expectProblem(unbalanced, 422, 'JOURNAL_UNBALANCED');
    expect(p.params).toMatchObject({ debitTransactionMinor: 500, creditTransactionMinor: 499 });
    expectMoney((await getBudget(request, root.id)).balances.budgetCurrency.actual, 0, 'USD');
  });

  test('a manual journal cannot drive a bucket below zero, so it never creates allocation headroom', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const actual = async (side: 'debit' | 'credit', amountMinor: number) =>
      request.post('/api/ledger/journals', {
        headers: await mutate('finance-admin'),
        data: {
          transactionCurrency: 'USD',
          reasonCode: 'ADJ-CORRECTION',
          reason: side === 'debit' ? 'Opening actuals' : 'Relieve actuals',
          lines: [
            { budgetId: root.id, account: 'actual', side, amountMinor },
            {
              budgetId: null,
              account: 'obligations',
              side: side === 'debit' ? 'credit' : 'debit',
              amountMinor,
              legalEntityId: US,
            },
          ],
        },
      });
    // Crediting actual with nothing posted would leave actual at -500.00 and available at 1,500.00.
    const negative = await expectProblem(
      await actual('credit', 50_000),
      409,
      'NEGATIVE_BUCKET_BALANCE',
    );
    expect(negative.params).toMatchObject({
      budgetId: root.id,
      bucket: 'actual',
      balanceMinor: -50_000,
    });
    await expectProblem(
      await allocate(request, root.id, child.id, { amountMinor: 150_000, currency: 'USD' }),
      409,
      'OVER_ALLOCATION',
    );
    // Boundary: relieving exactly what was posted passes; one minor unit more is refused.
    await expectContract(await actual('debit', 20_000), 201, Journal);
    await expectProblem(await actual('credit', 20_001), 409, 'NEGATIVE_BUCKET_BALANCE');
    await expectContract(await actual('credit', 20_000), 201, Journal);
    const b = await getBudget(request, root.id);
    expectMoney(b.balances.budgetCurrency.actual, 0, 'USD');
    expectMoney(b.balances.available, 100_000, 'USD');
    expectMoney(b.balances.budgetCurrency.allocatedOut, 0, 'USD');
    expectMoney((await getBudget(request, child.id)).balances.budgetCurrency.authorized, 0, 'USD');
  });

  test('a manual journal cannot move amounts between budgets, directly or through a counter account', async ({
    request,
  }) => {
    const a = await createRoot(request, { amountMinor: 10_000 });
    const b = await createRoot(request, { amountMinor: 10_000 });
    const post = async (lines: unknown[]) =>
      request.post('/api/ledger/journals', {
        headers: await mutate('finance-admin'),
        data: {
          transactionCurrency: 'USD',
          reasonCode: 'ADJ-CORRECTION',
          reason: 'Move held between budgets',
          lines,
        },
      });
    const counter = (side: 'debit' | 'credit') => ({
      budgetId: null,
      account: 'earmark_reserve',
      side,
      amountMinor: 5_000,
      legalEntityId: US,
    });
    await expectProblem(
      await post([
        { budgetId: a.id, account: 'held', side: 'debit', amountMinor: 5_000 },
        { budgetId: b.id, account: 'held', side: 'credit', amountMinor: 5_000 },
      ]),
      422,
      'MANUAL_JOURNAL_NEEDS_COUNTER_ACCOUNT',
    );
    await expectProblem(
      await post([
        { budgetId: a.id, account: 'held', side: 'debit', amountMinor: 5_000 },
        counter('credit'),
        counter('debit'),
        { budgetId: b.id, account: 'held', side: 'credit', amountMinor: 5_000 },
      ]),
      422,
      'MANUAL_JOURNAL_NEEDS_COUNTER_ACCOUNT',
    );
    // Moving between buckets of one budget is refused too (that is the commitment lifecycle's job).
    await expectProblem(
      await post([
        { budgetId: a.id, account: 'actual', side: 'debit', amountMinor: 5_000 },
        { budgetId: a.id, account: 'held', side: 'credit', amountMinor: 5_000 },
      ]),
      422,
      'MANUAL_JOURNAL_NEEDS_COUNTER_ACCOUNT',
    );
    for (const id of [a.id, b.id]) {
      const after = await getBudget(request, id);
      expectMoney(after.balances.budgetCurrency.held, 0, 'USD');
      expectMoney(after.balances.available, 10_000, 'USD');
    }
  });

  test('only finance admins post manual journals', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    for (const role of ['finance-controller', 'ceo', 'auditor'] as const) {
      const res = await request.post('/api/ledger/journals', {
        headers: await mutate(role),
        data: {
          transactionCurrency: 'USD',
          reasonCode: 'ADJ-OPENING',
          reason: 'Not allowed for this role',
          lines: [
            { budgetId: root.id, account: 'actual', side: 'debit', amountMinor: 1 },
            {
              budgetId: null,
              account: 'obligations',
              side: 'credit',
              amountMinor: 1,
              legalEntityId: US,
            },
          ],
        },
      });
      await expectProblem(res, 403, 'FORBIDDEN');
    }
  });
});
