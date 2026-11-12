// Invariant 21: an AI suggestion is never itself authorization. A matching suggestion changes
// nothing on its own; applying it needs `actuals.manage` in the person's own right through the same
// match command an unaided reviewer would use; and the acceptance is only recorded once that command
// has actually run, with one hash-chained audit entry and a query-log row linking the two.
import { expect, test } from '@playwright/test';
import { ActualDetail, AiQueryLogList, AiSuggestionDecision } from '@bf/contracts';
import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { suggestionFor, unmatchedLine } from './support';
const detail = async (request: APIRequestContext, actualId: string) =>
  expectContract(
    await request.get(`/api/actuals/${actualId}`, { headers: await as('finance-admin') }),
    200,
    ActualDetail,
  );

test('running the ranker produces a suggestion and matches nothing', async ({ request }) => {
  const { actual } = await unmatchedLine(request);
  const suggestion = await suggestionFor(request, actual.actual.id);
  expect(suggestion.suggested.targetId).toBeTruthy();
  expect(suggestion.suggested.reasons.length).toBeGreaterThan(0);
  expect(suggestion.applyWith.endpoint).toBe('matchActual');
  expect(suggestion.applyWith.actualId).toBe(actual.actual.id);
  expect(suggestion.applyWith.parts.length).toBe(1);

  const after = await detail(request, actual.actual.id);
  expect(after.actual.status, 'the ranker matched nothing').toBe('unmatched');
  expect(after.matches, 'and posted no match parts').toEqual([]);
});

test('the ranker is deterministic: the same line gives the same suggestion twice', async ({
  request,
}) => {
  const { actual } = await unmatchedLine(request);
  const first = await suggestionFor(request, actual.actual.id);
  const second = await suggestionFor(request, actual.actual.id);
  expect(second.id).toBe(first.id);
  expect(second.suggested.targetId).toBe(first.suggested.targetId);
  expect(second.suggested.confidence).toBe(first.suggested.confidence);
  expect(second.candidates.map((c) => c.targetId)).toEqual(first.candidates.map((c) => c.targetId));
});

test('applying a suggestion as someone without actuals.manage is refused and nothing changes', async ({
  request,
}) => {
  const { actual } = await unmatchedLine(request);
  const suggestion = await suggestionFor(request, actual.actual.id);

  const refused = await request.post(`/api/actuals/${suggestion.actualId}/matches`, {
    headers: await mutate('employee', randomUUID()),
    data: { parts: suggestion.applyWith.parts },
  });
  expect(
    [403, 404],
    'an employee cannot match a spend line, whatever the model suggested',
  ).toContain(refused.status());

  const after = await detail(request, actual.actual.id);
  expect(after.actual.status).toBe('unmatched');
});

test('recording an acceptance before the match command ran is refused', async ({ request }) => {
  const { actual } = await unmatchedLine(request);
  const suggestion = await suggestionFor(request, actual.actual.id);
  await expectProblem(
    await request.post(`/api/ai/suggestions/${suggestion.id}/decision`, {
      headers: await mutate('finance-admin', randomUUID()),
      data: {
        decision: 'accepted',
        appliedResourceType: 'actual',
        appliedResourceId: suggestion.actualId,
      },
    }),
    409,
    'AI_SUGGESTION_NOT_APPLIED',
  );
  const after = await detail(request, actual.actual.id);
  expect(after.actual.status).toBe('unmatched');
});

test('a reviewer applies the suggestion through the normal match command, and the acceptance is audited', async ({
  request,
}) => {
  const { actual } = await unmatchedLine(request);
  const suggestion = await suggestionFor(request, actual.actual.id);

  const matched = await expectContract(
    await request.post(`/api/actuals/${suggestion.actualId}/matches`, {
      headers: await mutate('finance-admin', randomUUID()),
      data: { parts: suggestion.applyWith.parts },
    }),
    201,
    ActualDetail,
  );
  expect(matched.actual.status).not.toBe('unmatched');

  const decision = await expectContract(
    await request.post(`/api/ai/suggestions/${suggestion.id}/decision`, {
      headers: await mutate('finance-admin', randomUUID()),
      data: {
        decision: 'accepted',
        appliedResourceType: 'actual',
        appliedResourceId: suggestion.actualId,
      },
    }),
    201,
    AiSuggestionDecision,
  );
  expect(decision.status).toBe('accepted');
  expect(decision.appliedResourceId).toBe(suggestion.actualId);
  expect(decision.auditEventId, 'one hash-chained audit entry per decision').toBeTruthy();

  const log = await expectContract(
    await request.get(`/api/ai/query-log?suggestionId=${suggestion.id}&limit=20`, {
      headers: await as('auditor'),
    }),
    200,
    AiQueryLogList,
  );
  const accepted = log.items.find((i) => i.outcome === 'accepted');
  expect(accepted, 'the confirmation is on the AI audit trail').toBeDefined();
  expect(accepted!.appliedResourceId).toBe(suggestion.actualId);
  expect(accepted!.auditEventId).toBe(decision.auditEventId);
  expect(accepted!.suggestionId).toBe(suggestion.id);

  await expectProblem(
    await request.post(`/api/ai/suggestions/${suggestion.id}/decision`, {
      headers: await mutate('finance-admin', randomUUID()),
      data: { decision: 'dismissed' },
    }),
    409,
    'AI_SUGGESTION_NOT_OPEN',
  );
});

test('rejecting a suggestion needs a reason, because the reasons feed the evaluation set', async ({
  request,
}) => {
  const { actual } = await unmatchedLine(request);
  const suggestion = await suggestionFor(request, actual.actual.id);

  await expectProblem(
    await request.post(`/api/ai/suggestions/${suggestion.id}/decision`, {
      headers: await mutate('finance-admin', randomUUID()),
      data: { decision: 'rejected' },
    }),
    422,
    'REASON_REQUIRED',
  );
  const rejected = await expectContract(
    await request.post(`/api/ai/suggestions/${suggestion.id}/decision`, {
      headers: await mutate('finance-admin', randomUUID()),
      data: {
        decision: 'rejected',
        reasonCode: 'wrong_budget',
        reason: 'Belongs to another event.',
      },
    }),
    201,
    AiSuggestionDecision,
  );
  expect(rejected.status).toBe('rejected');

  const after = await detail(request, actual.actual.id);
  expect(after.actual.status, 'rejecting a suggestion leaves the line for 080b').toBe('unmatched');
});
