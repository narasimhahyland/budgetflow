// Gap package B2, second part: pending approvals (018), approval performance (018a), product
// analytics (018b) and the one-click evidence pack (088a). Scenarios build their own budgets and
// requests through the API, so they repeat without a reset; every figure is checked against the
// approval, ledger, analytics or audit rows it comes from.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  ApprovalPerformance,
  EvidencePack,
  EvidencePackDownload,
  EvidencePackList,
  NudgeResponse,
  PendingApprovalsOverview,
  ProductAnalytics,
  RequestDetail,
} from '@bf/contracts';
import { SEED, userById, type SeedUserId } from '@bf/seed';
import { request as pwRequest } from '@playwright/test';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole } from '../support/db';
import {
  auditFor,
  decideOk,
  directorTree,
  spendingRequest,
  taskOf,
  usd,
  waitForMail,
} from '../support/p5';

const TENANT = SEED.tenants.acme;
/** Seeded event with commitments and actuals (Bengaluru Annual Day 2026). */
const ANNUAL_DAY = '77000000-0000-4000-8000-000000000001';

const rows = <T>(sql: string, params: unknown[] = []) =>
  asAppRole(TENANT, async (c) => (await c.query(sql, params)).rows as T[]);

const pending = async (request: APIRequestContext, user: SeedUserId, query = '') =>
  expectContract(
    await request.get(`/api/dashboards/pending-approvals${query}`, { headers: await as(user) }),
    200,
    PendingApprovalsOverview,
  );

async function newPendingRequest(request: APIRequestContext, minor = 45_000) {
  const { team } = await directorTree(request);
  const r = await expectContract(
    await spendingRequest(request, 'budget-owner', team.id, usd(minor)),
    201,
    RequestDetail,
  );
  return { team, r };
}

