// Phase 10 budget health (screen 013): five written checks with fixed thresholds, each explainable
// in one sentence, evaluated from ledger balances and budget controls. Health is a view: it never
// changes a balance or blocks a command.
import { expect, test } from '@playwright/test';
import { BudgetHealthOverview, ControlResult, Journal } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { createRoot, getBudget } from '../support/factory';

const US = SEED.legalEntities.acmeUs;

async function post(
  request: Parameters<typeof createRoot>[0],
  budgetId: string,
  account: string,
  amountMinor: number,
) {
  return expectContract(
    await request.post('/api/ledger/journals', {
      headers: await mutate('finance-admin'),
      data: {
        transactionCurrency: 'USD',
        reasonCode: 'ADJ-OPENING',
        reason: 'Opening balances for the health scenario',
        lines: [
          { budgetId, account, side: 'debit', amountMinor },
          {
            budgetId: null,
            account: account === 'held' ? 'earmark_reserve' : 'obligations',
            side: 'credit',
            amountMinor,
            legalEntityId: US,
          },
        ],
      },
    }),
    201,
    Journal,
  );
}

const rowFor = (overview: BudgetHealthOverview, budgetId: string) =>
  overview.rows.find((r) => r.budgetId === budgetId);

test.describe('budget health checks', () => {
  test('a budget spending far ahead of its year is At risk, and says why', async ({ request }) => {
    const root = await createRoot(request, {
      amountMinor: 100_000,
      name: `Health pace ${randomUUID().slice(0, 6)}`,
    });
    await post(request, root.id, 'actual', 98_000);

    const overview = await expectContract(
      await request.get(`/api/dashboards/health?rootBudgetId=${root.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      BudgetHealthOverview,
    );
    const row = rowFor(overview, root.id)!;
    expect(row.level).not.toBe('healthy');
    expect(row.reasons.length).toBeGreaterThan(0);
    for (const reason of row.reasons) expect(reason.text.length).toBeGreaterThan(0);
    expect(row.reasons.map((r) => r.check)).toContain('forecast');
    expect(row.actual.amountMinor).toBe(98_000);
    expect(row.available.amountMinor).toBe(2_000);
    expect(overview.thresholds.paceWatchBps).toBe(11_000);
  });

  test('a frozen budget is on Watch for controls and keeps its own status', async ({ request }) => {
    const root = await createRoot(request, {
      amountMinor: 50_000,
      name: `Health freeze ${randomUUID().slice(0, 6)}`,
    });
    await expectContract(
      await request.post(`/api/budgets/${root.id}/freeze`, {
        headers: await mutate('finance-admin'),
        data: { reasonCode: 'FRZ-POLICY', reason: 'Paused while the program is reviewed' },
      }),
      200,
      ControlResult,
    );
    const overview = await expectContract(
      await request.get(`/api/dashboards/health?rootBudgetId=${root.id}`, {
        headers: await as('finance-controller'),
      }),
      200,
      BudgetHealthOverview,
    );
    const row = rowFor(overview, root.id)!;
    expect(row.status).toBe('frozen');
    expect(row.reasons.some((r) => r.check === 'controls' && r.text === 'Frozen')).toBe(true);

    // Health changed nothing: the budget still reports the same balances.
    const after = await getBudget(request, root.id);
    expect(after.balances.budgetCurrency.authorized.amountMinor).toBe(50_000);
    expect(after.status).toBe('frozen');
  });

  test('an untouched budget late in the year is on Watch for money that would lapse', async ({
    request,
  }) => {
    const root = await createRoot(request, {
      amountMinor: 1_000_000,
      name: `Health quiet ${randomUUID().slice(0, 6)}`,
    });
    const overview = await expectContract(
      await request.get(`/api/dashboards/health?rootBudgetId=${root.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      BudgetHealthOverview,
    );
    expect(overview.summary.budgets).toBe(1);
    expect(overview.summary.watch).toBe(1);
    expect(overview.summary.atRisk).toBe(0);
    const row = rowFor(overview, root.id)!;
    expect(row.reasons.map((r) => r.check)).toEqual(['unused']);
    expect(row.reasons[0].text).toContain('would lapse');
    // The matrix counts the same budget under the same check.
    expect(overview.matrix).toHaveLength(1);
    expect(overview.matrix[0].cells['unused']).toEqual({ watch: 1, atRisk: 0 });
    expect(overview.matrix[0].cells['pace']).toEqual({ watch: 0, atRisk: 0 });
    // Nothing is committed or spent, so the whole amount is still available.
    expect(overview.reconciliation.authorized.amountMinor).toBe(1_000_000);
    expect(overview.reconciliation.available.amountMinor).toBe(1_000_000);
  });

  test('filtering by level returns only budgets at that level', async ({ request }) => {
    const root = await createRoot(request, {
      amountMinor: 100_000,
      name: `Health filter ${randomUUID().slice(0, 6)}`,
    });
    await post(request, root.id, 'actual', 99_000);
    const atRisk = await expectContract(
      await request.get(`/api/dashboards/health?rootBudgetId=${root.id}&level=healthy`, {
        headers: await as('finance-admin'),
      }),
      200,
      BudgetHealthOverview,
    );
    expect(atRisk.rows).toHaveLength(0);
    const all = await expectContract(
      await request.get(`/api/dashboards/health?rootBudgetId=${root.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      BudgetHealthOverview,
    );
    expect(all.rows).toHaveLength(1);
  });
});
