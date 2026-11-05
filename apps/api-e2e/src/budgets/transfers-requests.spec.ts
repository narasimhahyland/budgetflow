// Transfers along the hierarchy (parents keep allocated out = children's authorized), increase requests
// and contingency reserve releases with approval (partial, reject, no self-approval, one decision).
import { expect, test } from '@playwright/test';
import {
  BudgetChangeRequest,
  BudgetChangeRequestList,
  BudgetDetail,
  TransferResult,
} from '@bf/contracts';
import { as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { allocateOk, createChild, createRoot } from '../support/factory';
import { bal, budget, freeze, openingBalance, post, tree, USD } from './p4';

const transfer = (from: string, to: string, amountMinor: number) => ({
  path: `/api/budgets/${from}/transfers`,
  body: {
    toBudgetId: to,
    amountMinor,
    reasonCode: 'TRF-REBALANCE',
    reason: 'Rebalance between teams',
  },
});

test.describe('transfers', () => {
  test('between siblings the parent is untouched; between cousins money moves through their ancestors', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const [india, us] = await Promise.all([
      createChild(request, root.id, { currency: 'USD' }),
      createChild(request, root.id, { currency: 'USD' }),
    ]);
    const [blr, hyd] = await Promise.all([
      createChild(request, india.id, { currency: 'USD' }),
      createChild(request, india.id, { currency: 'USD' }),
    ]);
    const nyc = await createChild(request, us.id, { currency: 'USD' });
    await allocateOk(request, root.id, india.id, USD(30_000));
    await allocateOk(request, root.id, us.id, USD(40_000));
    await allocateOk(request, india.id, blr.id, USD(10_000));
    await allocateOk(request, us.id, nyc.id, USD(5_000));

    const t1 = transfer(blr.id, hyd.id, 2_500);
    const sib = await expectContract(
      await post(request, t1.path, t1.body, 'ceo'),
      201,
      TransferResult,
    );
    expect(sib.journal.type).toBe('transfer');
    expect(sib.journal.lines.map((l) => [l.budgetId, l.account, l.budget?.amountMinor])).toEqual([
      [blr.id, 'authorized', 2_500],
      [hyd.id, 'authorized', -2_500],
    ]);
    expect(bal(await budget(request, india.id))).toMatchObject({
      authorized: 30_000,
      allocatedOut: 10_000,
    });

    const t2 = transfer(blr.id, nyc.id, 1_000);
    const cousins = await expectContract(
      await post(request, t2.path, t2.body, 'ceo'),
      201,
      TransferResult,
    );
    expect(cousins.journal.balanced).toBe(true);
    expect(bal(await budget(request, india.id))).toMatchObject({
      authorized: 29_000,
      allocatedOut: 9_000,
    });
    expect(bal(await budget(request, us.id))).toMatchObject({
      authorized: 41_000,
      allocatedOut: 6_000,
    });
    expect(bal(await budget(request, root.id))).toMatchObject({
      authorized: 100_000,
      allocatedOut: 70_000,
    });
    expect(bal(await budget(request, nyc.id)).authorized).toBe(6_000);

    const t3 = transfer(blr.id, hyd.id, 6_501);
    const over = await expectProblem(
      await post(request, t3.path, t3.body, 'ceo'),
      409,
      'INSUFFICIENT_AVAILABLE',
    );
    expect(over.params?.['availableMinor']).toBe(6_500);
    const other = await createRoot(request, { amountMinor: 1_000 });
    const t4 = transfer(blr.id, other.id, 100);
    await expectProblem(await post(request, t4.path, t4.body, 'ceo'), 422, 'TRANSFER_INVALID');
    await freeze(request, hyd.id);
    const t5 = transfer(blr.id, hyd.id, 100);
    await expectProblem(await post(request, t5.path, t5.body, 'ceo'), 409, 'BUDGET_FROZEN');
  });

  test('pending requests reduce what can be transferred; the owner of both siblings or of their parent may transfer', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 50_000, owner: 'regional-manager' });
    const a = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'location-manager',
      as: 'finance-admin',
    });
    const b = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'location-manager',
      as: 'finance-admin',
    });
    await allocateOk(request, root.id, a.id, USD(10_000), { as: 'finance-admin' });
    await openingBalance(request, a.id, 'pre_encumbered', 4_000);
    const t = transfer(a.id, b.id, 6_001);
    await expectProblem(
      await post(request, t.path, t.body, 'regional-manager'),
      409,
      'INSUFFICIENT_AVAILABLE',
    );
    const c = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'budget-owner',
      as: 'finance-admin',
    });
    // The location manager owns a and b but not c (which they cannot see): a to c is refused, a to b
    // goes straight through.
    const ownsOneSide = transfer(a.id, c.id, 1_000);
    await expectProblem(
      await post(request, ownsOneSide.path, ownsOneSide.body, 'location-manager'),
      404,
      'NOT_FOUND',
    );
    expect((await budget(request, a.id, 'location-manager')).allowedActions).toContain(
      'budget.transfer',
    );
    const byOwner = transfer(a.id, b.id, 1_000);
    const ownsBoth = await expectContract(
      await post(request, byOwner.path, byOwner.body, 'location-manager'),
      201,
      TransferResult,
    );
    expect(bal(ownsBoth.to).authorized).toBe(1_000);
    expect(bal(await budget(request, root.id)).allocatedOut).toBe(10_000);
    const byParentOwner = transfer(a.id, b.id, 5_000);
    await expectContract(
      await post(request, byParentOwner.path, byParentOwner.body, 'regional-manager'),
      201,
      TransferResult,
    );
    expect(bal(await budget(request, a.id)).authorized).toBe(4_000);
  });
});

