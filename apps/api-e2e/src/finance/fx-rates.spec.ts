// FX lookup by rate type and date (Phase 3): plan rates lock per fiscal year and drive budget control;
// spot, month-end and monthly average rates are dated. Transactions in INR, EUR or GBP convert to the USD
// reporting currency once, half-even at the line. A locked year's plan rates never change.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  CurrencyList,
  ExchangeRate,
  ExchangeRateList,
  FiscalCalendarDetail,
  PlanRateLockResponse,
  RateLookupResponse,
} from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

async function lookup(
  request: APIRequestContext,
  q: string,
  user: Parameters<typeof as>[0] = 'analyst',
) {
  return request.get(`/api/finance/exchange-rates/lookup?${q}`, { headers: await as(user) });
}

const ok = async (request: APIRequestContext, q: string) =>
  expectContract(await lookup(request, q), 200, RateLookupResponse);

test.describe('exchange-rate lookup by type and date', () => {
  test('a transaction in INR converts to USD at the locked plan rate, and differently at spot', async ({
    request,
  }) => {
    const plan = await ok(request, 'from=INR&to=USD&date=2026-11-16&type=plan&amountMinor=8325000');
    expect(plan.applied).toMatchObject({
      type: 'plan',
      from: 'INR',
      to: 'USD',
      value: '0.012012012012',
    });
    expect(plan.sources).toEqual([
      expect.objectContaining({
        quoteCurrency: 'INR',
        rate: '83.250000000000',
        fiscalYearLabel: 'FY2026',
        locked: true,
      }),
    ]);
    expect(plan.converted).toEqual({ amountMinor: 100_000, currency: 'USD' });
    const spot = await ok(request, 'from=INR&to=USD&date=2026-11-16&type=spot&amountMinor=8325000');
    expect(spot.sources[0]).toMatchObject({
      rate: '84.070000000000',
      effectiveDate: '2026-11-02',
      locked: false,
    });
    expect(spot.converted).toEqual({ amountMinor: 99_025, currency: 'USD' });
    // Spot uses the latest rate on or before the date.
    const mid = await ok(request, 'from=INR&to=USD&date=2026-10-20&type=spot');
    expect(mid.sources[0].effectiveDate).toBe('2026-10-15');
    // The next fiscal year has its own plan rate.
    const fy27 = await ok(request, 'from=INR&to=USD&date=2027-03-01&type=plan');
    expect(fy27.sources[0]).toMatchObject({ rate: '85.100000000000', fiscalYearLabel: 'FY2027' });
  });

  test('month-end, monthly average and cross rates', async ({ request }) => {
    const me = await ok(
      request,
      'from=EUR&to=USD&date=2026-10-20&type=month_end&amountMinor=94000',
    );
    expect(me.sources[0]).toMatchObject({ effectiveDate: '2026-10-31', rate: '0.940000000000' });
    expect(me.converted).toEqual({ amountMinor: 100_000, currency: 'USD' });
    const avg = await ok(request, 'from=GBP&to=USD&date=2026-10-20&type=monthly_average');
    expect(avg.sources[0]).toMatchObject({ effectiveDate: '2026-10-01', rate: '0.785000000000' });
    const cross = await ok(request, 'from=EUR&to=INR&date=2026-06-30&type=plan&amountMinor=10000');
    expect(cross.applied.value).toBe('90.489130434783');
    expect(cross.applied.rateIds).toHaveLength(2);
    expect(cross.converted).toEqual({ amountMinor: 904_891, currency: 'INR' });
    const same = await ok(request, 'from=USD&to=USD&date=2026-06-30&type=spot&amountMinor=12345');
    expect(same).toMatchObject({
      applied: { value: '1.000000000000', rateIds: [] },
      converted: { amountMinor: 12_345 },
    });
  });

  test('a missing rate is a clear 422, never a silent fallback', async ({ request }) => {
    const nov = await expectProblem(
      await lookup(request, 'from=EUR&to=USD&date=2026-11-10&type=month_end'),
      422,
      'RATE_MISSING',
    );
    expect(nov.detail).toContain('2026-11-30');
    await expectProblem(
      await lookup(request, 'from=INR&to=USD&date=2020-01-01&type=spot'),
      422,
      'RATE_MISSING',
    );
    await expectProblem(
      await lookup(request, 'from=INR&to=USD&date=2035-01-01&type=plan'),
      422,
      'RATE_MISSING',
    );
    await expectProblem(
      await lookup(request, 'from=XYZ&to=USD&date=2026-01-01&type=plan'),
      422,
      'UNKNOWN_CURRENCY',
    );
  });

  test('currencies and rates are readable by every member; the reporting currency is USD', async ({
    request,
  }) => {
    const ccy = await expectContract(
      await request.get('/api/finance/currencies', { headers: await as('employee') }),
      200,
      CurrencyList,
    );
    expect(ccy.reportingCurrency).toBe('USD');
    expect(ccy.items.map((c) => c.code)).toEqual(
      expect.arrayContaining(['USD', 'INR', 'EUR', 'GBP']),
    );
    const plans = await expectContract(
      await request.get(
        `/api/finance/exchange-rates?rateType=plan&fiscalYearId=${SEED.fiscalYears.acmeFy2026}`,
        {
          headers: await as('employee'),
        },
      ),
      200,
      ExchangeRateList,
    );
    expect(plans.items.every((r) => r.locked && r.baseCurrency === 'USD')).toBe(true);
    expect(plans.items.map((r) => r.quoteCurrency)).toEqual(
      expect.arrayContaining(['INR', 'EUR', 'GBP']),
    );
  });
});

