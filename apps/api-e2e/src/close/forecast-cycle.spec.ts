// Phase 11 invariants for the forecast cycle (87a): a forecast is never an actual and never posts;
// a variance above the cycle threshold is refused without commentary; only finance accepts; the
// monitor's ledger columns reconcile to the ledger; closing locks the snapshot and fills the gaps
// with system run-rate forecasts.
//
// Every scenario owns its own budget tree and scopes its cycle to that tree, so two scenarios never
// forecast the same budget.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ForecastCycleDetail,
  ForecastSubmission,
  Journal,
  type ForecastMethod,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { allocateOk, createChild, createRoot, getBudget } from '../support/factory';

const US = SEED.legalEntities.acmeUs;
const AS_OF = '2026-09-30';
const DUE = '2026-10-12';

/** Opening balances for a scenario budget, posted as a manual journal (the only money here). */
async function openingBalances(
  request: APIRequestContext,
  budgetId: string,
  lines: [string, number][],
) {
  return expectContract(
    await request.post('/api/ledger/journals', {
      headers: await mutate('finance-admin'),
      data: {
        transactionCurrency: 'USD',
        reasonCode: 'ADJ-OPENING',
        reason: 'Opening balances for the forecast cycle scenario',
        lines: lines.flatMap(([account, amountMinor]) => [
          { budgetId, account, side: 'debit', amountMinor },
          {
            budgetId: null,
            account: account === 'held' ? 'earmark_reserve' : 'obligations',
            side: 'credit',
            amountMinor,
            legalEntityId: US,
          },
        ]),
      },
    }),
    201,
    Journal,
  );
}

async function openCycle(
  request: APIRequestContext,
  rootBudgetId: string,
  opts: {
    thresholdBps?: number;
    thresholdMinor?: number;
    asOfDate?: string;
    dueDate?: string;
  } = {},
) {
  return expectContract(
    await request.post('/api/close/forecast-cycles', {
      headers: await mutate('finance-admin'),
      data: {
        name: `Scenario reforecast ${randomUUID().slice(0, 8)}`,
        asOfDate: opts.asOfDate ?? AS_OF,
        dueDate: opts.dueDate ?? DUE,
        rootBudgetId,
        varianceThresholdBps: opts.thresholdBps ?? 1_000,
        varianceThresholdMinor: opts.thresholdMinor ?? 100_000,
        includeOpenEvents: false,
      },
    }),
    201,
    ForecastCycleDetail,
  );
}

async function cycleDetail(request: APIRequestContext, cycleId: string, user = 'finance-admin') {
  return expectContract(
    await request.get(`/api/close/forecast-cycles/${cycleId}`, {
      headers: await as(user as Parameters<typeof as>[0]),
    }),
    200,
    ForecastCycleDetail,
  );
}

function submitData(
  budgetId: string,
  method: ForecastMethod,
  extra: { amountMinor?: number; commentary?: string; submit?: boolean } = {},
) {
  return { budgetId, method, ...extra };
}

const lineFor = (detail: typeof ForecastCycleDetail._output, budgetId: string) => {
  const found = detail.submissions.find((s) => s.budgetId === budgetId);
  expect(found, `budget ${budgetId} is a line in the cycle`).toBeDefined();
  return found!;
};

