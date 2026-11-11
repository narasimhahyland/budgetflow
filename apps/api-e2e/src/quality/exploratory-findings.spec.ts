// Phase 17 exploratory findings, fixed (evidence/phase-17/exploratory/README.md). Each scenario proves
// a screen now says what the API will do: the approval card's company-wide Available matches the budget
// page (F7), an owner is not told they approve their own requests (F1), an exhausted hard-mode budget
// is marked before anyone fills a form (F3), and problem details give formatted amounts (F2).
//
// The scenario owns its budgets: a USD 1,000.00 root owned by the regional manager with one child owned
// by the location manager, so no seeded figure moves.
import { expect, test } from '@playwright/test';
import { BudgetDetail, ProblemDetails, RequestDetail, RequestableBudgetList } from '@bf/contracts';
import { userById } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { allocate, allocateOk, createChild, createRoot } from '../support/factory';

test.describe.configure({ mode: 'serial' });

const USD = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
let rootId = '';
let childId = '';

async function requestOn(
  request: import('@playwright/test').APIRequestContext,
  user: 'regional-manager' | 'location-manager',
  budgetId: string,
  amountMinor: number,
) {
  return expectContract(
    await request.post('/api/requests', {
      headers: await mutate(user),
      data: {
        kind: 'spending',
        budgetId,
        amount: USD(amountMinor),
        spendType: 'general',
        title: 'Exploratory finding scenario',
        purpose: 'Proves a screen says what the API will do',
      },
    }),
    201,
    RequestDetail,
  );
}

test.beforeAll(async ({ request }) => {
  const root = await createRoot(request, { amountMinor: 100_000, owner: 'regional-manager' });
  rootId = root.id;
  const child = await createChild(request, rootId, {
    currency: 'USD',
    as: 'regional-manager',
    owner: 'location-manager',
  });
  childId = child.id;
  await allocateOk(request, rootId, childId, USD(60_000), { as: 'regional-manager' });
});

test('F2: an over-allocation explains itself in formatted amounts, never minor units', async ({
  request,
}) => {
  const problem = await expectProblem(
    await allocate(request, rootId, childId, USD(40_001), { as: 'regional-manager' }),
    409,
    'OVER_ALLOCATION',
  );
  expect(problem.detail).toBe(
    'Only USD 400.00 is available to allocate; USD 400.01 was asked for. Lower the amount or ask for an increase.',
  );
  expect(problem.detail).not.toContain('minor units');
  // The figures stay machine-readable for screens that format them themselves.
  expect(ProblemDetails.parse(problem).params).toMatchObject({
    availableMinor: 40_000,
    requestedMinor: 40_001,
  });
});

test("F7: the approval card's company-wide Available counts the children's spending", async ({
  request,
}) => {
  // The child's request is pending in the root's subtree; the root's own request comes next.
  await requestOn(request, 'location-manager', childId, 5_000);
  const own = await requestOn(request, 'regional-manager', rootId, 2_000);

  const page = await expectContract(
    await request.get(`/api/budgets/${rootId}`, { headers: await as('regional-manager') }),
    200,
    BudgetDetail,
  );
  // 1,000.00 authorized less 20.00 (root) and 50.00 (child) pending.
  expect(page.available.companyWide.amountMinor).toBe(93_000);

  const detail = await expectContract(
    await request.get(`/api/requests/${own.id}`, { headers: await as('regional-manager') }),
    200,
    RequestDetail,
  );
  expect(detail.impact?.companyWideAvailable).toEqual(page.available.companyWide);
  // The old card left the child's 50.00 out and showed 980.00.
  expect(detail.impact?.companyWideAvailable.amountMinor).not.toBe(98_000);
});

test('F1: an owner is told the next owner up approves their requests', async ({ request }) => {
  const list = await expectContract(
    await request.get('/api/requests/requestable-budgets', {
      headers: await as('regional-manager'),
    }),
    200,
    RequestableBudgetList,
  );
  const root = list.items.find((b) => b.budgetId === rootId);
  const child = list.items.find((b) => b.budgetId === childId);
  expect(root?.approverHint).toBe(
    'You own this budget, so the next owner up approves your requests, within delegation of authority',
  );
  expect(root?.approverHint).not.toContain(userById('regional-manager').displayName);
  expect(child?.approverHint).toBe(
    `${userById('location-manager').displayName} approves, within delegation of authority`,
  );
});

test('F3: a hard-mode budget with nothing left is marked before anyone fills a form', async ({
  request,
}) => {
  const before = await expectContract(
    await request.get('/api/requests/requestable-budgets', {
      headers: await as('regional-manager'),
    }),
    200,
    RequestableBudgetList,
  );
  const open = before.items.find((b) => b.budgetId === rootId);
  expect(open?.blockedCode).toBeNull();
  expect(open?.available?.amountMinor).toBe(38_000);

  // Allocate everything the root still has: 1,000.00 − 600.00 allocated − 20.00 pending.
  await allocateOk(request, rootId, childId, USD(38_000), { as: 'regional-manager' });

  const after = await expectContract(
    await request.get('/api/requests/requestable-budgets', {
      headers: await as('regional-manager'),
    }),
    200,
    RequestableBudgetList,
  );
  const exhausted = after.items.find((b) => b.budgetId === rootId);
  expect(exhausted?.available?.amountMinor).toBe(0);
  expect(exhausted?.blockedCode).toBe('INSUFFICIENT_AVAILABLE');
  expect(exhausted?.blockedReason).toContain('no money available');
  // The child still has money and stays open.
  expect(after.items.find((b) => b.budgetId === childId)?.blockedCode).toBeNull();

  // And it agrees with what submitting would do.
  await expectProblem(
    await request.post('/api/requests', {
      headers: await mutate('regional-manager'),
      data: {
        kind: 'spending',
        budgetId: rootId,
        amount: USD(100),
        spendType: 'general',
        title: 'Exploratory finding scenario',
        purpose: 'Proves the marker matches the submit check',
      },
    }),
    409,
    'INSUFFICIENT_AVAILABLE',
  );
});
