// Invariants 9 and 10 (Phase 4): freeze, reduce and set to zero. Frozen and zeroed budgets reject new
// requests and allocations while existing commitments complete; reductions need a destination, a reason
// code, a typed reason and the confirmed impact preview; the floor is allocated out + held + encumbered +
// actual (pending requests listed, never floored); every change publishes budget.control_changed.
import { expect, test } from '@playwright/test';
import { ControlResult, Journal } from '@bf/contracts';
import { as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import { allocate, allocateOk, createChild, createRoot } from '../support/factory';
import { bal, budget, freeze, openingBalance, post, preview, spendCheck, tree, USD } from './p4';

async function outboxFor(budgetId: string) {
  return asOwner(
    async (c) =>
      (
        await c.query<{ topic: string; payload: Record<string, unknown> }>(
          `select topic, payload from outbox_messages where topic = 'budget.control_changed' and payload->>'budgetId' = $1 order by created_at`,
          [budgetId],
        )
      ).rows,
  );
}

test.describe('freeze', () => {
  test('a frozen budget blocks new requests and allocations while commitments complete', async ({
    request,
  }) => {
    const { root, a } = await tree(request, 100_000, 40_000);
    const grandchild = await createChild(request, a.id, { currency: 'USD' });
    await openingBalance(request, a.id, 'encumbered', 5_000);
    const impact = await preview(request, a.id, { action: 'freeze' });
    expect(impact).toMatchObject({
      blocksNewRequests: true,
      pendingRequestPolicy: 'hold',
      encumberedMinor: 5_000,
    });

    const frozen = await freeze(request, a.id);
    expect(frozen.budget.status).toBe('frozen');
    expect(frozen.event).toEqual({
      topic: 'budget.control_changed',
      action: 'frozen',
      pendingRequestPolicy: 'hold',
      unfitRequestIds: [],
    });

    const check = await spendCheck(request, a.id, { amountMinor: 100 });
    expect(check.outcome).toBe('blocked');
    expect(check.reasons.map((r) => r.code)).toContain('BUDGET_FROZEN');
    await expectProblem(await allocate(request, root.id, a.id, USD(100)), 409, 'BUDGET_FROZEN');
    await expectProblem(
      await allocate(request, a.id, grandchild.id, USD(100)),
      409,
      'BUDGET_FROZEN',
    );

    // The approved commitment completes: the encumbrance is relieved and the actual posts.
    await openingBalance(request, a.id, 'encumbered', 5_000, 'credit');
    await openingBalance(request, a.id, 'actual', 4_800);
    const after = bal(await budget(request, a.id));
    expect(after).toMatchObject({ encumbered: 0, actual: 4_800, authorized: 40_000 });

    const events = await outboxFor(a.id);
    expect(events.at(-1)).toMatchObject({
      topic: 'budget.control_changed',
      payload: {
        action: 'frozen',
        pendingRequestPolicy: 'hold',
        reasonCode: 'FRZ-POLICY',
        status: 'frozen',
      },
    });

    const unfrozen = await expectContract(
      await post(request, `/api/budgets/${a.id}/unfreeze`, { reason: 'Review finished' }),
      200,
      ControlResult,
    );
    expect(unfrozen.budget.status).toBe('active');
    expect((await outboxFor(a.id)).at(-1)?.payload).toMatchObject({
      action: 'unfrozen',
      pendingRequestPolicy: 'release',
    });
    await allocateOk(request, root.id, a.id, USD(100));
  });

  test('cascade freezes every budget below; an owner cannot freeze the budget they own', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 50_000 });
    const region = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'regional-manager',
    });
    const city = await createChild(request, region.id, { currency: 'USD' });
    await allocateOk(request, root.id, region.id, USD(20_000));
    await allocateOk(request, region.id, city.id, USD(5_000));
    await expectProblem(
      await post(
        request,
        `/api/budgets/${region.id}/freeze`,
        { reasonCode: 'FRZ-POLICY', reason: 'Own budget' },
        'regional-manager',
      ),
      403,
      'FORBIDDEN',
    );
    const r = await expectContract(
      await post(
        request,
        `/api/budgets/${region.id}/freeze`,
        { reasonCode: 'FRZ-POLICY', reason: 'Region review', cascade: true },
        'ceo',
      ),
      200,
      ControlResult,
    );
    expect(r.affectedBudgetIds.sort()).toEqual([region.id, city.id].sort());
    expect((await budget(request, city.id)).status).toBe('frozen');
    expect((await outboxFor(city.id)).at(-1)?.payload).toMatchObject({
      action: 'frozen',
      cascadeFromBudgetId: region.id,
    });
  });

  test('a reason code from the list is required', async ({ request }) => {
    const { a } = await tree(request, 10_000, 1_000);
    await expectProblem(
      await post(request, `/api/budgets/${a.id}/freeze`, {
        reasonCode: 'NOPE',
        reason: 'Made up code',
      }),
      422,
      'VALIDATION_FAILED',
    );
  });
});

