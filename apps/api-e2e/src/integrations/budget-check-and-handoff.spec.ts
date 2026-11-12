// Gap B7: Workday Financials runBudgetCheck before approving spend (094), and the hand-off of an
// approved request to a prefilled draft expense in the expense tool (117a). The budget check runs
// against the mock Workday budget; Warn mode shows and records it, Block mode refuses the approval
// with the ERP's reason. The hand-off creates one draft per request in Concur (never submitted by
// BudgetFlow, never moving money), replays post once, and the draft's progress comes back through
// the Concur sync.
import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import {
  ConnectionDetail,
  ExpenseHandoffView,
  ExternalBudgetCheckList,
  RequestDetail,
  SyncRunView,
} from '@bf/contracts';
import type { SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { env } from '../support/env';
import {
  auditFor,
  decideOk,
  decideTask,
  directorTree,
  spendingRequest,
  taskOf,
  usd,
} from '../support/p5';
import { armFailure, CONNECTIONS, mockApi, resetMock } from '../support/p12';

test.beforeEach(async () => {
  await resetMock();
});

let workday: string | null = null;
let workdayMadeHere = false;

/** Turns the budget check off (and disconnects Workday if this file connected it), whatever happened. */
test.afterAll(async () => {
  if (!workday) return;
  const api = await pwRequest.newContext({
    baseURL: process.env.API_URL ?? `http://localhost:${env('BF_API_PORT')}`,
  });
  const headers = await mutate('integration-admin');
  if (workdayMadeHere) {
    expect(
      (await api.delete(`/api/integrations/connections/${workday}`, { headers })).status(),
    ).toBe(200);
  } else {
    expect(
      (
        await api.patch(`/api/integrations/connections/${workday}`, {
          headers,
          data: { settings: { budgetCheck: { enabled: false, mode: 'warn' } } },
        })
      ).status(),
    ).toBe(200);
  }
});

async function workdayConnection(request: APIRequestContext): Promise<string> {
  if (workday) return workday;
  const res = await request.post('/api/integrations', {
    headers: await mutate('integration-admin'),
    data: {
      provider: 'workday_financials',
      mode: 'mock',
      credential: 'mock-workday-dev-only-0001',
    },
  });
  if (res.status() === 409) {
    workday = ((await res.json()) as { params: { connectionId: string } }).params.connectionId;
  } else {
    workday = (await expectContract(res, 201, ConnectionDetail)).summary.id;
    workdayMadeHere = true;
  }
  return workday;
}

async function setCheck(request: APIRequestContext, id: string, check: unknown) {
  return request.patch(`/api/integrations/connections/${id}`, {
    headers: await mutate('integration-admin'),
    data: { settings: { budgetCheck: check } },
  });
}

/** A pending request on a fresh US team budget (ERP company 1000), with the approver's task. */
async function pendingRequest(request: APIRequestContext, amountMinor: number) {
  const { team } = await directorTree(request);
  const created = await expectContract(
    await spendingRequest(request, 'budget-owner', team.id, usd(amountMinor), {
      category: 'TEAM-LUNCH',
      title: `Team lunch ${randomUUID().slice(0, 6)}`,
    }),
    201,
    RequestDetail,
  );
  const task = await taskOf(request, 'department-head', 'request', created.id);
  return { requestId: created.id, task };
}

const checks = async (request: APIRequestContext, task: string) =>
  (
    await expectContract(
      await request.get(`/api/approvals/tasks/${task}/budget-checks`, {
        headers: await as('department-head'),
      }),
      200,
      ExternalBudgetCheckList,
    )
  ).items;

test.describe('Workday Financials budget check before approval (094)', () => {
  test('off by default; Warn shows and records the answer; Block refuses the approval with the reason', async ({
    request,
  }) => {
    const id = await workdayConnection(request);
    const big = await pendingRequest(request, 300_000); // USD 3,000.00; Workday has USD 2,500.00 left
    expect(await checks(request, big.task)).toEqual([]);

    // Only the ERP that controls budgets offers the check, and the setting must be well formed.
    await expectProblem(await setCheck(request, id, { enabled: 'yes' }), 422, 'VALIDATION_FAILED');
    await expectProblem(
      await setCheck(request, CONNECTIONS.erpnext, { enabled: true }),
      422,
      'VALIDATION_FAILED',
    );

    expect((await setCheck(request, id, { enabled: true, mode: 'warn' })).status()).toBe(200);
    const [warn] = await checks(request, big.task);
    expect(warn).toMatchObject({
      provider: 'workday_financials',
      status: 'failed',
      mode: 'warn',
      blocksApproval: false,
      remaining: { amountMinor: 250_000, currency: 'USD' },
    });
    expect(warn.message).toContain('USD 2500.00 left');

    expect((await setCheck(request, id, { enabled: true, mode: 'block' })).status()).toBe(200);
    const [block] = await checks(request, big.task);
    expect(block).toMatchObject({ status: 'failed', blocksApproval: true });
    const refused = await expectProblem(
      await decideTask(request, 'department-head', big.task, { decision: 'approve' }),
      409,
      'EXTERNAL_BUDGET_CHECK_FAILED',
    );
    expect(refused.detail).toContain('Approval is blocked until it passes');
    const audit = await auditFor(request, big.requestId);
    expect(audit.some((a) => a.action === 'request.approved')).toBe(false);

    // Within what Workday has left: passes, approves, and the result is recorded with the decision.
    const small = await pendingRequest(request, 3_000);
    expect((await checks(request, small.task))[0]).toMatchObject({
      status: 'passed',
      blocksApproval: false,
    });
    await decideOk(request, 'department-head', small.task, { decision: 'approve' });
    const approved = (await auditFor(request, small.requestId)).find(
      (a) => a.action.startsWith('request.') && a.changes['externalBudgetChecks'],
    );
    expect(approved?.changes['externalBudgetChecks']?.to).toEqual(['Workday Financials: passed']);

    // Workday unreachable in Block mode: the approval waits, with the reason.
    const third = await pendingRequest(request, 3_000);
    // Enough failures to cover the card's read and the decision's check, retries included.
    await armFailure('/workday-financials/ccx/api/v1/budgetChecks', 503, 10);
    const [down] = await checks(request, third.task);
    expect(down).toMatchObject({ status: 'unavailable', blocksApproval: true });
    await expectProblem(
      await decideTask(request, 'department-head', third.task, { decision: 'approve' }),
      409,
      'EXTERNAL_BUDGET_CHECK_FAILED',
    );

    // The setting change is audited on the connection.
    const changes = (await auditFor(request, id)).filter((a) => a.changes['budgetCheck']);
    expect(changes.map((a) => a.changes['budgetCheck']?.to)).toEqual(
      expect.arrayContaining(['warn', 'block']),
    );
  });
});

test.describe('hand-off of approved spend to a prefilled expense (117a)', () => {
  const handoff = async (
    request: APIRequestContext,
    requestId: string,
    who: SeedUserId = 'budget-owner',
  ) =>
    expectContract(
      await request.get(`/api/requests/${requestId}/expense-handoff`, { headers: await as(who) }),
      200,
      ExpenseHandoffView,
    );
  const create = async (request: APIRequestContext, requestId: string, key = randomUUID()) =>
    request.post(`/api/requests/${requestId}/expense-handoff`, {
      headers: await mutate('budget-owner', key),
      data: {},
    });

  test('the requester creates one prefilled draft in Concur, a replay posts once, and others cannot', async ({
    request,
  }) => {
    const pending = await pendingRequest(request, 5_749);
    // Not approved yet: nothing to hand off.
    expect((await handoff(request, pending.requestId)).availability).toBe('not_approved');
    await expectProblem(
      await create(request, pending.requestId),
      422,
      'EXPENSE_HANDOFF_NOT_AVAILABLE',
    );
    await decideOk(request, 'department-head', pending.task, { decision: 'approve' });

    const ready = await handoff(request, pending.requestId);
    expect(ready).toMatchObject({
      availability: 'ready',
      tool: { provider: 'concur', displayName: 'Concur' },
      handoff: null,
    });
    // The fields come from the request: nothing is typed twice. The expense type is the
    // connection's mapping for the request category (TEAM-LUNCH is "Meals - team" in Concur).
    expect(ready.fields).toMatchObject({
      expenseType: 'Meals - team',
      amount: { amountMinor: 5_749, currency: 'USD' },
    });
    expect(ready.fields.requestRef).toMatch(/^REQ-/);

    // The approver sees the request but cannot create the requester's expense.
    expect((await handoff(request, pending.requestId, 'department-head')).availability).toBe(
      'not_allowed',
    );

    const key = randomUUID();
    const created = await expectContract(
      await create(request, pending.requestId, key),
      201,
      ExpenseHandoffView,
    );
    expect(created.availability).toBe('created');
    expect(created.handoff).toMatchObject({ status: 'draft_created', claimedAmount: null });
    expect(created.handoff!.externalId).toMatch(/^CNR-DRAFT-/);

    const replay = await create(request, pending.requestId, key);
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect((await expectContract(replay, 201, ExpenseHandoffView)).handoff!.id).toBe(
      created.handoff!.id,
    );
    const again = await expectProblem(
      await create(request, pending.requestId),
      409,
      'EXPENSE_HANDOFF_EXISTS',
    );
    expect(again.params?.['externalId']).toBe(created.handoff!.externalId);

    const audit = await auditFor(request, pending.requestId);
    expect(audit.filter((a) => a.action === 'request.expense_handoff_created')).toHaveLength(1);
  });

  test("the draft's progress and the amount claimed come back from Concur, once", async ({
    request,
  }) => {
    const pending = await pendingRequest(request, 5_749);
    await decideOk(request, 'department-head', pending.task, { decision: 'approve' });
    const created = await expectContract(
      await create(request, pending.requestId),
      201,
      ExpenseHandoffView,
    );
    const draftId = created.handoff!.externalId;
    const mock = await mockApi();
    // The mock keeps drafts in memory; reset only clears them between scenarios, not mid-scenario.
    expect(
      (
        await mock.post('/_control/concur-draft', {
          data: { id: draftId, status: 'Paid', claimedAmount: '56.00' },
        })
      ).ok(),
    ).toBe(true);
    const sync = async () =>
      expectContract(
        await request.post(`/api/integrations/connections/${CONNECTIONS.concur}/sync`, {
          headers: await mutate('integration-admin'),
          data: { object: 'expense_reports', direction: 'inbound' },
        }),
        201,
        SyncRunView,
      );
    const first = await sync();
    expect(first).toMatchObject({ recordsApplied: 1, recordsFailed: 0 });
    const paid = await handoff(request, pending.requestId);
    expect(paid.handoff).toMatchObject({
      status: 'paid',
      claimedAmount: { amountMinor: 5_600, currency: 'USD' },
      differenceMinor: -149,
    });
    expect(paid.handoff!.history.map((h) => h.status)).toEqual(['draft_created', 'paid']);
    const second = await sync();
    expect(second).toMatchObject({ recordsApplied: 0, recordsSkippedDuplicate: 1 });
    const synced = (await auditFor(request, pending.requestId)).filter(
      (a) => a.action === 'request.expense_status_synced',
    );
    expect(synced).toHaveLength(1);
  });

  test('when Concur refuses the draft, nothing is recorded and the details stay available to copy', async ({
    request,
  }) => {
    const pending = await pendingRequest(request, 2_500);
    await decideOk(request, 'department-head', pending.task, { decision: 'approve' });
    await armFailure('/concur/api/v4/expense/drafts', 422, 1);
    const refused = await expectProblem(
      await create(request, pending.requestId),
      422,
      'EXPENSE_TOOL_REJECTED',
    );
    expect(refused.detail).toContain('Concur did not accept the draft');
    const after = await handoff(request, pending.requestId);
    expect(after).toMatchObject({ availability: 'ready', handoff: null });
    expect(after.fields.amount).toEqual({ amountMinor: 2_500, currency: 'USD' });
  });
});
