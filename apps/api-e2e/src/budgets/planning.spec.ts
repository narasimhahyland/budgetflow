// Invariant 4 (root budgets tie to the approved plan version): plan versions, spreadsheet import with
// column mapping, apply (create or adjust roots), tie-out per year, roll forward; plus phasing, limits,
// settings concurrency, owner alert thresholds, company-wide Available and scope. Ends with the ledger
// rebuild check (cached balances equal the rebuild, plan ties per version).
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ApplyPlanVersionResult,
  BudgetDetail,
  BudgetLimits,
  BudgetList,
  BudgetPhasing,
  BudgetSummary,
  BudgetVersionList,
  ControlResult,
  PlanImportResult,
  PlanTieOut,
  PlanVersionDetail,
  RollForwardResult,
  SpendCheckResult,
  AllocationHistory,
} from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import { allocateOk, createChild, createRoot } from '../support/factory';
import { bal, budget, openingBalance, post, preview, rebuildCheck, spendCheck, USD } from './p4';

const FY27 = SEED.fiscalYears.acmeFy2027;

async function tieOut(request: APIRequestContext, fiscalYearId: string) {
  return expectContract(
    await request.get(`/api/plan-versions/tie-out?fiscalYearId=${fiscalYearId}`, {
      headers: await as('finance-admin'),
    }),
    200,
    PlanTieOut,
  );
}

/** A new version for FY2027 starting from the controlling one (so repeated runs keep every root covered). */
async function nextVersion(
  request: APIRequestContext,
  lines: { code: string; name: string; amountMinor: number; legalEntityId?: string }[],
  edit: (l: { code: string; amountMinor: number }) => number | null = () => null,
) {
  const current = await tieOut(request, FY27);
  const base = current.planVersionId
    ? await expectContract(
        await request.get(`/api/plan-versions/${current.planVersionId}`, {
          headers: await as('finance-admin'),
        }),
        200,
        PlanVersionDetail,
      )
    : null;
  const copied = (base?.lines ?? []).map((l) => ({
    code: l.code,
    name: l.name,
    amountMinor: edit(l) ?? l.amountMinor,
    ...(l.budgetId ? { budgetId: l.budgetId } : {}),
    ...(l.legalEntityId ? { legalEntityId: l.legalEntityId } : {}),
  }));
  const created = await expectContract(
    await post(request, '/api/plan-versions', {
      fiscalYearId: FY27,
      kind: base ? 'current' : 'original',
      label: `FY2027 scenario ${randomUUID().slice(0, 6)}`,
      lines: [...copied, ...lines],
    }),
    201,
    PlanVersionDetail,
  );
  expect(created.status).toBe('draft');
  return created;
}

