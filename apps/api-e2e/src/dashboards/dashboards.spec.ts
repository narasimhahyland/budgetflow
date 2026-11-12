// Gap package B2, first part: the finance controller dashboard (012), the alerts dashboard (017) and
// the exceptions dashboard (017a). Every figure is checked against an independent source: the
// period-close endpoint, the ledger postings the scenario makes, or the rows under RLS. Role scope:
// owners see only their subtree on alerts and are refused the tenant-wide finance pages; employees
// see none of them. The operator sweep (scope/operator-isolation.spec.ts) covers the platform operator.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  AlertsOverview,
  BudgetAlert,
  ClosePeriodDetail,
  ExceptionsOverview,
  FinanceOverview,
  Journal,
  IntegrityCheckRun,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole } from '../support/db';
import { createRoot } from '../support/factory';

const TENANT = SEED.tenants.acme;
const US = SEED.legalEntities.acmeUs;

async function postActual(request: APIRequestContext, budgetId: string, amountMinor: number) {
  return expectContract(
    await request.post('/api/ledger/journals', {
      headers: await mutate('finance-admin'),
      data: {
        transactionCurrency: 'USD',
        reasonCode: 'ADJ-OPENING',
        reason: 'Spend for the alerts dashboard scenario',
        lines: [
          { budgetId, account: 'actual', side: 'debit', amountMinor },
          {
            budgetId: null,
            account: 'obligations',
            side: 'credit',
            amountMinor,
            legalEntityId: US,
          },
        ],
      },
    }),
    201,
    Journal,
  );
}

const rows = <T>(sql: string, params: unknown[] = []) =>
  asAppRole(TENANT, async (c) => (await c.query(sql, params)).rows as T[]);

async function alerts(request: APIRequestContext, user: Parameters<typeof as>[0], query = '') {
  return expectContract(
    await request.get(`/api/dashboards/alerts${query}`, { headers: await as(user) }),
    200,
    AlertsOverview,
  );
}

