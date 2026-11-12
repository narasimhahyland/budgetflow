// Invariant 21: the model only ever sees data the asking user is already entitled to see. Retrieval
// goes through the same PolicyService check and tenant RLS as any other read, so a scoped owner's
// question cannot surface another subtree's or another tenant's figures, and every figure in an
// answer is a copy of a reconciled ledger read-model value.
import { expect, test } from '@playwright/test';
import { AiQueryLogList, AskAnswer, BudgetDetail } from '@bf/contracts';
import { SEED } from '@bf/seed';
import { as } from '../support/auth';
import { expectContract } from '../support/contract';
import { relaxAskLimit } from './support';
import { AI_LIVE, AI_LIVE_REASON } from './support';

test.skip(!AI_LIVE, AI_LIVE_REASON);

const BENGALURU = SEED.budgets.bengaluru;
const EUROPE = SEED.budgets.europe;

test.beforeAll(async ({ request }) => {
  await relaxAskLimit(request);
});

test('an owner is answered from the ledger read models, with every figure traceable to a budget', async ({
  request,
}) => {
  // Asked about one named budget, so the assertion is about this budget and not about whatever other
  // scenarios have since created in the owner's subtree.
  const answer = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('location-manager'),
      data: {
        question: 'How much is left?',
        channel: 'web',
        context: { type: 'budget', id: BENGALURU },
      },
    }),
    200,
    AskAnswer,
  );
  expect(answer.outcome).toBe('answered');
  expect(answer.sources.map((s) => s.id)).toContain(BENGALURU);
  expect(answer.figures.length).toBeGreaterThan(0);

  // Every figure must equal what the budget read model reports: the model never computes a number.
  for (const source of answer.sources.filter((s) => s.type === 'budget')) {
    const budget = await expectContract(
      await request.get(`/api/budgets/${source.id}`, { headers: await as('location-manager') }),
      200,
      BudgetDetail,
    );
    const figures = answer.figures.filter((f) => f.source.id === source.id);
    expect(figures.length, `figures cited for ${source.label}`).toBeGreaterThan(0);
    const expected: Record<string, number> = {
      authorized: budget.balances.budgetCurrency.authorized.amountMinor,
      pending: budget.balances.budgetCurrency.preEncumbered.amountMinor,
      committed: budget.balances.budgetCurrency.encumbered.amountMinor,
      actual: budget.balances.budgetCurrency.actual.amountMinor,
      available: budget.available.underRules.amountMinor,
    };
    for (const figure of figures) {
      expect(figure.amount.amountMinor, `${source.label} ${figure.key}`).toBe(expected[figure.key]);
      expect(figure.amount.currency).toBe(budget.currency);
    }
  }
});

test('a scoped owner asking about another subtree is refused and gets no figures from it', async ({
  request,
}) => {
  // The Europe subtree exists and is readable by finance, which proves the refusal is about scope.
  const europe = await expectContract(
    await request.get(`/api/budgets/${EUROPE}`, { headers: await as('finance-admin') }),
    200,
    BudgetDetail,
  );
  expect(europe.balances.budgetCurrency.authorized.amountMinor).toBeGreaterThan(0);

  const answer = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('location-manager'),
      data: { question: `How much is left in ${europe.name}?` },
    }),
    200,
    AskAnswer,
  );
  expect(answer.outcome).toBe('refused_out_of_scope');
  expect(answer.refusal?.kind).toBe('out_of_scope');
  expect(answer.answer).toBeNull();
  expect(answer.figures).toEqual([]);
  expect(answer.sources.map((s) => s.id)).not.toContain(EUROPE);
});

test('the same question with a context chip the asker may not read surfaces nothing', async ({
  request,
}) => {
  const answer = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('location-manager'),
      data: { question: 'How much is left?', context: { type: 'budget', id: EUROPE } },
    }),
    200,
    AskAnswer,
  );
  expect(answer.sources.map((s) => s.id)).not.toContain(EUROPE);
  expect(answer.figures.every((f) => f.source.id !== EUROPE)).toBe(true);
});

test('another tenant never appears in an answer or in its query-log row', async ({ request }) => {
  const globexName = 'Globex Operations';
  const answer = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('location-manager'),
      data: { question: `How much is left in ${globexName}?` },
    }),
    200,
    AskAnswer,
  );
  expect(answer.outcome).toBe('refused_out_of_scope');
  expect(answer.sources).toEqual([]);

  // And from the other side: a Globex admin sees only Globex, never Hyland.
  const globex = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('globex-admin'),
      data: { question: 'How much is left in my budgets?' },
    }),
    200,
    AskAnswer,
  );
  expect(globex.sources.map((s) => s.id)).not.toContain(BENGALURU);
  expect(globex.sources.map((s) => s.id)).not.toContain(EUROPE);

  const log = await expectContract(
    await request.get('/api/ai/query-log?feature=ask&limit=50', {
      headers: await as('finance-admin'),
    }),
    200,
    AiQueryLogList,
  );
  // The Hyland log never contains the Globex call, and no Hyland row cites a Globex record.
  const globexSources = globex.sources.map((s) => s.id);
  for (const entry of log.items)
    for (const ref of entry.factRefs) expect(globexSources).not.toContain(ref.id);
});

test('the query log records the scope that was applied, the records used and the fields sent, and never the question', async ({
  request,
}) => {
  const question = `How much is left in Bengaluru Events? marker-${Date.now()}`;
  const answer = await expectContract(
    await request.post('/api/ai/ask', {
      headers: await as('location-manager'),
      data: { question },
    }),
    200,
    AskAnswer,
  );
  expect(answer.outcome).toBe('answered');

  const log = await expectContract(
    await request.get('/api/ai/query-log?feature=ask&limit=20', {
      headers: await as('auditor'),
    }),
    200,
    AiQueryLogList,
  );
  const entry = log.items.find((i) => i.id === answer.provenance.queryLogId);
  expect(entry, 'the ask wrote its own query-log row').toBeDefined();
  expect(entry!.scope.action).toBe('budget.read');
  expect(entry!.scope.permittedCount).toBeGreaterThan(0);
  expect(entry!.recordsUsed).toBe(answer.sources.length);
  expect(entry!.modelId).toBe(answer.provenance.modelId);
  expect(JSON.stringify(entry)).not.toContain('marker-');
  // Data minimization: only the allow-listed field names left the server.
  expect(entry!.sentFields.length).toBeGreaterThan(0);
  for (const field of entry!.sentFields)
    expect(field, 'no personal or credential field is ever sent').not.toMatch(
      /email|phone|address|card|token|secret|password/i,
    );
});
