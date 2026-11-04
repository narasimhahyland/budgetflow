// Invariant 7 (calendar variants and period status): the fiscal calendar engine generates correct periods
// for calendar years, non-calendar years and 52/53-week 4-4-5 / 5-4-4 / 13-period variants (last or
// nearest weekday), maps entity years to the group year, and period statuses change in order, with a
// reason to reopen or unlock. Status changes run on scenario calendars only; seeded periods stay as seeded.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  FiscalCalendarDetail,
  FiscalCalendarList,
  FiscalPeriod,
  FiscalYearPreview,
} from '@bf/contracts';
import { ORG_SEED, SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

async function preview(
  request: APIRequestContext,
  definition: Record<string, unknown>,
  year: number,
) {
  return expectContract(
    await request.post('/api/finance/fiscal-calendars/preview', {
      headers: await as('finance-controller'),
      data: { definition, year },
    }),
    200,
    FiscalYearPreview,
  );
}

test.describe('fiscal calendar engine', () => {
  test('calendar and non-calendar years', async ({ request }) => {
    const cy = await preview(request, { type: 'calendar_year' }, 2027);
    expect(cy).toMatchObject({
      label: 'FY2027',
      startDate: '2027-01-01',
      endDate: '2027-12-31',
      weeks: null,
      days: 365,
    });
    expect(cy.periods).toHaveLength(12);
    expect(cy.periods[1]).toMatchObject({
      label: 'Feb 2027',
      startDate: '2027-02-01',
      endDate: '2027-02-28',
      days: 28,
    });
    const india = await preview(
      request,
      { type: 'non_calendar', startMonth: 4, labelBy: 'end' },
      2027,
    );
    expect(india).toMatchObject({
      label: 'FY2027',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    });
    expect(india.periods[0].label).toBe('Apr 2026');
    expect(india.periods[11].label).toBe('Mar 2027');
    const byStart = await preview(
      request,
      { type: 'non_calendar', startMonth: 7, labelBy: 'start' },
      2026,
    );
    expect(byStart).toMatchObject({ startDate: '2026-07-01', endDate: '2027-06-30' });
    await expectProblem(
      await request.post('/api/finance/fiscal-calendars/preview', {
        headers: await as('finance-controller'),
        data: { definition: { type: 'non_calendar', startMonth: 1 }, year: 2027 },
      }),
      422,
      'VALIDATION_FAILED',
    );
  });

  test('4-4-5 ending the last Saturday of December has 52 and 53-week years', async ({
    request,
  }) => {
    const def = { type: '4-4-5', endMonth: 12, endWeekday: 6, method: 'last' };
    const fy26 = await preview(request, def, 2026);
    expect(fy26).toMatchObject({
      startDate: '2025-12-28',
      endDate: '2026-12-26',
      weeks: 52,
      days: 364,
    });
    expect(fy26.periods.map((p) => p.days / 7)).toEqual([4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5]);
    expect(fy26.periods[0]).toMatchObject({
      label: 'P01 FY2026',
      startDate: '2025-12-28',
      endDate: '2026-01-24',
    });
    const fy28 = await preview(request, def, 2028);
    expect(fy28).toMatchObject({
      startDate: '2027-12-26',
      endDate: '2028-12-30',
      weeks: 53,
      days: 371,
    });
    // The 53rd week joins the last period.
    expect(fy28.periods[11].days).toBe(42);
  });

  test('5-4-4, 4-5-4, 13-period and the nearest-weekday method', async ({ request }) => {
    const p544 = await preview(
      request,
      { type: '5-4-4', endMonth: 12, endWeekday: 6, method: 'last' },
      2026,
    );
    expect(p544.periods.slice(0, 3).map((p) => p.days / 7)).toEqual([5, 4, 4]);
    const p454 = await preview(
      request,
      { type: '4-5-4', endMonth: 12, endWeekday: 6, method: 'last' },
      2026,
    );
    expect(p454.periods.slice(0, 3).map((p) => p.days / 7)).toEqual([4, 5, 4]);
    const p13 = await preview(
      request,
      { type: '13-period', endMonth: 12, endWeekday: 6, method: 'last' },
      2026,
    );
    expect(p13.periods).toHaveLength(13);
    expect(p13.periods.every((p) => p.days === 28)).toBe(true);
    // Retail-style year ending the Saturday nearest 31 January.
    const near27 = await preview(
      request,
      { type: '4-4-5', endMonth: 1, endWeekday: 6, method: 'nearest' },
      2027,
    );
    expect(near27).toMatchObject({ startDate: '2026-02-01', endDate: '2027-01-30', weeks: 52 });
    const near26 = await preview(
      request,
      { type: '4-4-5', endMonth: 1, endWeekday: 6, method: 'nearest' },
      2026,
    );
    expect(near26.endDate).toBe('2026-01-31');
  });

  test('seeded Hyland calendars: entities, variants and group-year mapping', async ({
    request,
  }) => {
    const list = await expectContract(
      await request.get('/api/finance/fiscal-calendars', { headers: await as('employee') }),
      200,
      FiscalCalendarList,
    );
    const byEntity = (code: string) =>
      list.items.find((c) => c.legalEntities.some((l) => l.code === code))!;
    expect(byEntity('HYL-US').definition.type).toBe('calendar_year');
    expect(byEntity('HYL-DE').id).toBe(byEntity('HYL-US').id);
    expect(byEntity('HYL-IN').definition).toMatchObject({ type: 'non_calendar', startMonth: 4 });
    expect(byEntity('HYL-UK').definition).toMatchObject({
      type: '4-4-5',
      endMonth: 12,
      endWeekday: 6,
    });
    const uk = await expectContract(
      await request.get(`/api/finance/fiscal-calendars/${ORG_SEED.ukCalendar}`, {
        headers: await as('finance-controller'),
      }),
      200,
      FiscalCalendarDetail,
    );
    const fy26 = uk.fiscalYears.find((y) => y.label === 'FY2026')!;
    expect(fy26).toMatchObject({
      startDate: '2025-12-28',
      endDate: '2026-12-26',
      weeks: 52,
      groupFiscalYearLabel: 'FY2026',
    });
    expect(uk.fiscalYears.find((y) => y.label === 'FY2028')!.weeks).toBe(53);
    // Seeded statuses: locked before Jul 2026, closed Jul-Sep, soft-closed Oct, open from Nov.
    const statusOn = (date: string) =>
      fy26.periods.find((p) => p.startDate <= date && date <= p.endDate)!.status;
    expect(statusOn('2026-03-15')).toBe('locked');
    expect(statusOn('2026-12-01')).toBe('open');
    const group = await expectContract(
      await request.get(`/api/finance/fiscal-calendars/${byEntity('HYL-US').id}`, {
        headers: await as('finance-controller'),
      }),
      200,
      FiscalCalendarDetail,
    );
    const g26 = group.fiscalYears.find((y) => y.id === SEED.fiscalYears.acmeFy2026)!;
    expect(g26.periods.find((p) => p.label === 'Oct 2026')!.status).toBe('soft_closed');
    expect(g26.periods.find((p) => p.label === 'Nov 2026')!.allowedActions).toEqual(['soft_close']);
  });
});

test.describe('period status changes', () => {
  async function scenarioCalendar(request: APIRequestContext) {
    return expectContract(
      await request.post('/api/finance/fiscal-calendars', {
        headers: await mutate('finance-admin'),
        data: {
          name: `Scenario 4-4-5 ${randomUUID().slice(0, 6)}`,
          definition: { type: '4-4-5', endMonth: 12, endWeekday: 6, method: 'last' },
          groupCalendarId: (
            await expectContract(
              await request.get('/api/finance/fiscal-calendars', {
                headers: await as('finance-admin'),
              }),
              200,
              FiscalCalendarList,
            )
          ).items.find((c) => c.legalEntities.some((l) => l.code === 'HYL-US'))!.id,
          years: [2027, 2028],
        },
      }),
      201,
      FiscalCalendarDetail,
    );
  }

  const change = async (
    request: APIRequestContext,
    periodId: string,
    action: string,
    reason?: string,
    user: Parameters<typeof mutate>[0] = 'finance-controller',
  ) =>
    request.post(`/api/finance/fiscal-periods/${periodId}/status`, {
      headers: await mutate(user),
      data: reason ? { action, reason } : { action },
    });

  test('creating a calendar generates its years and maps them to the group year', async ({
    request,
  }) => {
    const cal = await scenarioCalendar(request);
    expect(cal.fiscalYears.map((y) => [y.label, y.weeks, y.groupFiscalYearLabel])).toEqual([
      ['FY2027', 52, 'FY2027'],
      ['FY2028', 53, 'FY2028'],
    ]);
    expect(cal.fiscalYears.every((y) => y.periods.every((p) => p.status === 'open'))).toBe(true);
    await expectProblem(
      await request.post(`/api/finance/fiscal-calendars/${cal.id}/years`, {
        headers: await mutate('finance-admin'),
        data: { year: 2028 },
      }),
      409,
      'DUPLICATE_CODE',
    );
    const more = await expectContract(
      await request.post(`/api/finance/fiscal-calendars/${cal.id}/years`, {
        headers: await mutate('finance-admin'),
        data: { year: 2029 },
      }),
      201,
      FiscalCalendarDetail,
    );
    expect(more.fiscalYears.map((y) => y.label)).toEqual(['FY2027', 'FY2028', 'FY2029']);
    await expectProblem(
      await request.post('/api/finance/fiscal-calendars', {
        headers: await mutate('regional-manager'),
        data: { name: 'Nope', definition: { type: 'calendar_year' }, years: [2027] },
      }),
      403,
      'FORBIDDEN',
    );
  });

  test('periods close and lock in order; reopening and unlocking need a reason and go newest first', async ({
    request,
  }) => {
    const cal = await scenarioCalendar(request);
    const [p1, p2] = cal.fiscalYears[0].periods;
    expect(p2.allowedActions).toEqual(['soft_close']);
    const closeP2 = await expectProblem(
      await change(request, p2.id, 'close'),
      409,
      'INVALID_TRANSITION',
    );
    expect(closeP2.detail).toContain('P01 FY2027');
    for (const action of ['soft_close', 'close', 'lock']) {
      const p = await expectContract(await change(request, p1.id, action), 201, FiscalPeriod);
      expect(p.status).toBe({ soft_close: 'soft_closed', close: 'closed', lock: 'locked' }[action]);
    }
    await expectContract(await change(request, p2.id, 'close'), 201, FiscalPeriod);
    const locked2 = await expectContract(await change(request, p2.id, 'lock'), 201, FiscalPeriod);
    expect(locked2.allowedActions).toEqual(['unlock']);
    await expectProblem(
      await change(request, p1.id, 'reopen', 'Late invoice'),
      409,
      'INVALID_TRANSITION',
    );
    await expectProblem(await change(request, p1.id, 'unlock'), 422, 'REASON_REQUIRED');
    const blocked = await expectProblem(
      await change(request, p1.id, 'unlock', 'Audit adjustment'),
      409,
      'INVALID_TRANSITION',
    );
    expect(blocked.detail).toContain('P02 FY2027');
    await expectContract(
      await change(request, p2.id, 'unlock', 'Audit adjustment'),
      201,
      FiscalPeriod,
    );
    const reopened2 = await expectContract(
      await change(request, p2.id, 'reopen', 'Late invoice'),
      201,
      FiscalPeriod,
    );
    expect(reopened2.status).toBe('open');
    await expectContract(
      await change(request, p1.id, 'unlock', 'Audit adjustment'),
      201,
      FiscalPeriod,
    );
    const reopened1 = await expectContract(
      await change(request, p1.id, 'reopen', 'Late invoice'),
      201,
      FiscalPeriod,
    );
    expect(reopened1.status).toBe('open');
    await expectProblem(
      await change(request, p1.id, 'close', undefined, 'analyst'),
      403,
      'FORBIDDEN',
    );
    await expectProblem(
      await change(request, p1.id, 'close', undefined, 'org-admin'),
      403,
      'FORBIDDEN',
    );
  });
});
