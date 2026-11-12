// Navan live integration (build plan 16a, gap B1), proven against the mock provider on Navan's real
// paths and shapes. Every Navan call runs in the worker: OAuth client credentials without a `scope`
// parameter, a cached token, the EU region header, modified-date windows of at most 93 days, cursor
// paging, 429 backoff. Inbound spend becomes an actuals review batch (never the ledger directly),
// replays post once, card-feed duplicates are flagged, spend above the remaining budget goes to the
// post-spend exception queue, closed periods move late. Outbound, event codes are published as
// Navan field options through async batch jobs and switched off while their budget is frozen;
// coding is written back by batch PATCH of at most 100, and Navan's ERP sync status is untouched
// unless BudgetFlow is the system of record. Nothing here approves anything in Navan.
import { expect, test } from '@playwright/test';
import {
  ActualList,
  ConnectionDetail,
  DocumentList,
  IntegrationMessageList,
  Journal,
  NavanCustomFieldList,
  NavanSettings,
  PostSpendExceptionList,
  PushItemList,
  TestConnectionResult,
} from '@bf/contracts';
import { SEED } from '@bf/seed';
import { createEvent, post, spendBudget, US, uniq, buckets, actualByRef } from '../actuals/support';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  addNavanTransactions,
  connectNavan,
  COST_CENTER_FIELD,
  EVENT_FIELD,
  expireNavanTokens,
  NAVAN_CLIENT_ID,
  NAVAN_SECRET,
  navanOption,
  navanSettings,
  navanState,
  runNavan,
  STACK_NOW,
  type NavanTx,
} from '../support/navan';
import { applyControl, auditFor } from '../support/p5';
import { armFailure, CONNECTIONS, resetMock } from '../support/p12';

// Serial: the scenarios share one Navan connection and its cursors. Runs go through the worker, so
// each scenario gets more time than the default.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const DAY_MS = 86_400_000;
const tag = uniq();
let navan: ConnectionDetail;

const tx = (n: string, over: Partial<NavanTx> = {}): NavanTx => ({
  id: `NVN-T-${tag}-${n}`,
  type: 'CARD',
  transactionDate: '2026-11-14',
  modifiedAt: '2026-11-15T10:00:00.000Z',
  amount: '10.00',
  currency: 'USD',
  merchant: `Scenario merchant ${tag}`,
  description: `Scenario ${tag} ${n}`,
  user: { id: 'nvn-u-06', email: 'budget.owner@example.test' },
  hrFields: { subsidiary: 'HYL-US', costCenter: 'CC-US-NYC-300' },
  glCode: '6100',
  ...over,
});

async function linesOf(request: Parameters<typeof buckets>[0], batchId: string) {
  return expectContract(
    await request.get(`/api/actuals?status=all&batchId=${batchId}&limit=200`, {
      headers: await as('finance-controller'),
    }),
    200,
    ActualList,
  );
}

