// Invariant 21: an AI suggestion is never itself authorization. A matching suggestion changes
// nothing on its own; applying it needs `actuals.manage` in the person's own right through the same
// match command an unaided reviewer would use; and the acceptance is only recorded once that command
// has actually run, with one hash-chained audit entry and a query-log row linking the two.
import { expect, test } from '@playwright/test';
import {
  ActualDetail,
  AiMatchSuggestionList,
  AiQueryLogList,
  AiSuggestionDecision,
} from '@bf/contracts';
import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

async function openSuggestions(request: APIRequestContext) {
  await expectContract(
    await request.post('/api/ai/matching-suggestions/run', {
      headers: await as('finance-admin'),
      data: {},
    }),
    200,
    AiMatchSuggestionList,
  );
  return expectContract(
    await request.get('/api/ai/matching-suggestions?status=open', {
      headers: await as('finance-admin'),
    }),
    200,
    AiMatchSuggestionList,
  );
}

test('running the suggestion ranker matches nothing by itself', async ({ request }) => {
  const list = await openSuggestions(request);
  expect(list.items.length, 'the seeded import leaves lines for the ranker').toBeGreaterThan(0);
  for (const suggestion of list.items) {
    const actual = await expectContract(
      await request.get(`/api/actuals/${suggestion.actualId}`, {
        headers: await as('finance-admin'),
      }),
      200,
      ActualDetail,
    );
    expect(actual.actual.status, `${suggestion.merchant ?? suggestion.actualId} is untouched`).toBe(
      'unmatched',
    );
    expect(actual.matches, 'and it carries no match parts').toEqual([]);
  }
});

test('a suggestion is ordered deterministically and carries the body a person would submit', async ({
  request,
}) => {
  const first = await openSuggestions(request);
  const second = await openSuggestions(request);
  expect(second.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
  for (const suggestion of first.items) {
    expect(suggestion.applyWith.endpoint).toBe('matchActual');
    expect(suggestion.applyWith.actualId).toBe(suggestion.actualId);
    expect(suggestion.applyWith.parts.length).toBe(1);
  }
});

test('applying a suggestion as someone without actuals.manage is refused and nothing changes', async ({
  request,
}) => {
  const list = await openSuggestions(request);
  const suggestion = list.items[0];
  expect(suggestion, 'at least one open suggestion to apply').toBeDefined();

  const refused = await request.post(`/api/actuals/${suggestion.actualId}/matches`, {
    headers: await mutate('employee', randomUUID()),
    data: { parts: suggestion.applyWith.parts },
  });
  expect(
    [403, 404],
    'an employee cannot match a spend line, whatever the model suggested',
  ).toContain(refused.status());

  const actual = await expectContract(
    await request.get(`/api/actuals/${suggestion.actualId}`, {
      headers: await as('finance-admin'),
    }),
    200,
    ActualDetail,
  );
  expect(actual.actual.status).toBe('unmatched');
});

test('recording an acceptance before the match command ran is refused', async ({ request }) => {
  const list = await openSuggestions(request);
  const suggestion = list.items[0];
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
});

test('a reviewer applies the suggestion through the normal match command, and the acceptance is audited', async ({
  request,
}) => {
  const list = await openSuggestions(request);
  const suggestion = list.items[0];

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

  // The same suggestion cannot be decided twice.
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
  const list = await openSuggestions(request);
  const suggestion = list.items.at(-1);
  expect(suggestion).toBeDefined();
  await expectProblem(
    await request.post(`/api/ai/suggestions/${suggestion!.id}/decision`, {
      headers: await mutate('finance-admin', randomUUID()),
      data: { decision: 'rejected' },
    }),
    422,
    'REASON_REQUIRED',
  );
  const rejected = await expectContract(
    await request.post(`/api/ai/suggestions/${suggestion!.id}/decision`, {
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
});
