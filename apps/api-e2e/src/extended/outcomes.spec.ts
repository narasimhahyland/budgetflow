// Invariant 85: outcome linkage and participation rankings describe groups, never people. Survey
// figures need five responses and retention figures ten people; below that the value is dropped
// rather than shown, no response or employment date is ever returned, and no money is read at all.
import { expect, test } from '@playwright/test';
import { OutcomeLinkage, ParticipationLeaderboard } from '@bf/contracts';
import { as } from '../support/auth';
import { expectContract } from '../support/contract';

const outcomes = async (
  request: import('@playwright/test').APIRequestContext,
  user: 'ceo' | 'org-admin' | 'finance-admin' | 'analyst' | 'regional-manager' | 'employee',
) => request.get('/api/insights/outcomes', { headers: await as(user) });

test.describe('outcome linkage never exposes an individual', () => {
  test('figures come with their group size and the thresholds that were applied', async ({
    request,
  }) => {
    const body = await expectContract(await outcomes(request, 'ceo'), 200, OutcomeLinkage);
    expect(body.thresholds).toEqual({ surveyResponses: 5, retentionGroup: 10 });
    expect(body.associationNote).toContain('association, not cause');

    for (const figure of [body.averagePulse, body.enps]) {
      // Either the figure is backed by at least five responses, or it is suppressed outright. There
      // is no middle state where a small group is rounded or blurred into something readable.
      expect(figure.suppressed === figure.groupSize < 5).toBe(true);
      if (figure.suppressed) expect(figure.valueMilli).toBeNull();
    }
    for (const row of body.categories) {
      expect(row.pulse.groupSize).toBe(row.responseCount);
      expect(row.pulse.suppressed === row.responseCount < 5).toBe(true);
      expect(row.pulse.suppressed ? row.pulse.valueMilli === null : true).toBe(true);
    }
  });

  test('retention is reported per cohort with its size, and suppressed under ten people', async ({
    request,
  }) => {
    const body = await expectContract(await outcomes(request, 'ceo'), 200, OutcomeLinkage);
    expect(body.retentionAvailable).toBe(true);
    expect(body.retentionBands.map((b) => b.band)).toEqual(['none', 'one_to_two', 'three_or_more']);
    for (const band of body.retentionBands) {
      expect(band.bandLabel).toMatch(/\d+ people\)$/);
      expect(band.retention.suppressed === band.retention.groupSize < 10).toBe(true);
      if (band.retention.suppressed) expect(band.retention.valueMilli).toBeNull();
    }
  });

  test('the response carries no person, response or employment record of any kind', async ({
    request,
  }) => {
    const raw = await (await outcomes(request, 'ceo')).text();
    // A reader must not be able to walk back from the aggregate to a person. The response has no
    // person ids, no names, no respondent tokens and no dates of employment to join on.
    for (const forbidden of ['personId', 'respondent', 'displayName', 'endDate', 'startDate'])
      expect(raw, `the outcomes response must not contain ${forbidden}`).not.toContain(forbidden);
    // And the schema itself has no per-person array to fill: the strict contract would reject one.
    const body = OutcomeLinkage.parse(JSON.parse(raw));
    expect(Object.keys(body)).not.toContain('people');
  });

  test('a regional manager sees pulse and eNPS but no retention', async ({ request }) => {
    const body = await expectContract(
      await outcomes(request, 'regional-manager'),
      200,
      OutcomeLinkage,
    );
    expect(body.retentionAvailable).toBe(false);
    expect(body.retentionBands).toEqual([]);
    expect(body.thresholds.surveyResponses).toBe(5);
  });

  test('an employee cannot read the outcomes view at all', async ({ request }) => {
    const res = await outcomes(request, 'employee');
    expect([403, 404]).toContain(res.status());
  });
});

test.describe('participation rankings reward turnout, never spending', () => {
  test('offices and teams are ranked by turnout and small groups are not ranked', async ({
    request,
  }) => {
    const body = await expectContract(
      await request.get('/api/insights/participation-leaderboard?period=year', {
        headers: await as('employee'),
      }),
      200,
      ParticipationLeaderboard,
    );
    expect(body.minimumGroupSize).toBe(5);
    expect(body.note).toContain('Spending never counts');
    for (const row of [...body.locations, ...body.teams]) {
      expect(row.ranked === row.eligibleHeadcount >= 5).toBe(true);
      // A group too small to rank gets no number and says why, rather than appearing at the bottom.
      expect(row.ranked ? row.rank !== null : row.rank === null).toBe(true);
      expect(row.ranked ? row.notRankedReason === null : row.notRankedReason !== null).toBe(true);
      expect(row.ranked ? true : row.turnoutBps === null).toBe(true);
    }
    const ranked = body.locations.filter((r) => r.ranked);
    expect(ranked.map((r) => r.rank)).toEqual(ranked.map((_, i) => i + 1));
  });

  test('no money appears anywhere in the ranking', async ({ request }) => {
    const raw = await (
      await request.get('/api/insights/participation-leaderboard', {
        headers: await as('employee'),
      })
    ).text();
    for (const forbidden of ['amountMinor', 'currency', 'authorized', 'spend'])
      expect(raw, `the leaderboard must not contain ${forbidden}`).not.toContain(forbidden);
  });

  test('turnout is ordered deterministically, highest first then by name', async ({ request }) => {
    const first = await expectContract(
      await request.get('/api/insights/participation-leaderboard?period=quarter', {
        headers: await as('employee'),
      }),
      200,
      ParticipationLeaderboard,
    );
    const second = await expectContract(
      await request.get('/api/insights/participation-leaderboard?period=quarter', {
        headers: await as('employee'),
      }),
      200,
      ParticipationLeaderboard,
    );
    expect(second.locations.map((r) => r.orgUnitId)).toEqual(
      first.locations.map((r) => r.orgUnitId),
    );
    const turnouts = first.locations.filter((r) => r.ranked).map((r) => r.turnoutBps ?? 0);
    expect([...turnouts].sort((a, b) => b - a)).toEqual(turnouts);
  });
});