/** A direct mapping rule: lines whose memo carries `marker` are proposed against `budgetId`. */
async function ruleTo(request: Parameters<typeof buckets>[0], marker: string, budgetId: string) {
  const res = await request.post('/api/actuals/mapping-rules', {
    headers: await mutate('finance-admin'),
    data: {
      name: `Navan scenario ${marker}`,
      priority: 10,
      match: { memoContains: marker },
      targetBudgetId: budgetId,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

test.beforeAll(async ({ request }) => {
  await resetMock();
  navan = await connectNavan(request);
});

test.beforeEach(async () => {
  await resetMock();
});

test.describe('connection: client credentials, token cache, region', () => {
  test('the token call sends no scope, the token carries Expense: Write, and every call is EU', async ({
    request,
  }) => {
    expect(JSON.stringify(navan)).not.toContain(NAVAN_SECRET);
    expect(navan.credential.secretRef).not.toBeNull();
    const ok = await expectContract(
      await request.post(`/api/integrations/connections/${navan.summary.id}/test`, {
        headers: await mutate('integration-admin'),
      }),
      200,
      TestConnectionResult,
    );
    expect(ok.ok, ok.message).toBe(true);
    expect(ok.message).toContain('Expense: Write');

    const users = await runNavan(request, navan.summary.id, 'users', 'inbound');
    expect(users.status, users.errorSummary ?? '').not.toBe('failed');
    // Jordan and Lena are BudgetFlow people; the contractor is reported, never created.
    expect(users.recordsApplied).toBeGreaterThanOrEqual(2);
    expect(users.recordsFailed).toBeGreaterThanOrEqual(1);

    const state = await navanState();
    expect(state.tokenRequests.length).toBeGreaterThan(0);
    for (const t of state.tokenRequests) {
      expect(t).toMatchObject({
        grantType: 'client_credentials',
        clientId: NAVAN_CLIENT_ID,
        sentScope: false,
      });
    }
    expect(state.calls.length).toBeGreaterThan(0);
    expect(state.calls.every((c) => c.region === 'eu')).toBe(true);
    expect(state.calls.every((c) => c.status === 200)).toBe(true);
  });

  test('the worker caches the token between runs and renews it once Navan says it expired', async ({
    request,
  }) => {
    await runNavan(request, navan.summary.id, 'users', 'inbound');
    const afterFirst = (await navanState()).tokenRequests.length;
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    await runNavan(request, navan.summary.id, 'users', 'inbound');
    expect((await navanState()).tokenRequests.length, 'second run reuses the token').toBe(
      afterFirst,
    );
    await expireNavanTokens();
    const renewed = await runNavan(request, navan.summary.id, 'users', 'inbound');
    expect(renewed.status).not.toBe('failed');
    expect((await navanState()).tokenRequests.length).toBe(afterFirst + 1);
  });

  test('without the region header an EU account refuses the call, and the connection says why', async ({
    request,
  }) => {
    expect((await navanSettings(request, navan.summary.id, { region: 'us' })).status()).toBe(200);
    const refused = await expectContract(
      await request.post(`/api/integrations/connections/${navan.summary.id}/test`, {
        headers: await mutate('integration-admin'),
      }),
      200,
      TestConnectionResult,
    );
    expect(refused.ok).toBe(false);
    expect(refused.statusCode).toBe(400);
    expect(refused.message).toContain('region');
    const flagged = await expectContract(
      await request.get(`/api/integrations/connections/${navan.summary.id}`, {
        headers: await as('integration-admin'),
      }),
      200,
      ConnectionDetail,
    );
    expect(flagged.summary.status).toBe('needs_attention');

    expect((await navanSettings(request, navan.summary.id, { region: 'eu' })).status()).toBe(200);
    const back = await expectContract(
      await request.post(`/api/integrations/connections/${navan.summary.id}/test`, {
        headers: await mutate('integration-admin'),
      }),
      200,
      TestConnectionResult,
    );
    expect(back.ok).toBe(true);
  });

  test('live mode stays off without the env flag, and settings past Navan limits are refused', async ({
    request,
  }) => {
    await expectProblem(
      await request.patch(`/api/integrations/connections/${navan.summary.id}`, {
        headers: await mutate('integration-admin'),
        data: { mode: 'live' },
      }),
      409,
      'NAVAN_LIVE_DISABLED',
    );
    await expectProblem(
      await navanSettings(request, navan.summary.id, { writeBatchSize: 101 }),
      422,
      'VALIDATION_FAILED',
    );
    await expectProblem(
      await navanSettings(request, navan.summary.id, { pageSize: 501 }),
      422,
      'VALIDATION_FAILED',
    );
    // The settings contract: defaults fill in, out-of-range values fail at their own path.
    expect(NavanSettings.parse({})).toMatchObject({
      region: 'us',
      expenseWrite: false,
      writeBatchSize: 100,
    });
    const bad = NavanSettings.safeParse({ writeBatchSize: 0 });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].path).toEqual(['writeBatchSize']);
  });

  test('the field mapping lists the Navan list fields and names the ones BudgetFlow publishes into', async ({
    request,
  }) => {
    const fields = await expectContract(
      await request.get(`/api/integrations/connections/${navan.summary.id}/navan/custom-fields`, {
        headers: await as('integration-admin'),
      }),
      200,
      NavanCustomFieldList,
    );
    expect(fields.items.find((f) => f.id === EVENT_FIELD)?.usedFor).toBe('event_code');
    expect(fields.items.find((f) => f.id === COST_CENTER_FIELD)?.usedFor).toBe('cost_center');
    expect(fields.items.find((f) => f.type !== 'LIST')?.usedFor ?? null).toBeNull();
    await expectProblem(
      await request.get(`/api/integrations/connections/${navan.summary.id}/navan/custom-fields`, {
        headers: await as('employee'),
      }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('inbound: windows, paging, rate limits', () => {
  test('a long backfill is split into consecutive windows of at most 93 days', async ({
    request,
  }) => {
    const old = tx('FEB', {
      transactionDate: '2026-02-09',
      modifiedAt: '2026-02-10T12:00:00.000Z',
    });
    await addNavanTransactions([old]);
    const run = await runNavan(request, navan.summary.id, 'transactions', 'inbound', '2026-01-01');
    expect(run.status, run.errorSummary ?? '').not.toBe('failed');
    expect(run.importBatchId).not.toBeNull();
    expect(run.cursor, 'the next run re-reads the last four hours').toBe(
      new Date(Date.parse(STACK_NOW) - 4 * 3_600_000).toISOString(),
    );

    // A reset mock forgot the worker's cached token: the first call is a 401 and is renewed.
    const answered = async (path: string) =>
      (await navanState(path)).calls.filter((c) => c.status === 200);
    const calls = await answered('/navan/v1/expense/card-transactions');
    const windows = calls.map((c) => ({ from: c.query.modifiedFrom, to: c.query.modifiedTo }));
    expect(windows[0].from).toBe('2026-01-01T00:00:00.000Z');
    expect(windows.at(-1)!.to).toBe(STACK_NOW);
    expect(windows).toHaveLength(4);
    for (const [i, w] of windows.entries()) {
      expect((Date.parse(w.to) - Date.parse(w.from)) / DAY_MS).toBeLessThanOrEqual(93);
      if (i > 0) expect(w.from, 'windows are contiguous').toBe(windows[i - 1].to);
    }
    // Every transaction type is read over the same windows.
    for (const type of [
      'card-transactions',
      'connect-transactions',
      'manual-transactions',
      'repayments',
      'fees',
      'adjustments',
      'daily-rebates',
      'disputes',
    ]) {
      expect(await answered(`/navan/v1/expense/${type}`)).toHaveLength(4);
    }
    const lines = await linesOf(request, run.importBatchId!);
    expect(lines.items.map((l) => l.sourceRef)).toContain(old.id);
    expect(lines.items.find((l) => l.sourceRef === old.id)?.source).toBe('travel');

    // The next run starts from the stored cursor.
    await runNavan(request, navan.summary.id, 'transactions', 'inbound');
    const next = (await answered('/navan/v1/expense/card-transactions')).at(-1)!;
    expect(next.query.modifiedFrom).toBe(run.cursor);
  });

  test('cursor paging reads every page once', async ({ request }) => {
    expect((await navanSettings(request, navan.summary.id, { pageSize: 2 })).status()).toBe(200);
    const page = ['P1', 'P2', 'P3', 'P4', 'P5'].map((n, i) =>
      tx(n, { modifiedAt: `2026-11-15T0${i + 1}:00:00.000Z` }),
    );
    await addNavanTransactions(page);
    const run = await runNavan(request, navan.summary.id, 'transactions', 'inbound', '2026-11-15');
    expect((await navanSettings(request, navan.summary.id, { pageSize: 500 })).status()).toBe(200);
    expect(run.status, run.errorSummary ?? '').not.toBe('failed');
    const calls = (await navanState('/navan/v1/expense/card-transactions')).calls.filter(
      (c) => c.status === 200,
    );
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c.query.limit === '2')).toBe(true);
    expect(calls[0].query.cursor).toBeUndefined();
    expect(calls.slice(1).every((c) => Boolean(c.query.cursor))).toBe(true);
    const refs = (await linesOf(request, run.importBatchId!)).items.map((l) => l.sourceRef);
    for (const t of page) expect(refs.filter((r) => r === t.id)).toHaveLength(1);
  });

  test('a 429 waits for Retry-After and carries on; one that never clears lands in the retry queue', async ({
    request,
  }) => {
    const one = tx('RL1', { modifiedAt: '2026-11-15T14:00:00.000Z' });
    await addNavanTransactions([one]);
    await armFailure('/navan/v1/expense/card-transactions', 429, 2);
    const run = await runNavan(request, navan.summary.id, 'transactions', 'inbound', '2026-11-15');
    expect(run.status, run.errorSummary ?? '').not.toBe('failed');
    expect(run.errorSummary).toContain('2 rate-limit wait(s)');
    const refs = (await linesOf(request, run.importBatchId!)).items.map((l) => l.sourceRef);
    expect(refs).toContain(one.id);

    await armFailure('/navan/v1/expense/card-transactions', 429, 20);
    const failed = await runNavan(
      request,
      navan.summary.id,
      'transactions',
      'inbound',
      '2026-11-15',
    );
    expect(failed.status).toBe('failed');
    expect(failed.errorSummary).toContain('429');
    const messages = await expectContract(
      await request.get(
        `/api/integrations/messages?connectionId=${navan.summary.id}&errorClass=rate_limit`,
        { headers: await as('integration-admin') },
      ),
      200,
      IntegrationMessageList,
    );
    const queued = messages.items.find((m) => m.idempotencyKey === `sync:${failed.id}`);
    expect(queued?.status).toBe('retrying');
    expect(queued?.nextRetryAt).not.toBeNull();
    // Put the connection back to healthy for the scenarios that follow.
    await resetMock();
    await request.post(`/api/integrations/connections/${navan.summary.id}/test`, {
      headers: await mutate('integration-admin'),
    });
  });
});

test.describe('inbound: actuals review, duplicates, exceptions, periods, receipts', () => {
  test('a replayed window applies nothing again and the posted spend counts once', async ({
    request,
  }) => {
    const budget = await spendBudget(request, { legalEntityId: US, amountMinor: 1_000_000 });
    await ruleTo(request, `IDEM-${tag}`, budget.id);
    const line = tx('IDEM', { amount: '125.00', description: `IDEM-${tag} team dinner` });
    await addNavanTransactions([line]);
    const first = await runNavan(
      request,
      navan.summary.id,
      'transactions',
      'inbound',
      '2026-11-15',
    );
    expect(first.importBatchId).not.toBeNull();
    const before = await buckets(request, budget.id);
    const posted = await post(request, first.importBatchId!);
    expect(posted.status).toBe('posted');
    const after = await buckets(request, budget.id);
    expect(
      after.balances.budgetCurrency.actual.amountMinor -
        before.balances.budgetCurrency.actual.amountMinor,
    ).toBe(12_500);

    const replay = await runNavan(
      request,
      navan.summary.id,
      'transactions',
      'inbound',
      '2026-11-15',
    );
    expect(replay.status).not.toBe('failed');
    expect(replay.recordsApplied).toBe(0);
    expect(replay.recordsSkippedDuplicate).toBeGreaterThanOrEqual(1);
    const again = await buckets(request, budget.id);
    expect(again.balances.budgetCurrency.actual.amountMinor).toBe(
      after.balances.budgetCurrency.actual.amountMinor,
    );
    const detail = await actualByRef(request, line.id);
    expect(detail.actual.status).toBe('matched');
    expect(detail.matches).toHaveLength(1);
    await expectProblem(
      await request.post(`/api/actuals/imports/${first.importBatchId}/post`, {
        headers: await mutate('finance-controller'),
      }),
      409,
      'IMPORT_ALREADY_POSTED',
    );
  });

  test('a connected-card transaction that the card feed already sent is flagged before matching', async ({
    request,
  }) => {
    // The Ramp mock carries RMP-5501: 86.40 USD at Cafe Mocha on 5 November. Make sure it is in.
    await request.post(`/api/integrations/connections/${CONNECTIONS.ramp}/sync`, {
      headers: await mutate('integration-admin'),
      data: { object: 'transactions', direction: 'inbound', since: '2026-01-01' },
    });
    const dup = tx('DUP', {
      type: 'CONNECT',
      transactionDate: '2026-11-05',
      modifiedAt: '2026-11-15T15:00:00.000Z',
      amount: '86.40',
      merchant: 'Cafe Mocha',
    });
    await addNavanTransactions([dup]);
    const run = await runNavan(request, navan.summary.id, 'transactions', 'inbound', '2026-11-15');
    expect(run.errorSummary).toContain('possible duplicates of another source');
    const detail = await actualByRef(request, dup.id);
    expect(detail.actual.duplicateOfActualId).not.toBeNull();
    expect(detail.actual.note).toContain('Possible duplicate');
    expect(detail.actual.cardProgram).toBe('Connected card');
  });

  test('spend above the remaining budget goes to the post-spend exception queue, once', async ({
    request,
  }) => {
    const small = await spendBudget(request, { legalEntityId: US, amountMinor: 10_000 });
    await ruleTo(request, `OVER-${tag}`, small.id);
    const over = tx('OVER', { amount: '150.00', description: `OVER-${tag} client dinner` });
    await addNavanTransactions([over]);
    const run = await runNavan(request, navan.summary.id, 'transactions', 'inbound', '2026-11-15');
    expect(run.errorSummary).toContain('post-spend exception queue');
    const list = async () =>
      (
        await expectContract(
          await request.get('/api/rules/exceptions?type=over_budget', {
            headers: await as('finance-admin'),
          }),
          200,
          PostSpendExceptionList,
        )
      ).items.filter((e) => e.sourceRef === over.id);
    const raised = await list();
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      type: 'over_budget',
      status: 'open',
      budgetId: small.id,
      sourceKind: 'actual',
      personName: 'Jordan Smith',
      transactionAmount: { amountMinor: 15_000, currency: 'USD' },
    });
    expect(raised[0].facts).toMatchObject({
      roomMinor: 10_000,
      excessMinor: 5_000,
      source: 'Navan',
    });
    expect((await auditFor(request, raised[0].id)).map((a) => a.action)).toContain(
      'exception.raised',
    );
    // Navan approved it; BudgetFlow did not and cannot: nothing was posted to the budget.
    const b = await buckets(request, small.id);
    expect(b.balances.budgetCurrency.actual.amountMinor).toBe(0);

    await runNavan(request, navan.summary.id, 'transactions', 'inbound', '2026-11-15');
    expect(await list()).toHaveLength(1);
  });

  test('spend dated in a closed period posts to the next open period, flagged late', async ({
    request,
  }) => {
    const budget = await spendBudget(request, { legalEntityId: US, amountMinor: 1_000_000 });
    await ruleTo(request, `LATE-${tag}`, budget.id);
    const late = tx('LATE', {
      transactionDate: SEED.dates.closed,
      modifiedAt: '2026-11-15T16:00:00.000Z',
      amount: '40.00',
      description: `LATE-${tag} August taxi`,
    });
    await addNavanTransactions([late]);
    const run = await runNavan(request, navan.summary.id, 'transactions', 'inbound', '2026-11-15');
    await post(request, run.importBatchId!);
    const detail = await actualByRef(request, late.id);
    expect(detail.actual.accountingDate).toBe(SEED.dates.closed);
    const journal = await expectContract(
      await request.get(`/api/ledger/journals/${detail.matches[0].journalIds[0]}`, {
        headers: await as('finance-controller'),
      }),
      200,
      Journal,
    );
    expect([journal.late, journal.periodLabel, journal.accountingDate]).toEqual([
      true,
      'Nov 2026',
      SEED.dates.closed,
    ]);
  });

  test('receipts are copied into the document store, and an expired link is looked up again', async ({
    request,
  }) => {
    const fresh = tx('RCPT1', {
      modifiedAt: '2026-11-15T17:00:00.000Z',
      receiptToken: `r-${tag}-1`,
    });
    const stale = tx('RCPT2', {
      modifiedAt: '2026-11-15T17:30:00.000Z',
      receiptToken: `r-${tag}-2`,
      receiptIssuedAt: '2020-01-01T00:00:00.000Z',
    });
    await addNavanTransactions([fresh, stale]);
    const run = await runNavan(request, navan.summary.id, 'transactions', 'inbound', '2026-11-15');
    expect(run.errorSummary).toContain('2 receipt(s) stored');
    const lookups = (await navanState('/navan/v1/expense/transactions')).calls.filter(
      (c) => c.method === 'GET',
    );
    expect(lookups.some((c) => (c.query.ids ?? '').split(',').includes(stale.id))).toBe(true);
    expect(lookups.some((c) => (c.query.ids ?? '').split(',').includes(fresh.id))).toBe(false);
    for (const t of [fresh, stale]) {
      const actual = await actualByRef(request, t.id);
      const docs = await expectContract(
        await request.get(`/api/documents?ownerType=actual&ownerId=${actual.actual.id}`, {
          headers: await as('finance-admin'),
        }),
        200,
        DocumentList,
      );
      expect(docs.items).toHaveLength(1);
      expect(docs.items[0]).toMatchObject({ kind: 'receipt', status: 'available' });
    }
  });
});

test.describe('outbound: options, controls, write-back', () => {
  test('a frozen budget switches its event code off in Navan, and unfreezing switches it back on', async ({
    request,
  }) => {
    const team = await spendBudget(request, { legalEntityId: US });
    const event = await createEvent(request, { budgetId: team.id });
    const published = await runNavan(request, navan.summary.id, 'event_codes', 'outbound');
    expect(published.status, published.errorSummary ?? '').not.toBe('failed');
    expect(await navanOption(EVENT_FIELD, event.eventCode)).toMatchObject({ active: true });
    const jobs = (await navanState()).jobs;
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.status === 'COMPLETED' && j.polls >= 2)).toBe(true);

    await applyControl(request, team.id, 'freeze');
    await expect
      .poll(async () => (await navanOption(EVENT_FIELD, event.eventCode))?.active, {
        timeout: 30_000,
      })
      .toBe(false);
    const pushes = async () =>
      (
        await expectContract(
          await request.get(
            `/api/integrations/pushes?connectionId=${navan.summary.id}&kind=event_code`,
            { headers: await as('integration-admin') },
          ),
          200,
          PushItemList,
        )
      ).items.find((p) => p.reference === event.eventCode);
    expect((await pushes())?.status).toBe('disabled');

    await applyControl(request, team.id, 'unfreeze');
    await expect
      .poll(async () => (await navanOption(EVENT_FIELD, event.eventCode))?.active, {
        timeout: 30_000,
      })
      .toBe(true);
    const push = await pushes();
    expect(push?.status).toBe('pushed');
    const changes = (await auditFor(request, push!.id)).filter(
      (a) => a.action === 'integration.navan_option_changed',
    );
    expect(changes.map((c) => c.changes['status']?.to)).toEqual(
      expect.arrayContaining(['pushed', 'disabled']),
    );

    // A replay sends nothing: every option already matches.
    const before = (await navanState()).jobs.length;
    const replay = await runNavan(request, navan.summary.id, 'event_codes', 'outbound');
    expect(replay.errorSummary).toContain('already matches');
    expect((await navanState()).jobs.length).toBe(before);
  });

  test('cost centers are published as options of the cost center field', async ({ request }) => {
    const run = await runNavan(request, navan.summary.id, 'cost_centers', 'outbound');
    expect(run.status, run.errorSummary ?? '').not.toBe('failed');
    // After a mock reset the options exist again only if BudgetFlow sends them; diff-based runs
    // send nothing when the stored state already matches, so read what BudgetFlow recorded.
    const pushes = await expectContract(
      await request.get(
        `/api/integrations/pushes?connectionId=${navan.summary.id}&kind=cost_center`,
        { headers: await as('integration-admin') },
      ),
      200,
      PushItemList,
    );
    expect(pushes.items.find((p) => p.reference === 'CC-US-NYC-300')?.status).toBe('pushed');
  });

  test('coding is written back in PATCH calls of at most the batch size, without the ERP sync status', async ({
    request,
  }) => {
    expect((await navanSettings(request, navan.summary.id, { writeBatchSize: 1 })).status()).toBe(
      200,
    );
    const run = await runNavan(request, navan.summary.id, 'transactions', 'outbound', '2026-01-01');
    expect(run.status, run.errorSummary ?? '').toBe('succeeded');
    expect(run.recordsApplied).toBeGreaterThanOrEqual(2);
    const patches = (await navanState()).patches;
    expect(patches).toHaveLength(run.recordsApplied);
    expect(patches.every((p) => p.transactions.length === 1)).toBe(true);
    const items = patches.flatMap((p) => p.transactions);
    expect(items.find((i) => i['id'] === `NVN-T-${tag}-IDEM`)).toMatchObject({
      glCode: '6100',
      hrFields: { costCenter: 'CC-US-NYC-300' },
    });
    expect(items.some((i) => 'erpSyncStatus' in i)).toBe(false);

    // Only when BudgetFlow is the system of record is the transaction marked synced.
    await resetMock();
    expect(
      (
        await navanSettings(request, navan.summary.id, {
          writeBatchSize: 100,
          systemOfRecord: true,
        })
      ).status(),
    ).toBe(200);
    const sor = await runNavan(request, navan.summary.id, 'transactions', 'outbound', '2026-01-01');
    expect(sor.status).toBe('succeeded');
    const sorPatches = (await navanState()).patches;
    expect(sorPatches.length).toBe(Math.ceil(sor.recordsApplied / 100));
    expect(
      sorPatches.flatMap((p) => p.transactions).every((i) => i['erpSyncStatus'] === 'SYNCED'),
    ).toBe(true);
    expect(
      (await navanSettings(request, navan.summary.id, { systemOfRecord: false })).status(),
    ).toBe(200);
  });

  test('read-only credentials and a switched-off write scope never write to Navan', async ({
    request,
  }) => {
    expect((await navanSettings(request, navan.summary.id, { expenseWrite: false })).status()).toBe(
      200,
    );
    const off = await runNavan(request, navan.summary.id, 'event_codes', 'outbound');
    expect(off.status).toBe('failed');
    expect(off.errorSummary).toContain('Expense: Write is off');

    const readOnly = await connectNavan(request, { clientId: 'budgetflow-eu-readonly' });
    const refused = await runNavan(request, readOnly.summary.id, 'transactions', 'outbound');
    expect(refused.status).toBe('failed');
    expect(refused.errorSummary).toContain('did not grant the Expense: Write scope');
    expect((await navanState()).patches).toHaveLength(0);
    expect((await navanState()).jobs).toHaveLength(0);

    // Leave Navan connected with full scope for whoever runs next.
    navan = await connectNavan(request);
    expect(navan.summary.status).toBe('connected');
  });
});
