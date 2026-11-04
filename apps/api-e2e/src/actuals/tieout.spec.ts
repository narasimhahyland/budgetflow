// Invariant 15 (P6, GL tie-out): BudgetFlow actuals are compared with general ledger balances by legal
// entity, cost center, GL account and period at the locked plan rate. Differences above tolerance block the
// monthly sign-off until explained; the preparer cannot sign off; a signed-off month is locked. Each run uses
// its own legal entity so scenarios never collide with the seeded tie-outs.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { TieOut, TieOutLineDetail, TieOutList, FileExport } from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import { createCommitment, csv, importAndPost, spendBudget, uniq } from './support';

async function entityWithAccounts(request: APIRequestContext) {
  const code = `TO-${uniq()}`;
  const le = await request.post('/api/finance/legal-entities', {
    headers: await mutate('finance-admin'),
    data: {
      code,
      name: `Scenario entity ${code}`,
      country: 'IN',
      functionalCurrency: 'INR',
      fiscalCalendarId: '21000000-0000-4000-8000-000000000001',
    },
  });
  expect(le.status(), await le.text()).toBe(201);
  const entity = (await le.json()) as { id: string };
  for (const acct of ['6100', '6130', '6140']) {
    const r = await request.post('/api/finance/gl-accounts', {
      headers: await mutate('finance-admin'),
      data: {
        legalEntityId: entity.id,
        code: acct,
        name: `Account ${acct}`,
        accountType: 'expense',
      },
    });
    expect(r.status(), await r.text()).toBe(201);
  }
  const ccCode = `CC-${code}`;
  const cc = await request.post('/api/org/cost-centers', {
    headers: await mutate('finance-admin'),
    data: {
      code: ccCode,
      name: 'Scenario office',
      legalEntityId: entity.id,
      effectiveFrom: '2026-01-01',
    },
  });
  expect(cc.status(), await cc.text()).toBe(201);
  return { id: entity.id, code, ccCode };
}

const tieOut = async (
  request: APIRequestContext,
  data: Record<string, unknown>,
  user: 'finance-controller' | 'finance-admin' = 'finance-controller',
) => request.post('/api/actuals/tie-outs', { headers: await mutate(user), data });

