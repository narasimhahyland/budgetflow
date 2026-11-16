// Gap B9: the nightly AI scans (016b outlook, 017c anomaly flags) as worker jobs. The sweep
// iterates tenants explicitly and runs each tenant's scan once per night; a replay or a redelivered
// job changes nothing; tenants never see each other's runs; a switched-off feature skips its run
// without a model call; a model outage retries with backoff and ends in the dead letter with the
// run marked failed. A scan only suggests: no journal, approval, rule or audit entry comes from it.
//
// The local stack turns the wall-clock schedule off (`AI_SCAN_NIGHTLY_CRON=off`), so these
// scenarios publish the nightly job through the outbox, exactly as the schedule would enqueue it.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { AiScanRun, AiScanRunList, AiSettingsView } from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { todayUtc } from '../support/clock';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole, asOwner } from '../support/db';
import { createRoot } from '../support/factory';
import { openingBalance } from '../budgets/p4';

const ACME = SEED.tenants.acme;
const GLOBEX = SEED.tenants.globex;
const SANDBOX = SEED.tenants.sandbox;
const FEATURES = ['outlook', 'anomaly_flags'] as const;

const count = (sql: string, params: unknown[] = []) =>
  asOwner(async (c) => Number((await c.query<{ n: string }>(sql, params)).rows[0].n));

/** Publishes one job through the outbox, as the schedule or a redelivery would. */
async function publish(topic: string, payload: object, tenantId = ACME): Promise<void> {
  await asOwner((c) =>
    c.query(`insert into outbox_messages (tenant_id, topic, payload) values ($1, $2, $3)`, [
      tenantId,
      topic,
      JSON.stringify(payload),
    ]),
  );
}

const completedJobs = (name: string) =>
  count(`select count(*)::text as n from pgboss.job where name = $1 and state = 'completed'`, [
    name,
  ]);

/** Tonight's nightly runs of every tenant, as the database holds them. */
async function nightlyRuns(runDate: string) {
  return asOwner(
    async (c) =>
      (
        await c.query<{
          id: string;
          tenant_id: string;
          feature: string;
          status: string;
          attempts: number;
          completed_at: Date | null;
        }>(
          `select id, tenant_id, feature, status, attempts, completed_at from ai_scan_runs
            where trigger = 'nightly' and run_date = $1 order by tenant_id, feature`,
          [runDate],
        )
      ).rows,
  );
}

/** Runs the night's sweep and waits until every tenant's runs reached a final state. */
async function runNightlyAndSettle(runDate: string) {
  const before = await completedJobs('ai.scan_nightly');
  await publish('ai.scan_nightly', {});
  await expect
    .poll(() => completedJobs('ai.scan_nightly'), { timeout: 30_000 })
    .toBeGreaterThan(before);
  await expect
    .poll(
      async () =>
        (await nightlyRuns(runDate)).filter((r) => ['completed', 'skipped'].includes(r.status))
          .length,
      { timeout: 90_000, intervals: [500, 1000, 2000] },
    )
    .toBe(3 * FEATURES.length);
  return nightlyRuns(runDate);
}

