// Concurrent control and driver commands with different idempotency keys: status checks and driver
// amounts are read after the row locks, so exactly one request changes the budget and only that change
// writes an outbox event and an audit entry. A cascade skips children that are already at zero.
import { expect, test } from '@playwright/test';
import { BudgetDetail, PerHeadResult } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as } from '../support/auth';
import { expectContract } from '../support/contract';
import { allocateOk, createChild, createRoot } from '../support/factory';
import {
  auditActions,
  bal,
  budget,
  controlEvents,
  post,
  preview,
  rebuildCheck,
  tally,
  tree,
  USD,
} from './p4';

const zeroBody = (b: BudgetDetail, floor: number, extra: Record<string, unknown> = {}) => ({
  destination: 'parent',
  reasonCode: 'RED-REPRIORITIZE',
  reason: 'Programme stopped',
  confirmedFloorMinor: floor,
  confirmText: b.code ?? b.name,
  ...extra,
});

const count = (actions: string[], action: string) => actions.filter((a) => a === action).length;

test.describe('concurrent controls and drivers', () => {
  test.beforeAll(async () => {
    for (const u of ['finance-admin', 'ceo', 'auditor'] as const) await as(u);
  });

  test('parallel freeze, unfreeze, set to zero and restore: one success, one event and one audit entry each', async ({
    request,
  }) => {
    const { a } = await tree(request, 100_000, 10_000);
    const parallel = (path: string, body: Record<string, unknown>, n = 6) =>
      tally(Array.from({ length: n }, () => post(request, `/api/budgets/${a.id}/${path}`, body)));

    expect(await parallel('freeze', { reasonCode: 'FRZ-POLICY', reason: 'Policy review' })).toEqual(
      {
        '200': 1,
        '409 INVALID_TRANSITION': 5,
      },
    );
    expect((await budget(request, a.id)).status).toBe('frozen');
    expect(await parallel('unfreeze', { reason: 'Review finished' })).toEqual({
      '200': 1,
      '409 INVALID_TRANSITION': 5,
    });
    expect((await budget(request, a.id)).status).toBe('active');

    const pv = await preview(request, a.id, { action: 'set_to_zero', destination: 'parent' });
    expect(
      await parallel('set-to-zero', zeroBody(await budget(request, a.id), pv.floorMinor)),
    ).toEqual({ '200': 1, '409 INVALID_TRANSITION': 5 });
    expect(await parallel('restore', { reason: 'Programme back on' })).toEqual({
      '200': 1,
      '409 INVALID_TRANSITION': 5,
    });
    const after = await budget(request, a.id);
    expect([after.status, bal(after).authorized]).toEqual(['active', 0]);

    for (const action of ['frozen', 'unfrozen', 'set_to_zero', 'restored'])
      expect((await controlEvents(a.id, action)).length, action).toBe(1);
    const audits = await auditActions(request, a.id);
    for (const action of [
      'budget.frozen',
      'budget.unfrozen',
      'budget.set_to_zero',
      'budget.restored',
    ])
      expect(count(audits, action), action).toBe(1);
  });

  test('parallel reductions that each fit once: one succeeds, the rest are below the floor', async ({
    request,
  }) => {
    const { root, a } = await tree(request, 100_000, 10_000);
    const pv = await preview(request, a.id, {
      action: 'reduce',
      amountMinor: 6_000,
      destination: 'parent',
    });
    const res = await tally(
      Array.from({ length: 5 }, () =>
        post(request, `/api/budgets/${a.id}/reduce`, {
          amountMinor: 6_000,
          destination: 'parent',
          reasonCode: 'RED-COST-SAVING',
          reason: 'Parallel reduction',
          confirmedFloorMinor: pv.floorMinor,
        }),
      ),
    );
    expect(res).toEqual({ '200': 1, '409 REDUCTION_BELOW_FLOOR': 4 });
    expect(bal(await budget(request, a.id)).authorized).toBe(4_000);
    expect(bal(await budget(request, root.id)).allocatedOut).toBe(4_000);
    expect((await controlEvents(a.id, 'reduced')).length).toBe(1);
    expect(count(await auditActions(request, a.id), 'budget.reduced')).toBe(1);
  });

  test('parallel per-head set and true-up allocate the driver amount once', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 1_000_000 });
    const hyd = await expectContract(
      await post(
        request,
        '/api/budgets',
        {
          name: `Hyderabad wellbeing ${randomUUID().slice(0, 6)}`,
          parentId: root.id,
          legalEntityId: SEED.legalEntities.acmeIndia,
          orgUnitId: SEED.orgUnits.hyderabad,
          fiscalYearId: SEED.fiscalYears.acmeFy2026,
        },
        'ceo',
      ),
      201,
      BudgetDetail,
    );
    const setBody = (dryRun: boolean) => ({
      childBudgetId: hyd.id,
      rateMinor: 1_500,
      eligibleTypes: ['employee', 'intern'],
      prorate: true,
      asOf: '2026-10-31',
      dryRun,
    });
    const planned = await expectContract(
      await post(request, `/api/budgets/${root.id}/per-head`, setBody(true), 'ceo'),
      200,
      PerHeadResult,
    );
    expect(planned.preview.amountMinor).toBeGreaterThan(0);
    expect(
      await tally(
        Array.from({ length: 4 }, () =>
          post(request, `/api/budgets/${root.id}/per-head`, setBody(false), 'ceo'),
        ),
      ),
    ).toEqual({ '200': 4 });
    const afterSet = await budget(request, hyd.id);
    expect(bal(afterSet).authorized).toBe(planned.preview.amountMinor);
    expect(afterSet.driver?.amountMinor).toBe(planned.preview.amountMinor);

    const trueUp = (dryRun: boolean) =>
      post(
        request,
        `/api/budgets/${hyd.id}/per-head/true-up`,
        { asOf: '2026-11-01', dryRun },
        'ceo',
      );
    const target = await expectContract(await trueUp(true), 200, PerHeadResult);
    expect(target.preview.amountMinor).not.toBe(planned.preview.amountMinor);
    expect(await tally(Array.from({ length: 5 }, () => trueUp(false)))).toEqual({ '200': 5 });
    const afterUp = await budget(request, hyd.id);
    expect(bal(afterUp).authorized).toBe(target.preview.amountMinor);
    expect(afterUp.driver?.amountMinor).toBe(target.preview.amountMinor);
    expect(bal(await budget(request, root.id)).allocatedOut).toBe(target.preview.amountMinor);

    const audits = (await auditActions(request, hyd.id)).filter((x) =>
      x.startsWith('budget.per_head'),
    );
    expect(audits).toEqual(['budget.per_head_set', 'budget.per_head_true_up']);
    expect((await rebuildCheck(request)).status).toBe('clean');
  });

  test('a cascade set to zero skips a child that is already at zero', async ({ request }) => {
    const { root, a } = await tree(request, 100_000, 20_000);
    const k = await createChild(request, a.id, { currency: 'USD' });
    await allocateOk(request, a.id, k.id, USD(5_000));
    const kp = await preview(request, k.id, { action: 'set_to_zero', destination: 'parent' });
    expect(
      (
        await post(
          request,
          `/api/budgets/${k.id}/set-to-zero`,
          zeroBody(await budget(request, k.id), kp.floorMinor),
        )
      ).status(),
    ).toBe(200);
    const ap = await preview(request, a.id, {
      action: 'set_to_zero',
      destination: 'parent',
      cascade: true,
    });
    const res = await post(
      request,
      `/api/budgets/${a.id}/set-to-zero`,
      zeroBody(await budget(request, a.id), ap.floorMinor, { cascade: true }),
    );
    expect(res.status()).toBe(200);
    expect((await res.json()).affectedBudgetIds).toEqual([a.id]);
    expect((await controlEvents(k.id, 'set_to_zero')).length).toBe(1);
    expect(count(await auditActions(request, k.id), 'budget.set_to_zero')).toBe(1);
    expect(bal(await budget(request, root.id)).allocatedOut).toBe(0);
  });
});