test.describe('012 finance controller dashboard', () => {
  test('close status equals the period-close checklist for every entity', async ({ request }) => {
    const o = await expectContract(
      await request.get('/api/dashboards/finance', { headers: await as('finance-controller') }),
      200,
      FinanceOverview,
    );
    expect(o.close.length).toBeGreaterThan(0);
    const entityCodes = o.close.flatMap((c) => c.entities.map((e) => e.legalEntityCode));
    // Every Hyland entity with a calendar appears once: the close card has one row per entity.
    expect(new Set(entityCodes).size).toBe(entityCodes.length);
    expect(entityCodes).toEqual(expect.arrayContaining(['HYL-US', 'HYL-IN', 'HYL-DE', 'HYL-UK']));
    for (const c of o.close) {
      // The period being closed has ended and is not closed yet (the seed's October).
      expect(c.period.endDate < o.asOf).toBe(true);
      expect(['open', 'soft_closed']).toContain(c.period.status);
      const detail = await expectContract(
        await request.get(`/api/close/periods/${c.period.id}`, {
          headers: await as('finance-controller'),
        }),
        200,
        ClosePeriodDetail,
      );
      expect(c.entities).toEqual(detail.entities);
    }
    // The seed has no signed tie-out for October, so nothing is all clear.
    expect(o.allClear).toBe(false);
  });

  test('queue tiles equal the queues they open', async ({ request }) => {
    const o = await expectContract(
      await request.get('/api/dashboards/finance', { headers: await as('finance-controller') }),
      200,
      FinanceOverview,
    );
    const tile = (key: string) => o.tiles.find((t) => t.key === key)!;
    const [unmatched] = await rows<{ n: string }>(
      `select count(*) as n from actuals where match_status in ('unmatched','partially_matched')
         and (import_batch_id is null or import_batch_id in (select id from import_batches where status = 'posted'))`,
    );
    expect(tile('unmatched_actuals').count).toBe(Number(unmatched.n));
    const [exceptions] = await rows<{ n: string; amount: string }>(
      `select count(*) as n, coalesce(sum(reporting_amount_minor),0) as amount
         from post_spend_exceptions where status in ('open','explained')`,
    );
    expect(tile('post_spend_exceptions').count).toBe(Number(exceptions.n));
    expect(tile('post_spend_exceptions').amount?.amountMinor).toBe(Number(exceptions.amount));
    const [accruals] = await rows<{ n: string; amount: string }>(
      `select count(*) as n, coalesce(sum(amount_minor),0) as amount from accruals where status = 'proposed'`,
    );
    expect(tile('accrual_proposals').count).toBe(Number(accruals.n));
    expect(tile('accrual_proposals').amount?.amountMinor).toBe(Number(accruals.amount));
    const [stale] = await rows<{ n: string; amount: string }>(
      `select count(*) as n, coalesce(sum(greatest(amount_minor - consumed_minor - released_minor, 0)),0) as amount
         from commitments where status in ('pre_encumbered','encumbered','partially_consumed')
         and service_end < $1::date`,
      [o.asOf],
    );
    expect(tile('stale_commitments').count).toBe(Number(stale.n));
    expect(tile('stale_commitments').amount?.amountMinor).toBe(Number(stale.amount));
    for (const t of o.tiles) expect(t.link).toMatch(/^\//);
  });

  test('the FX effect is the actuals of the year by currency and is never part of spend', async ({
    request,
  }) => {
    const o = await expectContract(
      await request.get('/api/dashboards/finance', { headers: await as('finance-controller') }),
      200,
      FinanceOverview,
    );
    const fx = await rows<{ currency: string; fx: string }>(
      `select a.transaction_currency as currency, sum(a.fx_effect_minor) as fx from actuals a
         join fiscal_years fy on fy.id = $1::uuid
        where a.accounting_date between fy.start_date and fy.end_date and a.fx_effect_minor <> 0
        group by 1 order by 1`,
      [SEED.fiscalYears.acmeFy2026],
    );
    expect(o.fx.byCurrency.map((c) => [c.currency, c.effect.amountMinor])).toEqual(
      fx.map((r) => [r.currency, Number(r.fx)]),
    );
    expect(o.fx.total.amountMinor).toBe(fx.reduce((s, r) => s + Number(r.fx), 0));
    expect(o.fx.total.currency).toBe('USD');
  });

  test('Run check now records a ledger check that the integrity card then reports', async ({
    request,
  }) => {
    const run = await expectContract(
      await request.post('/api/integrity/ledger-checks', {
        headers: await mutate('finance-controller'),
      }),
      202,
      IntegrityCheckRun,
    );
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get(`/api/integrity/ledger-checks/${run.id}`, {
                headers: await as('finance-controller'),
              })
            ).json()
          ).status,
        { timeout: 30_000 },
      )
      .toMatch(/clean|drift_detected/);
    const o = await expectContract(
      await request.get('/api/dashboards/finance', { headers: await as('finance-controller') }),
      200,
      FinanceOverview,
    );
    expect(o.integrity?.lastRun?.id).toBe(run.id);
    expect(o.integrity?.lastRun?.status).toBe('clean');
    expect(o.integrity?.lastRun?.budgetsChecked).toBeGreaterThan(0);
    expect(o.integrity?.auditChain?.valid).toBe(true);
    expect(o.integrity?.openLedgerFlags).toBe(0);
  });

  test('scope: auditor reads with integrity, CEO without, owners and employees are refused', async ({
    request,
  }) => {
    const auditor = await expectContract(
      await request.get('/api/dashboards/finance', { headers: await as('auditor') }),
      200,
      FinanceOverview,
    );
    expect(auditor.integrity).not.toBeNull();
    const ceo = await expectContract(
      await request.get('/api/dashboards/finance', { headers: await as('ceo') }),
      200,
      FinanceOverview,
    );
    expect(ceo.integrity).toBeNull();
    for (const user of ['location-manager', 'regional-manager', 'employee'] as const)
      await expectProblem(
        await request.get('/api/dashboards/finance', { headers: await as(user) }),
        403,
        'FORBIDDEN',
      );
  });
});

