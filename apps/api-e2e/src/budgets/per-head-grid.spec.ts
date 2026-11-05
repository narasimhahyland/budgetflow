// Per-head driver allocation (USD rate x eligible headcount from the HR import, contractors excluded,
// joiners prorated) with true-ups after a headcount refresh, and the allocation grid (preview, then all
// lines post as one change or none do; parallel grids never exceed the parent).
import { expect, test, type APIRequestContext } from '@playwright/test';
import { BatchAllocationResult, BudgetDetail, PerHeadResult } from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { createChild, createRoot } from '../support/factory';
import { bal, budget, post } from './p4';

const RATE = 1_500;

async function locationChild(request: APIRequestContext, parentId: string, orgUnitId: string) {
  return expectContract(
    await post(
      request,
      '/api/budgets',
      {
        name: `Per-head scenario ${Math.random().toString(36).slice(2, 8)}`,
        parentId,
        legalEntityId: SEED.legalEntities.acmeIndia,
        orgUnitId,
        fiscalYearId: SEED.fiscalYears.acmeFy2026,
      },
      'ceo',
    ),
    201,
    BudgetDetail,
  );
}

const perHead = (request: APIRequestContext, parentId: string, body: Record<string, unknown>) =>
  post(request, `/api/budgets/${parentId}/per-head`, body, 'ceo');

test.describe('per-head driver', () => {
  test('rate x eligible prorated headcount; contractors excluded; prorating optional', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 1_000_000 });
    const hyd = await locationChild(request, root.id, SEED.orgUnits.hyderabad);
    const blr = await locationChild(request, root.id, SEED.orgUnits.bengaluru);
    const preview = async (childBudgetId: string, extra: Record<string, unknown>) =>
      expectContract(
        await perHead(request, root.id, {
          childBudgetId,
          rateMinor: RATE,
          eligibleTypes: ['employee', 'intern'],
          prorate: true,
          asOf: '2026-10-31',
          dryRun: true,
          ...extra,
        }),
        200,
        PerHeadResult,
      );
    const h = await preview(hyd.id, {});
    expect(h.preview).toMatchObject({
      headcount: 86,
      eligibleHeadcount: 86,
      eligibleHeadcountMilli: 81_750,
      amountMinor: 122_625,
      deltaMinor: 122_625,
      currency: 'USD',
      fits: true,
    });
    expect(h.journalId).toBeNull();
    const b = await preview(blr.id, { eligibleTypes: ['employee'] });
    expect(b.preview).toMatchObject({
      headcount: 130,
      eligibleHeadcount: 120,
      excludedHeadcount: 10,
      amountMinor: 177_750,
    });
    expect(b.preview.byType.find((t) => t.employmentType === 'contractor')).toMatchObject({
      headcount: 10,
      eligible: false,
    });
    const whole = await preview(hyd.id, { prorate: false });
    expect(whole.preview.amountMinor).toBe(86 * RATE);
    expect(bal(await budget(request, hyd.id)).authorized).toBe(0);
  });

  test('allocates the driver amount, then trues up after the headcount refresh (up and down)', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 500_000 });
    const hyd = await locationChild(request, root.id, SEED.orgUnits.hyderabad);
    const first = await expectContract(
      await perHead(request, root.id, {
        childBudgetId: hyd.id,
        rateMinor: RATE,
        eligibleTypes: ['employee', 'intern'],
        prorate: true,
        asOf: '2026-10-31',
        dryRun: false,
      }),
      200,
      PerHeadResult,
    );
    expect(first.journalId).toBeTruthy();
    expect(first.child).toMatchObject({ allocationDriver: 'per_head' });
    expect(first.child?.driver).toMatchObject({
      rateMinor: RATE,
      amountMinor: 122_625,
      eligibleHeadcountMilli: 81_750,
      asOfDate: '2026-10-31',
    });
    expect(bal(await budget(request, hyd.id)).authorized).toBe(122_625);

    const trueUp = (asOf: string, dryRun: boolean) =>
      post(request, `/api/budgets/${hyd.id}/per-head/true-up`, { asOf, dryRun }, 'ceo');
    const dry = await expectContract(await trueUp('2026-11-01', true), 200, PerHeadResult);
    expect(dry.preview).toMatchObject({
      amountMinor: 132_000,
      currentDriverAmountMinor: 122_625,
      deltaMinor: 9_375,
      asOfDate: '2026-11-01',
    });
    const up = await expectContract(await trueUp('2026-11-01', false), 200, PerHeadResult);
    expect(up.child?.driver?.amountMinor).toBe(132_000);
    expect(bal(await budget(request, hyd.id)).authorized).toBe(132_000);
    const down = await expectContract(await trueUp('2026-10-31', false), 200, PerHeadResult);
    expect(down.preview.deltaMinor).toBe(-9_375);
    expect(bal(await budget(request, hyd.id)).authorized).toBe(122_625);
    expect(bal(await budget(request, root.id)).allocatedOut).toBe(122_625);
  });

  test('a driver amount above the parent is a hard block; a unit without headcount is explained', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const hyd = await locationChild(request, root.id, SEED.orgUnits.hyderabad);
    const body = {
      childBudgetId: hyd.id,
      rateMinor: RATE,
      eligibleTypes: ['employee', 'intern'],
      prorate: true,
      asOf: '2026-10-31',
    };
    const dry = await expectContract(
      await perHead(request, root.id, { ...body, dryRun: true }),
      200,
      PerHeadResult,
    );
    expect(dry.preview).toMatchObject({ fits: false, parentAvailableMinor: 100_000 });
    await expectProblem(
      await perHead(request, root.id, { ...body, dryRun: false }),
      409,
      'OVER_ALLOCATION',
    );
    const plain = await createChild(request, root.id, { currency: 'USD' });
    await expectProblem(
      await perHead(request, root.id, { ...body, childBudgetId: plain.id, dryRun: true }),
      422,
      'VALIDATION_FAILED',
    );
  });
});