test.describe('plan versions and the root tie-out', () => {
  test('applying a version creates roots, a revision adjusts them, and roots always tie out', async ({
    request,
  }) => {
    const code = `SCN-${randomUUID().slice(0, 6).toUpperCase()}`;
    const v1 = await nextVersion(request, [
      {
        code,
        name: 'Scenario program FY2027',
        amountMinor: 50_000,
        legalEntityId: SEED.legalEntities.acmeUs,
      },
    ]);
    await expectProblem(
      await post(request, `/api/plan-versions/${v1.id}/apply`, {}),
      409,
      'PLAN_VERSION_NOT_EDITABLE',
    );
    await expectProblem(
      await post(request, `/api/plan-versions/${v1.id}/approve`, {}, 'budget-owner'),
      403,
      'FORBIDDEN',
    );
    const approved = await expectContract(
      await post(request, `/api/plan-versions/${v1.id}/approve`, {}),
      200,
      PlanVersionDetail,
    );
    expect(approved.status).toBe('approved');
    const applied = await expectContract(
      await post(request, `/api/plan-versions/${v1.id}/apply`, {}),
      200,
      ApplyPlanVersionResult,
    );
    expect(applied.createdBudgetIds).toHaveLength(1);
    expect(applied.planVersion.controlling).toBe(true);
    const rootId = applied.createdBudgetIds[0];
    const root = await budget(request, rootId);
    expect(root).toMatchObject({ code, planVersionId: v1.id, parentId: null, currency: 'USD' });
    expect(bal(root).authorized).toBe(50_000);
    let t = await tieOut(request, FY27);
    expect(t).toMatchObject({ planVersionId: v1.id, tiedOut: true, differenceMinor: 0 });
    expect(t.planTotalMinor).toBe(t.rootAuthorizedMinor + t.savingsMinor);

    // Cut part of the root to savings: plan = roots + savings still ties out.
    const pv = await preview(request, rootId, {
      action: 'reduce',
      amountMinor: 5_000,
      destination: 'savings',
    });
    await expectContract(
      await post(request, `/api/budgets/${rootId}/reduce`, {
        amountMinor: 5_000,
        destination: 'savings',
        reasonCode: 'RED-COST-SAVING',
        reason: 'Savings target',
        confirmedFloorMinor: pv.floorMinor,
      }),
      200,
      ControlResult,
    );
    t = await tieOut(request, FY27);
    expect(t.tiedOut).toBe(true);
    expect(t.savingsMinor).toBeGreaterThanOrEqual(5_000);

    // Revision: +10,000 for this root (plan funding in); the version supersedes the previous one.
    const v2 = await nextVersion(request, [], (l) => (l.code === code ? 60_000 : null));
    const line = v2.lines.find((l) => l.code === code)!;
    expect(line).toMatchObject({
      amountMinor: 60_000,
      rootAuthorizedMinor: 45_000,
      savingsMinor: 5_000,
      differenceMinor: 10_000,
    });
    await post(request, `/api/plan-versions/${v2.id}/approve`, {}, 'finance-admin-2');
    await post(request, `/api/plan-versions/${v2.id}/approve`, {}, 'ceo');
    const a2 = await expectContract(
      await post(request, `/api/plan-versions/${v2.id}/apply`, {}),
      200,
      ApplyPlanVersionResult,
    );
    expect(a2.adjustedBudgetIds).toContain(rootId);
    expect(bal(await budget(request, rootId)).authorized).toBe(55_000);
    t = await tieOut(request, FY27);
    expect(t).toMatchObject({ planVersionId: v2.id, tiedOut: true });
    const old = await expectContract(
      await request.get(`/api/plan-versions/${v1.id}`, { headers: await as('finance-admin') }),
      200,
      PlanVersionDetail,
    );
    expect(old.status).toBe('superseded');

    // A revision that cuts more than the root has unallocated is refused.
    const child = await expectContract(
      await post(request, '/api/budgets', {
        name: 'FY2027 scenario team',
        parentId: rootId,
        legalEntityId: SEED.legalEntities.acmeUs,
        fiscalYearId: FY27,
      }),
      201,
      BudgetDetail,
    );
    await allocateOk(request, rootId, child.id, USD(50_000), { as: 'finance-admin' });
    const v3 = await nextVersion(request, [], (l) => (l.code === code ? 30_000 : null));
    await post(request, `/api/plan-versions/${v3.id}/approve`, {});
    await expectProblem(
      await post(request, `/api/plan-versions/${v3.id}/apply`, {}),
      409,
      'REDUCTION_BELOW_FLOOR',
    );
    expect((await tieOut(request, FY27)).tiedOut).toBe(true);
  });

  test('spreadsheet import maps columns, reports row errors, and accepts tab-separated paste', async ({
    request,
  }) => {
    const code = `IMP-${randomUUID().slice(0, 5).toUpperCase()}`;
    const csv = [
      'Program code,Program,Budget (USD),Entity,Owner',
      `${code},Imported program,"25,000.00",HYL-US,ceo@example.test`,
      `${code}-B,Bad amount,abc,HYL-XX,nobody@example.test`,
    ].join('\n');
    const mapping = {
      code: 'Program code',
      name: 'Program',
      amount: 'Budget (USD)',
      legalEntity: 'Entity',
      ownerEmail: 'Owner',
    };
    const dry = await expectContract(
      await post(request, '/api/plan-versions/import', {
        fiscalYearId: FY27,
        kind: 'forecast',
        label: 'Import check',
        csv,
        mapping,
        dryRun: true,
      }),
      200,
      PlanImportResult,
    );
    expect(dry.valid).toBe(false);
    expect(dry.rows[0]).toMatchObject({ code, amountMinor: 2_500_000, errors: [] });
    expect(dry.rows[0].legalEntityId).toBeTruthy();
    expect(dry.rows[1].errors).toHaveLength(3);
    await expectProblem(
      await post(request, '/api/plan-versions/import', {
        fiscalYearId: FY27,
        kind: 'forecast',
        label: 'Import check',
        csv,
        mapping,
        dryRun: false,
      }),
      422,
      'IMPORT_INVALID',
    );
    await expectProblem(
      await post(request, '/api/plan-versions/import', {
        fiscalYearId: FY27,
        kind: 'forecast',
        label: 'Bad mapping',
        csv,
        mapping: { ...mapping, amount: 'Nope' },
        dryRun: true,
      }),
      422,
      'IMPORT_INVALID',
    );
    const tsv = ['Program code\tProgram\tBudget (USD)', `${code}\tImported program\t25000`].join(
      '\n',
    );
    const saved = await expectContract(
      await post(request, '/api/plan-versions/import', {
        fiscalYearId: FY27,
        kind: 'forecast',
        label: 'Forecast import',
        csv: tsv,
        mapping: { code: 'Program code', name: 'Program', amount: 'Budget (USD)' },
        dryRun: false,
      }),
      200,
      PlanImportResult,
    );
    expect(saved.planVersion).toMatchObject({
      status: 'draft',
      kind: 'forecast',
      source: 'import',
      totalMinor: 2_500_000,
      lineCount: 1,
    });
    await post(request, `/api/plan-versions/${saved.planVersion!.id}/approve`, {});
    await expectProblem(
      await post(request, `/api/plan-versions/${saved.planVersion!.id}/apply`, {}),
      422,
      'VALIDATION_FAILED',
    );
  });

  test('roll forward clones the tree into the next year under its plan version', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 80_000, name: 'Roll FY2026 program' });
    const a = await createChild(request, root.id, { currency: 'USD' });
    const aa = await createChild(request, a.id, { currency: 'USD' });
    await allocateOk(request, root.id, a.id, USD(30_001));
    await allocateOk(request, a.id, aa.id, USD(10_000));
    const rfVersion = await nextVersion(request, [
      {
        code: root.code!,
        name: 'Roll FY2027 program',
        amountMinor: 88_000,
        legalEntityId: SEED.legalEntities.acmeUs,
      },
    ]);
    await post(request, `/api/plan-versions/${rfVersion.id}/approve`, {}, 'finance-admin-2');
    await post(request, `/api/plan-versions/${rfVersion.id}/approve`, {}, 'ceo');
    const planVersionId = rfVersion.id;
    const body = { targetFiscalYearId: FY27, planVersionId, scalePct: 110 };
    const dry = await expectContract(
      await post(request, `/api/budgets/${root.id}/roll-forward`, { ...body, dryRun: true }),
      200,
      RollForwardResult,
    );
    expect(dry.budgets.map((b) => [b.name, b.amountMinor])).toEqual([
      ['Roll FY2027 program', 88_000],
      [a.name, 33_001],
      [aa.name, 11_000],
    ]);
    await expectProblem(
      await post(request, `/api/budgets/${a.id}/roll-forward`, { ...body, dryRun: true }),
      422,
      'VALIDATION_FAILED',
    );
    const done = await expectContract(
      await post(request, `/api/budgets/${root.id}/roll-forward`, { ...body, dryRun: false }),
      200,
      RollForwardResult,
    );
    const newRoot = await budget(request, done.rootId!);
    expect(newRoot).toMatchObject({
      fiscalYearId: FY27,
      planVersionId,
      name: 'Roll FY2027 program',
    });
    expect(bal(newRoot)).toMatchObject({ authorized: 88_000, allocatedOut: 33_001 });
    expect((await tieOut(request, FY27)).tiedOut).toBe(true);
  });
});

