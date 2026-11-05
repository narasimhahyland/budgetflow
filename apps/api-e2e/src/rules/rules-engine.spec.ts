// Phase 7, the rules engine: outcomes are decided by precedence (block > hold > approvals > warn >
// goes through), an active version is immutable so edits open a draft, a draft that contradicts an
// active rule cannot be published, and every change leaves one audit entry.
import { expect, test } from '@playwright/test';
import {
  RuleDetail,
  RuleList,
  RulesDashboard,
  RuleVersionDiff,
  SingleSimulationResponse,
} from '@bf/contracts';
import { P7_SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { auditFor } from '../support/p5';

const FINANCE = 'finance-admin';

const simulate = (facts: Record<string, unknown>, includeDraft = false) => ({
  includeDraft,
  facts: { amountMinor: 75_000, ...facts },
});

test.describe('rules engine', () => {
  test('the strictest matching rule decides the outcome and says why in plain English', async ({
    request,
  }) => {
    // A blocked vendor outranks the approval and warning rules that also match this request.
    const blocked = await expectContract(
      await request.post('/api/rules/simulate', {
        headers: await as(FINANCE),
        data: simulate({ vendorStatus: 'blocked' }),
      }),
      200,
      SingleSimulationResponse,
    );
    expect(blocked.effect).toBe('block');
    expect(blocked.decisiveRuleCode).toBe('R-03');
    expect(blocked.explanation).toContain('blocked');
    expect(blocked.matches.map((m) => m.ruleCode)).toContain('R-12');
    expect(blocked.matches.find((m) => m.ruleCode === 'R-12')?.decisive).toBe(false);

    // Cash and gift cards are blocked outright, whatever else matches.
    const cash = await expectContract(
      await request.post('/api/rules/simulate', {
        headers: await as(FINANCE),
        data: simulate({ isCashEquivalent: true, category: 'gifts' }),
      }),
      200,
      SingleSimulationResponse,
    );
    expect(cash.effect).toBe('block');
    expect(cash.decisiveRuleCode).toBe('R-07');

    // Small wellbeing spend goes through with no approval step.
    const small = await expectContract(
      await request.post('/api/rules/simulate', {
        headers: await as(FINANCE),
        data: simulate({
          amountMinor: 1_500,
          category: 'wellbeing',
          spendType: 'wellbeing',
          remainingPct: 60,
        }),
      }),
      200,
      SingleSimulationResponse,
    );
    expect(small.effect).toBe('auto_approve');
    expect(small.decisiveRuleCode).toBe('R-19');

    // An event above the threshold needs the budget owner and the parent budget owner.
    const event = await expectContract(
      await request.post('/api/rules/simulate', {
        headers: await as(FINANCE),
        data: simulate({ amountMinor: 120_000, spendType: 'employee_events' }),
      }),
      200,
      SingleSimulationResponse,
    );
    expect(event.effect).toBe('require_approval');
    expect(event.requiredApprovers).toEqual(
      expect.arrayContaining(['budget_owner', 'parent_owner']),
    );
  });

  test('simulation writes nothing: the dashboard counts are unchanged afterwards', async ({
    request,
  }) => {
    const before = await expectContract(
      await request.get('/api/rules/dashboard', { headers: await as(FINANCE) }),
      200,
      RulesDashboard,
    );
    await request.post('/api/rules/simulate', {
      headers: await as(FINANCE),
      data: simulate({ vendorStatus: 'blocked' }),
    });
    const after = await expectContract(
      await request.get('/api/rules/dashboard', { headers: await as(FINANCE) }),
      200,
      RulesDashboard,
    );
    expect(after.kpis.activeRules).toBe(before.kpis.activeRules);
    expect(after.kpis.draftsAwaitingPublish).toBe(before.kpis.draftsAwaitingPublish);
  });

  test('a draft that contradicts an active rule cannot be published', async ({ request }) => {
    const list = await expectContract(
      await request.get('/api/rules', { headers: await as(FINANCE) }),
      200,
      RuleList,
    );
    const conflicted = list.items.find((r) => r.code === P7_SEED.conflictingDraftCode);
    expect(conflicted, 'the seed publishes a rule with a conflicting draft').toBeDefined();
    expect(conflicted!.conflictsWith).toContain(P7_SEED.conflictsWithCode);

    const detail = await expectContract(
      await request.get(`/api/rules/${conflicted!.id}`, { headers: await as(FINANCE) }),
      200,
      RuleDetail,
    );
    expect(detail.draft).not.toBeNull();
    expect(detail.conflicts.some((c) => c.blocking)).toBe(true);
    // The screen must not offer an action the API would refuse.
    expect(detail.allowedActions).not.toContain('publish');

    const refused = await request.post(`/api/rules/${conflicted!.id}/publish`, {
      headers: await mutate(FINANCE),
      data: {},
    });
    const problem = await expectProblem(refused, 409, 'RULE_CONFLICT');
    expect(problem.detail).toContain(P7_SEED.conflictsWithCode);
  });

  test('editing an active rule opens a new draft instead of changing the active version', async ({
    request,
  }) => {
    const created = await expectContract(
      await request.post('/api/rules', {
        headers: await mutate(FINANCE),
        data: {
          mode: 'blank',
          name: 'Scenario: catering above the review amount',
          family: 'spending_limits',
          priority: 410,
          actions: [{ effect: 'warn' }],
          conditions: {
            logic: 'and',
            conditions: [{ fact: 'amount_reporting_minor', op: 'gt', value: 400_000 }],
          },
          explanation: 'Catering above USD 4,000.00 is reviewed by Finance after the event.',
          validFrom: '2026-01-01',
        },
      }),
      201,
      RuleDetail,
    );
    expect(created.draft?.version).toBe(1);
    expect(created.active).toBeNull();

    const published = await expectContract(
      await request.post(`/api/rules/${created.id}/publish`, {
        headers: await mutate(FINANCE),
        data: { reason: 'Scenario publish' },
      }),
      200,
      RuleDetail,
    );
    expect(published.active?.version).toBe(1);
    expect(published.draft).toBeNull();
    const activeBefore = published.active!;

    // Editing now must not touch version 1; it opens version 2 as a draft.
    const edited = await expectContract(
      await request.put(`/api/rules/${created.id}/draft`, {
        headers: await mutate(FINANCE),
        data: {
          priority: 415,
          actions: [{ effect: 'require_approval', approvers: ['finance_controller'] }],
          conditions: {
            logic: 'and',
            conditions: [{ fact: 'amount_reporting_minor', op: 'gt', value: 300_000 }],
          },
          scope: {},
          explanation: 'Catering above USD 3,000.00 needs the Finance Controller.',
          validFrom: '2026-12-01',
        },
      }),
      200,
      RuleDetail,
    );
    expect(edited.active?.version).toBe(1);
    expect(edited.active?.priority).toBe(activeBefore.priority);
    expect(edited.active?.effect).toBe(activeBefore.effect);
    expect(edited.draft?.version).toBe(2);
    expect(edited.draft?.effect).toBe('require_approval');

    // The comparison explains the change without naming internal keys.
    const diff = await expectContract(
      await request.get(`/api/rules/${created.id}/diff?fromVersion=1&toVersion=2`, {
        headers: await as(FINANCE),
      }),
      200,
      RuleVersionDiff,
    );
    expect(diff.summaryLines.length).toBeGreaterThan(0);
    const text = diff.summaryLines.map((l) => l.text).join(' ');
    expect(text).toContain('Needs approval');
    expect(text).not.toMatch(/require_approval|budget_owner|finance_controller/);

    const entries = await auditFor(request, created.id);
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['rule.created', 'rule.published', 'rule.draft_saved']),
    );
  });

  test('retiring a rule stops it deciding anything and is refused twice', async ({ request }) => {
    const created = await expectContract(
      await request.post('/api/rules', {
        headers: await mutate(FINANCE),
        data: {
          mode: 'blank',
          name: 'Scenario: retire me',
          priority: 405,
          actions: [{ effect: 'warn' }],
          conditions: {
            logic: 'and',
            conditions: [{ fact: 'spend_type', op: 'eq', value: 'scenario_retire' }],
          },
          explanation: 'Scenario rule used to prove retiring works.',
          validFrom: '2026-01-01',
        },
      }),
      201,
      RuleDetail,
    );
    await request.post(`/api/rules/${created.id}/publish`, {
      headers: await mutate(FINANCE),
      data: {},
    });

    const matched = await expectContract(
      await request.post('/api/rules/simulate', {
        headers: await as(FINANCE),
        data: simulate({ spendType: 'scenario_retire' }),
      }),
      200,
      SingleSimulationResponse,
    );
    expect(matched.matches.map((m) => m.ruleCode)).toContain(created.code);

    const retired = await expectContract(
      await request.post(`/api/rules/${created.id}/retire`, {
        headers: await mutate(FINANCE),
        data: { reason: 'The scenario no longer needs this rule.' },
      }),
      200,
      RuleDetail,
    );
    expect(retired.status).toBe('retired');

    const afterRetire = await expectContract(
      await request.post('/api/rules/simulate', {
        headers: await as(FINANCE),
        data: simulate({ spendType: 'scenario_retire' }),
      }),
      200,
      SingleSimulationResponse,
    );
    expect(afterRetire.matches.map((m) => m.ruleCode)).not.toContain(created.code);

    const again = await request.post(`/api/rules/${created.id}/retire`, {
      headers: await mutate(FINANCE),
      data: { reason: 'Trying again should be refused.' },
    });
    await expectProblem(again, 409, 'INVALID_TRANSITION');
  });

  test('a replayed publish returns the first response instead of creating another version', async ({
    request,
  }) => {
    const created = await expectContract(
      await request.post('/api/rules', {
        headers: await mutate(FINANCE),
        data: {
          mode: 'blank',
          name: 'Scenario: idempotent publish',
          priority: 404,
          actions: [{ effect: 'warn' }],
          conditions: {
            logic: 'and',
            conditions: [{ fact: 'spend_type', op: 'eq', value: 'scenario_idempotent' }],
          },
          explanation: 'Scenario rule used to prove publishing is idempotent.',
          validFrom: '2026-01-01',
        },
      }),
      201,
      RuleDetail,
    );
    const key = `scenario-publish-${created.id}`;
    const first = await expectContract(
      await request.post(`/api/rules/${created.id}/publish`, {
        headers: await mutate(FINANCE, key),
        data: {},
      }),
      200,
      RuleDetail,
    );
    const replay = await request.post(`/api/rules/${created.id}/publish`, {
      headers: await mutate(FINANCE, key),
      data: {},
    });
    const second = await expectContract(replay, 200, RuleDetail);
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect(second.active?.version).toBe(first.active?.version);
    expect(second.versions.length).toBe(first.versions.length);
  });
});
