// Phase 10 invariant: every reported figure reconciles to the ledger. A report's money columns are
// summed from ledger buckets with child allocations counted once, Available follows the company-wide
// definition (Authorized − Held − Pre-encumbered − Encumbered − Actual), and the same numbers come
// back from the budget read model and the journals behind them. A difference is a bug, not rounding.
import { expect, test } from '@playwright/test';
import { Journal, ReportDrilldown, ReportResult, type ReportRow } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { allocateOk, createChild, createRoot, getBudget } from '../support/factory';

const US = SEED.legalEntities.acmeUs;

const cell = (row: ReportRow | null, key: string) => row?.cells[key]?.money?.amountMinor ?? 0;

async function openingBalances(
  request: Parameters<typeof createRoot>[0],
  budgetId: string,
  lines: [string, number][],
) {
  return expectContract(
    await request.post('/api/ledger/journals', {
      headers: await mutate('finance-admin'),
      data: {
        transactionCurrency: 'USD',
        reasonCode: 'ADJ-OPENING',
        reason: 'Opening balances for the reporting scenario',
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
    }),
    201,
    Journal,
  );
}

test.describe('reported figures reconcile to the ledger', () => {
  test('utilization totals equal the ledger buckets, with child allocations counted once', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 1_000_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, child.id, { amountMinor: 400_000, currency: 'USD' });
    await openingBalances(request, child.id, [
      ['held', 10_000],
      ['pre_encumbered', 30_000],
      ['encumbered', 120_000],
      ['actual', 60_000],
    ]);
    await openingBalances(request, root.id, [['actual', 25_000]]);

    const report = await expectContract(
      await request.get(`/api/reports/utilization/run?rootBudgetId=${root.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      ReportResult,
    );

    // The report says it was built from ledger balances, and says so truthfully.
    expect(report.reconciliation.source).toBe('ledger_balances');
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.reconciliation.ties).toBe(true);
    expect(report.reconciliation.budgetsCounted).toBe(2);

    // Authorized is netted against allocated out, so the parent and the child never count the
    // same 400,000 twice.
    expect(report.reconciliation.authorized.amountMinor).toBe(1_000_000);
    expect(report.reconciliation.held.amountMinor).toBe(10_000);
    expect(report.reconciliation.preEncumbered.amountMinor).toBe(30_000);
    expect(report.reconciliation.encumbered.amountMinor).toBe(120_000);
    expect(report.reconciliation.actual.amountMinor).toBe(85_000);
    // 1,000,000 − 10,000 − 30,000 − 120,000 − 85,000
    expect(report.reconciliation.available.amountMinor).toBe(755_000);
    expect(report.currency).toBe('USD');

    // The totals row of the table carries exactly those figures.
    expect(cell(report.totals, 'authorized')).toBe(1_000_000);
    expect(cell(report.totals, 'available')).toBe(755_000);
    expect(cell(report.totals, 'actual')).toBe(85_000);

    // And the same numbers come back from the budget read model the rest of the product uses.
    const rootDetail = await getBudget(request, root.id);
    expect(rootDetail.available.companyWide.amountMinor).toBe(755_000);
    const childRow = report.rows.find((r) => r.budgetId === child.id)!;
    const childDetail = await getBudget(request, child.id);
    expect(cell(childRow, 'authorized')).toBe(
      childDetail.balances.reporting.authorized.amountMinor,
    );
    expect(cell(childRow, 'actual')).toBe(childDetail.balances.reporting.actual.amountMinor);
  });

  test('every report over the same scope reports the same ledger totals', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 500_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, child.id, { amountMinor: 200_000, currency: 'USD' });
    await openingBalances(request, child.id, [
      ['encumbered', 50_000],
      ['actual', 30_000],
    ]);

    for (const reportId of [
      'utilization',
      'budget-vs-actual',
      'allocation',
      'unused-expired',
      'location-comparison',
      'department-comparison',
      'spend-per-head',
      'event-spending',
      'participation-reach',
    ]) {
      const report = await expectContract(
        await request.get(`/api/reports/${reportId}/run?rootBudgetId=${root.id}`, {
          headers: await as('finance-admin'),
        }),
        200,
        ReportResult,
      );
      expect(
        report.reconciliation.ties,
        `${reportId}: ${JSON.stringify(report.reconciliation.differences)}`,
      ).toBe(true);
      expect(report.reconciliation.authorized.amountMinor, reportId).toBe(500_000);
      expect(report.reconciliation.encumbered.amountMinor, reportId).toBe(50_000);
      expect(report.reconciliation.actual.amountMinor, reportId).toBe(30_000);
      expect(report.reconciliation.available.amountMinor, reportId).toBe(420_000);
    }
  });

  test('the allocation report ties each parent to its children and shows the unallocated room', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 300_000 });
    const a = await createChild(request, root.id, { currency: 'USD' });
    const b = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, a.id, { amountMinor: 100_000, currency: 'USD' });
    await allocateOk(request, root.id, b.id, { amountMinor: 50_000, currency: 'USD' });

    const report = await expectContract(
      await request.get(`/api/reports/allocation/run?rootBudgetId=${root.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      ReportResult,
    );
    const rootRow = report.rows.find((r) => r.budgetId === root.id)!;
    expect(cell(rootRow, 'authorized')).toBe(300_000);
    expect(cell(rootRow, 'allocatedOut')).toBe(150_000);
    expect(cell(rootRow, 'unallocated')).toBe(150_000);
    expect(rootRow.cells['check'].text).toBe('Ties');
    // Unallocated across the tree is the net authorized: money allocated down is counted once.
    expect(cell(report.totals, 'unallocated')).toBe(300_000);
    expect(report.reconciliation.ties).toBe(true);
  });

  test('a drill-down returns the ledger lines the figure was built from', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 200_000 });
    const journal = await openingBalances(request, root.id, [['actual', 40_000]]);

    const drill = await expectContract(
      await request.get(`/api/reports/utilization/drilldown?budgetId=${root.id}&bucket=actual`, {
        headers: await as('finance-controller'),
      }),
      200,
      ReportDrilldown,
    );
    expect(drill.total.amountMinor).toBe(40_000);
    expect(drill.lineCount).toBe(1);
    expect(drill.lines[0].journalId).toBe(journal.id);
    expect(drill.lines[0].account).toBe('actual');
    // The currency triplet travels with the line, so a figure can always be traced to its rate.
    expect(drill.lines[0].reporting.currency).toBe('USD');
    expect(drill.lines[0].reportingRate.type).toBeTruthy();

    const report = await expectContract(
      await request.get(`/api/reports/utilization/run?rootBudgetId=${root.id}`, {
        headers: await as('finance-controller'),
      }),
      200,
      ReportResult,
    );
    expect(cell(report.totals, 'actual')).toBe(drill.total.amountMinor);
  });

  test('FX never consumes budget: a non-USD child reports at its locked plan rate only', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 1_000_000 });
    const child = await createChild(request, root.id, {
      currency: 'INR',
      legalEntityId: SEED.legalEntities.acmeIndia,
    });
    await allocateOk(request, root.id, child.id, { amountMinor: 300_000, currency: 'USD' });

    const report = await expectContract(
      await request.get(`/api/reports/utilization/run?rootBudgetId=${root.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      ReportResult,
    );
    // Reporting currency throughout; the parent's authorized is unchanged by the conversion.
    expect(report.currency).toBe('USD');
    expect(report.reconciliation.authorized.amountMinor).toBe(1_000_000);
    expect(report.reconciliation.ties).toBe(true);
    const childDetail = await getBudget(request, child.id);
    expect(childDetail.balances.budgetCurrency.authorized.currency).toBe('INR');
    const childRow = report.rows.find((r) => r.budgetId === child.id)!;
    expect(cell(childRow, 'authorized')).toBe(
      childDetail.balances.reporting.authorized.amountMinor,
    );
  });
});