test.describe('budget rules: phasing, limits, settings, alerts', () => {
  test('phasing splits authorized over the fiscal periods and manual amounts must add up', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 50_000 });
    const c = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, c.id, USD(12_005));
    const even = await expectContract(
      await request.put(`/api/budgets/${c.id}/phasing`, {
        headers: { ...(await as('ceo')), 'idempotency-key': randomUUID() },
        data: { method: 'even' },
      }),
      200,
      BudgetPhasing,
    );
    expect(even.periods).toHaveLength(12);
    expect(even.phasedMinor).toBe(12_005);
    expect(even.periods.map((p) => p.allotmentMinor).slice(0, 6)).toEqual([
      1_001, 1_001, 1_001, 1_001, 1_001, 1_000,
    ]);
    const put = async (data: unknown) =>
      request.put(`/api/budgets/${c.id}/phasing`, {
        headers: { ...(await as('ceo')), 'idempotency-key': randomUUID() },
        data,
      });
    await expectProblem(
      await put({ method: 'manual', amountsMinor: Array(12).fill(1_000) }),
      422,
      'PHASING_TOTAL_MISMATCH',
    );
    const seasonal = await expectContract(
      await put({ method: 'seasonal', weights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4] }),
      200,
      BudgetPhasing,
    );
    expect(seasonal.periods[11].allotmentMinor).toBeGreaterThan(
      seasonal.periods[0].allotmentMinor * 3,
    );
    expect((await budget(request, c.id)).phasingMethod).toBe('seasonal');
    await allocateOk(request, root.id, c.id, USD(1));
    const stale = await expectContract(
      await request.get(`/api/budgets/${c.id}/phasing`, { headers: await as('ceo') }),
      200,
      BudgetPhasing,
    );
    expect(stale.outOfDate).toBe(true);
  });

  test('limits by location and category feed the spend check; only the parent owner sets them', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000, owner: 'regional-manager' });
    const c = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'location-manager',
      as: 'finance-admin',
    });
    await allocateOk(request, root.id, c.id, USD(60_000), { as: 'finance-admin' });
    const items = [
      {
        kind: 'per_person',
        categoryCode: null,
        orgUnitId: SEED.orgUnits.bengaluru,
        amountMinor: 2_500,
        mode: 'hard',
      },
      { kind: 'per_event', categoryCode: null, orgUnitId: null, amountMinor: 20_000, mode: 'soft' },
      {
        kind: 'category',
        categoryCode: 'team_lunch',
        orgUnitId: null,
        amountMinor: 10_000,
        mode: 'hard',
      },
    ];
    const set = async (user: 'location-manager' | 'regional-manager') =>
      request.put(`/api/budgets/${c.id}/limits`, {
        headers: { ...(await as(user)), 'idempotency-key': randomUUID() },
        data: { items },
      });
    await expectProblem(await set('location-manager'), 403, 'FORBIDDEN');
    const limits = await expectContract(await set('regional-manager'), 200, BudgetLimits);
    expect(limits.items.find((l) => l.kind === 'per_person')?.orgUnitName).toBe('Bengaluru');
    const ok = await spendCheck(request, c.id, {
      amountMinor: 2_000,
      orgUnitId: SEED.orgUnits.bengaluru,
      plannedAttendance: 1,
    });
    expect(ok.outcome).toBe('ok');
    const perPerson = await spendCheck(request, c.id, {
      amountMinor: 30_000,
      orgUnitId: SEED.orgUnits.bengaluru,
      plannedAttendance: 10,
    });
    expect(perPerson.outcome).toBe('blocked');
    expect(perPerson.limits.map((l) => [l.kind, l.outcome])).toEqual([
      ['per_person', 'blocked'],
      ['per_event', 'warning'],
    ]);
    const cat = await spendCheck(request, c.id, {
      amountMinor: 3_000,
      categoryCode: 'team_lunch',
      categoryCommittedMinor: 8_000,
    });
    expect(cat.limits[0]).toMatchObject({
      kind: 'category',
      outcome: 'blocked',
      valueMinor: 11_000,
    });
    const over = await spendCheck(request, c.id, { amountMinor: 60_001 });
    expect(over).toMatchObject({ outcome: 'blocked', availableMinor: 60_000 });
  });

  test('settings use optimistic concurrency; owners tune thresholds, the parent owner governs the control mode', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 50_000, owner: 'regional-manager' });
    const c = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'location-manager',
      as: 'finance-admin',
    });
    const put = async (
      user: 'location-manager' | 'regional-manager',
      data: Record<string, unknown>,
    ) =>
      request.put(`/api/budgets/${c.id}/settings`, {
        headers: { ...(await as(user)), 'idempotency-key': randomUUID() },
        data,
      });
    const v = (await budget(request, c.id)).version;
    const own = await expectContract(
      await put('location-manager', {
        expectedVersion: v,
        alertThresholdsPct: [90, 60],
        reason: 'Earlier warning',
      }),
      200,
      BudgetDetail,
    );
    expect(own.alertThresholdsPct).toEqual([60, 90]);
    await expectProblem(
      await put('location-manager', { expectedVersion: v, name: 'Stale edit' }),
      409,
      'VERSION_CONFLICT',
    );
    await expectProblem(
      await put('location-manager', {
        expectedVersion: own.version,
        control: { basis: ['allocated_out'], mode: 'track', toleranceBps: 0 },
      }),
      403,
      'FORBIDDEN',
    );
    const governed = await expectContract(
      await put('regional-manager', {
        expectedVersion: own.version,
        control: {
          basis: ['allocated_out', 'encumbered', 'actual'],
          mode: 'soft',
          toleranceBps: 500,
        },
      }),
      200,
      BudgetDetail,
    );
    expect(governed.control).toEqual({
      basis: ['allocated_out', 'encumbered', 'actual'],
      mode: 'soft',
      toleranceBps: 500,
    });
    const versions = await expectContract(
      await request.get(`/api/budgets/${c.id}/versions`, { headers: await as('location-manager') }),
      200,
      BudgetVersionList,
    );
    expect(versions.items.map((x) => x.reason)).toEqual(
      expect.arrayContaining(['Earlier warning', 'Created']),
    );
  });

  test('crossing an owner alert threshold publishes budget.threshold_crossed', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 50_000 });
    const c = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, c.id, USD(10_000));
    await openingBalance(request, c.id, 'actual', 7_000);
    expect((await budget(request, c.id)).thresholdsReachedPct).toEqual([50]);
    const pv = await preview(request, c.id, {
      action: 'reduce',
      amountMinor: 2_000,
      destination: 'parent',
    });
    await expectContract(
      await post(request, `/api/budgets/${c.id}/reduce`, {
        amountMinor: 2_000,
        destination: 'parent',
        reasonCode: 'RED-COST-SAVING',
        reason: 'Trim',
        confirmedFloorMinor: pv.floorMinor,
      }),
      200,
      ControlResult,
    );
    const after = await budget(request, c.id);
    expect(after.utilizationBps).toBe(8_750);
    expect(after.thresholdsReachedPct).toEqual([50, 80]);
    const events = await asOwner(
      async (db) =>
        (
          await db.query<{ payload: Record<string, unknown> }>(
            `select payload from outbox_messages where topic = 'budget.threshold_crossed' and payload->>'budgetId' = $1 order by created_at`,
            [c.id],
          )
        ).rows,
    );
    // 50% was reached by the actual itself (alerts fire from spend), 80% by the reduction.
    expect(events.map((e) => e.payload['thresholdPct'])).toEqual([50, 80]);
  });

  test("a parent's owner is alerted when spend in a child crosses the parent's threshold", async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 10_000, owner: 'regional-manager' });
    const c = await createChild(request, root.id, { currency: 'USD', as: 'finance-admin' });
    await allocateOk(request, root.id, c.id, USD(9_000), { as: 'finance-admin' });
    const thresholds = async (budgetId: string) =>
      asOwner(async (db) =>
        (
          await db.query<{ payload: Record<string, unknown> }>(
            `select payload from outbox_messages where topic = 'budget.threshold_crossed' and payload->>'budgetId' = $1 order by created_at`,
            [budgetId],
          )
        ).rows.map((r) => r.payload),
      );
    await openingBalance(request, c.id, 'actual', 6_000);
    expect((await budget(request, root.id)).utilizationBps).toBe(6_000);
    await openingBalance(request, c.id, 'encumbered', 2_500);
    const parent = await budget(request, root.id);
    expect(parent.utilizationBps).toBe(8_500);
    expect(parent.thresholdsReachedPct).toEqual([50, 80]);
    const events = await thresholds(root.id);
    expect(events.map((e) => e['thresholdPct'])).toEqual([50, 80]);
    expect(events[0]['ownerPersonId']).toBe(root.ownerPersonId);
    expect((await thresholds(c.id)).map((e) => e['thresholdPct'])).toEqual([50, 80]);
  });
});

