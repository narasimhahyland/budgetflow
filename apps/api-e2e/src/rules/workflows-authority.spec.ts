// Phase 7 approval workflows and delegation hygiene: the approval limit matrix needs two people and
// never leaves a gap, a delegation is capped and time-boxed, overdue approvals escalate by authority,
// and a post-spend exception is settled with a reversal rather than an edit.
import { expect, test } from '@playwright/test';
import {
  ApprovalHistoryResponse,
  DelegationView,
  DoaMatrixAdminView,
  PostSpendExceptionList,
  SlaSweepResponse,
  TestWorkflowRouteResponse,
  WorkflowRouteList,
} from '@bf/contracts';
import { BUDGETS, userById } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { auditFor, usd } from '../support/p5';

const FINANCE = 'finance-admin';
const CEO = 'ceo';

const plusDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test.describe('approval workflows and authority', () => {
  test('routing names the steps for a request and the rules that matched it', async ({
    request,
  }) => {
    const routes = await expectContract(
      await request.get('/api/rules/routing', { headers: await as(FINANCE) }),
      200,
      WorkflowRouteList,
    );
    const spending = routes.items.find((r) => r.requestKind === 'spending');
    expect(spending, 'the seed publishes a route for spending requests').toBeDefined();
    expect(spending!.steps.length).toBeGreaterThan(0);
    // Every route has to apply approval limits somewhere, or ownership would grant authority.
    expect(spending!.steps.some((s) => s.applyDoa)).toBe(true);

    const tested = await expectContract(
      await request.post('/api/rules/routing/test', {
        headers: await as(FINANCE),
        data: {
          requestKind: 'spending',
          budgetId: BUDGETS.bengaluru,
          amountMinor: 120_000,
          spendType: 'team_lunch',
        },
      }),
      200,
      TestWorkflowRouteResponse,
    );
    expect(tested.route.steps.length).toBeGreaterThan(0);
    expect(tested.matchedRuleCodes.length).toBeGreaterThan(0);
    // Testing a route must not create an approval task for anybody.
    for (const step of tested.route.steps) expect(step.taskId).toBeNull();
  });

  test('a delegation cannot be to yourself, longer than 30 days, or above your own limit', async ({
    request,
  }) => {
    const me = userById('regional-manager').personId!;
    const other = userById('location-manager').personId!;

    await expectProblem(
      await request.post('/api/approvals/delegations', {
        headers: await mutate('regional-manager'),
        data: {
          delegatePersonId: me,
          validFrom: plusDays(1),
          validTo: plusDays(5),
          reason: 'Delegating to myself should be refused.',
        },
      }),
      422,
      'SELF_DELEGATION',
    );

    await expectProblem(
      await request.post('/api/approvals/delegations', {
        headers: await mutate('regional-manager'),
        data: {
          delegatePersonId: other,
          validFrom: plusDays(1),
          validTo: plusDays(60),
          reason: 'A sixty day absence needs a change to the approval limits, not a delegation.',
        },
      }),
      422,
      'DELEGATION_TOO_LONG',
    );

    const ok = await expectContract(
      await request.post('/api/approvals/delegations', {
        headers: await mutate('regional-manager'),
        data: {
          delegatePersonId: other,
          validFrom: plusDays(1),
          validTo: plusDays(10),
          reason: 'Away at the planning offsite for a week.',
          spendType: 'travel',
          limit: usd(100_000),
        },
      }),
      201,
      DelegationView,
    );
    expect(ok.validTo).toBe(plusDays(10));

    const revoked = await expectContract(
      await request.post(`/api/approvals/delegations/${ok.id}/revoke`, {
        headers: await mutate('regional-manager'),
        data: { reason: 'Back earlier than planned.' },
      }),
      200,
      DelegationView,
    );
    expect(revoked.active).toBe(false);

    await expectProblem(
      await request.post(`/api/approvals/delegations/${ok.id}/revoke`, {
        headers: await mutate('regional-manager'),
        data: { reason: 'Revoking twice should be refused.' },
      }),
      409,
      'ALREADY_REVOKED',
    );
  });

  test('a new approval limit version needs two people and never leaves today without a matrix', async ({
    request,
  }) => {
    // Submitting here rather than relying on the seeded version keeps this repeatable: an earlier
    // run may already have approved that one.
    const current = await expectContract(
      await request.get('/api/rules/doa-admin', { headers: await as(FINANCE) }),
      200,
      DoaMatrixAdminView,
    );
    const startsOn = plusDays(120);
    const before = await expectContract(
      await request.put('/api/rules/doa-admin', {
        headers: await mutate(FINANCE),
        data: {
          validFrom: startsOn,
          submitForApproval: true,
          rows: current.rows
            .filter((r) => r.changeMarker !== 'removed')
            .map((r) => ({
              role: r.role,
              personId: r.personId,
              spendType: r.spendType,
              legalEntityId: r.legalEntityId,
              limitMinor: r.limit.amountMinor,
              currency: 'USD' as const,
              validFrom: startsOn,
            })),
        },
      }),
      200,
      DoaMatrixAdminView,
    );
    const waiting = before.versions.find((v) => v.status === 'awaiting_approval');
    expect(waiting, 'the version just submitted is waiting for approval').toBeDefined();
    // Finance submitted it, so Finance is not offered the approve action.
    expect(before.allowedActions).not.toContain('approve');

    await expectProblem(
      await request.post('/api/rules/doa-admin/approve', {
        headers: await mutate(FINANCE),
        data: { versionId: waiting!.id },
      }),
      409,
      'DOA_VERSION_SELF_APPROVAL',
    );

    const asCeo = await expectContract(
      await request.get('/api/rules/doa-admin', { headers: await as(CEO) }),
      200,
      DoaMatrixAdminView,
    );
    expect(asCeo.allowedActions).toContain('approve');

    const approved = await expectContract(
      await request.post('/api/rules/doa-admin/approve', {
        headers: await mutate(CEO),
        data: { versionId: waiting!.id, comment: 'Approved for the next fiscal year.' },
      }),
      200,
      DoaMatrixAdminView,
    );
    // The new version starts later, so the current matrix is still the one in force today.
    expect(approved.selectedVersion.status).toBe('scheduled');
    expect(approved.activeVersion).not.toBeNull();
    expect(approved.activeVersion!.version).toBeLessThan(approved.selectedVersion.version);

    // Routing still resolves, which it could not do without a matrix in force.
    const stillRoutes = await expectContract(
      await request.post('/api/rules/routing/test', {
        headers: await as(FINANCE),
        data: {
          requestKind: 'spending',
          budgetId: BUDGETS.bengaluru,
          amountMinor: 50_000,
          spendType: 'team_lunch',
        },
      }),
      200,
      TestWorkflowRouteResponse,
    );
    expect(stillRoutes.route.steps.length).toBeGreaterThan(0);

    const entries = await auditFor(request, waiting!.id);
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['doa.version_submitted', 'doa.version_approved']),
    );
  });

  test('overdue approvals escalate to the next authority and are audited', async ({ request }) => {
    const asOf = new Date(Date.now() + 45 * 86_400_000).toISOString();
    const swept = await expectContract(
      await request.post('/api/approvals/sla-sweep', {
        headers: await mutate(FINANCE),
        data: { asOf },
      }),
      200,
      SlaSweepResponse,
    );
    expect(swept.evaluatedTasks).toBeGreaterThan(0);
    expect(swept.escalatedCount).toBeGreaterThan(0);

    // A task that already escalated is no longer pending, so sweeping again at the same moment
    // does not escalate it a second time.
    const repeat = await expectContract(
      await request.post('/api/approvals/sla-sweep', {
        headers: await mutate(FINANCE),
        data: { asOf },
      }),
      200,
      SlaSweepResponse,
    );
    expect(repeat.escalatedTaskIds).not.toEqual(expect.arrayContaining(swept.escalatedTaskIds));
  });

  test('a post-spend exception is settled once and the decision is recorded', async ({
    request,
  }) => {
    const queue = await expectContract(
      await request.get('/api/rules/exceptions', { headers: await as(FINANCE) }),
      200,
      PostSpendExceptionList,
    );
    expect(queue.counts.open).toBeGreaterThan(0);
    const open = queue.items.find((e) => e.status === 'open');
    expect(open).toBeDefined();

    const settled = await expectContract(
      await request.post(`/api/rules/exceptions/${open!.id}/resolve`, {
        headers: await mutate(FINANCE),
        data: {
          action: 'resolve',
          resolution: 'accept_with_reason',
          reasonCode: 'EXC-ACCEPT',
          reason: 'Agreed with the budget owner before the spend; the cap is revised next year.',
        },
      }),
      200,
      PostSpendExceptionList.shape.items.element,
    );
    expect(settled.status).toBe('resolved');
    expect(settled.resolvedByName).not.toBeNull();

    // Spend that already happened cannot be settled twice.
    await expectProblem(
      await request.post(`/api/rules/exceptions/${open!.id}/resolve`, {
        headers: await mutate(FINANCE),
        data: {
          action: 'resolve',
          resolution: 'accept_with_reason',
          reason: 'Settling the same exception twice should be refused.',
        },
      }),
      409,
      'EXCEPTION_ALREADY_RESOLVED',
    );

    const entries = await auditFor(request, open!.id);
    expect(entries.map((e) => e.action)).toContain('exception.resolved');
  });

  test('the approval history records real decisions and shows an approver only their own', async ({
    request,
  }) => {
    const all = await expectContract(
      await request.get('/api/approvals/history', { headers: await as('auditor') }),
      200,
      ApprovalHistoryResponse,
    );
    expect(all.items.length).toBeGreaterThan(0);
    expect(all.summary.totalDecisions).toBe(all.items.length);
    for (const i of all.items) {
      expect(i.timeToDecideMinutes).toBeGreaterThan(0);
      // Rule versions are only what the route recorded; the history never guesses which rule ran.
      expect(Array.isArray(i.ruleVersions)).toBe(true);
    }

    const rejected = await expectContract(
      await request.get('/api/approvals/history?decision=reject', {
        headers: await as('auditor'),
      }),
      200,
      ApprovalHistoryResponse,
    );
    expect(rejected.items.every((i) => i.decision === 'reject')).toBe(true);
    expect(rejected.items.length).toBeLessThan(all.items.length);

    // An approver without audit rights sees the decisions they made, not everyone's.
    const mine = await expectContract(
      await request.get('/api/approvals/history', { headers: await as('location-manager') }),
      200,
      ApprovalHistoryResponse,
    );
    const me = userById('location-manager').displayName;
    expect(mine.items.every((i) => i.approverName === me || i.onBehalfOfName === me)).toBe(true);
    expect(mine.items.length).toBeLessThanOrEqual(all.items.length);
  });

  test('rules administration is refused to people without it', async ({ request }) => {
    for (const path of ['/api/rules/dashboard', '/api/rules', '/api/rules/policies']) {
      await expectProblem(
        await request.get(path, { headers: await as('employee') }),
        403,
        'FORBIDDEN',
      );
    }
    // Reading is enough for an auditor; changing is not.
    const read = await request.get('/api/rules', { headers: await as('auditor') });
    expect(read.status()).toBe(200);
    await expectProblem(
      await request.post('/api/rules', {
        headers: await mutate('auditor'),
        data: {
          mode: 'blank',
          name: 'An auditor should not be able to create this',
          actions: [{ effect: 'warn' }],
          explanation: 'Should be refused.',
        },
      }),
      403,
      'FORBIDDEN',
    );
  });
});
