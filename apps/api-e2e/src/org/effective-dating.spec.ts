// Effective dating (Phase 3): org changes take effect on a date and never rewrite history. Reads take an
// as-of date; a move re-links the whole subtree from its effective date; backdating before the latest
// change is refused. Scenario units live in future years so today's seeded views stay unchanged.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  CostCenter,
  CostCenterList,
  GlMapping,
  GlMappingList,
  OrgUnitDetail,
  OrgUnitList,
  PersonDetail,
} from '@bf/contracts';
import { ORG_SEED, SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

const O = ORG_SEED.units;
const U = SEED.orgUnits;
const tag = () => randomUUID().slice(0, 6).toUpperCase();
/** A future year per run (scenario data never overlaps today's seeded views or other runs). */
const futureYear = () => 2100 + Math.floor(Math.random() * 700);

async function createUnit(
  request: APIRequestContext,
  body: Record<string, unknown>,
  user: Parameters<typeof mutate>[0] = 'org-admin',
) {
  return expectContract(
    await request.post('/api/org/units', { headers: await mutate(user), data: body }),
    201,
    OrgUnitDetail,
  );
}

async function unitAsOf(request: APIRequestContext, id: string, asOf: string) {
  return expectContract(
    await request.get(`/api/org/units/${id}?asOf=${asOf}`, { headers: await as('org-admin') }),
    200,
    OrgUnitDetail,
  );
}

test.describe('effective-dated org hierarchy', () => {
  test('create, rename, move and deactivate read back correctly as of each date', async ({
    request,
  }) => {
    const y = futureYear();
    const t = tag();
    const dept = await createUnit(request, {
      code: `T-${t}-DEPT`,
      name: `Scenario department ${t}`,
      kind: 'department',
      parentId: U.bengaluru,
      effectiveFrom: `${y}-01-01`,
      reason: 'Scenario setup',
    });
    expect(dept.ancestorIds).toEqual([U.acme, U.india, U.bengaluru, dept.id]);
    expect(dept.legalEntityId).toBe(SEED.legalEntities.acmeIndia);
    const team = await createUnit(request, {
      code: `T-${t}-TEAM`,
      name: `Scenario team ${t}`,
      kind: 'team',
      parentId: dept.id,
      effectiveFrom: `${y}-02-01`,
    });
    // Not active before its effective date: today's list does not contain it.
    const today = await expectContract(
      await request.get('/api/org/units', { headers: await as('org-admin') }),
      200,
      OrgUnitList,
    );
    expect(today.items.map((u) => u.id)).not.toContain(dept.id);

    // Rename from 1 June.
    const renamed = await expectContract(
      await request.post(`/api/org/units/${dept.id}/changes`, {
        headers: await mutate('org-admin'),
        data: {
          effectiveFrom: `${y}-06-01`,
          name: `Renamed department ${t}`,
          reason: 'Reorganisation',
        },
      }),
      201,
      OrgUnitDetail,
    );
    expect(renamed.name).toBe(`Renamed department ${t}`);
    expect((await unitAsOf(request, dept.id, `${y}-05-31`)).name).toBe(`Scenario department ${t}`);
    expect((await unitAsOf(request, dept.id, `${y}-06-01`)).name).toBe(`Renamed department ${t}`);

    // Move the department (and its team) to Hyderabad from next year.
    await expectContract(
      await request.post(`/api/org/units/${dept.id}/changes`, {
        headers: await mutate('org-admin'),
        data: {
          effectiveFrom: `${y + 1}-01-01`,
          parentId: U.hyderabad,
          reason: 'Moved to Hyderabad',
        },
      }),
      201,
      OrgUnitDetail,
    );
    const before = await unitAsOf(request, team.id, `${y}-12-31`);
    const after = await unitAsOf(request, team.id, `${y + 1}-01-01`);
    expect(before.ancestorIds).toEqual([U.acme, U.india, U.bengaluru, dept.id, team.id]);
    expect(after.ancestorIds).toEqual([U.acme, U.india, U.hyderabad, dept.id, team.id]);
    const history = (await unitAsOf(request, dept.id, `${y + 1}-02-01`)).versions;
    expect(history.map((v) => v.changeKind)).toEqual(['moved', 'renamed', 'created']);
    expect(history[1]).toMatchObject({ validFrom: `${y}-06-01`, validTo: `${y}-12-31` });
    expect(history[0]).toMatchObject({
      validFrom: `${y + 1}-01-01`,
      validTo: null,
      parentId: U.hyderabad,
    });

    // The Hyderabad subtree (as of the new year) now contains the moved units; Bengaluru's does not.
    const hyd = await unitAsOf(request, U.hyderabad, `${y + 1}-01-01`);
    expect(hyd.children.map((c) => c.id)).toContain(dept.id);
    const blr = await unitAsOf(request, U.bengaluru, `${y + 1}-01-01`);
    expect(blr.children.map((c) => c.id)).not.toContain(dept.id);

    // Backdating before the latest change is refused; nothing changes.
    await expectProblem(
      await request.post(`/api/org/units/${dept.id}/changes`, {
        headers: await mutate('org-admin'),
        data: { effectiveFrom: `${y}-09-01`, name: 'Backdated', reason: 'Should fail' },
      }),
      409,
      'EFFECTIVE_DATE_CONFLICT',
    );
    // A unit with active children cannot be deactivated; after the team closes, the department can.
    await expectProblem(
      await request.post(`/api/org/units/${dept.id}/changes`, {
        headers: await mutate('org-admin'),
        data: { effectiveFrom: `${y + 2}-01-01`, deactivate: true, reason: 'Closing' },
      }),
      409,
      'ORG_UNIT_HAS_CHILDREN',
    );
    await expectContract(
      await request.post(`/api/org/units/${team.id}/changes`, {
        headers: await mutate('org-admin'),
        data: { effectiveFrom: `${y + 2}-01-01`, deactivate: true, reason: 'Team closed' },
      }),
      201,
      OrgUnitDetail,
    );
    const closed = await expectContract(
      await request.post(`/api/org/units/${dept.id}/changes`, {
        headers: await mutate('org-admin'),
        data: { effectiveFrom: `${y + 2}-01-01`, deactivate: true, reason: 'Department closed' },
      }),
      201,
      OrgUnitDetail,
    );
    expect(closed.validTo).toBe(`${y + 1}-12-31`);
    const later = await expectContract(
      await request.get(`/api/org/units?asOf=${y + 2}-01-01`, { headers: await as('org-admin') }),
      200,
      OrgUnitList,
    );
    expect(later.items.map((u) => u.id)).not.toContain(dept.id);
  });

  test('hierarchy rules: parent kinds, cycles and duplicate codes', async ({ request }) => {
    const y = futureYear();
    const t = tag();
    await expectProblem(
      await request.post('/api/org/units', {
        headers: await mutate('org-admin'),
        data: {
          code: `T-${t}-BAD`,
          name: 'Team under a region',
          kind: 'team',
          parentId: U.india,
          effectiveFrom: `${y}-01-01`,
        },
      }),
      422,
      'ORG_HIERARCHY_INVALID',
    );
    await expectProblem(
      await request.post('/api/org/units', {
        headers: await mutate('org-admin'),
        data: {
          code: 'BLR',
          name: 'Duplicate',
          kind: 'team',
          parentId: O.blrEng,
          effectiveFrom: `${y}-01-01`,
        },
      }),
      409,
      'DUPLICATE_CODE',
    );
    const a = await createUnit(request, {
      code: `T-${t}-A`,
      name: `Scenario A ${t}`,
      kind: 'department',
      parentId: U.berlin,
      effectiveFrom: `${y}-01-01`,
    });
    const b = await createUnit(request, {
      code: `T-${t}-B`,
      name: `Scenario B ${t}`,
      kind: 'department',
      parentId: a.id,
      effectiveFrom: `${y}-01-01`,
    });
    await expectProblem(
      await request.post(`/api/org/units/${a.id}/changes`, {
        headers: await mutate('org-admin'),
        data: { effectiveFrom: `${y}-03-01`, parentId: b.id, reason: 'Cycle' },
      }),
      422,
      'ORG_HIERARCHY_INVALID',
    );
  });

  test('an idempotent replay creates the unit once', async ({ request }) => {
    const y = futureYear();
    const t = tag();
    const key = randomUUID();
    const body = {
      code: `T-${t}-IDEM`,
      name: `Idempotent ${t}`,
      kind: 'team',
      parentId: O.hydEng,
      effectiveFrom: `${y}-01-01`,
    };
    const first = await request.post('/api/org/units', {
      headers: await mutate('org-admin', key),
      data: body,
    });
    const again = await request.post('/api/org/units', {
      headers: await mutate('org-admin', key),
      data: body,
    });
    const a = await expectContract(first, 201, OrgUnitDetail);
    const b = await expectContract(again, 201, OrgUnitDetail);
    expect(b.id).toBe(a.id);
    expect(again.headers()['idempotent-replayed']).toBe('true');
  });

  test('cost centers deactivate from a date and read back as of it', async ({ request }) => {
    const y = futureYear();
    const t = tag();
    const cc = await expectContract(
      await request.post('/api/org/cost-centers', {
        headers: await mutate('finance-admin'),
        data: {
          code: `CC-T-${t}`,
          name: `Scenario cost center ${t}`,
          legalEntityId: SEED.legalEntities.acmeIndia,
          orgUnitId: U.hyderabad,
          effectiveFrom: `${y}-01-01`,
        },
      }),
      201,
      CostCenter,
    );
    expect(cc.legalEntityCode).toBe('HYL-IN');
    const closed = await expectContract(
      await request.post(`/api/org/cost-centers/${cc.id}/changes`, {
        headers: await mutate('org-admin'),
        data: { deactivateFrom: `${y}-07-01`, reason: 'Merged into Hyderabad office' },
      }),
      201,
      CostCenter,
    );
    expect(closed.validTo).toBe(`${y}-06-30`);
    const read = async (asOf: string) =>
      (
        await expectContract(
          await request.get(`/api/org/cost-centers?asOf=${asOf}`, {
            headers: await as('employee'),
          }),
          200,
          CostCenterList,
        )
      ).items.find((c) => c.id === cc.id)!;
    expect((await read(`${y}-06-30`)).active).toBe(true);
    expect((await read(`${y}-07-01`)).active).toBe(false);
    await expectProblem(
      await request.post('/api/org/cost-centers', {
        headers: await mutate('regional-manager'),
        data: {
          code: `CC-T-${t}-X`,
          name: 'x',
          legalEntityId: SEED.legalEntities.acmeIndia,
          effectiveFrom: `${y}-01-01`,
        },
      }),
      403,
      'FORBIDDEN',
    );
  });

  test('a reporting-line change closes the current line the day before', async ({ request }) => {
    const y = futureYear();
    const person = ORG_SEED.people.lena;
    const res = await request.post(`/api/org/people/${person}/reporting-lines`, {
      headers: await mutate('org-admin'),
      data: {
        managerPersonId: userById('finance-controller').personId,
        effectiveFrom: `${y}-04-01`,
        reason: 'Matrix to finance',
      },
    });
    // Repeated runs move the line further out each time; earlier runs' later lines refuse earlier dates.
    if (res.status() === 409) return expectProblem(res, 409, 'EFFECTIVE_DATE_CONFLICT');
    const after = await expectContract(res, 201, PersonDetail);
    expect(after.managerPersonId).toBe(userById('finance-controller').personId);
    expect(after.reportingLines[0]).toMatchObject({
      validFrom: `${y}-04-01`,
      validTo: null,
      kind: 'solid',
    });
    expect(after.reportingLines[1].validTo).toBe(`${y}-03-31`);
    const today = await expectContract(
      await request.get(`/api/org/people/${person}`, { headers: await as('org-admin') }),
      200,
      PersonDetail,
    );
    expect(today.managerPersonId).toBe(userById('department-head').personId);
  });

  test('reporting loops are refused', async ({ request }) => {
    // Deepika reports to the India regional manager (no scenario changes that line).
    await expectProblem(
      await request.post(
        `/api/org/people/${userById('regional-manager').personId}/reporting-lines`,
        {
          headers: await mutate('org-admin'),
          data: {
            managerPersonId: ORG_SEED.people.deepika,
            effectiveFrom: `${futureYear()}-01-01`,
            reason: 'Loop',
          },
        },
      ),
      422,
      'ORG_HIERARCHY_INVALID',
    );
    await expectProblem(
      await request.post(`/api/org/people/${ORG_SEED.people.deepika}/reporting-lines`, {
        headers: await mutate('org-admin'),
        data: {
          managerPersonId: ORG_SEED.people.deepika,
          effectiveFrom: `${futureYear()}-01-01`,
          reason: 'Self',
        },
      }),
      422,
      'ORG_HIERARCHY_INVALID',
    );
  });

  test('category-to-GL mappings are effective-dated per entity and attendee type', async ({
    request,
  }) => {
    const y = futureYear();
    const t = tag();
    const le = await request.post('/api/finance/gl-accounts', {
      headers: await mutate('finance-admin'),
      data: {
        legalEntityId: SEED.legalEntities.acmeEurope,
        code: `T${t}`,
        name: `Scenario account ${t}`,
        accountType: 'expense',
      },
    });
    const account = (await le.json()) as { id: string };
    expect(le.status()).toBe(201);
    const current = await expectContract(
      await request.get(`/api/finance/gl-mappings?legalEntityId=${SEED.legalEntities.acmeEurope}`, {
        headers: await as('finance-admin'),
      }),
      200,
      GlMappingList,
    );
    const wellbeing = current.items.find(
      (m) => m.categoryCode === 'wellbeing' && m.attendeeType === 'employee',
    )!;
    expect(wellbeing.glAccountCode).toBe('6110');
    const client = current.items.find(
      (m) => m.categoryCode === 'employee_events' && m.attendeeType === 'client',
    )!;
    expect(client.glAccountCode).toBe('6200');
    const res = await request.post('/api/finance/gl-mappings', {
      headers: await mutate('finance-admin'),
      data: {
        legalEntityId: SEED.legalEntities.acmeEurope,
        categoryCode: 'wellbeing',
        attendeeType: 'employee',
        glAccountId: account.id,
        effectiveFrom: `${y}-01-01`,
      },
    });
    if (res.status() === 409) return expectProblem(res, 409, 'EFFECTIVE_DATE_CONFLICT');
    const mapped = await expectContract(res, 201, GlMapping);
    expect(mapped.validFrom).toBe(`${y}-01-01`);
    const at = async (asOf: string) =>
      (
        await expectContract(
          await request.get(
            `/api/finance/gl-mappings?legalEntityId=${SEED.legalEntities.acmeEurope}&asOf=${asOf}`,
            {
              headers: await as('analyst'),
            },
          ),
          200,
          GlMappingList,
        )
      ).items.find((m) => m.categoryCode === 'wellbeing' && m.attendeeType === 'employee')!;
    expect((await at(`${y}-01-01`)).glAccountId).toBe(account.id);
    expect((await at(`${y - 1}-12-31`)).glAccountId).not.toBe(account.id);
    await expectProblem(
      await request.post('/api/finance/gl-mappings', {
        headers: await mutate('finance-admin'),
        data: {
          legalEntityId: SEED.legalEntities.acmeUs,
          categoryCode: 'wellbeing',
          attendeeType: 'employee',
          glAccountId: account.id,
          effectiveFrom: `${y}-01-01`,
        },
      }),
      422,
      'VALIDATION_FAILED',
    );
  });
});