test.describe('GL tie-out and monthly sign-off', () => {
  test('differences above tolerance block sign-off until explained; sign-off is by someone else and locks the month', async ({
    request,
  }) => {
    const e = await entityWithAccounts(request);
    const budget = await spendBudget(request, { legalEntityId: e.id });
    const c1 = await createCommitment({ budgetId: budget.id, amountMinor: 100_000 });
    const c2 = await createCommitment({ budgetId: budget.id, amountMinor: 10_000 });
    const p = `T${uniq()}`;
    await importAndPost(
      request,
      csv([
        `${p}-1,2026-11-03,83250.00,INR,${e.code},${e.ccCode},6100,,,Team event,${c1.reference},,charge`,
        `${p}-2,2026-11-03,8325.00,INR,${e.code},${e.ccCode},6140,,,Taxis,${c2.reference},,charge`,
        `${p}-3,2026-11-04,20812.50,INR,${e.code},${e.ccCode},6140,,,Train tickets,,,charge`,
      ]),
    );
    const gl = [
      'cost_center,gl_account,amount,currency',
      `${e.ccCode},6100,83250.00,INR`,
      `${e.ccCode},6140,29137.50,INR`,
      `${e.ccCode},6130,1665.00,INR`,
    ].join('\n');
    const run = await expectContract(
      await tieOut(request, {
        legalEntityId: e.id,
        month: '2026-11',
        toleranceMinor: 5_000,
        fileName: 'gl-2026-11.csv',
        content: gl,
      }),
      201,
      TieOut,
    );
    expect(run).toMatchObject({
      status: 'exceptions',
      period: { label: 'Nov 2026' },
      exceptions: 1,
      unexplainedExceptions: 1,
      unmatchedActuals: 1,
      glTotal: { amountMinor: 137_000, currency: 'USD' },
      budgetflowTotal: { amountMinor: 110_000, currency: 'USD' },
      tolerance: { amountMinor: 5_000 },
    });
    const byAccount = Object.fromEntries(run.lines.map((l) => [l.glAccountCode, l]));
    expect(byAccount['6100']).toMatchObject({
      gl: { amountMinor: 100_000 },
      budgetflow: { amountMinor: 100_000 },
      difference: { amountMinor: 0 },
      withinTolerance: true,
    });
    expect(byAccount['6140']).toMatchObject({
      difference: { amountMinor: 25_000 },
      withinTolerance: false,
      unmatchedActuals: 1,
    });
    expect(byAccount['6130']).toMatchObject({
      difference: { amountMinor: 2_000 },
      withinTolerance: true,
    });

    const drill = await expectContract(
      await request.get(`/api/actuals/tie-outs/${run.id}/lines/${byAccount['6140'].id}`, {
        headers: await as('auditor'),
      }),
      200,
      TieOutLineDetail,
    );
    expect(drill.ledgerLines.map((l) => l.sourceRef)).toEqual([`${p}-2`]);
    expect(drill.unmatchedActuals.map((a) => a.sourceRef)).toEqual([`${p}-3`]);

    expect(
      (
        await request.post(`/api/actuals/tie-outs/${run.id}/sign-off`, {
          headers: await mutate('finance-controller'),
          data: {},
        })
      ).status(),
    ).toBe(403);
    await expectProblem(
      await request.post(`/api/actuals/tie-outs/${run.id}/sign-off`, {
        headers: await mutate('finance-admin'),
        data: {},
      }),
      409,
      'TIEOUT_SIGNOFF_BLOCKED',
    );

    const explained = await expectContract(
      await request.post(
        `/api/actuals/tie-outs/${run.id}/lines/${byAccount['6140'].id}/explanation`,
        {
          headers: await mutate('finance-controller'),
          data: {
            explanation:
              'Train tickets posted in the ERP; BudgetFlow line is in the unmatched queue.',
          },
        },
      ),
      200,
      TieOut,
    );
    expect(explained.unexplainedExceptions).toBe(0);
    const before = await asOwner(async (c) =>
      Number(
        (
          await c.query(
            `select count(*) from product_analytics_events where name = 'tieout.signed_off'`,
          )
        ).rows[0].count,
      ),
    );
    const signed = await expectContract(
      await request.post(`/api/actuals/tie-outs/${run.id}/sign-off`, {
        headers: await mutate('finance-admin'),
        data: { comment: 'Signed with one explained difference' },
      }),
      200,
      TieOut,
    );
    expect(signed).toMatchObject({
      status: 'signed_off',
      signedOffByName: 'Priya Raman',
      signOffComment: 'Signed with one explained difference',
    });
    expect(
      await asOwner(async (c) =>
        Number(
          (
            await c.query(
              `select count(*) from product_analytics_events where name = 'tieout.signed_off'`,
            )
          ).rows[0].count,
        ),
      ),
    ).toBe(before + 1);

    await expectProblem(
      await request.post(
        `/api/actuals/tie-outs/${run.id}/lines/${byAccount['6140'].id}/explanation`,
        {
          headers: await mutate('finance-controller'),
          data: { explanation: 'Late change after sign-off' },
        },
      ),
      409,
      'TIEOUT_SIGNED_OFF',
    );
    await expectProblem(
      await tieOut(request, {
        legalEntityId: e.id,
        month: '2026-11',
        toleranceMinor: 5_000,
        fileName: 'again.csv',
        content: gl,
      }),
      409,
      'TIEOUT_SIGNED_OFF',
    );
    const list = await expectContract(
      await request.get(`/api/actuals/tie-outs?month=2026-11&legalEntityId=${e.id}`, {
        headers: await as('auditor'),
      }),
      200,
      TieOutList,
    );
    expect(list.items.map((i) => i.id)).toEqual([run.id]);
    const file = await expectContract(
      await request.get(`/api/actuals/tie-outs/${run.id}/export`, {
        headers: await as('finance-controller'),
      }),
      200,
      FileExport,
    );
    expect(file.content).toContain(
      `${e.code},Nov 2026,6140,${e.ccCode},350.00,100.00,250.00,USD,difference,Train tickets posted`,
    );
  });

  test('the preparer cannot sign off; auditors read but cannot prepare', async ({ request }) => {
    const e = await entityWithAccounts(request);
    const gl = ['cost_center,gl_account,amount,currency', `${e.ccCode},6100,0.01,INR`].join('\n');
    expect(
      (
        await tieOut(
          request,
          {
            legalEntityId: e.id,
            month: '2026-12',
            toleranceMinor: 100,
            fileName: 'gl.csv',
            content: gl,
          },
          'finance-controller',
        )
      ).status(),
    ).toBe(201);
    const mine = await expectContract(
      await tieOut(
        request,
        {
          legalEntityId: e.id,
          month: '2026-12',
          toleranceMinor: 100,
          fileName: 'gl.csv',
          content: gl,
        },
        'finance-admin',
      ),
      201,
      TieOut,
    );
    expect(mine.status).toBe('reconciled');
    await expectProblem(
      await request.post(`/api/actuals/tie-outs/${mine.id}/sign-off`, {
        headers: await mutate('finance-admin'),
        data: {},
      }),
      409,
      'SIGNOFF_BY_PREPARER',
    );
    expect(
      (
        await request.post('/api/actuals/tie-outs', {
          headers: await mutate('auditor'),
          data: {
            legalEntityId: e.id,
            month: '2026-12',
            toleranceMinor: 0,
            fileName: 'x.csv',
            content: gl,
          },
        })
      ).status(),
    ).toBe(403);
  });
});