test.describe('018 pending approvals dashboard', () => {
  test('a pending request appears with its step, approver and the amount held on its budget', async ({
    request,
  }) => {
    const { r } = await newPendingRequest(request);
    const o = await pending(request, 'finance-controller');
    const item = o.items.find((i) => i.subjectId === r.id);
    expect(item).toMatchObject({
      subjectType: 'request',
      reference: r.ref,
      kind: 'spending',
      held: true,
      amount: usd(45_000),
      step: 'Parent owner',
      approverName: userById('department-head').displayName,
      sla: 'within',
      canNudge: true,
    });
    // KPIs add up from the items and from the ledger's pre-encumbered lines of pending requests.
    expect(o.kpis.pending).toBe(o.items.length);
    const [held] = await rows<{ amount: string }>(
      `select coalesce(sum(l.reporting_amount_minor),0) as amount from ledger_lines l
         where l.account = 'pre_encumbered' and l.request_id in (
           select i.subject_id from approval_tasks t join approval_instances i on i.id = t.instance_id
            where t.status = 'pending' and i.subject_type = 'request')`,
    );
    expect(o.kpis.preEncumbered.amountMinor).toBe(Number(held.amount));
    const [tasks] = await rows<{ n: string }>(
      `select count(*) as n from approval_tasks where status = 'pending'`,
    );
    expect(o.kpis.pending).toBe(Number(tasks.n));
    expect(o.bySteps.reduce((s, b) => s + b.within + b.dueToday + b.breached, 0)).toBe(
      o.kpis.pending,
    );
    // Co-funding requests are requested amounts, never held.
    for (const i of o.items.filter((x) => x.kind === 'co_funding')) expect(i.held).toBe(false);
  });

  test('nudge reminds the approver once per four hours, records it, and decides nothing', async ({
    request,
  }) => {
    const { r } = await newPendingRequest(request, 52_000);
    const item = (await pending(request, 'finance-controller')).items.find(
      (i) => i.subjectId === r.id,
    )!;
    const key = crypto.randomUUID();
    const sent = await expectContract(
      await request.post(`/api/dashboards/pending-approvals/${item.taskId}/nudge`, {
        headers: await mutate('finance-controller', key),
      }),
      200,
      NudgeResponse,
    );
    expect(sent.channels).toEqual(['in_app', 'email']);
    expect(Date.parse(sent.nextNudgeAt) - Date.parse(sent.nudgedAt)).toBe(4 * 60 * 60 * 1000);
    const replay = await request.post(`/api/dashboards/pending-approvals/${item.taskId}/nudge`, {
      headers: await mutate('finance-controller', key),
    });
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    await expectProblem(
      await request.post(`/api/dashboards/pending-approvals/${item.taskId}/nudge`, {
        headers: await mutate('finance-controller'),
      }),
      409,
      'CONFLICT',
    );
    const after = (await pending(request, 'finance-controller')).items.find(
      (i) => i.subjectId === r.id,
    )!;
    expect(after.canNudge).toBe(false);
    expect(after.lastNudgedAt).toBe(sent.nudgedAt);
    // The request history shows the reminder; the request is still waiting.
    const history = await auditFor(request, r.id);
    expect(history.filter((h) => h.action === 'approval.nudged')).toHaveLength(1);
    const [req] = await rows<{ status: string }>(`select status from requests where id = $1`, [
      r.id,
    ]);
    expect(req.status).toBe('pending_approval');
    const [note] = await rows<{ n: string }>(
      `select count(*) as n from notifications where type = 'approval.nudge' and item_id = $1 and recipient_person_id = $2`,
      [r.id, userById('department-head').personId],
    );
    expect(Number(note.n)).toBe(1);
    const mail = await waitForMail('department.head@example.test', `Reminder: ${r.ref}`);
    expect(mail.text).toContain('for your decision');
    expect(mail.text).toContain(`/requests/${r.id}`);
  });

  test('scope: owners see their subtree only; employees are refused; the approver filter narrows', async ({
    request,
  }) => {
    const { r } = await newPendingRequest(request);
    const owner = await pending(request, 'regional-manager');
    expect(owner.scope.tenantWide).toBe(false);
    expect(owner.items.some((i) => i.subjectId === r.id)).toBe(false);
    const dept = await pending(request, 'department-head');
    expect(dept.items.some((i) => i.subjectId === r.id)).toBe(true);
    const filtered = await pending(
      request,
      'finance-controller',
      `?approverPersonId=${userById('department-head').personId}`,
    );
    expect(
      filtered.items.every((i) => i.approverPersonId === userById('department-head').personId),
    ).toBe(true);
    await expectProblem(
      await request.get('/api/dashboards/pending-approvals', { headers: await as('employee') }),
      403,
      'FORBIDDEN',
    );
    // A regional manager cannot nudge a task outside their subtree: it is not found for them.
    const item = dept.items.find((i) => i.subjectId === r.id)!;
    await expectProblem(
      await request.post(`/api/dashboards/pending-approvals/${item.taskId}/nudge`, {
        headers: await mutate('regional-manager'),
      }),
      404,
      'NOT_FOUND',
    );
  });
});