test.describe('plan-rate lock', () => {
  test('plan rates can be added while a fiscal year is open for planning, then lock and never change', async ({
    request,
  }) => {
    const year = 2100 + Math.floor(Math.random() * 700);
    const cal = await expectContract(
      await request.post('/api/finance/fiscal-calendars', {
        headers: await mutate('finance-admin'),
        data: {
          name: `Scenario plan calendar ${randomUUID().slice(0, 6)}`,
          definition: { type: 'calendar_year' },
          years: [year],
        },
      }),
      201,
      FiscalCalendarDetail,
    );
    const fy = cal.fiscalYears[0];
    expect(fy.planRatesLockedAt).toBeNull();
    const rate = await expectContract(
      await request.post('/api/finance/exchange-rates', {
        headers: await mutate('finance-admin'),
        data: {
          rateType: 'plan',
          quoteCurrency: 'INR',
          rate: '90.5',
          effectiveDate: `${year}-01-01`,
          fiscalYearId: fy.id,
          source: 'Scenario plan',
        },
      }),
      201,
      ExchangeRate,
    );
    expect(rate).toMatchObject({
      rate: '90.500000000000',
      locked: false,
      fiscalYearLabel: `FY${year}`,
    });
    const before = await ok(
      request,
      `from=INR&to=USD&date=${year}-06-15&type=plan&amountMinor=905000`,
    );
    expect(before.sources[0]).toMatchObject({ rateId: rate.id, locked: false });
    expect(before.converted).toEqual({ amountMinor: 10_000, currency: 'USD' });
    const lock = await expectContract(
      await request.post(`/api/finance/fiscal-years/${fy.id}/plan-rate-lock`, {
        headers: await mutate('finance-admin'),
        data: { reason: 'Plan approved' },
      }),
      201,
      PlanRateLockResponse,
    );
    expect(lock).toMatchObject({ fiscalYearLabel: `FY${year}`, lockedRates: 1 });
    const after = await ok(request, `from=INR&to=USD&date=${year}-06-15&type=plan`);
    expect(after.sources[0]).toMatchObject({ rateId: rate.id, locked: true });
    await expectProblem(
      await request.post('/api/finance/exchange-rates', {
        headers: await mutate('finance-admin'),
        data: {
          rateType: 'plan',
          quoteCurrency: 'EUR',
          rate: '0.9',
          effectiveDate: `${year}-01-01`,
          fiscalYearId: fy.id,
          source: 'Late',
        },
      }),
      409,
      'PLAN_RATE_LOCKED',
    );
    await expectProblem(
      await request.post(`/api/finance/fiscal-years/${fy.id}/plan-rate-lock`, {
        headers: await mutate('finance-admin'),
        data: { reason: 'Again' },
      }),
      409,
      'PLAN_RATE_LOCKED',
    );
    await expectProblem(
      await request.post('/api/finance/exchange-rates', {
        headers: await mutate('finance-admin'),
        data: {
          rateType: 'plan',
          quoteCurrency: 'GBP',
          rate: '0.8',
          effectiveDate: '2026-02-01',
          fiscalYearId: SEED.fiscalYears.acmeFy2026,
          source: 'x',
        },
      }),
      409,
      'PLAN_RATE_LOCKED',
    );
  });

  test('dated rates: spot is added, duplicates and invalid dates are refused, and only finance may write', async ({
    request,
  }) => {
    const year = 2100 + Math.floor(Math.random() * 700);
    const spot = await expectContract(
      await request.post('/api/finance/exchange-rates', {
        headers: await mutate('finance-admin'),
        data: {
          rateType: 'spot',
          quoteCurrency: 'GBP',
          rate: '0.8123',
          effectiveDate: `${year}-03-15`,
          source: 'Scenario feed',
        },
      }),
      201,
      ExchangeRate,
    );
    const read = await ok(request, `from=GBP&to=USD&date=${year}-03-20&type=spot`);
    expect(read.sources[0].rateId).toBe(spot.id);
    await expectProblem(
      await request.post('/api/finance/exchange-rates', {
        headers: await mutate('finance-admin'),
        data: {
          rateType: 'spot',
          quoteCurrency: 'GBP',
          rate: '0.9',
          effectiveDate: `${year}-03-15`,
          source: 'Again',
        },
      }),
      409,
      'DUPLICATE_CODE',
    );
    await expectProblem(
      await request.post('/api/finance/exchange-rates', {
        headers: await mutate('finance-admin'),
        data: {
          rateType: 'month_end',
          quoteCurrency: 'GBP',
          rate: '0.9',
          effectiveDate: `${year}-03-15`,
          source: 'x',
        },
      }),
      422,
      'VALIDATION_FAILED',
    );
    await expectProblem(
      await request.post('/api/finance/exchange-rates', {
        headers: await mutate('finance-admin'),
        data: {
          rateType: 'spot',
          quoteCurrency: 'USD',
          rate: '1',
          effectiveDate: `${year}-03-16`,
          source: 'x',
        },
      }),
      422,
      'VALIDATION_FAILED',
    );
    await expectProblem(
      await request.post('/api/finance/exchange-rates', {
        headers: await mutate('org-admin'),
        data: {
          rateType: 'spot',
          quoteCurrency: 'GBP',
          rate: '0.9',
          effectiveDate: `${year}-03-17`,
          source: 'x',
        },
      }),
      403,
      'FORBIDDEN',
    );
  });
});
