// Year-end roll-forward must not mint money: what a budget carries plus what it lapses equals what
// it had, both years' journals balance, FY plan rates stay locked per year, carried commitments keep
// their amount, and the ledger rebuild still finds cached balances equal to a rebuild from the
// ledger. The run owns scenario-created roots in FY2026 and FY2027, so no seeded budget moves.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  BudgetDetail,
  CommitmentHygieneList,
  IntegrityCheckRun,
  Journal,
  YearEndRun,
} from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { asAppRole } from '../support/db';
import { createCommitment } from '../actuals/support';
import {
  childInYear,
  ledgerCheck,
  policyIdByCode,
  rootInYear,
  setRolloverPolicy,
  uniq,
  yearEndRun,
} from './support';

test.describe.configure({ mode: 'serial' });

const FY2026 = SEED.fiscalYears.acmeFy2026;
const FY2027 = SEED.fiscalYears.acmeFy2027;

async function budget(request: APIRequestContext, id: string) {
  return expectContract(
    await request.get(`/api/budgets/${id}`, { headers: await as('finance-admin') }),
    200,
    BudgetDetail,
  );
}

async function journal(request: APIRequestContext, id: string) {
  return expectContract(
    await request.get(`/api/ledger/journals/${id}`, { headers: await as('finance-admin') }),
    200,
    Journal,
  );
}

/** A matching FY2026 and FY2027 tree: same codes, so the run finds each budget's counterpart. */
async function matchedTrees(
  request: APIRequestContext,
  opts: { rootMinor: number; childMinor: number },
) {
  const suffix = uniq();
  const rootCode = `YE-${suffix}`;
  const childCode = `YE-${suffix}-C`;
  const source = await rootInYear(request, {
    fiscalYearId: FY2026,
    amountMinor: opts.rootMinor,
    code: rootCode,
    name: `Year-end source ${suffix}`,
  });
  const sourceChild = await childInYear(request, source.budget.id, {
    fiscalYearId: FY2026,
    code: childCode,
    name: `Year-end source child ${suffix}`,
  });
  const alloc = await request.post(`/api/budgets/${source.budget.id}/allocations`, {
    headers: await mutate('finance-admin'),
    data: {
      childBudgetId: sourceChild.id,
      amount: { amountMinor: opts.childMinor, currency: 'USD' },
    },
  });
  expect(alloc.status(), await alloc.text()).toBe(201);
  const target = await rootInYear(request, {
    fiscalYearId: FY2027,
    amountMinor: opts.rootMinor,
    code: rootCode,
    name: `Year-end source ${suffix}`,
  });
  const targetChild = await childInYear(request, target.budget.id, {
    fiscalYearId: FY2027,
    code: childCode,
    name: `Year-end source child ${suffix}`,
  });
  return { suffix, source, sourceChild, target, targetChild };
}