test.describe('018a approval performance', () => {
  test('cycle time and channel mix come from the decisions; names only for finance', async ({
    request,
  }) => {
    const { r } = await newPendingRequest(request, 30_000);
    await decideOk(
      request,
      'department-head',
      await taskOf(request, 'department-head', 'request', r.id),
      {
        decision: 'approve',
      },
    );
    const named = await expectContract(
      await request.get('/api/dashboards/approval-performance?days=90', {
        headers: await as('finance-controller'),
      }),
      200,
      ApprovalPerformance,
    );
    const [counts] = await rows<{ n: string; web: string; changes: string }>(
      `select count(*) as n, count(*) filter (where channel = 'web') as web,
              count(*) filter (where action = 'request_changes') as changes
         from approval_actions where created_at >= now() - interval '120 days'`,
    );
    expect(named.view).toBe('named');
    expect(named.kpis.decisions).toBeGreaterThan(0);
    expect(named.kpis.decisions).toBeLessThanOrEqual(Number(counts.n));
    expect(named.byChannel.reduce((s, c) => s + c.decisions, 0)).toBe(named.kpis.decisions);
    expect(named.byStep.reduce((s, c) => s + c.decisions, 0)).toBe(named.kpis.decisions);
    expect(named.smallSample).toBe(named.kpis.decisions < 30);
    // Approvers with fewer than ten decisions are grouped, never ranked by name.
    for (const a of named.approvers.filter((x) => x.approverPersonId))
      expect(a.decisions).toBeGreaterThanOrEqual(10);

    const analyst = await expectContract(
      await request.get('/api/dashboards/approval-performance', { headers: await as('analyst') }),
      200,
      ApprovalPerformance,
    );
    expect(analyst.view).toBe('aggregate');
    expect(analyst.approvers).toEqual([]);
    expect(analyst.kpis.decisions).toBe(named.kpis.decisions);

    const own = await expectContract(
      await request.get('/api/dashboards/approval-performance', {
        headers: await as('department-head'),
      }),
      200,
      ApprovalPerformance,
    );
    expect(own.view).toBe('own');
    expect(own.own?.decisions).toBeGreaterThan(0);
    expect(own.own?.companyMedianHours).toBe(named.kpis.medianHours);
    expect(own.approvers).toEqual([]);
    expect(own.byChannel).toEqual([]);
    await expectProblem(
      await request.get('/api/dashboards/approval-performance', { headers: await as('employee') }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('018b product analytics', () => {
  test('KPIs are counts from the analytics events, against the plan targets', async ({
    request,
  }) => {
    const o = await expectContract(
      await request.get('/api/analytics/kpis?period=90', { headers: await as('org-admin') }),
      200,
      ProductAnalytics,
    );
    const [owners] = await rows<{ n: string }>(
      `select count(distinct owner_person_id) as n from budgets where owner_person_id is not null and status::text not in ('closed','cancelled')`,
    );
    expect(o.owners).toBe(Number(owners.n));
    // Fewer than 20 owners: the dashboard says so instead of judging against the targets.
    expect(o.insufficient).toBe(o.owners < 20);
    const kpi = (k: string) => o.kpis.find((x) => x.key === k)!;
    expect(kpi('owner_activation').target?.value).toBe(70);
    expect(kpi('time_to_approve').target).toMatchObject({ value: 24, comparison: 'at_most' });
    expect(kpi('auto_match_rate').target?.value).toBe(80);
    const [matched] = await rows<{ n: string; auto: string }>(
      `select count(*) as n, count(*) filter (where coalesce(match_rule,'manual') <> 'manual') as auto
         from actuals where match_status = 'matched' and matched_at >= $1::date`,
      [o.from],
    );
    expect(o.autoMatchBySource.reduce((s, r) => s + r.matched, 0)).toBe(Number(matched.n));
    expect(o.autoMatchBySource.reduce((s, r) => s + r.automatic, 0)).toBe(Number(matched.auto));
    // Counts and flags only: no names or emails anywhere in the response.
    expect(JSON.stringify(o)).not.toMatch(/@example\.test/);
    for (const p of o.weeklyActive)
      expect(Object.keys(p).sort()).toEqual(['employees', 'owners', 'weekStart']);

    for (const user of ['finance-admin', 'ceo'] as const)
      await expectContract(
        await request.get('/api/analytics/kpis', { headers: await as(user) }),
        200,
        ProductAnalytics,
      );
    for (const user of ['regional-manager', 'employee'] as const)
      await expectProblem(
        await request.get('/api/analytics/kpis', { headers: await as(user) }),
        403,
        'FORBIDDEN',
      );
  });
});

async function generatePack(
  request: APIRequestContext,
  user: SeedUserId,
  body: Record<string, unknown>,
): Promise<EvidencePack> {
  const created = await expectContract(
    await request.post('/api/evidence-packs', { headers: await mutate(user), data: body }),
    202,
    EvidencePack,
  );
  let pack = created;
  await expect
    .poll(
      async () => {
        pack = await expectContract(
          await request.get(`/api/evidence-packs/${created.id}`, { headers: await as(user) }),
          200,
          EvidencePack,
        );
        return pack.status;
      },
      { timeout: 45_000 },
    )
    .toMatch(/ready|failed/);
  return pack;
}

test.describe('088a one-click evidence pack', () => {
  test('an auditor generates a pack for an event: manifest, verified chain, audited download', async ({
    request,
  }) => {
    const pack = await generatePack(request, 'auditor', {
      subjectType: 'event',
      subjectId: ANNUAL_DAY,
      contents: [
        'summary',
        'approvals',
        'audit_trail',
        'contributions',
        'commitments',
        'actuals',
        'reconciliation',
        'exceptions',
      ],
      includeAttendees: false,
    });
    expect(pack.status, pack.error ?? '').toBe('ready');
    expect(pack.subjectLabel).toContain('BLR-ANNUAL-26');
    expect(pack.chain).toMatchObject({ valid: true, brokenAt: null });
    const names = pack.manifest.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'summary.pdf',
        'approvals.csv',
        'audit-trail.csv',
        'commitments.csv',
        'actuals.csv',
        'exceptions.csv',
      ]),
    );
    expect(names).not.toContain('attendees.csv');
    const [commitments] = await rows<{ n: string }>(
      `select count(*) as n from commitments where event_id = $1`,
      [ANNUAL_DAY],
    );
    expect(pack.counts['commitments']).toBe(Number(commitments.n));

    // Download: a short-lived link whose ZIP holds exactly the manifest's files and fingerprints.
    const link = await expectContract(
      await request.get(`/api/evidence-packs/${pack.id}/download`, {
        headers: await as('auditor'),
      }),
      200,
      EvidencePackDownload,
    );
    expect(link.url).toContain(`/tenants/${TENANT}/evidence-packs/${pack.id}.zip`);
    const ctx = await pwRequest.newContext();
    const zip = Buffer.from(await (await ctx.get(link.url)).body());
    await ctx.dispose();
    expect(zip.length).toBe(pack.sizeBytes);
    for (const f of pack.manifest) expect(zip.includes(Buffer.from(f.name))).toBe(true);
    expect(zip.includes(Buffer.from('manifest.json'))).toBe(true);
    expect(zip.includes(Buffer.from('Needs'))).toBe(false);

    const audit = await auditFor(request, pack.id);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'evidence_pack.requested',
        'evidence_pack.generated',
        'evidence_pack.downloaded',
      ]),
    );
    const downloaded = audit.find((a) => a.action === 'evidence_pack.downloaded')!;
    expect(downloaded.changes['manifestSha256']?.to).toBe(pack.manifestSha256);
  });

  test('attendee details only when asked; a budget pack lists its ledger buckets', async ({
    request,
  }) => {
    const withAttendees = await generatePack(request, 'finance-controller', {
      subjectType: 'event',
      subjectId: ANNUAL_DAY,
      contents: ['summary'],
      includeAttendees: true,
    });
    expect(withAttendees.status).toBe('ready');
    expect(withAttendees.manifest.map((f) => f.name)).toEqual(['summary.pdf', 'attendees.csv']);
    const budgetPack = await generatePack(request, 'finance-admin', {
      subjectType: 'budget',
      subjectId: SEED.budgets.bengaluru,
      contents: ['summary', 'commitments'],
      includeAttendees: false,
    });
    expect(budgetPack.status).toBe('ready');
    expect(budgetPack.subjectLabel).toContain('Bengaluru');
  });

  test('scope: only auditors and finance generate; the CEO downloads; owners are refused', async ({
    request,
  }) => {
    for (const user of ['ceo', 'regional-manager', 'employee'] as const)
      await expectProblem(
        await request.post('/api/evidence-packs', {
          headers: await mutate(user),
          data: {
            subjectType: 'event',
            subjectId: ANNUAL_DAY,
            contents: ['summary'],
            includeAttendees: false,
          },
        }),
        403,
        'FORBIDDEN',
      );
    const mine = await generatePack(request, 'auditor', {
      subjectType: 'event',
      subjectId: ANNUAL_DAY,
      contents: ['summary'],
      includeAttendees: false,
    });
    const ceo = await expectContract(
      await request.get('/api/evidence-packs', { headers: await as('ceo') }),
      200,
      EvidencePackList,
    );
    expect(ceo.canGenerate).toBe(false);
    const seen = ceo.items.find((p) => p.id === mine.id);
    expect(seen?.status).toBe('ready');
    expect(seen?.canDownload).toBe(true);
    await expectProblem(
      await request.get('/api/evidence-packs', { headers: await as('regional-manager') }),
      403,
      'FORBIDDEN',
    );
    // An unknown subject is not found rather than packed.
    await expectProblem(
      await request.post('/api/evidence-packs', {
        headers: await mutate('auditor'),
        data: {
          subjectType: 'event',
          subjectId: crypto.randomUUID(),
          contents: ['summary'],
          includeAttendees: false,
        },
      }),
      404,
      'NOT_FOUND',
    );
  });
});