test.describe('increase requests', () => {
  test('the child owner asks, the parent owner approves part of it, and the money allocates once', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 40_000, owner: 'regional-manager' });
    const child = await createChild(request, root.id, {
      currency: 'USD',
      as: 'regional-manager',
      owner: 'location-manager',
    });
    await allocateOk(request, root.id, child.id, USD(10_000), { as: 'regional-manager' });

    const asked = await expectContract(
      await post(
        request,
        `/api/budgets/${child.id}/increase-requests`,
        { amountMinor: 5_000, reason: 'Diwali party' },
        'location-manager',
      ),
      201,
      BudgetChangeRequest,
    );
    expect(asked).toMatchObject({
      status: 'pending',
      kind: 'increase',
      canDecide: false,
      sourceBudgetId: root.id,
    });
    expect(bal(await budget(request, child.id)).authorized).toBe(10_000);

    const inbox = await expectContract(
      await request.get(`/api/budget-requests?status=pending&budgetId=${child.id}`, {
        headers: await as('regional-manager'),
      }),
      200,
      BudgetChangeRequestList,
    );
    expect(inbox.items.find((i) => i.id === asked.id)).toMatchObject({
      canDecide: true,
      sourceAvailableMinor: 30_000,
    });

    const decide = (
      body: Record<string, unknown>,
      user: Parameters<typeof post>[3],
      key?: string,
    ) => post(request, `/api/budget-requests/${asked.id}/decision`, body, user, key);
    await expectProblem(
      await decide({ decision: 'approve' }, 'location-manager'),
      403,
      'FORBIDDEN',
    );
    await expectProblem(
      await decide({ decision: 'approve', approvedAmountMinor: 5_001 }, 'regional-manager'),
      422,
      'VALIDATION_FAILED',
    );
    const approved = await expectContract(
      await decide(
        { decision: 'approve', approvedAmountMinor: 3_000, note: 'Part now, rest after Q3' },
        'regional-manager',
        `dec-${asked.id}`,
      ),
      200,
      BudgetChangeRequest,
    );
    expect(approved).toMatchObject({ status: 'approved', approvedAmount: USD(3_000) });
    expect(approved.journalId).toBeTruthy();
    const replay = await decide(
      { decision: 'approve', approvedAmountMinor: 3_000, note: 'Part now, rest after Q3' },
      'regional-manager',
      `dec-${asked.id}`,
    );
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    await expectProblem(
      await decide({ decision: 'reject' }, 'regional-manager'),
      409,
      'REQUEST_ALREADY_DECIDED',
    );
    expect(bal(await budget(request, child.id)).authorized).toBe(13_000);
    expect(bal(await budget(request, root.id)).allocatedOut).toBe(13_000);
  });

  test('a root budget grows through the plan, and a rejected request posts nothing', async ({
    request,
  }) => {
    const { root, a } = await tree(request, 20_000, 1_000);
    await expectProblem(
      await post(
        request,
        `/api/budgets/${root.id}/increase-requests`,
        { amountMinor: 100, reason: 'More please' },
        'ceo',
      ),
      422,
      'VALIDATION_FAILED',
    );
    const r = await expectContract(
      await post(
        request,
        `/api/budgets/${a.id}/increase-requests`,
        { amountMinor: 100, reason: 'More please' },
        'ceo',
      ),
      201,
      BudgetChangeRequest,
    );
    await expectProblem(
      await post(request, `/api/budget-requests/${r.id}/decision`, { decision: 'approve' }, 'ceo'),
      409,
      'SELF_APPROVAL',
    );
    const rejected = await expectContract(
      await post(
        request,
        `/api/budget-requests/${r.id}/decision`,
        { decision: 'reject', note: 'Not this quarter' },
        'finance-admin',
      ),
      200,
      BudgetChangeRequest,
    );
    expect(rejected).toMatchObject({ status: 'rejected', journalId: null });
    expect(bal(await budget(request, a.id)).authorized).toBe(1_000);
  });
});

test.describe('contingency reserve', () => {
  test('a release moves reserve money only once approved by someone else', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 50_000 });
    const reserve = await expectContract(
      await post(
        request,
        '/api/budgets',
        {
          name: 'Scenario reserve',
          parentId: root.id,
          legalEntityId: root.legalEntityId,
          fiscalYearId: root.fiscalYearId,
          budgetType: 'contingency',
        },
        'ceo',
      ),
      201,
      BudgetDetail,
    );
    const team = await createChild(request, root.id, { currency: 'USD' });
    await allocateOk(request, root.id, reserve.id, USD(5_000));
    const r = await expectContract(
      await post(
        request,
        `/api/budgets/${reserve.id}/releases`,
        { toBudgetId: team.id, amountMinor: 2_000, reason: 'Unplanned offsite' },
        'finance-admin',
      ),
      201,
      BudgetChangeRequest,
    );
    expect(r).toMatchObject({ kind: 'contingency_release', canDecide: false });
    await expectProblem(
      await post(
        request,
        `/api/budgets/${team.id}/releases`,
        { toBudgetId: reserve.id, amountMinor: 1, reason: 'Wrong way' },
        'finance-admin',
      ),
      422,
      'VALIDATION_FAILED',
    );
    expect(bal(await budget(request, team.id)).authorized).toBe(0);
    const done = await expectContract(
      await post(request, `/api/budget-requests/${r.id}/decision`, { decision: 'approve' }, 'ceo'),
      200,
      BudgetChangeRequest,
    );
    expect(done.status).toBe('approved');
    expect(bal(await budget(request, team.id)).authorized).toBe(2_000);
    expect(bal(await budget(request, reserve.id)).authorized).toBe(3_000);
    expect(bal(await budget(request, root.id)).allocatedOut).toBe(5_000);
  });
});
