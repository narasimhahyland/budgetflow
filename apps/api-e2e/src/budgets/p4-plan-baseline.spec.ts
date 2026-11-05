// Phase 4 follow-up part 2: immutable approved plan lines, plan revisions for new money, contingency root, monthly per-head rate.
import { expect, test } from '@playwright/test';
import { BudgetChangeRequest, BudgetDetail, PlanTieOut, PlanVersionDetail } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole, pgError } from '../support/db';
import { createChild, createRoot } from '../support/factory';
import { rebuildCheck } from './p4';

test.describe('Phase 4 plan baseline', () => {
  test('a root without a plan line is rejected; new money needs Finance Admin and CEO; approved plan lines are immutable', async ({
    request,
  }) => {
    await expectProblem(
      await request.post('/api/budgets', {
        headers: await mutate('ceo'),
        data: {
          name: 'Orphan root',
          code: `OR-${randomUUID().slice(0, 4)}`,
          legalEntityId: SEED.legalEntities.acmeUs,
          currency: 'USD',
          fiscalYearId: SEED.fiscalYears.acmeFy2026,
          planVersionId: SEED.planVersions.acmeFy2026Original,
          originalAmount: { amountMinor: 50_000, currency: 'USD' },
        },
      }),
      409,
      'PLAN_REVISION_REQUIRED',
    );

    const insErr = await pgError(
      asAppRole(SEED.tenants.acme, (c) =>
        c.query(
          `insert into plan_version_lines (tenant_id, plan_version_id, line_no, code, name, amount_minor, currency)
           values ($1, $2, 99, 'ILLEGAL', 'Illegal insert', 100, 'USD')`,
          [SEED.tenants.acme, SEED.planVersions.acmeFy2026Original],
        ),
      ),
    );
    expect(insErr?.message).toContain('plan_version_line_immutable');
    const updErr = await pgError(
      asAppRole(SEED.tenants.acme, (c) =>
        c.query(
          `update plan_version_lines set amount_minor = amount_minor + 1 where plan_version_id = $1`,
          [SEED.planVersions.acmeFy2026Original],
        ),
      ),
    );
    expect(updErr?.message).toContain('plan_version_line_immutable');
    const delErr = await pgError(
      asAppRole(SEED.tenants.acme, (c) =>
        c.query(`delete from plan_version_lines where plan_version_id = $1`, [
          SEED.planVersions.acmeFy2026Original,
        ]),
      ),
    );
    expect(delErr?.message).toContain('plan_version_line_immutable');

    const fy = SEED.fiscalYears.acmeFy2026;
    const tie = await request.get(`/api/plan-versions/tie-out?fiscalYearId=${fy}`, {
      headers: await as('finance-admin'),
    });
    const baseId = (await tie.json()).planVersionId as string;
    const newCode = `NM-${randomUUID().slice(0, 4).toUpperCase()}`;
    const revision = await expectContract(
      await request.post('/api/plan-versions', {
        headers: await mutate('finance-admin'),
        data: {
          fiscalYearId: fy,
          kind: 'current',
          label: `New money ${randomUUID().slice(0, 6)}`,
          copyFromId: baseId,
          lines: [
            {
              code: newCode,
              name: 'Additive new money line',
              amountMinor: 100_000,
              legalEntityId: SEED.legalEntities.acmeUs,
            },
          ],
        },
      }),
      201,
      PlanVersionDetail,
    );

    await expectProblem(
      await request.post(`/api/plan-versions/${revision.id}/approve`, {
        headers: await mutate('finance-admin'),
      }),
      409,
      'SELF_APPROVAL',
    );

    const step1 = await expectContract(
      await request.post(`/api/plan-versions/${revision.id}/approve`, {
        headers: await mutate('finance-admin-2'),
      }),
      200,
      PlanVersionDetail,
    );
    expect(step1.status).toBe('draft');

    await expectProblem(
      await request.post(`/api/plan-versions/${revision.id}/approve`, {
        headers: await mutate('finance-admin-2'),
      }),
      409,
      'PLAN_SIGNOFF_REQUIRED',
    );

    const approved = await expectContract(
      await request.post(`/api/plan-versions/${revision.id}/approve`, {
        headers: await mutate('ceo'),
      }),
      200,
      PlanVersionDetail,
    );
    expect(approved.status).toBe('approved');

    const funded = await expectContract(
      await request.post('/api/budgets', {
        headers: await mutate('ceo'),
        data: {
          name: 'Additive new money line',
          code: newCode,
          legalEntityId: SEED.legalEntities.acmeUs,
          currency: 'USD',
          fiscalYearId: fy,
          planVersionId: revision.id,
          originalAmount: { amountMinor: 100_000, currency: 'USD' },
        },
      }),
      201,
      BudgetDetail,
    );
    expect(funded.balances.budgetCurrency.authorized.amountMinor).toBe(100_000);
    const afterTie = await expectContract(
      await request.get(`/api/plan-versions/tie-out?fiscalYearId=${fy}`, {
        headers: await as('finance-admin'),
      }),
      200,
      PlanTieOut,
    );
    expect(afterTie.tiedOut).toBe(true);
  });

  test('contingency reserve is a root; release is the cross-root move', async ({ request }) => {
    const reserve = await expectContract(
      await request.get(`/api/budgets/${SEED.budgets.contingency}`, {
        headers: await as('finance-admin'),
      }),
      200,
      BudgetDetail,
    );
    expect(reserve.parentId).toBeNull();
    expect(reserve.budgetType).toBe('contingency');
    expect(reserve.balances.budgetCurrency.authorized.amountMinor).toBe(300_000);

    const scenarioReserve = await createRoot(request, {
      amountMinor: 10_000,
      budgetType: 'contingency',
      owner: 'finance-admin',
    });
    const programRoot = await createRoot(request, { amountMinor: 40_000 });
    const team = await createChild(request, programRoot.id, { currency: 'USD' });
    const rel = await expectContract(
      await request.post(`/api/budgets/${scenarioReserve.id}/releases`, {
        headers: await mutate('finance-admin'),
        data: { toBudgetId: team.id, amountMinor: 3_000, reason: 'Cross-root contingency release' },
      }),
      201,
      BudgetChangeRequest,
    );
    const decided = await expectContract(
      await request.post(`/api/budget-requests/${rel.id}/decision`, {
        headers: await mutate('ceo'),
        data: { decision: 'approve' },
      }),
      200,
      BudgetChangeRequest,
    );
    expect(decided.status).toBe('approved');
    const teamAfter = await expectContract(
      await request.get(`/api/budgets/${team.id}`, { headers: await as('ceo') }),
      200,
      BudgetDetail,
    );
    const reserveAfter = await expectContract(
      await request.get(`/api/budgets/${scenarioReserve.id}`, { headers: await as('ceo') }),
      200,
      BudgetDetail,
    );
    expect(teamAfter.balances.budgetCurrency.authorized.amountMinor).toBe(3_000);
    expect(reserveAfter.balances.budgetCurrency.authorized.amountMinor).toBe(7_000);
    expect((await rebuildCheck(request)).status).toBe('clean');
  });

  test('scenario roots are created through plan revisions', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 250_000 });
    expect(root.parentId).toBeNull();
    expect(root.balances.budgetCurrency.authorized.amountMinor).toBe(250_000);
  });
});