async function waitForRun(
  request: APIRequestContext,
  runId: string,
  done: (r: AiScanRun) => boolean,
  timeout = 60_000,
): Promise<AiScanRun> {
  let last: AiScanRun | null = null;
  await expect
    .poll(
      async () => {
        last = await expectContract(
          await request.get(`/api/ai/scan-runs/${runId}`, { headers: await as('finance-admin') }),
          200,
          AiScanRun,
        );
        return done(last);
      },
      { timeout, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  return last!;
}

async function setFeature(request: APIRequestContext, feature: string, enabled: boolean) {
  await expectContract(
    await request.post(`/api/ai/features/${feature}/switch`, {
      headers: await mutate('org-admin'),
      data: { enabled },
    }),
    201,
    AiSettingsView,
  );
  if (enabled) {
    // Outlook and anomaly flags are finance features: on only after the Finance Admin confirms.
    const res = await request.post(`/api/ai/features/${feature}/finance-confirmation`, {
      headers: await mutate('finance-admin'),
    });
    expect([201, 409]).toContain(res.status());
  }
  const view = await expectContract(
    await request.get('/api/ai/settings', { headers: await as('finance-admin') }),
    200,
    AiSettingsView,
  );
  expect(view.features.find((f) => f.feature === feature)?.enabled).toBe(enabled);
}

test.describe.configure({ mode: 'serial' });

test.describe('nightly AI scans', () => {
  test('the sweep runs each tenant once per night, and only suggests', async ({ request }) => {
    const tonight = todayUtc();
    const journalsBefore = await count(`select count(*)::text as n from ledger_journals`);
    const approvalsBefore = await count(`select count(*)::text as n from approval_tasks`);

    const runs = await runNightlyAndSettle(tonight);
    // Exactly one run per tenant and feature: Hyland, Globex and the sandbox, each on its own.
    for (const tenantId of [ACME, GLOBEX, SANDBOX])
      for (const feature of FEATURES)
        expect(
          runs.filter((r) => r.tenant_id === tenantId && r.feature === feature),
          `${tenantId} ${feature}`,
        ).toHaveLength(1);

    // Hyland's runs are what the screens report: the outlook measured budgets and called the model.
    const list = await expectContract(
      await request.get('/api/ai/scan-runs', { headers: await as('finance-admin') }),
      200,
      AiScanRunList,
    );
    const outlook = list.latestCompleted.find((r) => r.feature === 'outlook')!;
    expect(outlook.runDate).toBe(tonight);
    expect(outlook.trigger).toBe('nightly');
    expect(outlook.evaluatedCount).toBeGreaterThan(0);
    expect(outlook.modelCalls).toBeGreaterThan(0);
    expect(list.latestCompleted.find((r) => r.feature === 'anomaly_flags')?.runDate).toBe(tonight);

    // The snapshots the outlook screen reads carry tonight's date.
    const outlookList = await request.get('/api/ai/outlook', {
      headers: await as('finance-admin'),
    });
    expect(outlookList.status()).toBe(200);
    expect(((await outlookList.json()) as { asOfDate: string }).asOfDate).toBe(tonight);

    // AI only suggests: the scan posted no journal, opened no approval and wrote no audit entry.
    expect(await count(`select count(*)::text as n from ledger_journals`)).toBe(journalsBefore);
    expect(await count(`select count(*)::text as n from approval_tasks`)).toBe(approvalsBefore);
    expect(
      await count(
        `select count(*)::text as n from audit_events where actor_subject = 'system:ai-scan'`,
      ),
    ).toBe(0);
    // Its model calls are in the query log under the scan's own subject, as "system".
    expect(
      await count(
        `select count(*)::text as n from ai_query_log
          where actor_subject = 'system:ai-scan' and channel = 'system' and tenant_id = $1`,
        [ACME],
      ),
    ).toBeGreaterThan(0);
  });

  test('a replay of the night, a second sweep or a redelivered job changes nothing', async ({
    request,
  }) => {
    const tonight = todayUtc();
    const before = await runNightlyAndSettle(tonight);
    const logBefore = await count(
      `select count(*)::text as n from ai_query_log where actor_subject = 'system:ai-scan'`,
    );
    const snapshotsBefore = await count(
      `select count(*)::text as n from ai_outlook_snapshots where as_of_date = $1`,
      [tonight],
    );
    const acmeOutlook = before.find((r) => r.tenant_id === ACME && r.feature === 'outlook')!;

    // Asking for tonight's run through the API returns the same, finished run.
    const key = randomUUID();
    const asked = await expectContract(
      await request.post('/api/ai/scan-runs', {
        headers: await mutate('finance-admin', key),
        data: { feature: 'outlook' },
      }),
      202,
      AiScanRun,
    );
    expect(asked.id).toBe(acmeOutlook.id);
    expect(asked.status).toBe('completed');
    // The same Idempotency-Key replays the stored response.
    const replay = await request.post('/api/ai/scan-runs', {
      headers: await mutate('finance-admin', key),
      data: { feature: 'outlook' },
    });
    expect(replay.status()).toBe(202);
    expect(replay.headers()['idempotent-replayed']).toBe('true');

    // A second sweep, and the run's own job delivered again.
    await runNightlyAndSettle(tonight);
    const scansBefore = await completedJobs('ai.scan.execute');
    await publish('ai.scan', { runId: acmeOutlook.id });
    await expect
      .poll(() => completedJobs('ai.scan.execute'), { timeout: 30_000 })
      .toBeGreaterThan(scansBefore);

    const after = await nightlyRuns(tonight);
    expect(after.map((r) => [r.id, r.status, r.attempts, r.completed_at?.toISOString()])).toEqual(
      before.map((r) => [r.id, r.status, r.attempts, r.completed_at?.toISOString()]),
    );
    expect(
      await count(
        `select count(*)::text as n from ai_query_log where actor_subject = 'system:ai-scan'`,
      ),
      'no model was called again',
    ).toBe(logBefore);
    expect(
      await count(`select count(*)::text as n from ai_outlook_snapshots where as_of_date = $1`, [
        tonight,
      ]),
    ).toBe(snapshotsBefore);
  });

  test("tenants never see each other's runs or results", async ({ request }) => {
    const tonight = todayUtc();
    const runs = await runNightlyAndSettle(tonight);
    const acmeIds = runs.filter((r) => r.tenant_id === ACME).map((r) => r.id);
    const globexIds = runs.filter((r) => r.tenant_id === GLOBEX).map((r) => r.id);

    const globex = await expectContract(
      await request.get('/api/ai/scan-runs', { headers: await as('globex-admin') }),
      200,
      AiScanRunList,
    );
    const seen = [...globex.items, ...globex.latestCompleted].map((r) => r.id);
    expect(seen.some((id) => globexIds.includes(id))).toBe(true);
    expect(seen.filter((id) => acmeIds.includes(id))).toEqual([]);
    // Hyland's run id is simply not found from Globex.
    await expectProblem(
      await request.get(`/api/ai/scan-runs/${acmeIds[0]}`, { headers: await as('globex-admin') }),
      404,
      'NOT_FOUND',
    );
    // A Hyland user forging Globex's tenant header is refused before anything is read.
    const forged = await request.get('/api/ai/scan-runs', {
      headers: await as('finance-admin', {}, GLOBEX),
    });
    expect(forged.status()).toBe(403);

    // RLS holds in the database as the application role.
    const visible = await asAppRole(GLOBEX, async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `select count(*)::text as n from ai_scan_runs where id = any($1::uuid[])`,
            [acmeIds],
          )
        ).rows[0].n,
      ),
    );
    expect(visible).toBe(0);
    // Every snapshot a scan wrote belongs to the tenant of its budget.
    expect(
      await count(
        `select count(*)::text as n from ai_outlook_snapshots s join budgets b on b.id = s.budget_id
          where s.tenant_id <> b.tenant_id`,
      ),
    ).toBe(0);
  });

  test('a switched-off feature skips its run without calling the model', async ({ request }) => {
    await setFeature(request, 'outlook', false);
    try {
      const logBefore = await count(
        `select count(*)::text as n from ai_query_log where feature = 'outlook' and tenant_id = $1`,
        [ACME],
      );
      const queued = await expectContract(
        await request.post('/api/ai/scan-runs', {
          headers: await mutate('org-admin'),
          data: { feature: 'outlook', budgetIds: [SEED.budgets.bengaluru] },
        }),
        202,
        AiScanRun,
      );
      expect(queued.status).toBe('queued');
      const skipped = await waitForRun(request, queued.id, (r) => r.status !== 'queued');
      expect(skipped).toMatchObject({
        status: 'skipped',
        skipReason: 'feature_off',
        modelCalls: 0,
        evaluatedCount: 0,
      });
      expect(
        await count(
          `select count(*)::text as n from ai_query_log where feature = 'outlook' and tenant_id = $1`,
          [ACME],
        ),
        'no model call while the switch is off',
      ).toBe(logBefore);
      // A skipped run is final: delivering its job again changes nothing.
      await publish('ai.scan', { runId: queued.id });
      const scansBefore = await completedJobs('ai.scan.execute');
      await expect
        .poll(() => completedJobs('ai.scan.execute'), { timeout: 30_000 })
        .toBeGreaterThan(scansBefore);
      expect(
        await expectContract(
          await request.get(`/api/ai/scan-runs/${queued.id}`, { headers: await as('org-admin') }),
          200,
          AiScanRun,
        ),
      ).toMatchObject({ status: 'skipped', attempts: 1 });
    } finally {
      await setFeature(request, 'outlook', true);
    }
    // Switched back on, the same scan calls the model again.
    const again = await expectContract(
      await request.post('/api/ai/scan-runs', {
        headers: await mutate('org-admin'),
        data: { feature: 'outlook', budgetIds: [SEED.budgets.bengaluru] },
      }),
      202,
      AiScanRun,
    );
    const done = await waitForRun(request, again.id, (r) => r.status === 'completed');
    expect(done.modelCalls).toBe(1);
  });

  test('a model outage retries with backoff, then the run fails and the job is dead-lettered', async ({
    request,
  }) => {
    // The scenario's own budget, with spending history, labelled so the recorded provider replays
    // an outage for it. Every model call of the manual run is for this budget, so every one fails.
    const probe = await createRoot(request, {
      amountMinor: 1_000_000,
      name: `__eval:unavailable outage probe ${randomUUID().slice(0, 6)}`,
    });
    await openingBalance(request, probe.id, 'actual', 200_000);
    const shownBefore = await expectContract(
      await request.get('/api/ai/scan-runs?feature=outlook', {
        headers: await as('finance-admin'),
      }),
      200,
      AiScanRunList,
    );

    const queued = await expectContract(
      await request.post('/api/ai/scan-runs', {
        headers: await mutate('finance-admin'),
        data: { feature: 'outlook', budgetIds: [probe.id] },
      }),
      202,
      AiScanRun,
    );
    expect(queued).toMatchObject({ trigger: 'manual', scopeCount: 1, status: 'queued' });

    // While the run waits for a retry, the request's job delivered again and a nightly sweep must
    // not start a second execution: the execution queue holds one live job per run.
    await waitForRun(request, queued.id, (r) => r.status === 'retrying');
    await publish('ai.scan', { runId: queued.id });
    await publish('ai.scan', { runId: queued.id });
    await publish('ai.scan_nightly', {});

    const failed = await waitForRun(request, queued.id, (r) => r.status === 'failed', 90_000);
    // The first attempt and three retries, each calling the model once and failing.
    expect(failed.attempts).toBe(4);
    expect(failed.modelCalls).toBe(1);
    expect(failed.failedModelCalls).toBe(1);
    expect(failed.error).toContain('Every retry failed');
    expect(
      await count(
        `select count(*)::text as n from ai_query_log
          where feature = 'outlook' and outcome = 'failed' and fact_refs @> $1::jsonb`,
        [JSON.stringify([{ id: probe.id }])],
      ),
      'every attempt is in the query log',
    ).toBe(4);

    // Retries backed off: the attempts span at least 2 + 4 + 8 seconds.
    const [span] = await asOwner(
      async (c) =>
        (
          await c.query<{ seconds: number }>(
            `select extract(epoch from max(occurred_at) - min(occurred_at))::float as seconds
               from ai_query_log where fact_refs @> $1::jsonb`,
            [JSON.stringify([{ id: probe.id }])],
          )
        ).rows,
    );
    expect(span.seconds).toBeGreaterThanOrEqual(12);

    // The job itself sits in the worker's dead-letter queue.
    await expect
      .poll(
        () =>
          count(
            `select count(*)::text as n from pgboss.job
              where name = 'integrity.dead-letter' and data->>'runId' = $1`,
            [queued.id],
          ),
        { timeout: 15_000 },
      )
      .toBe(1);

    // What the screens show is still the last completed run.
    const shownAfter = await expectContract(
      await request.get('/api/ai/scan-runs?feature=outlook', {
        headers: await as('finance-admin'),
      }),
      200,
      AiScanRunList,
    );
    expect(shownAfter.latestCompleted.map((r) => r.id)).toEqual(
      shownBefore.latestCompleted.map((r) => r.id),
    );
    expect(shownAfter.items[0]).toMatchObject({ id: queued.id, status: 'failed' });
  });

  test('who may queue and read scans comes from the policy', async ({ request }) => {
    // An employee cannot queue a scan or read the anomaly runs.
    await expectProblem(
      await request.post('/api/ai/scan-runs', {
        headers: await mutate('employee'),
        data: { feature: 'outlook' },
      }),
      403,
      'FORBIDDEN',
    );
    await expectProblem(
      await request.get('/api/ai/scan-runs?feature=anomaly_flags', {
        headers: await as('employee'),
      }),
      403,
      'FORBIDDEN',
    );
    // The auditor reads every run but does not start one.
    const read = await expectContract(
      await request.get('/api/ai/scan-runs', { headers: await as('auditor') }),
      200,
      AiScanRunList,
    );
    expect(read.items.every((r) => ['outlook', 'anomaly_flags'].includes(r.feature))).toBe(true);
    await expectProblem(
      await request.post('/api/ai/scan-runs', {
        headers: await mutate('auditor'),
        data: { feature: 'anomaly_flags' },
      }),
      403,
      'FORBIDDEN',
    );
    // A scan is always for tonight: no other night can be asked for (it would rewrite history).
    await expectProblem(
      await request.post('/api/ai/scan-runs', {
        headers: await mutate('finance-admin'),
        data: { feature: 'outlook', runDate: '2026-01-01' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    // Queuing writes one audit entry naming the person; the scan itself writes none.
    const queued = await expectContract(
      await request.post('/api/ai/scan-runs', {
        headers: await mutate('finance-admin'),
        data: { feature: 'anomaly_flags', budgetIds: [SEED.budgets.bengaluru] },
      }),
      202,
      AiScanRun,
    );
    await waitForRun(request, queued.id, (r) => ['completed', 'skipped'].includes(r.status));
    expect(
      await count(
        `select count(*)::text as n from audit_events where resource_id = $1 and action = 'ai.scan.requested'
           and actor_subject = $2`,
        [queued.id, userById('finance-admin').subject],
      ),
    ).toBe(1);
  });
});