test.describe('fiscal year-end run', () => {
  test('a dry run splits what every budget has into carry and lapse and posts nothing', async ({
    request,
  }) => {
    const trees = await matchedTrees(request, { rootMinor: 500_000, childMinor: 120_000 });
    await setRolloverPolicy(
      request,
      trees.sourceChild.id,
      await policyIdByCode(request, 'CARRY-25'),
    );
    await setRolloverPolicy(
      request,
      trees.source.budget.id,
      await policyIdByCode(request, 'LAPSE'),
    );

    const created = await expectContract(
      await request.post('/api/close/year-end-runs', {
        headers: await mutate('finance-admin'),
        data: {
          rootBudgetId: trees.source.budget.id,
          targetFiscalYearId: FY2027,
          targetPlanVersionId: trees.target.planVersionId,
          commitmentFreezeDate: '2026-12-15',
        },
      }),
      201,
      YearEndRun,
    );
    expect(created.status).toBe('draft');
    expect(created.executeConfirmation).toBe('RUN YEAR END FY2026');

    const dry = await expectContract(
      await request.post(`/api/close/year-end-runs/${created.id}/dry-run`, {
        headers: await mutate('finance-admin'),
      }),
      201,
      YearEndRun,
    );
    expect(dry.status).toBe('dry_run');
    expect(dry.journalIds).toEqual([]);

    const childLine = dry.lines.find((l) => l.budgetId === trees.sourceChild.id)!;
    // Carry and lapse always add up to what the budget had: a dry run never creates or loses money.
    expect(childLine.carryMinor + childLine.lapseMinor).toBe(childLine.availableMinor);
    // CARRY-25 caps the carry at 25% of authorized; the rest lapses to the parent.
    expect(childLine).toMatchObject({
      availableMinor: 120_000,
      carryMinor: 30_000,
      lapseMinor: 90_000,
      sweepToName: trees.source.budget.name,
      targetBudgetId: trees.targetChild.id,
      status: 'planned',
    });
    const rootLine = dry.lines.find((l) => l.budgetId === trees.source.budget.id)!;
    expect(rootLine).toMatchObject({ carryMinor: 0, lapseMinor: 380_000 });

    // Nothing moved.
    expect(
      (await budget(request, trees.sourceChild.id)).balances.budgetCurrency.authorized.amountMinor,
    ).toBe(120_000);
  });

  test('execution carries and lapses without minting money and both years stay rebuildable', async ({
    request,
  }) => {
    const trees = await matchedTrees(request, { rootMinor: 400_000, childMinor: 100_000 });
    await setRolloverPolicy(
      request,
      trees.sourceChild.id,
      await policyIdByCode(request, 'CARRY-FULL'),
    );
    await setRolloverPolicy(
      request,
      trees.source.budget.id,
      await policyIdByCode(request, 'LAPSE'),
    );

    const created = await expectContract(
      await request.post('/api/close/year-end-runs', {
        headers: await mutate('finance-admin'),
        data: {
          rootBudgetId: trees.source.budget.id,
          targetFiscalYearId: FY2027,
          targetPlanVersionId: trees.target.planVersionId,
        },
      }),
      201,
      YearEndRun,
    );
    await request.post(`/api/close/year-end-runs/${created.id}/dry-run`, {
      headers: await mutate('finance-admin'),
    });

    const beforeSourceRoot = await budget(request, trees.source.budget.id);
    const beforeTargetChild = await budget(request, trees.targetChild.id);

    const mistyped = await request.post(`/api/close/year-end-runs/${created.id}/execution`, {
      headers: await mutate('finance-admin'),
      data: { confirmation: 'run it' },
    });
    expect(mistyped.status()).toBe(422);
    expect((await mistyped.json()).code).toBe('CONFIRMATION_MISMATCH');

    const done = await expectContract(
      await request.post(`/api/close/year-end-runs/${created.id}/execution`, {
        headers: await mutate('finance-admin'),
        data: { confirmation: 'RUN YEAR END FY2026' },
      }),
      201,
      YearEndRun,
    );
    expect(done.status).toBe('completed');
    expect(done.journalIds.length).toBeGreaterThan(0);

    // Every journal the run posted balances in both currency views.
    for (const id of done.journalIds) {
      const j = await journal(request, id);
      expect({ id, balanced: j.balanced }).toEqual({ id, balanced: true });
      expect(j.totals.debitReportingMinor).toBe(j.totals.creditReportingMinor);
    }

    // The child gave up everything it had; the target counterpart received exactly that.
    const afterSourceChild = await budget(request, trees.sourceChild.id);
    const afterTargetChild = await budget(request, trees.targetChild.id);
    expect(afterSourceChild.balances.budgetCurrency.authorized.amountMinor).toBe(0);
    expect(afterTargetChild.balances.budgetCurrency.authorized.amountMinor).toBe(
      beforeTargetChild.balances.budgetCurrency.authorized.amountMinor + 100_000,
    );

    // The ending year's root kept nothing either: it lapsed what was left after the child returned.
    const afterSourceRoot = await budget(request, trees.source.budget.id);
    expect(afterSourceRoot.balances.budgetCurrency.authorized.amountMinor).toBe(0);
    expect(beforeSourceRoot.balances.budgetCurrency.authorized.amountMinor).toBe(400_000);

    const check = await ledgerCheck(request, 'finance-controller');
    expect(check.status, JSON.stringify(check.summary)).toBe('clean');
    expect((check as unknown as typeof IntegrityCheckRun._output).flagsRaised).toBe(0);

    // A second execution never posts twice.
    const again = await request.post(`/api/close/year-end-runs/${created.id}/execution`, {
      headers: await mutate('finance-admin'),
      data: { confirmation: 'RUN YEAR END FY2026' },
    });
    expect(again.status()).toBe(409);
    expect((await again.json()).code).toBe('YEAR_END_ALREADY_EXECUTED');
  });

  test('a carry that needs approval waits for the Finance Controller and can be approved in part', async ({
    request,
  }) => {
    const trees = await matchedTrees(request, { rootMinor: 300_000, childMinor: 80_000 });
    await setRolloverPolicy(
      request,
      trees.sourceChild.id,
      await policyIdByCode(request, 'CARRY-APPROVAL'),
    );
    await setRolloverPolicy(
      request,
      trees.source.budget.id,
      await policyIdByCode(request, 'LAPSE'),
    );
    const created = await expectContract(
      await request.post('/api/close/year-end-runs', {
        headers: await mutate('finance-admin'),
        data: {
          rootBudgetId: trees.source.budget.id,
          targetFiscalYearId: FY2027,
          targetPlanVersionId: trees.target.planVersionId,
        },
      }),
      201,
      YearEndRun,
    );
    const dry = await expectContract(
      await request.post(`/api/close/year-end-runs/${created.id}/dry-run`, {
        headers: await mutate('finance-admin'),
      }),
      201,
      YearEndRun,
    );
    const line = dry.lines.find((l) => l.budgetId === trees.sourceChild.id)!;
    expect(line.status).toBe('awaiting_approval');
    expect(dry.readiness.find((r) => r.code === 'carry_approvals_decided')).toMatchObject({
      passed: false,
      blocksExecution: true,
    });

    const tooEarly = await request.post(`/api/close/year-end-runs/${created.id}/execution`, {
      headers: await mutate('finance-admin'),
      data: { confirmation: 'RUN YEAR END FY2026' },
    });
    expect(tooEarly.status()).toBe(409);
    expect((await tooEarly.json()).code).toBe('YEAR_END_NOT_READY');

    // The Finance Admin who runs the year end does not decide its carries.
    const wrongRole = await request.post(
      `/api/close/year-end-runs/${created.id}/lines/${line.id}/decision`,
      {
        headers: await mutate('finance-admin'),
        data: { decision: 'approve', reason: 'Self-approving the carry.' },
      },
    );
    expect(wrongRole.status()).toBe(403);

    const tooMuch = await request.post(
      `/api/close/year-end-runs/${created.id}/lines/${line.id}/decision`,
      {
        headers: await mutate('finance-controller'),
        data: {
          decision: 'approve_part',
          approvedCarryMinor: 90_000,
          reason: 'More than was asked for.',
        },
      },
    );
    expect(tooMuch.status()).toBe(409);
    expect((await tooMuch.json()).code).toBe('LIMIT_EXCEEDED');

    const decided = await expectContract(
      await request.post(`/api/close/year-end-runs/${created.id}/lines/${line.id}/decision`, {
        headers: await mutate('finance-controller'),
        data: {
          decision: 'approve_part',
          approvedCarryMinor: 50_000,
          reason: 'Half carries; the rest funds next year centrally.',
        },
      }),
      201,
      YearEndRun,
    );
    const after = decided.lines.find((l) => l.id === line.id)!;
    expect(after).toMatchObject({ status: 'approved', carryMinor: 50_000, lapseMinor: 30_000 });
    expect(after.carryMinor + after.lapseMinor).toBe(line.availableMinor);

    const run = await yearEndRun(request, created.id);
    expect(run.readiness.find((r) => r.code === 'carry_approvals_decided')?.passed).toBe(true);
  });

  test('a budget without a rollover policy blocks its line instead of guessing', async ({
    request,
  }) => {
    const trees = await matchedTrees(request, { rootMinor: 200_000, childMinor: 50_000 });
    await setRolloverPolicy(
      request,
      trees.source.budget.id,
      await policyIdByCode(request, 'LAPSE'),
    );
    const created = await expectContract(
      await request.post('/api/close/year-end-runs', {
        headers: await mutate('finance-admin'),
        data: { rootBudgetId: trees.source.budget.id, targetFiscalYearId: FY2027 },
      }),
      201,
      YearEndRun,
    );
    const dry = await expectContract(
      await request.post(`/api/close/year-end-runs/${created.id}/dry-run`, {
        headers: await mutate('finance-admin'),
      }),
      201,
      YearEndRun,
    );
    const line = dry.lines.find((l) => l.budgetId === trees.sourceChild.id)!;
    expect(line.status).toBe('blocked');
    expect(line.blockedReason).toContain('rollover policy');
    expect(dry.readiness.find((r) => r.code === 'rollover_policies_assigned')?.passed).toBe(false);
  });

  test('an open commitment carries into the new year with its funding and keeps its amount', async ({
    request,
  }) => {
    const suffix = uniq();
    const codes = {
      root: `YEC-${suffix}`,
      dept: `YEC-${suffix}-D`,
      team: `YEC-${suffix}-T`,
    };
    // The approval chain the event funding request routes through: root, a department head's
    // budget, and the team budget whose owner runs the event.
    const build = async (fiscalYearId: string) => {
      const root = await rootInYear(request, {
        fiscalYearId,
        amountMinor: 5_000_000,
        code: codes.root,
        name: `Commitment carry ${suffix}`,
      });
      const dept = await childInYear(request, root.budget.id, {
        fiscalYearId,
        code: codes.dept,
        name: `Commitment carry dept ${suffix}`,
        owner: 'department-head',
      });
      const team = await childInYear(request, dept.id, {
        fiscalYearId,
        code: codes.team,
        name: `Commitment carry team ${suffix}`,
        owner: 'budget-owner',
        costCenterId: SEED.costCenters.hq,
      });
      for (const [parent, child, amountMinor] of [
        [root.budget.id, dept.id, 2_000_000],
        [dept.id, team.id, 900_000],
      ] as const) {
        const res = await request.post(`/api/budgets/${parent}/allocations`, {
          headers: await mutate('finance-admin'),
          data: { childBudgetId: child, amount: { amountMinor, currency: 'USD' } },
        });
        expect(res.status(), await res.text()).toBe(201);
      }
      return { root, dept, team };
    };
    const source = await build(FY2026);
    const target = await build(FY2027);
    const sourceChild = source.team;
    const targetChild = target.team;
    const commitment = await createCommitment(request, {
      budgetId: sourceChild.id,
      amountMinor: 150_000,
      costCenterId: SEED.costCenters.hq,
      description: 'Venue hold that runs into the new year',
      serviceStart: '2027-01-20',
      serviceEnd: '2027-01-22',
    });
    for (const id of [source.root.budget.id, source.dept.id, sourceChild.id]) {
      await setRolloverPolicy(request, id, await policyIdByCode(request, 'LAPSE'));
    }

    const created = await expectContract(
      await request.post('/api/close/year-end-runs', {
        headers: await mutate('finance-admin'),
        data: {
          rootBudgetId: source.root.budget.id,
          targetFiscalYearId: FY2027,
          targetPlanVersionId: target.root.planVersionId,
          commitmentFreezeDate: '2026-12-15',
        },
      }),
      201,
      YearEndRun,
    );
    const dry = await expectContract(
      await request.post(`/api/close/year-end-runs/${created.id}/dry-run`, {
        headers: await mutate('finance-admin'),
      }),
      201,
      YearEndRun,
    );
    const line = dry.lines.find((l) => l.budgetId === sourceChild.id)!;
    expect(line).toMatchObject({ openCommitmentCount: 1, openCommitmentMinor: 150_000 });

    const beforeTarget = await budget(request, targetChild.id);
    const done = await expectContract(
      await request.post(`/api/close/year-end-runs/${created.id}/execution`, {
        headers: await mutate('finance-admin'),
        data: { confirmation: 'RUN YEAR END FY2026' },
      }),
      201,
      YearEndRun,
    );
    expect(done.status).toBe('completed');

    // The ending year released the encumbrance; the new year holds the same amount again.
    const afterSource = await budget(request, sourceChild.id);
    const afterTarget = await budget(request, targetChild.id);
    expect(afterSource.balances.budgetCurrency.encumbered.amountMinor).toBe(0);
    expect(afterTarget.balances.budgetCurrency.encumbered.amountMinor).toBe(
      beforeTarget.balances.budgetCurrency.encumbered.amountMinor + 150_000,
    );
    // The money that backed the commitment travelled with it, so the new year's available is
    // unchanged by the carry: authorized and encumbered both rose by the same amount.
    expect(afterTarget.balances.budgetCurrency.authorized.amountMinor).toBe(
      beforeTarget.balances.budgetCurrency.authorized.amountMinor + 150_000,
    );
    expect(afterTarget.balances.available.amountMinor).toBe(
      beforeTarget.balances.available.amountMinor,
    );
    // The ending year has nothing left to spend: everything available lapsed, and what it still
    // shows as authorized is exactly the event funding its other buckets still hold.
    expect(afterSource.balances.available.amountMinor).toBe(0);
    const held = afterSource.balances.budgetCurrency;
    expect(held.authorized.amountMinor).toBe(
      held.allocatedOut.amountMinor +
        held.held.amountMinor +
        held.preEncumbered.amountMinor +
        held.encumbered.amountMinor +
        held.actual.amountMinor,
    );

    // The ending year's commitment is carried forward, not released: its history stays, and the
    // new year's twin points back at it.
    const states = await asAppRole(SEED.tenants.acme, async (c) =>
      (
        await c.query(
          `select status, carried_from_commitment_id from commitments
           where id = $1 or carried_from_commitment_id = $1
           order by carried_from_commitment_id nulls first`,
          [commitment.id],
        )
      ).rows.map((r) => r as { status: string; carried_from_commitment_id: string | null }),
    );
    expect(states).toHaveLength(2);
    expect(states[0].status).toBe('carried_forward');
    expect(states[1]).toEqual({
      status: 'encumbered',
      carried_from_commitment_id: commitment.id,
    });
    const twin = await expectContract(
      await request.get(`/api/actuals/commitments?budgetId=${targetChild.id}`, {
        headers: await as('finance-controller'),
      }),
      200,
      CommitmentHygieneList,
    );
    expect(twin.items).toHaveLength(1);
    expect(twin.items[0]).toMatchObject({
      status: 'encumbered',
      amount: { amountMinor: 150_000, currency: 'USD' },
    });

    for (const id of done.journalIds) {
      const j = await journal(request, id);
      expect({ id, balanced: j.balanced }).toEqual({ id, balanced: true });
    }
    const check = await ledgerCheck(request, 'finance-controller');
    expect(check.status, JSON.stringify(check.summary)).toBe('clean');
  });

  test('only a Finance Admin starts a year-end run', async ({ request }) => {
    const forbidden = await request.post('/api/close/year-end-runs', {
      headers: await mutate('budget-owner'),
      data: {
        rootBudgetId: SEED.budgets.employeeExperience,
        targetFiscalYearId: FY2027,
      },
    });
    expect(forbidden.status()).toBe(403);
  });
});