test.describe('reduce', () => {
  test('the floor counts allocated out, held, encumbered and actual but not pending requests', async ({
    request,
  }) => {
    const { root, a } = await tree(request, 100_000, 50_000);
    const child = await createChild(request, a.id, { currency: 'USD' });
    await allocateOk(request, a.id, child.id, USD(10_000));
    await openingBalance(request, a.id, 'held', 2_000);
    await openingBalance(request, a.id, 'encumbered', 3_000);
    await openingBalance(request, a.id, 'actual', 4_000);
    await openingBalance(request, a.id, 'pre_encumbered', 6_000);
    const impact = await preview(request, a.id, {
      action: 'reduce',
      amountMinor: 31_000,
      destination: 'parent',
    });
    expect(impact).toMatchObject({
      floorMinor: 19_000,
      pendingMinor: 6_000,
      maxReductionMinor: 31_000,
      newAuthorizedMinor: 19_000,
      destinationName: root.name,
      // Pending requests no longer fit; Phase 5 returns the listed ones (none are linked here).
      availableAfterMinor: -6_000,
      pendingRequestPolicy: 'return_unfit',
      unfitRequestIds: [],
      problem: null,
    });
    const tooMuch = await preview(request, a.id, {
      action: 'reduce',
      amountMinor: 31_001,
      destination: 'parent',
    });
    expect(tooMuch.problem?.code).toBe('REDUCTION_BELOW_FLOOR');

    const reduce = (
      amountMinor: number,
      confirmedFloorMinor: number,
      extra: Record<string, unknown> = {},
    ) =>
      post(request, `/api/budgets/${a.id}/reduce`, {
        amountMinor,
        destination: 'parent',
        reasonCode: 'RED-COST-SAVING',
        reason: 'Cost-saving program',
        confirmedFloorMinor,
        ...extra,
      });
    await expectProblem(await reduce(31_001, 19_000), 409, 'REDUCTION_BELOW_FLOOR');
    await expectProblem(await reduce(1_000, 18_000), 422, 'IMPACT_PREVIEW_REQUIRED');
    await expectProblem(
      await reduce(1_000, 19_000, { reasonCode: 'FRZ-POLICY' }),
      422,
      'VALIDATION_FAILED',
    );
    const done = await expectContract(await reduce(31_000, 19_000), 200, ControlResult);
    expect(done.budget.status).toBe('reduced');
    expect(done.event).toMatchObject({ pendingRequestPolicy: 'return_unfit', unfitRequestIds: [] });
    expect(bal(done.budget)).toMatchObject({ authorized: 19_000 });
    expect(bal(await budget(request, root.id))).toMatchObject({ allocatedOut: 19_000 });
    const j = await expectContract(
      await request.get(`/api/ledger/journals/${done.journalId}`, {
        headers: await as('finance-admin'),
      }),
      200,
      Journal,
    );
    expect(j.type).toBe('reduction');
    expect(j.balanced).toBe(true);
    expect(j.lines.map((l) => [l.budgetId, l.account, l.budget?.amountMinor])).toEqual([
      [a.id, 'authorized', 31_000],
      [root.id, 'allocated_out', -31_000],
    ]);
    expect((await outboxFor(a.id)).at(-1)?.payload).toMatchObject({
      action: 'reduced',
      pendingRequestPolicy: 'return_unfit',
      unfitRequestIds: [],
      authorizedBeforeMinor: 50_000,
      authorizedAfterMinor: 19_000,
      journalId: done.journalId,
    });
  });

  test('cut money to savings leaves the tree through the root; reallocation moves it to another subtree', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const region = await createChild(request, root.id, { currency: 'USD' });
    const city = await createChild(request, region.id, { currency: 'USD' });
    const other = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, region.id, USD(40_000));
    await allocateOk(request, region.id, city.id, USD(10_000));
    const pv = await preview(request, city.id, {
      action: 'reduce',
      amountMinor: 4_000,
      destination: 'savings',
    });
    expect(pv.destinationName).toBe('Company savings');
    const saved = await expectContract(
      await post(request, `/api/budgets/${city.id}/reduce`, {
        amountMinor: 4_000,
        destination: 'savings',
        reasonCode: 'RED-COST-SAVING',
        reason: 'Return to savings',
        confirmedFloorMinor: pv.floorMinor,
      }),
      200,
      ControlResult,
    );
    expect(bal(saved.budget).authorized).toBe(6_000);
    expect(bal(await budget(request, region.id))).toMatchObject({
      authorized: 36_000,
      allocatedOut: 6_000,
    });
    expect(bal(await budget(request, root.id))).toMatchObject({
      authorized: 96_000,
      allocatedOut: 36_000,
    });

    const pv2 = await preview(request, city.id, {
      action: 'reduce',
      amountMinor: 1_000,
      destination: 'reallocation',
      destinationBudgetId: other.id,
    });
    expect(pv2.destinationName).toBe(other.name);
    await expectContract(
      await post(request, `/api/budgets/${city.id}/reduce`, {
        amountMinor: 1_000,
        destination: 'reallocation',
        destinationBudgetId: other.id,
        reasonCode: 'RED-REPRIORITIZE',
        reason: 'Fund the other team',
        confirmedFloorMinor: pv2.floorMinor,
      }),
      200,
      ControlResult,
    );
    expect(bal(await budget(request, other.id)).authorized).toBe(1_000);
    expect(bal(await budget(request, region.id))).toMatchObject({
      authorized: 35_000,
      allocatedOut: 5_000,
    });
    expect(bal(await budget(request, root.id))).toMatchObject({
      authorized: 96_000,
      allocatedOut: 36_000,
    });
    await expectProblem(
      await post(request, `/api/budgets/${region.id}/reduce`, {
        amountMinor: 100,
        destination: 'reallocation',
        destinationBudgetId: city.id,
        reasonCode: 'RED-REPRIORITIZE',
        reason: 'Into own child',
        confirmedFloorMinor: 5_000,
      }),
      422,
      'TRANSFER_INVALID',
    );
  });
});

