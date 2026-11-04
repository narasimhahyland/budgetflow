// HR headcount import (Phase 3): validate as a dry run, apply, and counts refresh by location and team
// against the previous snapshot. The org hierarchy CSV import plans creates, renames and moves and applies
// them from one date. Invalid files import nothing. Scenario snapshots are dated in the future.
import { expect, test } from '@playwright/test';
import {
  HeadcountImportResult,
  HeadcountSnapshotList,
  HeadcountSummary,
  OrgImportResult,
  OrgUnitList,
} from '@bf/contracts';
import { ORG_SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

const futureDate = () => {
  const d = new Date(
    Date.UTC(2100 + Math.floor(Math.random() * 700), Math.floor(Math.random() * 12), 1),
  );
  return d.toISOString().slice(0, 10);
};

const HEADCOUNT_CSV = [
  'location_code,team_code,employment_type,headcount,prorated_headcount',
  'BLR,BLR-ENG-PLAT,employee,50,49.5',
  'BLR,BLR-ENG-CS,employee,40,',
  'BLR,,contractor,7,6.25',
  'HYD,HYD-ENG-QE,intern,8,5',
  'LON,LON-SALES,employee,20,20',
].join('\n');

test.describe('HR headcount import', () => {
  test('a dry run reports every bad line and saves nothing', async ({ request }) => {
    const asOfDate = futureDate();
    const bad = [
      'location_code,team_code,employment_type,headcount,prorated_headcount',
      'XXX,,employee,10,',
      'BLR,HYD-ENG-QE,employee,5,',
      'HYD,,freelancer,3,',
      'HYD,,employee,-2,',
      'HYD,,employee,4,4.5',
      'BLR,BLR-ENG-PLAT,employee,10,',
      'BLR,BLR-ENG-PLAT,employee,11,',
    ].join('\n');
    const dry = await expectContract(
      await request.post('/api/org/headcount/imports', {
        headers: await mutate('org-admin'),
        data: { csv: bad, asOfDate, dryRun: true },
      }),
      201,
      HeadcountImportResult,
    );
    expect(dry.accepted).toBe(false);
    expect(dry.snapshotId).toBeNull();
    expect(dry.issues.map((i) => [i.line, i.field])).toEqual([
      [2, 'location_code'],
      [3, 'team_code'],
      [4, 'employment_type'],
      [5, 'headcount'],
      [6, 'prorated_headcount'],
      [8, null],
    ]);
    // Applying the same file is refused with the issues as field errors.
    const p = await expectProblem(
      await request.post('/api/org/headcount/imports', {
        headers: await mutate('org-admin'),
        data: { csv: bad, asOfDate },
      }),
      422,
      'IMPORT_INVALID',
    );
    expect(p.errors?.[0]).toEqual({
      path: 'line 2.location_code',
      message: expect.stringContaining('XXX'),
    });
    const summary = await expectContract(
      await request.get(`/api/org/headcount?asOf=${asOfDate}`, { headers: await as('org-admin') }),
      200,
      HeadcountSummary,
    );
    expect(summary.snapshot?.asOfDate).not.toBe(asOfDate);
    await expectProblem(
      await request.post('/api/org/headcount/imports', {
        headers: await mutate('org-admin'),
        data: { csv: 'team_code,headcount\nX,1', asOfDate, dryRun: true },
      }),
      422,
      'IMPORT_INVALID',
    );
  });

  test('applying a file refreshes counts by location and team against the previous snapshot', async ({
    request,
  }) => {
    const asOfDate = futureDate();
    const dry = await expectContract(
      await request.post('/api/org/headcount/imports', {
        headers: await mutate('finance-admin'),
        data: { csv: HEADCOUNT_CSV, asOfDate, dryRun: true, fileName: 'hr-headcount.csv' },
      }),
      201,
      HeadcountImportResult,
    );
    expect(dry).toMatchObject({
      accepted: true,
      dryRun: true,
      snapshotId: null,
      lineCount: 5,
      totalHeadcount: 125,
    });
    const applied = await expectContract(
      await request.post('/api/org/headcount/imports', {
        headers: await mutate('org-admin'),
        data: { csv: HEADCOUNT_CSV, asOfDate, fileName: 'hr-headcount.csv' },
      }),
      201,
      HeadcountImportResult,
    );
    expect(applied.accepted).toBe(true);
    expect(applied.snapshotId).not.toBeNull();
    const platform = applied.units.find((u) => u.code === 'BLR-ENG-PLAT')!;
    expect(platform).toMatchObject({ headcount: 50, proratedHeadcountMilli: 49_500 });
    const summary = await expectContract(
      await request.get(`/api/org/headcount?asOf=${asOfDate}`, { headers: await as('org-admin') }),
      200,
      HeadcountSummary,
    );
    expect(summary.snapshot?.id).toBe(applied.snapshotId);
    expect(summary.total).toBe(125);
    const blr = summary.locations.find((l) => l.code === 'BLR')!;
    expect(blr).toMatchObject({
      headcount: 97,
      byType: { employee: 90, contractor: 7, intern: 0 },
    });
    expect(blr.proratedHeadcountMilli).toBe(49_500 + 40_000 + 6_250);
    expect(blr.teams.find((t) => t.code === 'BLR-ENG-PLAT')).toMatchObject({ headcount: 50 });
    expect(blr.previousHeadcount).not.toBeNull();
    expect(summary.locations.find((l) => l.code === 'HYD')).toMatchObject({
      headcount: 8,
      byType: { intern: 8 },
    });
    // Today's view is unchanged: the seeded refresh of 1 Nov 2026 still applies.
    const today = await expectContract(
      await request.get(`/api/org/headcount?asOf=${ORG_SEED.headcountAsOf}`, {
        headers: await as('org-admin'),
      }),
      200,
      HeadcountSummary,
    );
    expect(today.locations.find((l) => l.code === 'BLR')!.headcount).toBe(
      ORG_SEED.bengaluruHeadcount,
    );
    const snapshots = await expectContract(
      await request.get('/api/org/headcount/snapshots', { headers: await as('finance-admin') }),
      200,
      HeadcountSnapshotList,
    );
    expect(snapshots.items.find((s) => s.id === applied.snapshotId)).toMatchObject({
      totalHeadcount: 125,
      lineCount: 5,
    });
  });
});

test.describe('org hierarchy import', () => {
  test('a dry run plans creates, renames and moves; applying them takes effect from the date', async ({
    request,
  }) => {
    const effectiveFrom = futureDate();
    const t = randomUUID().slice(0, 6).toUpperCase();
    const csv = [
      'code,name,kind,parent_code,legal_entity_code,timezone',
      `T-${t}-OPS,Scenario operations ${t},department,WLK,HYL-US,America/New_York`,
      `T-${t}-OPS-A,Scenario ops team ${t},team,T-${t}-OPS,,`,
      'HYD,Hyderabad,location,IN,,',
    ].join('\n');
    const dry = await expectContract(
      await request.post('/api/org/imports', {
        headers: await mutate('org-admin'),
        data: { csv, effectiveFrom, dryRun: true },
      }),
      201,
      OrgImportResult,
    );
    expect(dry).toMatchObject({ accepted: true, created: 2, changed: 0, unchanged: 1 });
    expect(dry.operations.map((o) => [o.op, o.code])).toEqual([
      ['create', `T-${t}-OPS`],
      ['create', `T-${t}-OPS-A`],
      ['unchanged', 'HYD'],
    ]);
    const applied = await expectContract(
      await request.post('/api/org/imports', {
        headers: await mutate('org-admin'),
        data: { csv, effectiveFrom, reason: 'Scenario import' },
      }),
      201,
      OrgImportResult,
    );
    expect(applied.created).toBe(2);
    const at = await expectContract(
      await request.get(`/api/org/units?asOf=${effectiveFrom}`, { headers: await as('org-admin') }),
      200,
      OrgUnitList,
    );
    const ops = at.items.find((u) => u.code === `T-${t}-OPS`)!;
    const team = at.items.find((u) => u.code === `T-${t}-OPS-A`)!;
    expect(team.parentId).toBe(ops.id);
    expect(team.legalEntityId).toBe(ORG_SEED.entities.us);
    // A second file renames and moves the imported team from a later date.
    const later = `${Number(effectiveFrom.slice(0, 4)) + 1}-01-01`;
    const change = await expectContract(
      await request.post('/api/org/imports', {
        headers: await mutate('org-admin'),
        data: {
          csv: `code,name,kind,parent_code\nT-${t}-OPS-A,Renamed ops team ${t},team,WLK-FIN`,
          effectiveFrom: later,
        },
      }),
      201,
      OrgImportResult,
    );
    expect(change.changed).toBe(1);
    const moved = await expectContract(
      await request.get(`/api/org/units?asOf=${later}`, { headers: await as('org-admin') }),
      200,
      OrgUnitList,
    );
    expect(moved.items.find((u) => u.code === `T-${t}-OPS-A`)).toMatchObject({
      name: `Renamed ops team ${t}`,
      parentId: ORG_SEED.units.wlkFinance,
    });
  });

  test('invalid files import nothing and name each problem', async ({ request }) => {
    const effectiveFrom = futureDate();
    const t = randomUUID().slice(0, 6).toUpperCase();
    const csv = [
      'code,name,kind,parent_code,legal_entity_code',
      `T-${t}-X,Team under region,team,IN,`,
      `T-${t}-Y,Unknown parent,department,NOPE,`,
      `T-${t}-Z,Bad entity,department,BLR,HYL-ZZ`,
      'BLR,Bengaluru,department,IN,',
      `T-${t}-OK,Fine,department,BLR,`,
    ].join('\n');
    const dry = await expectContract(
      await request.post('/api/org/imports', {
        headers: await mutate('org-admin'),
        data: { csv, effectiveFrom, dryRun: true },
      }),
      201,
      OrgImportResult,
    );
    expect(dry.accepted).toBe(false);
    expect(dry.issues.map((i) => i.line)).toEqual([2, 3, 4, 5]);
    await expectProblem(
      await request.post('/api/org/imports', {
        headers: await mutate('org-admin'),
        data: { csv, effectiveFrom },
      }),
      422,
      'IMPORT_INVALID',
    );
    const at = await expectContract(
      await request.get(`/api/org/units?asOf=${effectiveFrom}`, { headers: await as('org-admin') }),
      200,
      OrgUnitList,
    );
    expect(at.items.map((u) => u.code)).not.toContain(`T-${t}-OK`);
    await expectProblem(
      await request.post('/api/org/imports', {
        headers: await mutate('finance-admin'),
        data: {
          csv: `code,name,kind,parent_code\nT-${t}-F,F,team,BLR-ENG`,
          effectiveFrom,
          dryRun: true,
        },
      }),
      403,
      'FORBIDDEN',
    );
  });
});