test.describe('forecast cycle', () => {
  test('a variance above the cycle threshold is refused without commentary and accepted with it', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 1_000_000, as: 'finance-admin' });
    await openingBalances(request, root.id, [['actual', 200_000]]);
    const cycle = await openCycle(request, root.id);

    // 400,000 against 1,000,000 authorized is 600,000 under (60%): past both halves of the
    // threshold, so the API refuses it until the owner explains it.
    const refused = await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
      headers: await mutate('finance-admin'),
      data: submitData(root.id, 'owner_input', { amountMinor: 400_000 }),
    });
    expect(refused.status(), await refused.text()).toBe(422);
    const problem = (await refused.json()) as { code: string; params?: Record<string, number> };
    expect(problem.code).toBe('FORECAST_COMMENTARY_REQUIRED');
    expect(problem.params?.['varianceMinor']).toBe(600_000);
    expect(problem.params?.['varianceBps']).toBe(6_000);

    // Nothing was written: the refused submission left no line behind.
    const afterRefusal = await cycleDetail(request, cycle.cycle.id);
    expect(lineFor(afterRefusal, root.id).status).toBe('draft');
    expect(lineFor(afterRefusal, root.id).submittedAt).toBeNull();

    const accepted = await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
        headers: await mutate('finance-admin'),
        data: submitData(root.id, 'owner_input', {
          amountMinor: 400_000,
          commentary:
            'Two of the three planned programmes were cancelled after the October review.',
        }),
      }),
      201,
      ForecastSubmission,
    );
    expect(accepted.status).toBe('submitted');
    expect(accepted.forecast.amountMinor).toBe(400_000);
    expect(accepted.variance.amountMinor).toBe(600_000);
    expect(accepted.varianceBps).toBe(6_000);
    expect(accepted.varianceDirection).toBe('under');
    expect(accepted.commentaryRequired).toBe(true);
    expect(accepted.commentary).toContain('cancelled');
  });

  test('a variance exactly on the threshold needs commentary, one minor unit inside it does not', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 1_000_000, as: 'finance-admin' });
    const cycle = await openCycle(request, root.id, {
      thresholdBps: 1_000,
      thresholdMinor: 100_000,
    });

    // Exactly 10% and exactly 100,000: "at least" includes the boundary, so this is refused.
    const onThreshold = await request.post(
      `/api/close/forecast-cycles/${cycle.cycle.id}/submissions`,
      {
        headers: await mutate('finance-admin'),
        data: submitData(root.id, 'owner_input', { amountMinor: 900_000 }),
      },
    );
    expect(onThreshold.status(), await onThreshold.text()).toBe(422);
    expect((await onThreshold.json()).code).toBe('FORECAST_COMMENTARY_REQUIRED');

    // One minor unit inside it needs no commentary.
    const inside = await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
        headers: await mutate('finance-admin'),
        data: submitData(root.id, 'owner_input', { amountMinor: 900_001 }),
      }),
      201,
      ForecastSubmission,
    );
    expect(inside.variance.amountMinor).toBe(99_999);
    expect(inside.commentaryRequired).toBe(false);
    expect(inside.status).toBe('submitted');
  });

  test('a forecast posts nothing: the ledger and the budget balances are unchanged', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 800_000, as: 'finance-admin' });
    await openingBalances(request, root.id, [
      ['encumbered', 100_000],
      ['actual', 150_000],
    ]);
    const before = await getBudget(request, root.id);
    const cycle = await openCycle(request, root.id);

    await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
        headers: await mutate('finance-admin'),
        data: submitData(root.id, 'owner_input', { amountMinor: 790_000 }),
      }),
      201,
      ForecastSubmission,
    );

    const after = await getBudget(request, root.id);
    // Every bucket is where it was: a forecast is a statement, not a posting.
    expect(after.balances.reporting).toEqual(before.balances.reporting);
    expect(after.available.companyWide.amountMinor).toBe(before.available.companyWide.amountMinor);

    // And the monitor's ledger columns come from the ledger, so they reconcile.
    const detail = await cycleDetail(request, cycle.cycle.id);
    expect(detail.reconciliation.ties).toBe(true);
    expect(detail.reconciliation.differences).toEqual([]);
    expect(detail.reconciliation.authorized.amountMinor).toBe(800_000);
    expect(detail.reconciliation.encumbered.amountMinor).toBe(100_000);
    expect(detail.reconciliation.actual.amountMinor).toBe(150_000);
    // 800,000 − 0 − 0 − 100,000 − 150,000
    expect(detail.reconciliation.available.amountMinor).toBe(550_000);
    const line = lineFor(detail, root.id);
    expect(line.authorized.amountMinor).toBe(800_000);
    expect(line.committed.amountMinor).toBe(100_000);
    expect(line.actualToDate.amountMinor).toBe(150_000);
    expect(line.forecast.amountMinor).toBe(790_000);
  });

  test('the system methods are computed from the ledger and offered with their explanation', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 1_000_000, as: 'finance-admin' });
    await openingBalances(request, root.id, [
      ['encumbered', 120_000],
      ['pre_encumbered', 30_000],
      ['actual', 250_000],
    ]);
    const cycle = await openCycle(request, root.id);
    const line = lineFor(await cycleDetail(request, cycle.cycle.id), root.id);

    const runRate = line.methodOptions.find((o) => o.method === 'run_rate')!;
    const pipeline = line.methodOptions.find((o) => o.method === 'committed_pipeline')!;
    expect(line.methodOptions.map((o) => o.method)).toEqual(['run_rate', 'committed_pipeline']);
    // Both are at least what is already committed and spent, and the pipeline is never below the
    // run-rate: it adds commitments on top of the same routine spend.
    expect(runRate.amount.amountMinor).toBeGreaterThanOrEqual(400_000);
    expect(pipeline.amount.amountMinor).toBeGreaterThanOrEqual(runRate.amount.amountMinor);
    expect(runRate.explanation.length).toBeGreaterThan(20);
    expect(pipeline.explanation.length).toBeGreaterThan(20);

    // Choosing a system method stores exactly the figure the API offered.
    const submitted = await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
        headers: await mutate('finance-admin'),
        data: submitData(root.id, 'committed_pipeline', {
          commentary: 'Committed plus the pipeline, which is the usual basis for this budget.',
        }),
      }),
      201,
      ForecastSubmission,
    );
    expect(submitted.forecast.amountMinor).toBe(pipeline.amount.amountMinor);
    expect(submitted.method).toBe('committed_pipeline');
  });

  test('an owner may forecast their own budget and not another owner\u2019s', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 900_000, as: 'finance-admin' });
    const mine = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'regional-manager',
      as: 'finance-admin',
    });
    const theirs = await createChild(request, root.id, {
      currency: 'USD',
      owner: 'department-head',
      as: 'finance-admin',
    });
    await allocateOk(
      request,
      root.id,
      mine.id,
      { amountMinor: 300_000, currency: 'USD' },
      { as: 'finance-admin' },
    );
    await allocateOk(
      request,
      root.id,
      theirs.id,
      { amountMinor: 300_000, currency: 'USD' },
      { as: 'finance-admin' },
    );
    const cycle = await openCycle(request, root.id);

    // Nothing has been spent, so the run-rate forecasts zero: the whole budget under, which needs
    // an explanation before it can be submitted.
    const commentary = 'Nothing is committed yet; the regional programme starts in January.';
    const ok = await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
      headers: await mutate('regional-manager'),
      data: submitData(mine.id, 'run_rate', { commentary }),
    });
    expect(ok.status(), await ok.text()).toBe(201);

    const refused = await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
      headers: await mutate('regional-manager'),
      data: submitData(theirs.id, 'run_rate', { commentary }),
    });
    expect([403, 404]).toContain(refused.status());

    // And the owner's own view of the cycle shows their subtree, not the whole tenant.
    const ownerView = await cycleDetail(request, cycle.cycle.id, 'regional-manager');
    expect(ownerView.submissions.some((s) => s.budgetId === mine.id)).toBe(true);
    expect(ownerView.submissions.some((s) => s.budgetId === theirs.id)).toBe(false);
    expect(ownerView.scope.tenantWide).toBe(false);
    expect(ownerView.allowedActions).toContain('submit');
    expect(ownerView.allowedActions).not.toContain('close');
  });

  test('only finance decides, and an accepted forecast is the owner\u2019s last word', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 700_000, owner: 'regional-manager' });
    const cycle = await openCycle(request, root.id);
    const submitted = await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
        headers: await mutate('regional-manager'),
        data: submitData(root.id, 'owner_input', { amountMinor: 690_000 }),
      }),
      201,
      ForecastSubmission,
    );

    const byOwner = await request.post(
      `/api/close/forecast-cycles/${cycle.cycle.id}/submissions/${submitted.id}/decision`,
      { headers: await mutate('regional-manager'), data: { decision: 'accept' } },
    );
    expect([403, 404]).toContain(byOwner.status());

    const asked = await expectContract(
      await request.post(
        `/api/close/forecast-cycles/${cycle.cycle.id}/submissions/${submitted.id}/decision`,
        {
          headers: await mutate('finance-admin'),
          data: {
            decision: 'request_commentary',
            note: 'Say which programmes are not going ahead.',
          },
        },
      ),
      201,
      ForecastSubmission,
    );
    expect(asked.status).toBe('commentary_required');
    expect(asked.commentaryNote).toContain('programmes');

    // The owner can answer while the line is back with them.
    const resubmitted = await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
        headers: await mutate('regional-manager'),
        data: submitData(root.id, 'owner_input', {
          amountMinor: 690_000,
          commentary: 'The Pune offsite was dropped; everything else is unchanged.',
        }),
      }),
      201,
      ForecastSubmission,
    );
    expect(resubmitted.status).toBe('submitted');

    const accepted = await expectContract(
      await request.post(
        `/api/close/forecast-cycles/${cycle.cycle.id}/submissions/${resubmitted.id}/decision`,
        { headers: await mutate('finance-admin'), data: { decision: 'accept' } },
      ),
      201,
      ForecastSubmission,
    );
    expect(accepted.status).toBe('accepted');
    expect(accepted.acceptedByName).toBe(userById('finance-admin').displayName);

    const afterAccept = await request.post(
      `/api/close/forecast-cycles/${cycle.cycle.id}/submissions`,
      {
        headers: await mutate('regional-manager'),
        data: submitData(root.id, 'owner_input', { amountMinor: 1_000 }),
      },
    );
    expect(afterAccept.status(), await afterAccept.text()).toBe(409);
    expect((await afterAccept.json()).code).toBe('FORECAST_ALREADY_ACCEPTED');
  });

  test('closing a cycle accepts what was submitted, fills the gaps with System run-rate and locks the snapshot', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 1_200_000, as: 'finance-admin' });
    const submittedChild = await createChild(request, root.id, {
      currency: 'USD',
      as: 'finance-admin',
    });
    const silentChild = await createChild(request, root.id, {
      currency: 'USD',
      as: 'finance-admin',
    });
    await allocateOk(
      request,
      root.id,
      submittedChild.id,
      {
        amountMinor: 400_000,
        currency: 'USD',
      },
      { as: 'finance-admin' },
    );
    await allocateOk(
      request,
      root.id,
      silentChild.id,
      { amountMinor: 300_000, currency: 'USD' },
      { as: 'finance-admin' },
    );
    await openingBalances(request, silentChild.id, [['actual', 60_000]]);
    const cycle = await openCycle(request, root.id);
    await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
        headers: await mutate('finance-admin'),
        data: submitData(submittedChild.id, 'owner_input', { amountMinor: 395_000 }),
      }),
      201,
      ForecastSubmission,
    );

    const wrongPhrase = await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/close`, {
      headers: await mutate('finance-admin'),
      data: { confirmation: 'close it' },
    });
    expect(wrongPhrase.status(), await wrongPhrase.text()).toBe(422);
    expect((await wrongPhrase.json()).code).toBe('CONFIRMATION_MISMATCH');

    const closed = await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/close`, {
        headers: await mutate('finance-admin'),
        data: { confirmation: cycle.cycle.closeConfirmation },
      }),
      201,
      ForecastCycleDetail,
    );
    expect(closed.cycle.status).toBe('closed');
    expect(closed.cycle.closedByName).toBe(userById('finance-admin').displayName);
    expect(closed.allowedActions).toEqual([]);
    // Every line of the cycle is accepted; nobody is left out of the report.
    expect(closed.submissions.map((s) => s.status)).toEqual(
      closed.submissions.map(() => 'accepted'),
    );
    expect(lineFor(closed, submittedChild.id).systemGenerated).toBe(false);
    const filled = lineFor(closed, silentChild.id);
    expect(filled.systemGenerated).toBe(true);
    expect(filled.method).toBe('run_rate');
    expect(filled.forecast.amountMinor).toBeGreaterThanOrEqual(60_000);
    // Closing moved no money either.
    expect(closed.reconciliation.ties).toBe(true);

    const afterClose = await request.post(
      `/api/close/forecast-cycles/${cycle.cycle.id}/submissions`,
      {
        headers: await mutate('finance-admin'),
        data: submitData(submittedChild.id, 'owner_input', { amountMinor: 1_000 }),
      },
    );
    expect(afterClose.status(), await afterClose.text()).toBe(409);
    expect((await afterClose.json()).code).toBe('FORECAST_CYCLE_CLOSED');
  });

  test('a replayed submission is stored once and answered from the first result', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 500_000, as: 'finance-admin' });
    const cycle = await openCycle(request, root.id);
    const key = randomUUID();
    const data = submitData(root.id, 'owner_input', { amountMinor: 495_000 });

    const first = await expectContract(
      await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
        headers: await mutate('finance-admin', key),
        data,
      }),
      201,
      ForecastSubmission,
    );
    const replay = await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
      headers: await mutate('finance-admin', key),
      data,
    });
    expect(replay.status()).toBe(201);
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    const second = await expectContract(replay, 201, ForecastSubmission);
    expect(second.id).toBe(first.id);

    // One line, not two.
    const detail = await cycleDetail(request, cycle.cycle.id);
    expect(detail.submissions.filter((s) => s.budgetId === root.id)).toHaveLength(1);
  });

  test('cycle lines come back in a total order, the same way every time', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 600_000, as: 'finance-admin' });
    for (let i = 0; i < 4; i += 1) {
      const child = await createChild(request, root.id, { currency: 'USD', as: 'finance-admin' });
      await allocateOk(
        request,
        root.id,
        child.id,
        { amountMinor: 50_000, currency: 'USD' },
        { as: 'finance-admin' },
      );
    }
    const cycle = await openCycle(request, root.id);
    const first = await cycleDetail(request, cycle.cycle.id);
    const second = await cycleDetail(request, cycle.cycle.id);

    const keys = (d: typeof ForecastCycleDetail._output) =>
      d.submissions.map((s) => `${s.budgetName}|${s.budgetId}`);
    expect(keys(first)).toEqual(keys(second));
    // Sorted by name then id, which is a total order because ids are unique.
    expect(keys(first)).toEqual([...keys(first)].sort((a, b) => a.localeCompare(b)));
    expect(first.submissions.length).toBe(5);
  });

  test('an auditor reads a cycle and cannot change it', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 400_000, as: 'finance-admin' });
    const cycle = await openCycle(request, root.id);

    const read = await cycleDetail(request, cycle.cycle.id, 'auditor');
    expect(read.cycle.id).toBe(cycle.cycle.id);
    expect(read.allowedActions).toEqual([]);

    const write = await request.post(`/api/close/forecast-cycles/${cycle.cycle.id}/submissions`, {
      headers: await mutate('auditor'),
      data: submitData(root.id, 'run_rate'),
    });
    expect([403, 404]).toContain(write.status());
  });
});