test.describe('allocation grid', () => {
  test('preview, then every line posts as one change; a bad grid posts nothing', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const [c1, c2] = await Promise.all([
      createChild(request, root.id, { currency: 'USD' }),
      createChild(request, root.id, { currency: 'USD' }),
    ]);
    const lines = [
      { childBudgetId: c1.id, amountMinor: 40_000 },
      { childBudgetId: c2.id, amountMinor: 30_000 },
      {
        newChild: {
          name: 'Grid team',
          code: 'GRID-1',
          ownerPersonId: userById('location-manager').personId,
        },
        amountMinor: 20_000,
      },
    ];
    const grid = (body: Record<string, unknown>, key?: string) =>
      post(request, `/api/budgets/${root.id}/allocations/batch`, body, 'ceo', key);
    const dry = await expectContract(
      await grid({ dryRun: true, lines }),
      200,
      BatchAllocationResult,
    );
    expect(dry).toMatchObject({
      ok: true,
      totalMinor: 90_000,
      availableBeforeMinor: 100_000,
      availableAfterMinor: 10_000,
      journalIds: [],
    });
    expect(bal(await budget(request, c1.id)).authorized).toBe(0);

    const tooMuch = await expectContract(
      await grid({ dryRun: true, lines: [...lines, { childBudgetId: c1.id, amountMinor: 1 }] }),
      200,
      BatchAllocationResult,
    );
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.lines[3]).toMatchObject({ outcome: 'error', code: 'VALIDATION_FAILED' });
    await expectProblem(
      await grid({ dryRun: false, lines: [{ childBudgetId: c1.id, amountMinor: 100_001 }] }),
      409,
      'OVER_ALLOCATION',
    );
    await expectProblem(
      await grid({
        dryRun: false,
        lines: [
          { childBudgetId: c1.id, amountMinor: 1 },
          { childBudgetId: root.id, amountMinor: 1 },
        ],
      }),
      422,
      'VALIDATION_FAILED',
    );
    expect(bal(await budget(request, c1.id)).authorized).toBe(0);

    const done = await expectContract(
      await grid({ dryRun: false, lines, memo: 'FY2026 split' }, `grid-${root.id}`),
      200,
      BatchAllocationResult,
    );
    expect(done.journalIds).toHaveLength(3);
    expect(done.parent && bal(done.parent)).toMatchObject({ allocatedOut: 90_000 });
    const replay = await grid({ dryRun: false, lines, memo: 'FY2026 split' }, `grid-${root.id}`);
    expect(replay.status()).toBe(200);
    expect(bal(await budget(request, root.id)).allocatedOut).toBe(90_000);
    const created = done.lines[2].childBudgetId!;
    expect(await budget(request, created)).toMatchObject({
      name: 'Grid team',
      code: 'GRID-1',
      parentId: root.id,
    });
  });

  test('parallel grids never allocate more than the parent holds', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const kids = await Promise.all(
      Array.from({ length: 3 }, () => createChild(request, root.id, { currency: 'USD' })),
    );
    const responses = await Promise.all(
      kids.map((k) =>
        post(
          request,
          `/api/budgets/${root.id}/allocations/batch`,
          { dryRun: false, lines: [{ childBudgetId: k.id, amountMinor: 60_000 }] },
          'ceo',
        ),
      ),
    );
    expect(responses.map((r) => r.status()).sort()).toEqual([200, 409, 409]);
    expect(bal(await budget(request, root.id)).allocatedOut).toBe(60_000);
  });

  test('a pasted row without an owner is saved as an unfunded Draft until an owner is set', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const c = await createChild(request, root.id, { currency: 'USD' });
    const r = await expectContract(
      await post(
        request,
        `/api/budgets/${root.id}/allocations/batch`,
        {
          dryRun: false,
          lines: [
            { childBudgetId: c.id, amountMinor: 10_000 },
            { newChild: { name: 'Pasted row without owner' }, amountMinor: 5_000 },
          ],
        },
        'ceo',
      ),
      200,
      BatchAllocationResult,
    );
    expect(r).toMatchObject({ ok: true, totalMinor: 10_000, availableAfterMinor: 90_000 });
    expect(r.journalIds).toHaveLength(1);
    expect(r.lines[1]).toMatchObject({ outcome: 'draft', amountMinor: 5_000 });
    const draftId = r.lines[1].childBudgetId!;
    const draft = await budget(request, draftId);
    expect([draft.status, draft.ownerPersonId, bal(draft).authorized]).toEqual(['draft', null, 0]);
    expect(bal(await budget(request, root.id)).allocatedOut).toBe(10_000);
    const activate = () => post(request, `/api/budgets/${draftId}/activate`, {}, 'finance-admin');
    await expectProblem(await activate(), 422, 'VALIDATION_FAILED');
    await expectContract(
      await request.put(`/api/budgets/${draftId}/settings`, {
        headers: await mutate('finance-admin'),
        data: {
          expectedVersion: draft.version,
          ownerPersonId: userById('location-manager').personId,
        },
      }),
      200,
      BudgetDetail,
    );
    expect((await expectContract(await activate(), 200, BudgetDetail)).status).toBe('active');
  });
});