test.describe('set to zero', () => {
  test('floors at what children keep and commitments, cancels pending requests and blocks new ones', async ({
    request,
  }) => {
    const { root, a } = await tree(request, 100_000, 30_000);
    const kid = await createChild(request, a.id, { currency: 'USD' });
    await allocateOk(request, a.id, kid.id, USD(8_000));
    await openingBalance(request, a.id, 'encumbered', 2_000);
    await openingBalance(request, a.id, 'pre_encumbered', 1_500);
    await openingBalance(request, kid.id, 'actual', 3_000);

    const plain = await preview(request, a.id, { action: 'set_to_zero', destination: 'parent' });
    expect(plain).toMatchObject({
      floorMinor: 10_000,
      reductionMinor: 20_000,
      pendingMinor: 1_500,
      pendingRequestPolicy: 'cancel',
    });
    const cascaded = await preview(request, a.id, {
      action: 'set_to_zero',
      destination: 'parent',
      cascade: true,
    });
    expect(cascaded).toMatchObject({ floorMinor: 5_000, reductionMinor: 25_000, cascade: true });
    expect(cascaded.affected.map((x) => [x.budgetId, x.reductionMinor, x.floorMinor])).toEqual([
      [a.id, 25_000, 5_000],
      [kid.id, 5_000, 3_000],
    ]);

    const zero = (body: Record<string, unknown>) =>
      post(request, `/api/budgets/${a.id}/set-to-zero`, {
        destination: 'parent',
        reasonCode: 'RED-REPRIORITIZE',
        reason: 'Region closed for the year',
        confirmedFloorMinor: cascaded.floorMinor,
        cascade: true,
        confirmText: a.name,
        ...body,
      });
    await expectProblem(await zero({ confirmText: 'wrong' }), 422, 'VALIDATION_FAILED');
    await expectProblem(await zero({ reason: '' }), 400, 'VALIDATION_FAILED');
    await expectProblem(
      await zero({ confirmedFloorMinor: plain.floorMinor }),
      422,
      'IMPACT_PREVIEW_REQUIRED',
    );
    const done = await expectContract(await zero({}), 200, ControlResult);
    expect(done.budget.status).toBe('set_to_zero');
    expect(done.affectedBudgetIds).toEqual([a.id, kid.id]);
    expect(bal(done.budget)).toMatchObject({
      authorized: 5_000,
      allocatedOut: 3_000,
      encumbered: 2_000,
      preEncumbered: 1_500,
    });
    expect(bal(await budget(request, kid.id))).toMatchObject({ authorized: 3_000, actual: 3_000 });
    expect((await budget(request, kid.id)).status).toBe('set_to_zero');
    expect(bal(await budget(request, root.id))).toMatchObject({ allocatedOut: 5_000 });

    const check = await spendCheck(request, a.id, { amountMinor: 1 });
    expect(check.reasons.map((r) => r.code)).toContain('BUDGET_SET_TO_ZERO');
    await expectProblem(await allocate(request, root.id, a.id, USD(1)), 409, 'BUDGET_SET_TO_ZERO');
    // Phase 5 cancels the pending request on the event (releasing its pre-encumbrance); the approved
    // commitment still completes on the zeroed budget.
    await openingBalance(request, a.id, 'pre_encumbered', 1_500, 'credit');
    await openingBalance(request, a.id, 'encumbered', 2_000, 'credit');
    await openingBalance(request, a.id, 'actual', 2_000);

    const events = await outboxFor(a.id);
    expect(events.at(-1)?.payload).toMatchObject({
      action: 'set_to_zero',
      pendingRequestPolicy: 'cancel',
      reasonCode: 'RED-REPRIORITIZE',
      reason: 'Region closed for the year',
      authorizedBeforeMinor: 30_000,
      authorizedAfterMinor: 5_000,
      cascadeFromBudgetId: null,
    });
    expect((await outboxFor(kid.id)).at(-1)?.payload).toMatchObject({
      action: 'set_to_zero',
      cascadeFromBudgetId: a.id,
    });

    const restored = await expectContract(
      await post(request, `/api/budgets/${a.id}/restore`, { reason: 'Region reopened' }),
      200,
      ControlResult,
    );
    expect(restored.budget.status).toBe('active');
    expect(bal(restored.budget).authorized).toBe(5_000);
  });

  test('a replayed set to zero posts once', async ({ request }) => {
    const { a } = await tree(request, 20_000, 5_000);
    const pv = await preview(request, a.id, { action: 'set_to_zero', destination: 'parent' });
    const key = `zero-${a.id}`;
    const body = {
      destination: 'parent',
      reasonCode: 'RED-REPRIORITIZE',
      reason: 'Stop the program',
      confirmedFloorMinor: pv.floorMinor,
      confirmText: a.name,
    };
    const first = await post(
      request,
      `/api/budgets/${a.id}/set-to-zero`,
      body,
      'finance-admin',
      key,
    );
    const second = await post(
      request,
      `/api/budgets/${a.id}/set-to-zero`,
      body,
      'finance-admin',
      key,
    );
    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    expect(second.headers()['idempotent-replayed']).toBe('true');
    expect((await second.json()).journalId).toBe((await first.json()).journalId);
    expect(
      (await outboxFor(a.id)).filter((e) => e.payload['action'] === 'set_to_zero'),
    ).toHaveLength(1);
  });

  test('a root budget can only send cut money to savings', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 10_000 });
    const pv = await preview(request, root.id, { action: 'set_to_zero', destination: 'parent' });
    expect(pv.problem?.code).toBe('REDUCTION_DESTINATION_REQUIRED');
    const toSavings = await preview(request, root.id, {
      action: 'set_to_zero',
      destination: 'savings',
    });
    expect(toSavings).toMatchObject({
      problem: null,
      reductionMinor: 10_000,
      destinationName: 'Company savings',
    });
  });
});
