// Reclaim and redistribute campaigns (086a), gap B4. Finance asks owners to release money forecast
// to lapse; an owner releases all, part, or keeps it with a reason and plan; after the deadline an
// unanswered notice goes to the parent owner, never automatically. Released money moves per legal
// entity pool as reductions with a destination (a target, or back to each source's parent), floored
// at allocated out + held + encumbered + actual, in one idempotent command with one audit entry.
//
// Each scenario builds its own tree through the API. A campaign takes every candidate in the
// tenant, so assertions only ever look at the notices of budgets the scenario created (by id).
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ReclaimCampaignDetail,
  ReclaimReminderRun,
  ReclaimCandidateList,
  ReclaimExecution,
  ReclaimNotice,
  ReclaimNoticeList,
  ReclaimPoolPreview,
} from '@bf/contracts';
import { RECLAIM_IDS, SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { daysFromToday, todayUtc } from '../support/clock';
import { expectContract, expectProblem } from '../support/contract';
import { allocateOk, createChild, createRoot } from '../support/factory';
import { asOwner } from '../support/db';
import { bal, budget, openingBalance, rebuildCheck, USD } from '../budgets/p4';

const CRITERIA = {
  minUnusedBps: 2_000,
  minUnused: { amountMinor: 100_000, currency: 'USD' },
  maxDaysLeft: 90,
};

async function campaignBody(name: string) {
  return {
    name,
    fiscalYearId: SEED.fiscalYears.acmeFy2026,
    criteria: CRITERIA,
    respondBy: todayUtc(),
  };
}

/** A root, a parent owned by the department head, three sources owned by the budget owner and a target. */
async function reclaimTree(request: APIRequestContext) {
  const root = await createRoot(request, { amountMinor: 10_000_000 });
  const parent = await createChild(request, root.id, {
    currency: 'USD',
    owner: 'department-head',
    as: 'finance-admin',
  });
  await allocateOk(request, root.id, parent.id, USD(6_000_000), { as: 'finance-admin' });
  const make = async (owner: 'budget-owner' | 'regional-manager', minor: number) => {
    const b = await createChild(request, parent.id, {
      currency: 'USD',
      owner,
      as: 'finance-admin',
    });
    await allocateOk(request, parent.id, b.id, USD(minor), { as: 'finance-admin' });
    return b;
  };
  const a = await make('budget-owner', 1_000_000);
  const b = await make('budget-owner', 500_000);
  const c = await make('budget-owner', 400_000);
  const target = await make('regional-manager', 200_000);
  // A: USD 2,000.00 committed and USD 1,000.00 spent. B: USD 500.00 spent. Target: spending fast,
  // so its run-rate forecast is above its budget and it shows up as a suggested target.
  await openingBalance(request, a.id, 'encumbered', 200_000);
  await openingBalance(request, a.id, 'actual', 100_000);
  await openingBalance(request, b.id, 'actual', 50_000);
  await openingBalance(request, target.id, 'actual', 195_000);
  return { root, parent, a, b, c, target };
}

async function notices(request: APIRequestContext, campaignId: string) {
  return expectContract(
    await request.get(`/api/reclaim/campaigns/${campaignId}`, {
      headers: await as('finance-admin'),
    }),
    200,
    ReclaimCampaignDetail,
  );
}

const noticeFor = (d: ReclaimCampaignDetail, budgetId: string) => {
  const n = d.notices.find((x) => x.budgetId === budgetId);
  expect(n, `notice for ${budgetId}`).toBeDefined();
  return n!;
};

async function respond(
  request: APIRequestContext,
  noticeId: string,
  data: Record<string, unknown>,
  user: Parameters<typeof mutate>[0] = 'budget-owner',
  key?: string,
) {
  return request.post(`/api/reclaim/notices/${noticeId}/response`, {
    headers: await mutate(user, key),
    data,
  });
}

async function auditCount(resourceId: string, action: string) {
  return asOwner(async (c) =>
    Number(
      (
        await c.query<{ n: string }>(
          'select count(*)::text as n from audit_events where resource_id = $1 and action = $2',
          [resourceId, action],
        )
      ).rows[0].n,
    ),
  );
}

test.describe('reclaim and redistribute campaigns (086a)', () => {
  test('offers, owner release (full, part, keep), the floor at its exact boundary, and the money landing at its destination', async ({
    request,
  }) => {
    const t = await reclaimTree(request);

    // Preview: the forecast of what lapses, proposed never past the floor. Nothing is written.
    const preview = await expectContract(
      await request.post('/api/reclaim/campaigns/preview', {
        headers: await as('finance-admin'),
        data: await campaignBody('Scenario preview'),
      }),
      200,
      ReclaimCandidateList,
    );
    const pa = preview.items.find((i) => i.budgetId === t.a.id)!;
    expect(pa, 'A is a candidate').toBeDefined();
    // A: authorized 10,000.00, floor = encumbered 2,000.00 + actual 1,000.00, so at most 7,000.00.
    expect(pa.floor).toEqual(USD(300_000));
    expect(pa.maxReclaimable).toEqual(USD(700_000));
    expect(pa.proposed.amountMinor).toBeLessThanOrEqual(700_000);
    expect(preview.items.some((i) => i.budgetId === t.target.id)).toBe(false);
    // An owner cannot start a campaign.
    await expectProblem(
      await request.post('/api/reclaim/campaigns/preview', {
        headers: await as('budget-owner'),
        data: await campaignBody('Owner preview'),
      }),
      403,
      'FORBIDDEN',
    );

    // Start: one notice per candidate, one audit entry for the whole campaign.
    const createKey = randomUUID();
    const created = await expectContract(
      await request.post('/api/reclaim/campaigns', {
        headers: await mutate('finance-admin', createKey),
        data: await campaignBody(`Scenario reclaim ${createKey.slice(0, 6)}`),
      }),
      201,
      ReclaimCampaignDetail,
    );
    const campaignId = created.campaign.id;
    expect(created.campaign.status).toBe('collecting');
    const na = noticeFor(created, t.a.id);
    const nb = noticeFor(created, t.b.id);
    const nc = noticeFor(created, t.c.id);
    expect(na.status).toBe('sent');
    expect(na.proposed).toEqual(pa.proposed);
    expect(await auditCount(campaignId, 'reclaim.campaign_started')).toBe(1);
    // Nothing moved yet: starting a campaign never touches money.
    expect(bal(await budget(request, t.a.id)).authorized).toBe(1_000_000);

    // The owner sees their notice; another owner cannot; finance cannot answer for the owner.
    const mine = await expectContract(
      await request.get('/api/reclaim/notices', { headers: await as('budget-owner') }),
      200,
      ReclaimNoticeList,
    );
    expect(mine.items.some((n) => n.id === na.id && n.canRespond)).toBe(true);
    await expectProblem(
      await request.get(`/api/reclaim/notices/${na.id}`, { headers: await as('location-manager') }),
      404,
      'NOT_FOUND',
    );
    await expectProblem(
      await respond(request, na.id, { choice: 'release_all' }, 'finance-admin'),
      403,
      'FORBIDDEN',
    );

    // A commitment lands after the campaign started: the floor rises by USD 500.00 to 3,500.00,
    // so at most 6,500.00 can be reclaimed now.
    await openingBalance(request, t.a.id, 'encumbered', 50_000);
    const proposedA = na.proposed.amountMinor;
    expect(proposedA).toBeGreaterThan(650_000);
    const below = await expectProblem(
      await respond(request, na.id, { choice: 'release_all' }),
      409,
      'REDUCTION_BELOW_FLOOR',
    );
    expect(below.detail).toBe(
      'At most USD 6,500.00 can be reclaimed (floor: committed + actual + children).',
    );
    // One minor unit above the floor is refused; exactly at it is accepted.
    await expectProblem(
      await respond(request, na.id, { choice: 'release_part', amountMinor: 650_001 }),
      409,
      'REDUCTION_BELOW_FLOOR',
    );
    const partKey = randomUUID();
    const part = await expectContract(
      await respond(
        request,
        na.id,
        { choice: 'release_part', amountMinor: 650_000, reason: 'the January kickoff' },
        'budget-owner',
        partKey,
      ),
      200,
      ReclaimNotice,
    );
    expect(part.status).toBe('released');
    expect(part.released).toEqual(USD(650_000));
    expect(part.kept).toEqual(USD(proposedA - 650_000));
    // A replay returns the first answer and records nothing more.
    const replay = await respond(
      request,
      na.id,
      { choice: 'release_part', amountMinor: 650_000, reason: 'the January kickoff' },
      'budget-owner',
      partKey,
    );
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect((await expectContract(replay, 200, ReclaimNotice)).released).toEqual(USD(650_000));
    expect(await auditCount(na.id, 'reclaim.responded')).toBe(1);
    // Answered once: a second, different answer is refused.
    await expectProblem(
      await respond(request, na.id, { choice: 'release_all' }),
      409,
      'RECLAIM_NOTICE_ANSWERED',
    );

    // B releases everything proposed.
    const full = await expectContract(
      await respond(request, nb.id, { choice: 'release_all' }),
      200,
      ReclaimNotice,
    );
    expect(full.released).toEqual(nb.proposed);

    // C keeps it: a reason and a plan are required, and nothing is reclaimed.
    await expectProblem(
      await respond(request, nc.id, { choice: 'keep', reason: 'Offsite' }),
      422,
      'REASON_REQUIRED',
    );
    const kept = await expectContract(
      await respond(request, nc.id, {
        choice: 'keep',
        reason: 'Committed offsite',
        plan: 'Team offsite 4-5 Dec, quote selected',
      }),
      200,
      ReclaimNotice,
    );
    expect(kept.status).toBe('kept');
    expect(kept.released).toEqual(USD(0));

    // Redistribute the HYL-US pool: USD 1,000.00 to the target, the rest back to the parent.
    const detail = await notices(request, campaignId);
    const pool = detail.pools.find((p) => p.legalEntityId === SEED.legalEntities.acmeUs)!;
    expect(pool, 'HYL-US pool').toBeDefined();
    const released = 650_000 + nb.proposed.amountMinor;
    // The pool holds only what was released; other notices in the tenant are still unanswered.
    expect(pool.released).toEqual(USD(released));
    expect(pool.suggestedTargets.some((s) => s.budgetId === t.target.id)).toBe(true);
    const targets = [{ budgetId: t.target.id, amountMinor: 100_000 }];
    const poolBody = { legalEntityId: SEED.legalEntities.acmeUs, currency: 'USD', targets };
    // A target in another legal entity is refused: money stays within its entity.
    await expectProblem(
      await request.post(`/api/reclaim/campaigns/${campaignId}/pools/preview`, {
        headers: await as('finance-admin'),
        data: { ...poolBody, targets: [{ budgetId: SEED.budgets.hyderabad, amountMinor: 100 }] },
      }),
      422,
      'TRANSFER_INVALID',
    );
    const impact = await expectContract(
      await request.post(`/api/reclaim/campaigns/${campaignId}/pools/preview`, {
        headers: await as('finance-admin'),
        data: poolBody,
      }),
      200,
      ReclaimPoolPreview,
    );
    expect(impact.allocated).toEqual(USD(100_000));
    expect(impact.remainder).toEqual(USD(released - 100_000));
    expect(impact.canConfirm).toBe(true);
    const ia = impact.sources.find((s) => s.budgetId === t.a.id)!;
    expect(ia.floor).toEqual(USD(350_000));
    expect(ia.authorizedAfter).toEqual(USD(350_000));
    expect(ia.withinFloor).toBe(true);
    // Only the Finance Admin redistributes.
    await expectProblem(
      await request.post(`/api/reclaim/campaigns/${campaignId}/pools/execution`, {
        headers: await mutate('ceo'),
        data: {
          ...poolBody,
          reasonCode: 'RED-YEAR-END-RECLAIM',
          reason: 'Year-end reclaim',
          confirmedFloors: impact.sources.map((s) => ({
            budgetId: s.budgetId,
            floorMinor: s.floor.amountMinor,
          })),
        },
      }),
      403,
      'FORBIDDEN',
    );
    // A stale confirmed floor posts nothing.
    await expectProblem(
      await request.post(`/api/reclaim/campaigns/${campaignId}/pools/execution`, {
        headers: await mutate('finance-admin'),
        data: {
          ...poolBody,
          reasonCode: 'RED-YEAR-END-RECLAIM',
          reason: 'Year-end reclaim',
          confirmedFloors: impact.sources.map((s) => ({
            budgetId: s.budgetId,
            floorMinor: s.floor.amountMinor + 1,
          })),
        },
      }),
      422,
      'IMPACT_PREVIEW_REQUIRED',
    );
    expect(bal(await budget(request, t.a.id)).authorized).toBe(1_000_000);

    const parentBefore = bal(await budget(request, t.parent.id));
    const execKey = randomUUID();
    const execBody = {
      ...poolBody,
      reasonCode: 'RED-YEAR-END-RECLAIM',
      reason: 'Year-end reclaim',
      confirmedFloors: impact.sources.map((s) => ({
        budgetId: s.budgetId,
        floorMinor: s.floor.amountMinor,
      })),
    };
    const exec = await expectContract(
      await request.post(`/api/reclaim/campaigns/${campaignId}/pools/execution`, {
        headers: await mutate('finance-admin', execKey),
        data: execBody,
      }),
      201,
      ReclaimExecution,
    );
    expect(exec.pool).toEqual(USD(released));
    expect(exec.journalIds).toHaveLength(exec.legs.length);
    expect(exec.legs.reduce((s, l) => s + l.amount.amountMinor, 0)).toBe(released);
    expect(
      exec.legs
        .filter((l) => l.destination === 'reallocation')
        .every((l) => l.targetBudgetId === t.target.id),
    ).toBe(true);
    expect(
      exec.legs
        .filter((l) => l.destination === 'parent')
        .every((l) => l.targetBudgetId === t.parent.id),
    ).toBe(true);

    // The money landed: A is exactly at its floor, B gave up its release, the target gained
    // USD 1,000.00, C (kept) did not move, and the parent took the remainder back as unallocated.
    expect(bal(await budget(request, t.a.id)).authorized).toBe(350_000);
    expect(bal(await budget(request, t.b.id)).authorized).toBe(500_000 - nb.proposed.amountMinor);
    expect(bal(await budget(request, t.target.id)).authorized).toBe(300_000);
    expect(bal(await budget(request, t.c.id)).authorized).toBe(400_000);
    const parentAfter = bal(await budget(request, t.parent.id));
    expect(parentAfter.authorized).toBe(parentBefore.authorized);
    expect(parentAfter.allocatedOut).toBe(parentBefore.allocatedOut - (released - 100_000));
    // Even at the floor, A can never go lower: its money is exactly what is committed and spent.
    const aAfter = bal(await budget(request, t.a.id));
    expect(aAfter.authorized).toBe(
      aAfter.allocatedOut + aAfter.held + aAfter.encumbered + aAfter.actual,
    );

    // One audit entry for the execution; a replay posts nothing more; a second run is refused.
    expect(await auditCount(campaignId, 'reclaim.pool_executed')).toBe(1);
    const again = await request.post(`/api/reclaim/campaigns/${campaignId}/pools/execution`, {
      headers: await mutate('finance-admin', execKey),
      data: execBody,
    });
    expect(again.headers()['idempotent-replayed']).toBe('true');
    expect((await expectContract(again, 201, ReclaimExecution)).id).toBe(exec.id);
    await expectProblem(
      await request.post(`/api/reclaim/campaigns/${campaignId}/pools/execution`, {
        headers: await mutate('finance-admin'),
        data: execBody,
      }),
      409,
      'RECLAIM_POOL_EXECUTED',
    );
    expect(bal(await budget(request, t.a.id)).authorized).toBe(350_000);
    expect(await auditCount(campaignId, 'reclaim.pool_executed')).toBe(1);

    // The parent's own notice in the same pool was never answered: once the pool has moved it is
    // closed, so a late answer cannot release money nothing will ever move.
    const np = noticeFor(created, t.parent.id);
    await expectProblem(
      await respond(request, np.id, { choice: 'release_all' }, 'department-head'),
      409,
      'RECLAIM_POOL_EXECUTED',
    );
    const done = await notices(request, campaignId);
    expect(noticeFor(done, t.a.id).status).toBe('reclaimed');
    expect(noticeFor(done, t.c.id).status).toBe('kept');
    const rebuilt = await rebuildCheck(request);
    expect(rebuilt.status, JSON.stringify(rebuilt.summary)).toBe('clean');
  });

  test('before the deadline a notice cannot go to the parent owner; after it, the parent owner decides and nothing moves on its own', async ({
    request,
  }) => {
    const t = await reclaimTree(request);
    const created = await expectContract(
      await request.post('/api/reclaim/campaigns', {
        headers: await mutate('finance-admin'),
        data: await campaignBody('Scenario deadline'),
      }),
      201,
      ReclaimCampaignDetail,
    );
    const na = noticeFor(created, t.a.id);
    await expectProblem(
      await request.post(`/api/reclaim/notices/${na.id}/escalation`, {
        headers: await mutate('finance-admin'),
        data: { reason: 'No answer' },
      }),
      409,
      'RECLAIM_NOT_OVERDUE',
    );

    // The seeded Q4 campaign's responses were due 13 Nov; New York Events never answered. Its owner
    // also owns the US region, so the decision goes one level further up, to the CEO.
    const seeded = RECLAIM_IDS.noticeNewYork;
    const before = await expectContract(
      await request.get(`/api/reclaim/notices/${seeded}`, { headers: await as('finance-admin') }),
      200,
      ReclaimNotice,
    );
    expect(before.status).toBe('sent');
    expect(before.overdue).toBe(true);
    expect(before.canEscalate).toBe(true);
    const nyBefore = bal(await budget(request, before.budgetId)).authorized;
    // Only finance sends it on.
    await expectProblem(
      await request.post(`/api/reclaim/notices/${seeded}/escalation`, {
        headers: await mutate('budget-owner'),
        data: { reason: 'No answer' },
      }),
      403,
      'FORBIDDEN',
    );
    const escalated = await expectContract(
      await request.post(`/api/reclaim/notices/${seeded}/escalation`, {
        headers: await mutate('finance-admin'),
        data: { reason: 'No answer by 13 Nov' },
      }),
      200,
      ReclaimNotice,
    );
    expect(escalated.status).toBe('parent_review');
    expect(escalated.parentOwnerName).toBe('Morgan Lee');
    expect(await auditCount(seeded, 'reclaim.escalated')).toBe(1);
    // Escalating moves no money, and the owner can no longer answer it.
    expect(bal(await budget(request, before.budgetId)).authorized).toBe(nyBefore);
    await expectProblem(
      await respond(request, seeded, { choice: 'keep', reason: 'Late', plan: 'Late plan' }),
      403,
      'FORBIDDEN',
    );
    const decided = await expectContract(
      await respond(request, seeded, { choice: 'release_part', amountMinor: 160_000 }, 'ceo'),
      200,
      ReclaimNotice,
    );
    expect(decided.status).toBe('released');
    expect(decided.respondedAs).toBe('parent_owner');
    expect(decided.released).toEqual(USD(160_000));
    // Still nothing moved: money only moves when finance redistributes the pool.
    expect(bal(await budget(request, before.budgetId)).authorized).toBe(nyBefore);
  });

  test('a commitment landing between the release and the redistribution blocks the whole pool, which posts nothing', async ({
    request,
  }) => {
    const t = await reclaimTree(request);
    const created = await expectContract(
      await request.post('/api/reclaim/campaigns', {
        headers: await mutate('finance-admin'),
        data: await campaignBody('Scenario late commitment'),
      }),
      201,
      ReclaimCampaignDetail,
    );
    const na = noticeFor(created, t.a.id);
    const nb = noticeFor(created, t.b.id);
    // A releases exactly up to its floor; B releases everything proposed.
    await expectContract(
      await respond(request, na.id, { choice: 'release_part', amountMinor: 700_000 }),
      200,
      ReclaimNotice,
    );
    await expectContract(
      await respond(request, nb.id, { choice: 'release_all' }),
      200,
      ReclaimNotice,
    );
    // Then USD 0.01 more is committed on A: its release is now one minor unit above the floor.
    await openingBalance(request, t.a.id, 'encumbered', 1);
    const poolBody = { legalEntityId: SEED.legalEntities.acmeUs, currency: 'USD', targets: [] };
    const impact = await expectContract(
      await request.post(`/api/reclaim/campaigns/${created.campaign.id}/pools/preview`, {
        headers: await as('finance-admin'),
        data: poolBody,
      }),
      200,
      ReclaimPoolPreview,
    );
    expect(impact.canConfirm).toBe(false);
    expect(impact.sources.find((s) => s.budgetId === t.a.id)!.withinFloor).toBe(false);
    expect(impact.blockedReason).toContain('At most USD 6,999.99 can be reclaimed');
    const bBefore = bal(await budget(request, t.b.id)).authorized;
    await expectProblem(
      await request.post(`/api/reclaim/campaigns/${created.campaign.id}/pools/execution`, {
        headers: await mutate('finance-admin'),
        data: {
          ...poolBody,
          reasonCode: 'RED-YEAR-END-RECLAIM',
          reason: 'Year-end reclaim',
          confirmedFloors: impact.sources.map((s) => ({
            budgetId: s.budgetId,
            floorMinor: s.floor.amountMinor,
          })),
        },
      }),
      409,
      'REDUCTION_BELOW_FLOOR',
    );
    // Nothing moved for any source, and no execution was recorded.
    expect(bal(await budget(request, t.a.id)).authorized).toBe(1_000_000);
    expect(bal(await budget(request, t.b.id)).authorized).toBe(bBefore);
    expect(await auditCount(created.campaign.id, 'reclaim.pool_executed')).toBe(0);
  });

  test('deadline reminders go out 2 days and 1 day before, once each, only to owners who have not answered', async ({
    request,
  }) => {
    const t = await reclaimTree(request);
    const created = await expectContract(
      await request.post('/api/reclaim/campaigns', {
        headers: await mutate('finance-admin'),
        data: { ...(await campaignBody('Scenario reminders')), respondBy: daysFromToday(2) },
      }),
      201,
      ReclaimCampaignDetail,
    );
    const na = noticeFor(created, t.a.id);
    const nb = noticeFor(created, t.b.id);
    // B answers straight away, so it is never reminded.
    await expectContract(
      await respond(request, nb.id, { choice: 'release_all' }),
      200,
      ReclaimNotice,
    );
    const run = async (asOf?: string, user: Parameters<typeof mutate>[0] = 'finance-admin') =>
      request.post('/api/reclaim/reminder-runs', {
        headers: await mutate(user),
        data: asOf ? { asOf } : {},
      });
    await expectProblem(await run(undefined, 'budget-owner'), 403, 'FORBIDDEN');
    const reminded = async (budgetId: string) =>
      noticeFor(await notices(request, created.campaign.id), budgetId).remindersSent;

    // Two days before: the 2-day reminder.
    const first = await expectContract(await run(), 202, ReclaimReminderRun);
    expect(first.asOf).toBe(todayUtc());
    await expect
      .poll(() => reminded(t.a.id), { timeout: 30_000, intervals: [250, 500, 1000] })
      .toEqual(['two_days']);
    // Again the same day, then one day before: the 1-day reminder, and still one 2-day reminder.
    await expectContract(await run(), 202, ReclaimReminderRun);
    await expectContract(await run(daysFromToday(1)), 202, ReclaimReminderRun);
    await expect
      .poll(() => reminded(t.a.id), { timeout: 30_000, intervals: [250, 500, 1000] })
      .toEqual(['two_days', 'one_day']);
    // On the deadline nothing more is due.
    await expectContract(await run(daysFromToday(2)), 202, ReclaimReminderRun);
    const count = async (noticeId: string) =>
      asOwner(async (c) =>
        Number(
          (
            await c.query<{ n: string }>(
              'select count(*)::text as n from reclaim_reminders where notice_id = $1',
              [noticeId],
            )
          ).rows[0].n,
        ),
      );
    // Every queued run has been published and finished by the worker before counting.
    const outstanding = () =>
      asOwner(async (c) =>
        Number(
          (
            await c.query<{ n: string }>(
              `select (select count(*) from outbox_messages
                          where topic = 'reclaim.reminders' and published_at is null)
                      + (select count(*) from pgboss.job
                          where name = 'reclaim.reminders' and state not in ('completed', 'failed', 'cancelled'))
                   as n`,
            )
          ).rows[0].n,
        ),
      );
    await expect.poll(outstanding, { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(0);
    expect(await count(na.id)).toBe(2);
    expect(await count(nb.id)).toBe(0);
    expect(await reminded(t.b.id)).toEqual([]);

    // The owner was told through the existing notifications, once per reminder.
    // Counted from the owner's notification rows rather than the feed: the feed returns only the
    // newest notifications, and in a full suite the owner receives many more (every campaign
    // notifies every candidate's owner), which pushes an older one off the page.
    await expect
      .poll(
        () =>
          asOwner(async (c) =>
            Number(
              (
                await c.query<{ n: string }>(
                  `select count(*)::text as n from notifications
                      where recipient_person_id = $1 and item_id = $2 and title like 'Reminder:%'`,
                  [userById('budget-owner').personId, na.id],
                )
              ).rows[0].n,
            ),
          ),
        { timeout: 30_000, intervals: [500, 1000] },
      )
      .toBe(2);
  });
});
