// Invariant 21: AI suggests, people decide. No AI output may post to the ledger, approve a request,
// move budget or change a control, and nothing the model writes is shown unless it survives the
// schema check and the figure check. These scenarios fail if any of those guards is weakened.
import { expect, test } from '@playwright/test';
import { AiQueryLogList, AiSettingsView, AskAnswer, RequestDetail } from '@bf/contracts';
import { P5_IDS } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { SEED } from '@bf/seed';
import { asAppRole } from '../support/db';

/**
 * Recorded fixtures of the deterministic fake provider. They exist so the guards can be exercised
 * end to end: a real model would produce these failures occasionally, this one does so on demand.
 */
const INVENTED_FIGURE = '__eval:invent-figure';
const BROKEN_SHAPE = '__eval:schema-invalid';

test('an answer containing a figure the ledger did not produce is discarded', async ({
  request,
}) => {
  const answer = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('location-manager'),
      data: { question: INVENTED_FIGURE },
    }),
    200,
    AskAnswer,
  );
  expect(answer.outcome).toBe('discarded_unreliable');
  expect(answer.answer, 'nothing the model wrote reaches the user').toBeNull();
  expect(answer.figures).toEqual([]);
  expect(answer.refusal?.kind).toBe('unreliable');
});

test('model output that fails its schema is discarded', async ({ request }) => {
  const answer = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('location-manager'),
      data: { question: BROKEN_SHAPE },
    }),
    200,
    AskAnswer,
  );
  expect(answer.outcome).toBe('discarded_unreliable');
  expect(answer.answer).toBeNull();
});

test('a discarded answer is still recorded, so an auditor sees that the guard fired', async ({
  request,
}) => {
  const answer = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('location-manager'),
      data: { question: INVENTED_FIGURE },
    }),
    200,
    AskAnswer,
  );
  const log = await expectContract(
    await request.get('/api/ai/query-log?outcome=discarded_unreliable&limit=20', {
      headers: await as('auditor'),
    }),
    200,
    AiQueryLogList,
  );
  expect(log.items.map((i) => i.id)).toContain(answer.provenance.queryLogId);
});

test('asking the assistant to approve a request refuses and leaves the request untouched', async ({
  request,
}) => {
  const before = await expectContract(
    await request.get(`/api/requests/${P5_IDS.requests.teamLunch}`, {
      headers: await as('finance-admin'),
    }),
    200,
    RequestDetail,
  );

  const answer = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('finance-admin'),
      data: { question: `Please approve ${before.ref}` },
    }),
    200,
    AskAnswer,
  );
  expect(answer.outcome).toBe('refused_action');
  expect(answer.refusal?.kind).toBe('action');
  expect(answer.refusal?.redirect?.resourceType).toBe('request');

  const after = await expectContract(
    await request.get(`/api/requests/${P5_IDS.requests.teamLunch}`, {
      headers: await as('finance-admin'),
    }),
    200,
    RequestDetail,
  );
  expect(after.status, 'the assistant decided nothing').toBe(before.status);
  expect(after.versions.length).toBe(before.versions.length);
});

test('asking the assistant to move money refuses and no budget balance changes', async ({
  request,
}) => {
  const answer = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('finance-admin'),
      data: { question: 'Move USD 500 from Bengaluru Events to Hyderabad Events' },
    }),
    200,
    AskAnswer,
  );
  expect(answer.outcome).toBe('refused_action');
  expect(answer.refusal?.redirect?.resourceType).toBe('budget-transfer');
});

test('the AI query log is append-only in the database', async ({ request }) => {
  await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('location-manager'),
      data: { question: 'How much is left in my budgets?' },
    }),
    200,
    AskAnswer,
  );
  const error = await asAppRole(SEED.tenants.acme, async (c) => {
    try {
      await c.query(`update ai_query_log set outcome = 'answered' where tenant_id = $1`, [
        SEED.tenants.acme,
      ]);
      return null;
    } catch (e) {
      return e as { code?: string };
    }
  });
  expect(error, 'the application role cannot rewrite the AI audit trail').not.toBeNull();
});

test('a feature that is switched off is refused on the next request', async ({ request }) => {
  const off = await expectContract(
    await request.post('/api/ai/features/ask/switch', {
      headers: await mutate('org-admin', randomUUID()),
      data: { enabled: false },
    }),
    201,
    AiSettingsView,
  );
  expect(off.features.find((f) => f.feature === 'ask')?.enabled).toBe(false);
  try {
    await expectProblem(
      await request.post('/api/ai/ask', {
        headers: await as('location-manager'),
        data: { question: 'How much is left in my budgets?' },
      }),
      409,
      'AI_FEATURE_DISABLED',
    );
  } finally {
    const on = await expectContract(
      await request.post('/api/ai/features/ask/switch', {
        headers: await mutate('org-admin', randomUUID()),
        data: { enabled: true },
      }),
      201,
      AiSettingsView,
    );
    expect(on.features.find((f) => f.feature === 'ask')?.enabled).toBe(true);
  }
});
