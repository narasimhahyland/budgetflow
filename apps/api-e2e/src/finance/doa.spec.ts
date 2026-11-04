// Seeded delegation-of-authority matrix (Phase 3 read view; Phase 5 enforces it on approvals): who x spend
// type x legal entity x limit, versioned and effective-dated. The most specific row wins (person, then
// spend type, then entity). Exactly at the limit passes; one minor unit above escalates. Amounts in other
// currencies convert at the locked plan rate. Authority is separate from budget ownership.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { DoaLookupResponse, DoaMatrix } from '@bf/contracts';
import { ORG_SEED, userById } from '@bf/seed';
import { as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

const E = ORG_SEED.entities;

async function lookup(request: APIRequestContext, params: Record<string, string | number>) {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return expectContract(
    await request.get(`/api/finance/doa/lookup?${qs}`, { headers: await as('finance-controller') }),
    200,
    DoaLookupResponse,
  );
}

test.describe('delegation-of-authority matrix', () => {
  test('finance roles and auditors read the active matrix; others cannot', async ({ request }) => {
    for (const user of ['finance-admin', 'finance-controller', 'auditor', 'ceo'] as const) {
      const m = await expectContract(
        await request.get('/api/finance/doa', { headers: await as(user) }),
        200,
        DoaMatrix,
      );
      expect(m.version).toMatchObject({ version: 1, status: 'active', validFrom: '2026-01-01' });
      expect(m.spendTypes).toEqual(
        expect.arrayContaining(['*', 'employee_events', 'team_lunch', 'travel']),
      );
      const ceo = m.items.find((l) => l.role === 'ceo' && l.spendType === '*')!;
      expect(ceo.limit).toEqual({ amountMinor: 25_000_000, currency: 'USD' });
      const personal = m.items.find((l) => l.personId === userById('regional-manager').personId)!;
      expect(personal).toMatchObject({
        spendType: 'travel',
        personName: userById('regional-manager').displayName,
      });
      const entity = m.items.find((l) => l.legalEntityCode === 'HYL-IN')!;
      expect(entity).toMatchObject({ role: 'regional-manager', spendType: 'employee_events' });
    }
    for (const user of ['employee', 'regional-manager', 'event-organizer'] as const)
      await expectProblem(
        await request.get('/api/finance/doa', { headers: await as(user) }),
        403,
        'FORBIDDEN',
      );
  });

  test('exactly at the limit passes; one minor unit above escalates', async ({ request }) => {
    const base = {
      role: 'location-manager',
      spendType: 'team_lunch',
      legalEntityId: E.india,
      currency: 'USD',
    };
    const at = await lookup(request, { ...base, amountMinor: 100_000 });
    expect(at).toMatchObject({ withinLimit: true, code: null });
    expect(at.limit).toMatchObject({ spendType: 'team_lunch', limit: { amountMinor: 100_000 } });
    const above = await lookup(request, { ...base, amountMinor: 100_001 });
    expect(above).toMatchObject({ withinLimit: false, code: 'DOA_LIMIT_EXCEEDED' });
    expect(above.limit?.limit.amountMinor).toBe(100_000);
  });

  test('amounts in INR convert at the locked FY2026 plan rate before the check', async ({
    request,
  }) => {
    const base = {
      role: 'location-manager',
      spendType: 'team_lunch',
      legalEntityId: E.india,
      currency: 'INR',
      date: '2026-11-16',
    };
    // INR 83,250.00 = USD 1,000.00 at 83.25.
    expect((await lookup(request, { ...base, amountMinor: 8_325_000 })).withinLimit).toBe(true);
    expect((await lookup(request, { ...base, amountMinor: 8_325_084 })).code).toBe(
      'DOA_LIMIT_EXCEEDED',
    );
  });

  test('the most specific row wins: person, then spend type, then entity, then wildcards', async ({
    request,
  }) => {
    const rm = userById('regional-manager').personId!;
    // Spend-type row (USD 5,000) beats the location manager's wildcard (USD 2,500).
    const events = await lookup(request, {
      role: 'location-manager',
      spendType: 'employee_events',
      legalEntityId: E.india,
      amountMinor: 400_000,
      currency: 'USD',
    });
    expect(events).toMatchObject({
      withinLimit: true,
      limit: { spendType: 'employee_events', limit: { amountMinor: 500_000 } },
    });
    const travel = await lookup(request, {
      role: 'location-manager',
      spendType: 'travel',
      legalEntityId: E.india,
      amountMinor: 250_001,
      currency: 'USD',
    });
    expect(travel).toMatchObject({
      code: 'DOA_LIMIT_EXCEEDED',
      limit: { spendType: '*', limit: { amountMinor: 250_000 } },
    });
    // Entity-specific row for India (USD 20,000) beats the role wildcard (USD 10,000); not for the US entity.
    const india = await lookup(request, {
      personId: rm,
      spendType: 'employee_events',
      legalEntityId: E.india,
      amountMinor: 1_500_000,
      currency: 'USD',
    });
    expect(india).toMatchObject({
      withinLimit: true,
      limit: { legalEntityCode: 'HYL-IN', limit: { amountMinor: 2_000_000 } },
    });
    const us = await lookup(request, {
      personId: rm,
      spendType: 'employee_events',
      legalEntityId: E.us,
      amountMinor: 1_500_000,
      currency: 'USD',
    });
    expect(us).toMatchObject({
      withinLimit: false,
      limit: { spendType: '*', limit: { amountMinor: 1_000_000 } },
    });
    // A person-specific travel limit (USD 5,000) overrides the higher role limit (USD 10,000).
    const personal = await lookup(request, {
      personId: rm,
      spendType: 'travel',
      legalEntityId: E.us,
      amountMinor: 600_000,
      currency: 'USD',
    });
    expect(personal).toMatchObject({
      withinLimit: false,
      code: 'DOA_LIMIT_EXCEEDED',
      limit: { personId: rm, limit: { amountMinor: 500_000 } },
    });
    expect(personal.approver).toMatchObject({
      displayName: userById('regional-manager').displayName,
      roles: ['regional-manager'],
    });
  });

  test('owning a budget does not grant approval authority', async ({ request }) => {
    const employee = await lookup(request, {
      personId: userById('employee').personId!,
      spendType: 'employee_events',
      legalEntityId: E.india,
      amountMinor: 1,
      currency: 'USD',
    });
    expect(employee).toMatchObject({ withinLimit: false, code: 'DOA_NO_AUTHORITY', limit: null });
    const organizer = await lookup(request, {
      role: 'event-organizer',
      spendType: 'team_lunch',
      legalEntityId: E.india,
      amountMinor: 1,
      currency: 'USD',
    });
    expect(organizer.code).toBe('DOA_NO_AUTHORITY');
    await expectProblem(
      await request.get(
        `/api/finance/doa/lookup?spendType=travel&legalEntityId=${E.us}&amountMinor=1&currency=USD`,
        {
          headers: await as('finance-controller'),
        },
      ),
      422,
      'VALIDATION_FAILED',
    );
  });
});
