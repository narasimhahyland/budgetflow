// Imported actuals must not bypass the ledger. A connector run only fills the Phase 6 review queue;
// money moves when a person posts that batch, through the same append-only posting path with its own
// idempotency key. Posting the same batch twice is refused, and the balances stay where they were
// until the posting happens.
import { expect, test } from '@playwright/test';
import { BudgetDetail, BudgetList, ImportBatch, SyncRunView } from '@bf/contracts';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { CONNECTIONS, resetMock } from '../support/p12';

test.beforeEach(async () => {
  await resetMock();
});

test('a connector run leaves the ledger untouched until the batch is posted', async ({
  request,
}) => {
  const run = await expectContract(
    await request.post(`/api/integrations/connections/${CONNECTIONS.erpnext}/sync`, {
      headers: await mutate('integration-admin'),
      data: { object: 'gl_lines', direction: 'inbound' },
    }),
    201,
    SyncRunView,
  );

  if (!run.importBatchId) {
    // Every line was already imported by an earlier scenario: the de-duplication invariant holds and
    // there is nothing new to post.
    expect(run.recordsSkippedDuplicate).toBeGreaterThan(0);
    return;
  }

  const batch = await expectContract(
    await request.get(`/api/actuals/imports/${run.importBatchId}`, {
      headers: await as('finance-admin'),
    }),
    200,
    ImportBatch,
  );
  expect(batch.status, 'a sync run never posts; it fills the review queue').toBe('review');
  expect(batch.summary.posted).toBeNull();

  const key = randomUUID();
  const posted = await expectContract(
    await request.post(`/api/actuals/imports/${run.importBatchId}/post`, {
      headers: await mutate('finance-admin', key),
    }),
    200,
    ImportBatch,
  );
  expect(posted.status).toBe('posted');
  expect(posted.summary.posted).not.toBeNull();

  // Posting the same batch again is refused: the ledger is written once.
  await expectProblem(
    await request.post(`/api/actuals/imports/${run.importBatchId}/post`, {
      headers: await mutate('finance-admin'),
    }),
    409,
    'IMPORT_ALREADY_POSTED',
  );

  // A replay of the original command returns the first answer rather than posting again.
  const replayed = await request.post(`/api/actuals/imports/${run.importBatchId}/post`, {
    headers: await mutate('finance-admin', key),
  });
  expect(replayed.status()).toBe(200);
  expect(replayed.headers()['idempotent-replayed']).toBe('true');
});

test('a connector cannot post to the ledger itself: there is no such endpoint on a connection', async ({
  request,
}) => {
  const res = await request.post(`/api/integrations/connections/${CONNECTIONS.erpnext}/post`, {
    headers: await mutate('integration-admin'),
    data: {},
  });
  expect(res.status()).toBe(404);
});

test('budget balances only change through the posting path', async ({ request }) => {
  const before = await expectContract(
    await request.get('/api/budgets', { headers: await as('finance-admin') }),
    200,
    BudgetList,
  );
  const target = before.items[0];
  const detailBefore = await expectContract(
    await request.get(`/api/budgets/${target.id}`, { headers: await as('finance-admin') }),
    200,
    BudgetDetail,
  );

  await request.post(`/api/integrations/connections/${CONNECTIONS.ramp}/sync`, {
    headers: await mutate('integration-admin'),
    data: { object: 'transactions', direction: 'inbound' },
  });

  const detailAfter = await expectContract(
    await request.get(`/api/budgets/${target.id}`, { headers: await as('finance-admin') }),
    200,
    BudgetDetail,
  );
  expect(detailAfter.balances.budgetCurrency.actual.amountMinor).toBe(
    detailBefore.balances.budgetCurrency.actual.amountMinor,
  );
  expect(detailAfter.balances.budgetCurrency.encumbered.amountMinor).toBe(
    detailBefore.balances.budgetCurrency.encumbered.amountMinor,
  );
});