test.describe('Available, roll-ups and scope', () => {
  test('company-wide Available counts child allocations once; the budget explains its own rules', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const c = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, c.id, USD(30_000));
    await openingBalance(request, c.id, 'pre_encumbered', 1_000);
    await openingBalance(request, c.id, 'encumbered', 2_000);
    await openingBalance(request, c.id, 'actual', 3_000);
    await openingBalance(request, root.id, 'encumbered', 500);
    const s = await expectContract(
      await request.get(`/api/budgets/summary?rootId=${root.id}`, { headers: await as('ceo') }),
      200,
      BudgetSummary,
    );
    expect(s).toMatchObject({
      scope: 'budget',
      authorized: USD(100_000),
      preEncumbered: USD(1_000),
      encumbered: USD(2_500),
      actual: USD(3_000),
      available: USD(93_500),
      budgetCount: 2,
      utilizationBps: 550,
    });
    const r = await budget(request, root.id, 'ceo');
    expect(r.available.companyWide).toEqual(USD(93_500));
    expect(r.available.underRules).toEqual(USD(69_500));
    expect(r.available.difference).toEqual(USD(24_000));
    expect(r.available.reasons).toEqual([
      { kind: 'allocated_to_children', amountMinor: 30_000 },
      { kind: 'children_spend', amountMinor: -6_000 },
    ]);
    const history = await expectContract(
      await request.get(`/api/budgets/${c.id}/allocation-history`, { headers: await as('ceo') }),
      200,
      AllocationHistory,
    );
    expect(history.items[0]).toMatchObject({
      direction: 'in',
      bucket: 'authorized',
      amount: USD(30_000),
    });
    expect(history.items[0].counterparties).toEqual([{ budgetId: root.id, name: root.name }]);
  });

  test('company-wide Available subtracts held money; parent utilization rolls up child spend once', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const c = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, c.id, USD(50_000));
    await openingBalance(request, c.id, 'held', 2_000);
    await openingBalance(request, root.id, 'held', 1_000);
    await openingBalance(request, c.id, 'pre_encumbered', 1_000);
    await openingBalance(request, c.id, 'encumbered', 5_000);
    await openingBalance(request, c.id, 'actual', 3_000);
    const s = await expectContract(
      await request.get(`/api/budgets/summary?rootId=${root.id}`, { headers: await as('ceo') }),
      200,
      BudgetSummary,
    );
    expect(s).toMatchObject({
      authorized: USD(100_000),
      held: USD(3_000),
      preEncumbered: USD(1_000),
      encumbered: USD(5_000),
      actual: USD(3_000),
      available: USD(88_000),
      utilizationBps: 800,
    });
    const r = await budget(request, root.id, 'ceo');
    expect(r.available.companyWide).toEqual(s.available);
    expect(r.available.underRules).toEqual(USD(49_000));
    expect(r.available.reasons).toEqual([
      { kind: 'allocated_to_children', amountMinor: 50_000 },
      { kind: 'children_spend', amountMinor: -11_000 },
    ]);
    expect(r.utilizationBps).toBe(s.utilizationBps);
    expect((await budget(request, c.id, 'ceo')).utilizationBps).toBe(1_600);
    const hierarchy = await expectContract(
      await request.get(`/api/budgets?rootId=${root.id}`, { headers: await as('ceo') }),
      200,
      BudgetList,
    );
    expect(hierarchy.items.find((b) => b.id === root.id)?.utilizationBps).toBe(800);
  });

  test('owners see their subtree only, in lists, roll-ups and controls', async ({ request }) => {
    const headers = await as('regional-manager');
    const list = await expectContract(
      await request.get(`/api/budgets?rootId=${SEED.budgets.india}&limit=500`, { headers }),
      200,
      BudgetList,
    );
    expect(list.items.every((b) => b.path.includes(SEED.budgets.india))).toBe(true);
    expect(list.items.map((b) => b.id)).toEqual(
      expect.arrayContaining([SEED.budgets.india, SEED.budgets.bengaluru, SEED.budgets.hyderabad]),
    );
    const sum = await expectContract(
      await request.get(`/api/budgets/summary?rootId=${SEED.budgets.india}`, { headers }),
      200,
      BudgetSummary,
    );
    expect(sum.authorized).toEqual(USD(SEED.indiaAuthorizedMinor));
    await expectProblem(
      await request.get(`/api/budgets/summary?rootId=${SEED.budgets.unitedStates}`, { headers }),
      404,
      'NOT_FOUND',
    );
    await expectProblem(
      await request.post(`/api/budgets/${SEED.budgets.unitedStates}/controls/preview`, {
        headers,
        data: { action: 'freeze' },
      }),
      404,
      'NOT_FOUND',
    );
    const india = await budget(request, SEED.budgets.india, 'regional-manager');
    expect(india.allowedActions).not.toContain('budget.control');
    expect(india.allowedActions).toContain('budget.settings');
    const blr = await budget(request, SEED.budgets.bengaluru, 'regional-manager');
    expect(blr.allowedActions).toEqual(
      expect.arrayContaining(['budget.control', 'budget.transfer']),
    );
    await expectProblem(await request.get('/api/plan-versions', { headers }), 403, 'FORBIDDEN');
    const check: SpendCheckResult = await spendCheck(request, SEED.budgets.bengaluru, {
      amountMinor: 100,
    });
    expect(check.outcome).toBe('ok');
  });

  test('the ledger rebuild equals cached balances after every Phase 4 posting', async ({
    request,
  }) => {
    const run = await rebuildCheck(request);
    expect(run.status, JSON.stringify(run)).toBe('clean');
  });
});
