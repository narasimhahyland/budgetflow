// Scope-based visibility of the org (Phase 3): PolicyService decides per unit and person. Tenant-wide roles
// see everything; owners see the subtrees of their budgets' units and scoped grants; employees and event
// organizers see only their own location and team. Hidden units and people answer 404, never 403.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  HeadcountSummary,
  OrgUnitDetail,
  OrgUnitList,
  PersonDetail,
  PersonList,
} from '@bf/contracts';
import { ORG_SEED, SEED, userById } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

const U = SEED.orgUnits;
const O = ORG_SEED.units;

async function unitCodes(request: APIRequestContext, user: Parameters<typeof as>[0]) {
  return expectContract(
    await request.get('/api/org/units', { headers: await as(user) }),
    200,
    OrgUnitList,
  );
}

test.describe('org scope visibility', () => {
  test('tenant-wide roles see the whole Hyland hierarchy, parents before children', async ({
    request,
  }) => {
    for (const user of ['org-admin', 'finance-admin', 'ceo', 'auditor', 'analyst'] as const) {
      const list = await unitCodes(request, user);
      expect(list.scope, user).toBe('tenant');
      const codes = list.items.map((u) => u.code);
      expect(codes, user).toEqual(
        expect.arrayContaining([
          'HYL',
          'EX',
          'IN',
          'US',
          'EU',
          'BLR',
          'HYD',
          'WLK',
          'NYC',
          'BER',
          'LON',
        ]),
      );
      expect(list.items[0].code).toBe('HYL');
      const index = new Map(list.items.map((u, i) => [u.id, i]));
      for (const u of list.items)
        if (u.parentId)
          expect(index.get(u.parentId)!, `${u.code} after parent`).toBeLessThan(index.get(u.id)!);
    }
    const orgAdmin = await unitCodes(request, 'org-admin');
    expect(orgAdmin.items.find((u) => u.code === 'BLR')!.allowedActions).toContain('org.manage');
    const finance = await unitCodes(request, 'finance-admin');
    expect(finance.items.find((u) => u.code === 'BLR')!.allowedActions).toEqual([]);
  });

  test('the India regional manager sees the India subtree only', async ({ request }) => {
    const list = await unitCodes(request, 'regional-manager');
    expect(list.scope).toBe('subtree');
    const codes = list.items.map((u) => u.code);
    expect(codes).toEqual(expect.arrayContaining(['IN', 'BLR', 'HYD', 'BLR-ENG-PLAT', 'HYD-FIN']));
    for (const hidden of ['HYL', 'EX', 'US', 'WLK', 'EU', 'BER', 'LON'])
      expect(codes).not.toContain(hidden);
    const headers = await as('regional-manager');
    await expectContract(
      await request.get(`/api/org/units/${U.hyderabad}`, { headers }),
      200,
      OrgUnitDetail,
    );
    for (const other of [U.unitedStates, U.berlin, O.london, U.acme])
      await expectProblem(
        await request.get(`/api/org/units/${other}`, { headers }),
        404,
        'NOT_FOUND',
      );
  });

  test('the US budget owner sees the US subtree; the Europe department head sees Europe', async ({
    request,
  }) => {
    const us = (await unitCodes(request, 'budget-owner')).items.map((u) => u.code);
    expect(us).toEqual(expect.arrayContaining(['US', 'WLK', 'NYC', 'WLK-FIN']));
    expect(us).not.toContain('IN');
    const eu = (await unitCodes(request, 'department-head')).items.map((u) => u.code);
    expect(eu).toEqual(expect.arrayContaining(['EU', 'BER', 'LON', 'BER-ENG-INT']));
    expect(eu).not.toContain('US');
  });

  test('an employee sees only their own location and team, and their colleagues there', async ({
    request,
  }) => {
    const list = await unitCodes(request, 'employee');
    expect(list.scope).toBe('self');
    expect(list.items.map((u) => u.code).sort()).toEqual(['HYD', 'HYD-ENG-QE']);
    const headers = await as('employee');
    const people = await expectContract(
      await request.get('/api/org/people?limit=200', { headers }),
      200,
      PersonList,
    );
    expect(people.scope).toBe('self');
    expect(people.items.map((p) => p.id)).toContain(userById('employee').personId);
    expect(
      people.items.every(
        (p) => p.locationOrgUnitId === U.hyderabad || p.orgUnitId === O.hydQuality,
      ),
    ).toBe(true);
    await expectProblem(
      await request.get(`/api/org/people/${ORG_SEED.people.deepika}`, { headers }),
      404,
      'NOT_FOUND',
    );
    const self = await expectContract(
      await request.get(`/api/org/people/${userById('employee').personId}`, { headers }),
      200,
      PersonDetail,
    );
    expect(self.managerPersonId).toBe(userById('location-manager').personId);
    expect(self.allowedActions).toEqual([]);
  });

  test('the people directory filters by scope, subtree and search', async ({ request }) => {
    const all = await expectContract(
      await request.get('/api/org/people?limit=200', { headers: await as('org-admin') }),
      200,
      PersonList,
    );
    expect(all.scope).toBe('tenant');
    expect(all.total).toBeGreaterThanOrEqual(45);
    const india = await expectContract(
      await request.get('/api/org/people?limit=200', { headers: await as('regional-manager') }),
      200,
      PersonList,
    );
    expect(india.total).toBeLessThan(all.total);
    expect(india.items.map((p) => p.employingEntityCode)).not.toContain('HYL-US');
    const team = await expectContract(
      await request.get(`/api/org/people?orgUnitId=${O.blrPlatform}`, {
        headers: await as('regional-manager'),
      }),
      200,
      PersonList,
    );
    expect(team.items.map((p) => p.displayName)).toEqual(
      expect.arrayContaining(['Rohan Kulkarni', 'Meera Nair']),
    );
    const search = await expectContract(
      await request.get('/api/org/people?q=hoffmann', { headers: await as('org-admin') }),
      200,
      PersonList,
    );
    expect(search.items.map((p) => p.displayName)).toEqual(['Lena Hoffmann']);
    await expectProblem(
      await request.get(`/api/org/people?orgUnitId=${U.berlin}`, {
        headers: await as('regional-manager'),
      }),
      404,
      'NOT_FOUND',
    );
  });

  test('headcount follows the same scope', async ({ request }) => {
    const all = await expectContract(
      await request.get(`/api/org/headcount?asOf=${ORG_SEED.headcountAsOf}`, {
        headers: await as('finance-admin'),
      }),
      200,
      HeadcountSummary,
    );
    expect(all.locations.map((l) => l.code)).toEqual(
      expect.arrayContaining(['BLR', 'HYD', 'WLK', 'NYC', 'BER', 'LON']),
    );
    const india = await expectContract(
      await request.get(`/api/org/headcount?asOf=${ORG_SEED.headcountAsOf}`, {
        headers: await as('regional-manager'),
      }),
      200,
      HeadcountSummary,
    );
    expect(india.locations.map((l) => l.code).sort()).toEqual(['BLR', 'HYD']);
    expect(india.total).toBe(ORG_SEED.bengaluruHeadcount + ORG_SEED.hyderabadHeadcount);
    await expectProblem(
      await request.get('/api/org/headcount/snapshots', { headers: await as('regional-manager') }),
      403,
      'FORBIDDEN',
    );
  });

  test('only org admins change the hierarchy; others are refused before anything is written', async ({
    request,
  }) => {
    const body = {
      code: 'T-SCOPE-REFUSED',
      name: 'Should not exist',
      kind: 'team',
      parentId: O.blrEng,
      effectiveFrom: '2031-01-01',
    };
    await expectProblem(
      await request.post('/api/org/units', {
        headers: await mutate('regional-manager'),
        data: body,
      }),
      403,
      'FORBIDDEN',
    );
    await expectProblem(
      await request.post('/api/org/units', { headers: await mutate('finance-admin'), data: body }),
      403,
      'FORBIDDEN',
    );
    // A unit outside the caller's scope is not even visible.
    await expectProblem(
      await request.post(`/api/org/units/${U.berlin}/changes`, {
        headers: await mutate('regional-manager'),
        data: { effectiveFrom: '2031-01-01', name: 'Nope', reason: 'scope check' },
      }),
      404,
      'NOT_FOUND',
    );
    await expectProblem(
      await request.post('/api/org/headcount/imports', {
        headers: await mutate('employee'),
        data: {
          csv: 'location_code,employment_type,headcount\nHYD,employee,1',
          asOfDate: '2040-01-01',
        },
      }),
      403,
      'FORBIDDEN',
    );
  });
});
