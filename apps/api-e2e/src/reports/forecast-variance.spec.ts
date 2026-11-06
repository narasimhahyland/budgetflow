// Screen 087: the forecast and variance report. The invariants it has to hold are that the
// Authorized, Actual YTD and Committed columns reconcile to the ledger, that the Forecast column
// never does because a forecast posts nothing, that a budget without an accepted forecast falls
// back to the system run-rate and says so, and that tied rows come back in the same order twice.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ForecastCycleDetail,
  ForecastSubmission,
  Journal,
  ReportCatalog,
  ReportResult,
  type ReportRow,
} from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { allocateOk, createChild, createRoot, getBudget } from '../support/factory';

const US = SEED.legalEntities.acmeUs;
const cell = (row: ReportRow | null | undefined, key: string) =>
  row?.cells[key]?.money?.amountMinor ?? 0;

async function openingBalances(
  request: APIRequestContext,
  budgetId: string,
  lines: [string, number][],
) {
  return expectContract(
    await request.post('/api/ledger/journals', {
      headers: await mutate('finance-admin'),
      data: {
        transactionCurrency: 'USD',
        reasonCode: 'ADJ-OPENING',
        reason: 'Opening balances for the forecast report scenario',
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

/** A cycle with one accepted forecast per budget given, closed so 087 reads it as the latest. */
async function acceptedCycle(
  request: APIRequestContext,
  rootBudgetId: string,
  forecasts: { budgetId: string; amountMinor: number; commentary?: string }[],
  opts: { asOfDate?: string; close?: boolean } = {},
) {
  const cycle = await expectContract(
    await request.post('/api/close/forecast-cycles', {
      headers: await mutate('finance-admin'),
      data: {
        name: `Report reforecast ${randomUUID().slice(0, 8)}`,
        asOfDate: opts.asOfDate ?? '2026-09-30',
        dueDate: '2026-10-12',
        rootBudgetId,
        includeOpenEvents: false,
      },
    }),
    201,
    ForecastCycleDetail,
  );
  for (const f of forecasts) {
    const submitted = await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
        headers: await mutate('finance-admin'),
        data: {
          budgetId: f.budgetId,
          method: 'owner_input',
          amountMinor: f.amountMinor,
          ...(f.commentary ? { commentary: f.commentary } : {}),
        },
      }),
      201,
      ForecastSubmission,
    );
    await expectContract(
      await request.post(
        `/api/close/forecast-cycles/${cycle.cycle.id}/submissions/${submitted.id}/decision`,
        { headers: await mutate('finance-admin'), data: { decision: 'accept' } },
      ),
      201,
      ForecastSubmission,
    );
  }
  if (opts.close !== false)
    await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/close`, {
        headers: await mutate('finance-admin'),
        data: { confirmation: cycle.cycle.closeConfirmation },
      }),
      201,
      ForecastCycleDetail,
    );
  return cycle.cycle;
}

async function runReport(
  request: APIRequestContext,
  query: Record<string, string>,
  user: 'finance-admin' | 'finance-controller' | 'regional-manager' | 'auditor' = 'finance-admin',
) {
  const qs = new URLSearchParams(query).toString();
  return expectContract(
    await request.get(`/api/reports/forecast-variance/run?${qs}`, { headers: await as(user) }),
    200,
    ReportResult,
  );
}

test.describe('forecast and variance report', () => {
  test('the report is in the catalog, scoped to owners as well as finance', async ({ request }) => {
    const catalog = await expectContract(
      await request.get('/api/reports', { headers: await as('finance-admin') }),
      200,
      ReportCatalog,
    );
    const spec = catalog.reports.find((r) => r.reportId === 'forecast-variance');
    expect(spec, 'forecast-variance is in the report catalog').toBeDefined();
    expect(spec!.screen).toBe('087');
    expect(spec!.ownerScoped).toBe(true);
    expect(spec!.formats).toEqual(['csv', 'xlsx', 'pdf']);
  });

  test('accepted forecasts are reported against the ledger, and only the ledger columns reconcile', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 1_000_000, as: 'finance-admin' });
    const child = await createChild(request, root.id, { currency: 'USD', as: 'finance-admin' });
    await allocateOk(
      request,
      root.id,
      child.id,
      { amountMinor: 400_000, currency: 'USD' },
      { as: 'finance-admin' },
    );
    await openingBalances(request, child.id, [
      ['encumbered', 120_000],
      ['pre_encumbered', 30_000],
      ['actual', 60_000],
    ]);
    await openingBalances(request, root.id, [['actual', 25_000]]);
    const cycle = await acceptedCycle(request, root.id, [
      // 350,000 against the child's 400,000: 50,000 under, inside the threshold.
      { budgetId: child.id, amountMinor: 350_000 },
      // The root keeps 600,000 of its own room; 500,000 is 100,000 under, which needs commentary.
      {
        budgetId: root.id,
        amountMinor: 500_000,
        commentary: 'The second half of the programme was moved into the next fiscal year.',
      },
    ]);

    const report = await runReport(request, {
      rootBudgetId: root.id,
      forecastCycleId: cycle.id,
    });

    expect(report.reportId).toBe('forecast-variance');
    // Authorized, Actual and Committed are the ledger's, and they tie.
    expect(report.reconciliation.source).toBe('ledger_balances');
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.reconciliation.ties).toBe(true);
    expect(report.reconciliation.authorized.amountMinor).toBe(1_000_000);
    expect(report.reconciliation.actual.amountMinor).toBe(85_000);
    expect(report.reconciliation.encumbered.amountMinor).toBe(120_000);
    expect(report.reconciliation.preEncumbered.amountMinor).toBe(30_000);
    // Authorized − Held − Pre-encumbered − Encumbered − Actual
    expect(report.reconciliation.available.amountMinor).toBe(765_000);

    const childRow = report.rows.find((r) => r.budgetId === child.id)!;
    const rootRow = report.rows.find((r) => r.budgetId === root.id)!;
    expect(cell(childRow, 'authorized')).toBe(400_000);
    expect(cell(childRow, 'actual')).toBe(60_000);
    expect(cell(childRow, 'committed')).toBe(150_000);
    expect(cell(childRow, 'forecast')).toBe(350_000);
    expect(cell(childRow, 'variance')).toBe(50_000);
    expect(childRow.cells['variancePct'].bps).toBe(1_250);
    expect(childRow.cells['varianceDirection'].text).toBe('under');
    expect(childRow.cells['method'].text).toBe('Owner input');
    expect(childRow.cells['commentary'].text).toBeNull();

    expect(cell(rootRow, 'authorized')).toBe(600_000);
    expect(cell(rootRow, 'forecast')).toBe(500_000);
    expect(cell(rootRow, 'variance')).toBe(100_000);
    expect(rootRow.cells['commentary'].text).toContain('next fiscal year');

    // The forecast total is in the KPIs but never in the reconciliation: it has no ledger bucket.
    const forecastKpi = report.kpis.find((k) => k.key === 'forecast')!;
    expect(forecastKpi.money?.amountMinor).toBe(850_000);
    expect(report.reconciliation.differences.map((d) => d.key)).not.toContain('forecast');
    // Nothing the report shows moved any money.
    const childAfter = await getBudget(request, child.id);
    expect(childAfter.balances.reporting.actual.amountMinor).toBe(60_000);
    expect(childAfter.available.companyWide.amountMinor).toBe(190_000);
  });

  test('a budget with no accepted forecast falls back to the system run-rate and the report says so', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 900_000, as: 'finance-admin' });
    const forecast = await createChild(request, root.id, { currency: 'USD', as: 'finance-admin' });
    const silent = await createChild(request, root.id, { currency: 'USD', as: 'finance-admin' });
    await allocateOk(
      request,
      root.id,
      forecast.id,
      { amountMinor: 300_000, currency: 'USD' },
      { as: 'finance-admin' },
    );
    await allocateOk(
      request,
      root.id,
      silent.id,
      { amountMinor: 200_000, currency: 'USD' },
      { as: 'finance-admin' },
    );
    await openingBalances(request, silent.id, [['actual', 80_000]]);
    const cycle = await acceptedCycle(
      request,
      root.id,
      [{ budgetId: forecast.id, amountMinor: 295_000 }],
      // Left open, so the cycle has one accepted line and the rest untouched.
      { close: false },
    );

    const report = await runReport(request, {
      rootBudgetId: root.id,
      forecastCycleId: cycle.id,
    });

    const silentRow = report.rows.find((r) => r.budgetId === silent.id)!;
    expect(silentRow.tags).toContain('System run-rate');
    expect(silentRow.cells['method'].text).toBe('Run-rate');
    // The run-rate is never below what is already spent and committed.
    expect(cell(silentRow, 'forecast')).toBeGreaterThanOrEqual(80_000);
    expect(report.notes.join(' ')).toContain('run-rate');
    expect(report.notes.join(' ')).toContain(cycle.name);
    expect(report.notes.join(' ')).toContain('post nothing');
    // The fallback does not break the reconciliation: the ledger columns are still the ledger's.
    expect(report.reconciliation.ties).toBe(true);
    expect(report.reconciliation.actual.amountMinor).toBe(80_000);

    const forecastRow = report.rows.find((r) => r.budgetId === forecast.id)!;
    expect(forecastRow.tags).not.toContain('System run-rate');
    expect(cell(forecastRow, 'forecast')).toBe(295_000);
  });

  test('comparing with an earlier cycle adds the previous forecast and the change', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 800_000, as: 'finance-admin' });
    const earlier = await acceptedCycle(
      request,
      root.id,
      [{ budgetId: root.id, amountMinor: 780_000 }],
      { asOfDate: '2026-08-31' },
    );
    const later = await acceptedCycle(
      request,
      root.id,
      [{ budgetId: root.id, amountMinor: 740_000 }],
      { asOfDate: '2026-09-30' },
    );

    const plain = await runReport(request, { rootBudgetId: root.id, forecastCycleId: later.id });
    expect(plain.columns.map((c) => c.key)).not.toContain('previousForecast');

    const compared = await runReport(request, {
      rootBudgetId: root.id,
      forecastCycleId: later.id,
      compareCycleId: earlier.id,
    });
    expect(compared.columns.map((c) => c.key)).toContain('previousForecast');
    expect(compared.columns.map((c) => c.key)).toContain('change');
    const row = compared.rows.find((r) => r.budgetId === root.id)!;
    expect(cell(row, 'forecast')).toBe(740_000);
    expect(cell(row, 'previousForecast')).toBe(780_000);
    expect(cell(row, 'change')).toBe(-40_000);
    expect(compared.notes.join(' ')).toContain(earlier.name);
  });

  test('"commentary required only" narrows the rows and says the figures are a part of the ledger', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 1_000_000, as: 'finance-admin' });
    const big = await createChild(request, root.id, { currency: 'USD', as: 'finance-admin' });
    const small = await createChild(request, root.id, { currency: 'USD', as: 'finance-admin' });
    await allocateOk(
      request,
      root.id,
      big.id,
      { amountMinor: 400_000, currency: 'USD' },
      { as: 'finance-admin' },
    );
    await allocateOk(
      request,
      root.id,
      small.id,
      { amountMinor: 400_000, currency: 'USD' },
      { as: 'finance-admin' },
    );
    const cycle = await acceptedCycle(
      request,
      root.id,
      [
        // 40% under: needs commentary.
        {
          budgetId: big.id,
          amountMinor: 240_000,
          commentary: 'The vendor contract was cancelled before any of it was committed.',
        },
        // 1.25% under: inside the threshold.
        { budgetId: small.id, amountMinor: 395_000 },
      ],
      { close: false },
    );

    const all = await runReport(request, { rootBudgetId: root.id, forecastCycleId: cycle.id });
    expect(all.rows.map((r) => r.budgetId)).toContain(small.id);
    expect(all.reconciliation.ties).toBe(true);

    const narrowed = await runReport(request, {
      rootBudgetId: root.id,
      forecastCycleId: cycle.id,
      commentaryRequiredOnly: 'true',
    });
    expect(narrowed.rows.map((r) => r.budgetId)).toContain(big.id);
    expect(narrowed.rows.map((r) => r.budgetId)).not.toContain(small.id);
    expect(narrowed.rows.length).toBeLessThan(all.rows.length);
    // A subset of the budgets in scope still has to be a part of the ledger, never more than it.
    expect(narrowed.reconciliation.ties).toBe(true);
  });

  test('tied rows come back in the same order every time', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 600_000, as: 'finance-admin' });
    // Four children with nothing authorized: every row ties at zero, so only the tie-break orders them.
    for (let i = 0; i < 4; i += 1)
      await createChild(request, root.id, { currency: 'USD', as: 'finance-admin' });

    const first = await runReport(request, { rootBudgetId: root.id });
    const second = await runReport(request, { rootBudgetId: root.id });
    const keys = (r: typeof ReportResult._output) => r.rows.map((x) => `${x.label}|${x.key}`);
    expect(first.rows.length).toBe(5);
    expect(keys(first)).toEqual(keys(second));
    // Largest authorized first, so the root leads; the four children all tie at nothing authorized
    // and are ordered by the tie-break alone, which is label then the unique row key.
    expect(first.rows[0].budgetId).toBe(root.id);
    const tied = keys(first).slice(1);
    expect(tied).toHaveLength(4);
    expect(tied).toEqual([...tied].sort((a, b) => a.localeCompare(b)));
  });

  test('an owner sees only their own subtree; an auditor reads the whole tenant', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 700_000, as: 'finance-admin' });
    const owned = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'regional-manager',
      as: 'finance-admin',
    });
    await allocateOk(
      request,
      root.id,
      owned.id,
      { amountMinor: 200_000, currency: 'USD' },
      { as: 'finance-admin' },
    );

    const ownerView = await runReport(request, { rootBudgetId: owned.id }, 'regional-manager');
    expect(ownerView.rows.map((r) => r.budgetId)).toEqual([owned.id]);
    expect(ownerView.scope.tenantWide).toBe(false);
    expect(ownerView.scope.note).toBe('Showing budgets you can see.');

    const refused = await request.get(
      `/api/reports/forecast-variance/run?rootBudgetId=${root.id}`,
      {
        headers: await as('employee'),
      },
    );
    expect([403, 404]).toContain(refused.status());

    const auditorView = await runReport(request, { rootBudgetId: root.id }, 'auditor');
    expect(auditorView.scope.tenantWide).toBe(true);
    expect(auditorView.rows.map((r) => r.budgetId)).toContain(owned.id);
  });
});
