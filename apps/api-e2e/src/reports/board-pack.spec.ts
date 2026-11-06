// Screen 16a: the board and FP&A pack. The invariants are that a closed-period pack reads the
// immutable close snapshot and reconciles to the ledger, that the FX bridge explains a currency
// movement without ever entering spend or variance, that an open-period pack is marked Draft on
// every page, that a page with no data keeps its place with a statement, and that generation runs
// in the worker and lands in the DocumentStore behind a short-lived signed URL.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  BoardPack,
  BoardPackDownload,
  BoardPackGeneration,
  BoardPackGenerationList,
  ClosePeriodList,
} from '@bf/contracts';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';

const pack = async (
  request: APIRequestContext,
  query: Record<string, string> = {},
  user: 'finance-admin' | 'finance-controller' | 'ceo' | 'auditor' = 'finance-admin',
) => {
  const qs = new URLSearchParams(query).toString();
  return expectContract(
    await request.get(`/api/reports/board-pack${qs ? `?${qs}` : ''}`, {
      headers: await as(user),
    }),
    200,
    BoardPack,
  );
};

test.describe('board and FP&A pack', () => {
  test('a closed-period pack reads the close snapshot and reconciles to the ledger', async ({
    request,
  }) => {
    const built = await pack(request);

    expect(built.source.kind).toBe('close_snapshot');
    expect(built.source.draft).toBe(false);
    expect(built.source.snapshotVersion).toBeGreaterThanOrEqual(1);
    expect(built.source.takenAt).not.toBeNull();
    expect(built.source.statement).toContain('close snapshot');
    expect(built.title).toContain(built.source.periodLabel);
    expect(built.currency).toBe('USD');

    // The pack says it was built from the ledger, and the snapshot it rendered agrees with it.
    expect(built.reconciliation.source).toBe('ledger_balances');
    expect(built.reconciliation.differences).toEqual([]);
    expect(built.reconciliation.ties).toBe(true);
    const r = built.reconciliation;
    expect(r.available.amountMinor).toBe(
      r.authorized.amountMinor -
        r.held.amountMinor -
        r.preEncumbered.amountMinor -
        r.encumbered.amountMinor -
        r.actual.amountMinor,
    );
    expect(r.budgetsCounted).toBeGreaterThan(0);

    // Every page of the inventory is there, in the order the pack defines.
    expect(built.pages.map((p) => p.page)).toEqual([
      'summary',
      'legal_entity',
      'region',
      'function',
      'category',
      'period',
      'variance_fx',
      'top_commitments',
      'controls_applied',
      'exceptions',
      'cofunding',
    ]);

    // The legal entity page is the snapshot: each row names the version it came from.
    const entities = built.pages.find((p) => p.page === 'legal_entity')!;
    expect(entities.rows.length).toBeGreaterThan(0);
    for (const row of entities.rows) expect(row.cells['snapshot'].text).toMatch(/^v\d+$/);

    // The summary's Available carries its definition, so nobody has to guess what it counts.
    const summary = built.pages.find((p) => p.page === 'summary')!;
    const available = summary.columns.find((c) => c.key === 'available')!;
    expect(available.hint).toContain('Authorized');
    expect(available.hint).toContain('counted once');
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].cells['available'].money?.amountMinor).toBe(r.available.amountMinor);
    expect(summary.rows[0].cells['actual'].money?.amountMinor).toBe(r.actual.amountMinor);
  });

  test('the FX bridge explains the gap and is never part of spend or variance', async ({
    request,
  }) => {
    const built = await pack(request);
    const fx = built.fxBridge;

    expect(fx.reportingRateType).toBe('monthly_average');
    expect(fx.note).toContain('FX never consumes budget');
    expect(fx.rows.length).toBeGreaterThan(0);
    // Rows in a total order, so a regenerated pack lists the currencies identically.
    expect(fx.rows.map((x) => x.transactionCurrency)).toEqual(
      [...fx.rows.map((x) => x.transactionCurrency)].sort((a, b) => a.localeCompare(b)),
    );

    let totalEffect = 0;
    for (const row of fx.rows) {
      // The same spend valued twice; the effect is the difference, nothing else.
      expect(row.fxEffect.amountMinor).toBe(
        row.atReportingRate.amountMinor - row.atPlanRate.amountMinor,
      );
      expect(row.transaction.currency).toBe(row.transactionCurrency);
      expect(row.atPlanRate.currency).toBe(built.currency);
      expect(row.atReportingRate.currency).toBe(built.currency);
      expect(row.note).toContain('Not part of spend or variance');
      totalEffect += row.fxEffect.amountMinor;
    }
    expect(fx.totalEffect.amountMinor).toBe(totalEffect);
    expect(fx.totalEffect.currency).toBe(built.currency);

    // The variance page reports plan against actual and committed, and says the FX effect is not
    // in it. Its actual column is the ledger's actual, with no FX effect folded in.
    const variance = built.pages.find((p) => p.page === 'variance_fx')!;
    const actualOnPage = variance.rows.reduce(
      (s, row) => s + (row.cells['actual'].money?.amountMinor ?? 0),
      0,
    );
    expect(actualOnPage).toBe(built.reconciliation.actual.amountMinor);
    for (const row of variance.rows) expect(row.cells['fxNote'].text).toBe('Bridged separately');
    const fxColumn = variance.columns.find((c) => c.key === 'fxNote')!;
    expect(fxColumn.hint).toContain('not part of this variance');
    // Variance is plan to date against actual plus committed; the FX effect never appears in it.
    for (const row of variance.rows)
      expect(row.cells['variance'].money?.amountMinor).toBe(
        (row.cells['planToDate'].money?.amountMinor ?? 0) -
          ((row.cells['actual'].money?.amountMinor ?? 0) +
            (row.cells['committed'].money?.amountMinor ?? 0)),
      );
    // And the pack's own reconciliation still ties with the bridge in it.
    expect(built.reconciliation.ties).toBe(true);
  });

  test('an open-period pack is a draft and says so on every page', async ({ request }) => {
    const built = await pack(request, { draft: 'true' });

    expect(built.source.kind).toBe('open_period_draft');
    expect(built.source.draft).toBe(true);
    expect(built.source.snapshotVersion).toBeNull();
    expect(built.source.statement).toContain('Draft');
    expect(built.notes.join(' ')).toContain('Draft');
    // The legal entity page has no snapshot to read, and each row says so rather than implying one.
    const entities = built.pages.find((p) => p.page === 'legal_entity')!;
    for (const row of entities.rows) expect(row.cells['snapshot'].text).toContain('no snapshot');
  });

  test('a page with no data keeps its place and carries a statement', async ({ request }) => {
    // The oldest closed period of the seeded year has no controls applied in it, so that page is
    // empty while the pack still carries it.
    const periods = await expectContract(
      await request.get('/api/close/periods', { headers: await as('finance-admin') }),
      200,
      ClosePeriodList,
    );
    const closed = periods.items
      .filter((p) => p.status === 'closed' || p.status === 'locked')
      .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.id.localeCompare(b.id));
    expect(closed.length, 'the seed leaves closed periods to build a pack from').toBeGreaterThan(0);

    const built = await pack(request, { fiscalPeriodId: closed[0].id });
    const emptyPages = built.pages.filter((p) => p.statement !== null);
    expect(
      emptyPages.length,
      'the earliest closed period has at least one empty page',
    ).toBeGreaterThan(0);
    for (const page of emptyPages) {
      expect(page.rows).toEqual([]);
      expect(page.totals).toBeNull();
      expect(page.statement).toContain(built.source.periodLabel);
    }
    // Pages are never dropped: the pack still has all eleven.
    expect(built.pages).toHaveLength(11);
  });

  test('only the pages asked for are rendered, in the order asked for', async ({ request }) => {
    const built = await pack(request, { pages: 'variance_fx,summary' });
    expect(built.pages.map((p) => p.page)).toEqual(['variance_fx', 'summary']);
  });

  test('generation runs in the worker and lands in the DocumentStore behind a short-lived link', async ({
    request,
  }) => {
    const queued = await expectContract(
      await request.post('/api/reports/board-pack/generations', {
        headers: await mutate('finance-admin'),
        data: { pages: ['summary', 'legal_entity', 'variance_fx'], formats: ['pdf', 'xlsx'] },
      }),
      202,
      BoardPackGeneration,
    );
    expect(queued.status).toBe('queued');
    expect(queued.files).toEqual([]);
    expect(queued.source.kind).toBe('close_snapshot');

    // Downloading before the worker has rendered it is refused, not answered with an empty file.
    const early = await request.get(
      `/api/reports/board-pack/generations/${queued.id}/download?format=pdf`,
      { headers: await as('finance-admin') },
    );
    expect([404, 409]).toContain(early.status());

    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/reports/board-pack/generations/${queued.id}`, {
            headers: await as('finance-admin'),
          });
          return ((await res.json()) as { status: string }).status;
        },
        { timeout: 90_000, intervals: [500, 1000, 2000] },
      )
      .toBe('ready');

    const ready = await expectContract(
      await request.get(`/api/reports/board-pack/generations/${queued.id}`, {
        headers: await as('finance-admin'),
      }),
      200,
      BoardPackGeneration,
    );
    expect(ready.status).toBe('ready');
    expect(ready.pageCount).toBe(3);
    expect(ready.rowCount).toBeGreaterThan(0);
    expect(ready.error).toBeNull();
    expect(ready.files.map((f) => f.format).sort()).toEqual(['pdf', 'xlsx']);
    for (const file of ready.files) {
      expect(file.sizeBytes).toBeGreaterThan(0);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.fileName).toContain('board-pack');
    }

    const download = await expectContract(
      await request.get(`/api/reports/board-pack/generations/${queued.id}/download?format=pdf`, {
        headers: await as('finance-admin'),
      }),
      200,
      BoardPackDownload,
    );
    // Short-lived and signed: the URL is presigned and stops working within minutes.
    expect(download.url).toContain('X-Amz-Signature');
    expect(download.url).toContain(`/board-packs/${queued.id}.pdf`);
    const ttlMs = Date.parse(download.expiresAt) - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000);

    // The file really is behind that URL, and it really is a PDF.
    const fetched = await request.get(download.url);
    expect(fetched.status(), await fetched.text()).toBe(200);
    const body = await fetched.body();
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.length).toBe(ready.files.find((f) => f.format === 'pdf')!.sizeBytes);

    const listed = await expectContract(
      await request.get('/api/reports/board-pack/generations', {
        headers: await as('finance-admin'),
      }),
      200,
      BoardPackGenerationList,
    );
    expect(listed.items.map((i) => i.id)).toContain(queued.id);
  });

  test('a replayed generation request queues one pack', async ({ request }) => {
    const key = randomUUID();
    const data = { pages: ['summary'], formats: ['pdf'] };
    const first = await expectContract(
      await request.post('/api/reports/board-pack/generations', {
        headers: await mutate('finance-admin', key),
        data,
      }),
      202,
      BoardPackGeneration,
    );
    const replay = await request.post('/api/reports/board-pack/generations', {
      headers: await mutate('finance-admin', key),
      data,
    });
    expect(replay.status()).toBe(202);
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect(((await replay.json()) as { id: string }).id).toBe(first.id);
  });

  test('the pack is for finance, the CEO and auditors; owner roles are refused', async ({
    request,
  }) => {
    for (const user of ['finance-controller', 'ceo', 'auditor'] as const) {
      const allowed = await request.get('/api/reports/board-pack', { headers: await as(user) });
      expect(allowed.status(), `${user} may build the pack`).toBe(200);
    }
    for (const user of ['regional-manager', 'employee'] as const) {
      const refused = await request.get('/api/reports/board-pack', { headers: await as(user) });
      expect([403, 404], `${user} may not build the pack`).toContain(refused.status());
    }
  });
});