test.describe('017 alerts dashboard', () => {
  test('owner thresholds raise alerts from the ledger; a worsening condition is raised again', async ({
    request,
  }) => {
    const root = await createRoot(request, {
      amountMinor: 1_000_000,
      name: `Alerts ${randomUUID().slice(0, 6)}`,
    });
    await postActual(request, root.id, 850_000);
    let o = await alerts(request, 'finance-controller');
    const warn = o.items.find((a) => a.budgetId === root.id && a.kind === 'threshold');
    expect(warn).toMatchObject({
      key: `threshold:${root.id}:8000`,
      severity: 'warning',
      tone: 'warning',
      snoozable: true,
      text: `${root.name} passed 80%: USD 8,500.00 of USD 10,000.00 committed or spent.`,
    });

    // Acknowledge: it leaves the open tab for the acknowledged one; the budget is unchanged.
    const acked = await expectContract(
      await request.post('/api/dashboards/alerts/decisions', {
        headers: await mutate('finance-controller'),
        data: { key: warn!.key, decision: 'acknowledge' },
      }),
      200,
      BudgetAlert,
    );
    expect(acked.acknowledgedAt).not.toBeNull();
    o = await alerts(request, 'finance-controller');
    expect(o.items.some((a) => a.key === warn!.key)).toBe(false);
    const ackTab = await alerts(request, 'finance-controller', '?tab=acknowledged');
    expect(ackTab.items.find((a) => a.key === warn!.key)?.acknowledgedAt).toBe(
      acked.acknowledgedAt,
    );
    // Acknowledging is per person: another finance reader still sees it open.
    const other = await alerts(request, 'finance-admin');
    expect(other.items.some((a) => a.key === warn!.key)).toBe(true);

    // Spend reaches 100% in hard mode: a new hard-block alert, which cannot be snoozed.
    await postActual(request, root.id, 150_000);
    o = await alerts(request, 'finance-controller');
    const block = o.items.find((a) => a.budgetId === root.id && a.kind === 'hard_block');
    expect(block).toMatchObject({
      key: `hard_block:${root.id}:10000`,
      severity: 'hard_block',
      tone: 'error',
      snoozable: false,
    });
    expect(o.items[0].severity).toBe('hard_block');
    await expectProblem(
      await request.post('/api/dashboards/alerts/decisions', {
        headers: await mutate('finance-controller'),
        data: { key: block!.key, decision: 'snooze' },
      }),
      422,
      'VALIDATION_FAILED',
    );
    // The acknowledged 80% alert's condition was replaced by the block: it shows as resolved.
    const resolved = await alerts(request, 'finance-controller', '?tab=resolved');
    expect(resolved.items.find((a) => a.key === warn!.key)?.resolvedAt).toBe(acked.acknowledgedAt);
  });

  test('snooze is idempotent on its key and lasts seven days', async ({ request }) => {
    const root = await createRoot(request, {
      amountMinor: 1_000_000,
      name: `Snooze ${randomUUID().slice(0, 6)}`,
    });
    await postActual(request, root.id, 600_000);
    const key = `threshold:${root.id}:5000`;
    const headers = await mutate('finance-controller');
    const first = await request.post('/api/dashboards/alerts/decisions', {
      headers,
      data: { key, decision: 'snooze' },
    });
    const a = await expectContract(first, 200, BudgetAlert);
    const replay = await request.post('/api/dashboards/alerts/decisions', {
      headers,
      data: { key, decision: 'snooze' },
    });
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect((await expectContract(replay, 200, BudgetAlert)).snoozedUntil).toBe(a.snoozedUntil);
    const ms =
      Date.parse(a.snoozedUntil!) -
      Date.parse((await alerts(request, 'finance-controller')).generatedAt);
    expect(ms).toBe(7 * 24 * 60 * 60 * 1000);
    const [events] = await rows<{ n: string }>(
      `select count(*) as n from product_analytics_events where name = 'alert.snoozed' and properties->>'alertKey' = $1`,
      [key],
    );
    expect(Number(events.n)).toBe(1);
    // An unknown key is not found rather than recorded.
    await expectProblem(
      await request.post('/api/dashboards/alerts/decisions', {
        headers: await mutate('finance-controller'),
        data: { key: `threshold:${randomUUID()}:5000`, decision: 'acknowledge' },
      }),
      404,
      'NOT_FOUND',
    );
  });

  test('controls are information alerts: frozen in the info tone, set to zero important', async ({
    request,
  }) => {
    const o = await alerts(request, 'finance-controller');
    const frozen = o.items.find((a) => a.kind === 'frozen');
    const zero = o.items.find((a) => a.kind === 'set_to_zero');
    expect(frozen).toMatchObject({ severity: 'information', tone: 'info', budgetStatus: 'frozen' });
    expect(zero).toMatchObject({
      severity: 'information',
      tone: 'important',
      budgetStatus: 'set_to_zero',
    });
  });

  test('scope: an owner sees only their subtree; an employee is refused', async ({ request }) => {
    const owner = await alerts(request, 'regional-manager');
    expect(owner.scope.tenantWide).toBe(false);
    const paths = await rows<{ id: string }>(
      `select d.id from budgets b join budgets d on d.tenant_id = b.tenant_id and left(d.path, length(b.path)) = b.path
        where b.owner_person_id = $1::uuid`,
      [userById('regional-manager').personId],
    );
    const visible = new Set(paths.map((p) => p.id));
    expect(owner.items.length).toBeGreaterThan(0);
    for (const a of owner.items) expect(visible.has(a.budgetId)).toBe(true);
    const all = await alerts(request, 'finance-controller');
    expect(all.items.length).toBeGreaterThan(owner.items.length);
    await expectProblem(
      await request.get('/api/dashboards/alerts', { headers: await as('employee') }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('017a exceptions dashboard', () => {
  test('types, ages and money at stake equal the exception rows', async ({ request }) => {
    const o = await expectContract(
      await request.get('/api/dashboards/exceptions', { headers: await as('finance-controller') }),
      200,
      ExceptionsOverview,
    );
    const post = await rows<{ n: string; amount: string }>(
      `select count(*) as n, coalesce(sum(reporting_amount_minor),0) as amount
         from post_spend_exceptions where status in ('open','explained')`,
    );
    const row = o.types.find((t) => t.type === 'post_spend_breach')!;
    expect(row.open).toBe(Number(post[0].n));
    expect(row.atStake?.amountMinor).toBe(Number(post[0].amount));
    const bands = row.bands.d0to7 + row.bands.d8to30 + row.bands.d31to60 + row.bands.over60;
    expect(bands).toBe(row.open);
    const [dupes] = await rows<{ n: string }>(
      `select count(*) as n from integrity_flags where status in ('open','acknowledged')
         and kind in ('duplicate','cross_source_duplicate','receipt_reuse')`,
    );
    expect(o.types.find((t) => t.type === 'duplicate')!.open).toBe(Number(dupes.n));
    expect(o.kpis.open).toBe(
      o.types.filter((t) => !t.informational).reduce((s, t) => s + t.open, 0),
    );
    expect(o.kpis.atStake.amountMinor).toBe(
      o.types.reduce((s, t) => s + (t.informational ? 0 : (t.atStake?.amountMinor ?? 0)), 0),
    );
    expect(o.byLocation.reduce((s, l) => s + l.open, 0)).toBe(o.kpis.open);
    expect(o.trend).toHaveLength(8);
    expect(o.integrityFlagOpen).toBe(false);
    expect(o.items).toEqual([]);

    const drill = await expectContract(
      await request.get('/api/dashboards/exceptions?type=post_spend_breach', {
        headers: await as('finance-controller'),
      }),
      200,
      ExceptionsOverview,
    );
    expect(drill.items).toHaveLength(row.open);
    expect(drill.items[0].ageDays).toBe(row.oldestDays);
    expect(drill.items.every((i) => i.type === 'post_spend_breach')).toBe(true);
  });

  test('scope: CEO reads without the integrity-flag types; owners are refused', async ({
    request,
  }) => {
    const ceo = await expectContract(
      await request.get('/api/dashboards/exceptions', { headers: await as('ceo') }),
      200,
      ExceptionsOverview,
    );
    expect(ceo.withheld).toEqual([
      'split_request',
      'duplicate',
      'just_under_threshold',
      'ledger_integrity',
    ]);
    expect(ceo.types.map((t) => t.type)).not.toContain('duplicate');
    const auditor = await expectContract(
      await request.get('/api/dashboards/exceptions', { headers: await as('auditor') }),
      200,
      ExceptionsOverview,
    );
    expect(auditor.withheld).toEqual([]);
    for (const user of ['location-manager', 'employee'] as const)
      await expectProblem(
        await request.get('/api/dashboards/exceptions', { headers: await as(user) }),
        403,
        'FORBIDDEN',
      );
  });
});
