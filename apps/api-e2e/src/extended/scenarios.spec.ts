// Invariant 83: a what-if scenario is a private projection. Modelling changes nothing on the ledger,
// and promoting one runs the ordinary control commands with their own authorization, floors, reasons
// and audit entries — there is no privileged apply path.
import { expect, test } from '@playwright/test';
import { Scenario, ScenarioComparison, ScenarioList } from '@bf/contracts';
import { userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  addChange,
  auditFor,
  buckets,
  createScenario,
  expectNothingMoved,
  fundedTree,
  impactOf,
  reason,
} from './support';

test.describe('what-if scenarios never touch real money', () => {
  test('modelling a reduction, a freeze and a set-to-zero leaves every bucket and status untouched', async ({
    request,
  }) => {
    const { root, child } = await fundedTree(request, {
      rootMinor: 1_000_000,
      childMinor: 400_000,
    });
    const rootBefore = await buckets(request, root.id);
    const childBefore = await buckets(request, child.id);

    const scenario = await createScenario(request);
    for (const data of [
      { kind: 'reduce', budgetId: child.id, amountMinor: 150_000, destination: 'parent' },
      { kind: 'freeze', budgetId: child.id },
      { kind: 'set_to_zero', budgetId: child.id, destination: 'parent' },
    ]) {
      await expectContract(await addChange(request, scenario.id, data), 201, Scenario);
    }

    // The impact is computed against the live ledger, so it is the strongest possible moment to
    // check that computing it wrote nothing.
    const impact = await impactOf(request, scenario.id);
    expect(impact.changes).toHaveLength(3);
    expect(impact.blocked).toBe(false);

    expectNothingMoved(rootBefore, await buckets(request, root.id));
    expectNothingMoved(childBefore, await buckets(request, child.id));
    expect((await buckets(request, child.id)).status).toBe('active');

    // And no journal was written for either budget: the ledger read model is unchanged and the only
    // audit entries on the scenario are about the scenario itself, never about money.
    const entries = await auditFor(request, 'scenario', scenario.id);
    expect(entries.map((e) => e.action).sort()).toEqual([
      'scenario.change_added',
      'scenario.change_added',
      'scenario.change_added',
      'scenario.created',
    ]);
    for (const entry of entries)
      expect(entry.changes['posted'] ?? { from: false, to: false }).toEqual({
        from: false,
        to: false,
      });
  });

  test('a reduction below the floor comes back blocked with the real floor, and still posts nothing', async ({
    request,
  }) => {
    const { child } = await fundedTree(request, {
      rootMinor: 1_000_000,
      childMinor: 400_000,
    });
    const before = await buckets(request, child.id);
    const scenario = await createScenario(request);
    // The child has 400,000 authorized and nothing committed, so a 500,000 cut is below its floor.
    await expectContract(
      await addChange(request, scenario.id, {
        kind: 'reduce',
        budgetId: child.id,
        amountMinor: 500_000,
        destination: 'parent',
      }),
      201,
      Scenario,
    );
    const impact = await impactOf(request, scenario.id);
    expect(impact.blocked).toBe(true);
    expect(impact.changes[0].problemCode).toBe('REDUCTION_BELOW_FLOOR');
    expect(impact.changes[0].maxReduction.amountMinor).toBe(400_000);
    expectNothingMoved(before, await buckets(request, child.id));

    // A blocked scenario cannot be promoted: the editor has to fix the change first.
    const refused = await request.post(`/api/scenarios/${scenario.id}/promote`, {
      headers: await mutate('finance-admin'),
      data: {
        reasonCode: 'cost_reduction',
        reason: reason('promoting a blocked scenario'),
        baselineAt: (await impactOf(request, scenario.id)).baselineAt,
      },
    });
    await expectProblem(refused, 422, 'SCENARIO_IMPACT_BLOCKED');
    expectNothingMoved(before, await buckets(request, child.id));
  });

  test('promotion applies the real control commands, each with its own audit entry', async ({
    request,
  }) => {
    const { child } = await fundedTree(request, {
      rootMinor: 1_000_000,
      childMinor: 400_000,
    });
    const scenario = await createScenario(request);
    await expectContract(
      await addChange(request, scenario.id, {
        kind: 'reduce',
        budgetId: child.id,
        amountMinor: 100_000,
        destination: 'parent',
      }),
      201,
      Scenario,
    );
    await expectContract(
      await addChange(request, scenario.id, { kind: 'freeze', budgetId: child.id }),
      201,
      Scenario,
    );

    const impact = await impactOf(request, scenario.id);
    const promoted = await expectContract(
      await request.post(`/api/scenarios/${scenario.id}/promote`, {
        headers: await mutate('finance-admin'),
        data: {
          reasonCode: 'cost_reduction',
          reason: reason('mid-year reallocation agreed by leadership'),
          baselineAt: impact.baselineAt,
        },
      }),
      201,
      Scenario,
    );
    expect(promoted.status).toBe('promoted');
    expect(promoted.changes.every((c) => c.promotion?.status === 'applied')).toBe(true);

    // The money moved exactly as the real commands move it: the child lost 100,000 and is frozen.
    const after = await buckets(request, child.id);
    expect(after.authorized).toBe(300_000);
    expect(after.status).toBe('frozen');

    // Each applied action wrote its own audit entry on its own budget, and the promotion wrote one.
    const budgetEntries = await auditFor(request, 'budget', child.id);
    expect(budgetEntries.map((e) => e.action)).toContain('budget.reduced');
    expect(budgetEntries.map((e) => e.action)).toContain('budget.frozen');
    const scenarioEntries = await auditFor(request, 'scenario', scenario.id);
    expect(scenarioEntries.filter((e) => e.action === 'scenario.promoted')).toHaveLength(1);
  });

  test('promotion is refused for a user who cannot change the budget by hand, and applies nothing', async ({
    request,
  }) => {
    // The scenario is authored by the budget's own owner, who can read it but cannot control it:
    // controls belong to whoever controls the parent (`budget.control`), never to the owner.
    const { child } = await fundedTree(request, {
      rootMinor: 1_000_000,
      childMinor: 400_000,
      owner: 'budget-owner',
    });
    const before = await buckets(request, child.id);
    const scenario = await createScenario(request, { as: 'budget-owner' });
    await expectContract(
      await addChange(request, scenario.id, { kind: 'freeze', budgetId: child.id }, 'budget-owner'),
      201,
      Scenario,
    );
    const impact = await impactOf(request, scenario.id, 'budget-owner');
    const refused = await request.post(`/api/scenarios/${scenario.id}/promote`, {
      headers: await mutate('budget-owner'),
      data: {
        reasonCode: 'cost_reduction',
        reason: reason('owner trying to freeze their own budget through a scenario'),
        baselineAt: impact.baselineAt,
      },
    });
    expect(refused.status(), await refused.text()).toBe(403);
    expectNothingMoved(before, await buckets(request, child.id));
    expect((await buckets(request, child.id)).status).toBe('active');

    // And the same freeze by hand is refused the same way, which is the point: the scenario grants
    // nothing its author did not already have.
    const byHand = await request.post(`/api/budgets/${child.id}/freeze`, {
      headers: await mutate('budget-owner'),
      data: { reasonCode: 'cost_reduction', reason: reason('owner freezing their own budget') },
    });
    expect(byHand.status()).toBe(403);
  });

  test('a scenario is private to its author and collaborators until it is promoted', async ({
    request,
  }) => {
    const scenario = await createScenario(request, {
      collaborators: [userById('finance-controller').personId!],
    });
    const asCollaborator = await request.get(`/api/scenarios/${scenario.id}`, {
      headers: await as('finance-controller'),
    });
    expect(asCollaborator.status()).toBe(200);

    // The CEO can change budgets company-wide but was not invited to this scenario, so it is not
    // merely forbidden to them: it does not exist as far as they can tell.
    const asOutsider = await request.get(`/api/scenarios/${scenario.id}`, {
      headers: await as('ceo'),
    });
    await expectProblem(asOutsider, 404, 'NOT_FOUND');
    const list = await expectContract(
      await request.get('/api/scenarios', { headers: await as('ceo') }),
      200,
      ScenarioList,
    );
    expect(list.items.map((s) => s.id)).not.toContain(scenario.id);
  });

  test('a stale baseline refuses promotion until the author recalculates', async ({ request }) => {
    const { child } = await fundedTree(request, {
      rootMinor: 1_000_000,
      childMinor: 400_000,
    });
    const scenario = await createScenario(request);
    await expectContract(
      await addChange(request, scenario.id, {
        kind: 'reduce',
        budgetId: child.id,
        amountMinor: 50_000,
        destination: 'parent',
      }),
      201,
      Scenario,
    );
    const impact = await impactOf(request, scenario.id);
    expect(impact.stale).toBe(false);

    // Somebody else posts in the meantime, which is exactly the case the baseline exists for.
    const other = await fundedTree(request, { rootMinor: 500_000, childMinor: 100_000 });
    expect(other.child.id).toBeTruthy();

    const afterLedgerMoved = await impactOf(request, scenario.id);
    expect(afterLedgerMoved.stale).toBe(true);
    expect(afterLedgerMoved.ledgerWritesSinceBaseline).toBeGreaterThan(0);
    const refused = await request.post(`/api/scenarios/${scenario.id}/promote`, {
      headers: await mutate('finance-admin'),
      data: {
        reasonCode: 'cost_reduction',
        reason: reason('promoting against a stale baseline'),
        baselineAt: impact.baselineAt,
      },
    });
    await expectProblem(refused, 409, 'SCENARIO_BASELINE_STALE');
    expect((await buckets(request, child.id)).authorized).toBe(400_000);
  });

  test('comparing scenarios reads today and each scenario without posting', async ({ request }) => {
    const { child } = await fundedTree(request, { rootMinor: 800_000, childMinor: 300_000 });
    const before = await buckets(request, child.id);
    const a = await createScenario(request, { name: `Compare A ${randomUUID().slice(0, 6)}` });
    const b = await createScenario(request, { name: `Compare B ${randomUUID().slice(0, 6)}` });
    await addChange(request, a.id, {
      kind: 'reduce',
      budgetId: child.id,
      amountMinor: 50_000,
      destination: 'parent',
    });
    await addChange(request, b.id, {
      kind: 'reduce',
      budgetId: child.id,
      amountMinor: 120_000,
      destination: 'parent',
    });
    const comparison = await expectContract(
      await request.get(`/api/scenarios/compare?ids=${a.id},${b.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      ScenarioComparison,
    );
    expect(comparison.columns.map((c) => c.label)[0]).toBe('Today');
    const row = comparison.rows.find((r) => r.budgetId === child.id)!;
    expect(row.authorized.map((m) => m.amountMinor)).toEqual([300_000, 250_000, 180_000]);
    expectNothingMoved(before, await buckets(request, child.id));
  });

  test('an archived scenario is read-only', async ({ request }) => {
    const scenario = await createScenario(request);
    await expectContract(
      await request.post(`/api/scenarios/${scenario.id}/archive`, {
        headers: await mutate('finance-admin'),
        data: { reason: reason('archiving a scenario we decided against') },
      }),
      201,
      Scenario,
    );
    const { child } = await fundedTree(request, { rootMinor: 400_000, childMinor: 100_000 });
    await expectProblem(
      await addChange(request, scenario.id, { kind: 'freeze', budgetId: child.id }),
      409,
      'SCENARIO_NOT_EDITABLE',
    );
  });

  test('an employee cannot create a scenario at all', async ({ request }) => {
    const res = await request.post('/api/scenarios', {
      headers: await mutate('employee'),
      data: { name: 'Employee what-if' },
    });
    expect([403, 404]).toContain(res.status());
  });

  test('the impact endpoint reports the same floor the real reduce command enforces', async ({
    request,
  }) => {
    const { child } = await fundedTree(request, {
      rootMinor: 1_000_000,
      childMinor: 200_000,
    });
    const scenario = await createScenario(request);
    await addChange(request, scenario.id, {
      kind: 'reduce',
      budgetId: child.id,
      amountMinor: 200_000,
      destination: 'parent',
    });
    const impact = await impactOf(request, scenario.id);
    const preview = await request.post(`/api/budgets/${child.id}/control-preview`, {
      headers: await as('finance-admin'),
      data: { action: 'reduce', amountMinor: 200_000, destination: 'parent' },
    });
    const body = (await preview.json()) as { floorMinor: number; maxReductionMinor: number };
    expect(impact.changes[0].floor.amountMinor).toBe(body.floorMinor);
    expect(impact.changes[0].maxReduction.amountMinor).toBe(body.maxReductionMinor);
  });
});
