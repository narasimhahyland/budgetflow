// Gap B5 (094b), invariants 122-125: finance and payroll exports describe what is already posted and
// never change a balance. Each export balances (debits equal credits in the reporting currency, every
// line mapped to an ERP account) before it is created; intercompany due-from / due-to pairs net to zero;
// payroll exports carry each person's reportable benefit as the benefit ledger states it; every source
// item is exported once, and a re-export needs a reason and is flagged as a duplicate send. Files go
// through the DocumentStore with signed links and neutralised CSV formulas; creation, re-sends,
// downloads and "Mark posted" are audited; scope follows `finance_export.*` plus the data behind it.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  BenefitEntry,
  BenefitLedgerView,
  BudgetDetail,
  ContributionDetail,
  FinanceExportDetail,
  FinanceExportDownload,
  FinanceExportList,
  FinanceExportPreview,
  FinanceExportSummary,
  Journal,
  RechargeList,
  type CreateFinanceExportRequest,
} from '@bf/contracts';
import { SEED, seedId, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { allocateOk } from '../support/factory';
import {
  approvedEvent,
  auditFor,
  budget,
  contribute,
  decideOk,
  directorTree,
  ENTITIES,
  fundedChild,
  taskOf,
  usd,
} from '../support/p5';

const FA = 'finance-admin';
const PERIOD = '2026-11';
const OLIVER_UK = seedId('40000000', 151);
const UK_RULE = 'UK annual staff functions';
const ERP = { dueFrom: '1300', dueTo: '2300', payables: '2000', employeeEvents: '6100' };

test.describe.configure({ mode: 'serial' });

const preview = async (request: APIRequestContext, query: string, user = FA) =>
  expectContract(
    await request.get(`/api/finance/exports/preview?${query}`, { headers: await as(user) }),
    200,
    FinanceExportPreview,
  );

const create = (
  request: APIRequestContext,
  body: Partial<CreateFinanceExportRequest> & { type: CreateFinanceExportRequest['type'] },
  headers?: Record<string, string>,
) =>
  (async () =>
    request.post('/api/finance/exports', {
      headers: headers ?? (await mutate(FA)),
      data: { period: PERIOD, ...body },
    }))();

async function download(
  request: APIRequestContext,
  id: string,
  format: 'csv' | 'xlsx',
  user = FA,
): Promise<{ link: FinanceExportDownload; body: Buffer }> {
  const link = await expectContract(
    await request.get(`/api/finance/exports/${id}/download?format=${format}`, {
      headers: await as(user),
    }),
    200,
    FinanceExportDownload,
  );
  expect(link.url).toContain('X-Amz-Signature');
  expect(link.url).toContain(`/tenants/${SEED.tenants.acme}/finance-exports/${id}.${format}`);
  const fetched = await request.get(link.url);
  expect(fetched.status(), await fetched.text()).toBe(200);
  return { link, body: await fetched.body() };
}

/** CSV rows (no quoted commas in these files apart from descriptions, which we do not split on). */
const csvRows = (body: Buffer) =>
  body
    .toString('utf8')
    .trim()
    .split('\r\n')
    .map((l) => l.split(','));

/** A cross-entity contribution (Germany giver, India event) whose approved recharge posts a journal. */
async function freshRecharge(request: APIRequestContext) {
  const { root, team } = await directorTree(request, { teamEntity: ENTITIES.india });
  const germany = await fundedChild(request, root.id, {
    owner: 'department-head',
    amountMinor: 1_000_000,
    legalEntityId: ENTITIES.germany,
  });
  const event = await approvedEvent(request, 'budget-owner', 'department-head', {
    homeBudgetId: team.id,
    estimate: usd(1_000_000),
    ownFunds: usd(300_000),
    toleranceBps: 1000,
  });
  const de = await expectContract(
    await contribute(request, 'budget-owner', {
      eventId: event.id,
      giverBudgetId: germany.id,
      amount: usd(200_000),
    }),
    201,
    ContributionDetail,
  );
  await decideOk(
    request,
    'department-head',
    await taskOf(request, 'department-head', 'contribution', de.id),
    { decision: 'approve' },
  );
  const recharges = async () =>
    expectContract(
      await request.get(`/api/recharges?eventId=${event.id}`, { headers: await as(FA) }),
      200,
      RechargeList,
    );
  const recharge = (await recharges()).items.find((r) => r.contributionId === de.id)!;
  expect(recharge.status).toBe('approved');
  const journal = await expectContract(
    await request.get(`/api/ledger/journals/${recharge.journalId}`, { headers: await as(FA) }),
    200,
    Journal,
  );
  return { recharge, journal, recharges };
}

/** A categorized India budget with spend on a cost center, funded from a fresh root. */
async function indiaBudget(request: APIRequestContext, rootId: string, costCenterId: string) {
  const b = await expectContract(
    await request.post('/api/budgets', {
      headers: await mutate('ceo'),
      data: {
        name: `B5 chargeback ${randomUUID().slice(0, 6)}`,
        parentId: rootId,
        legalEntityId: ENTITIES.india,
        costCenterId,
        categoryCode: 'employee_events',
        currency: 'USD',
        fiscalYearId: SEED.fiscalYears.acmeFy2026,
        ownerPersonId: userById('budget-owner').personId,
      },
    }),
    201,
    BudgetDetail,
  );
  await allocateOk(request, rootId, b.id, usd(500_000));
  return b;
}

async function manualJournal(
  request: APIRequestContext,
  reason: string,
  lines: {
    budgetId: string | null;
    account: string;
    side: 'debit' | 'credit';
    amountMinor: number;
    legalEntityId?: string;
  }[],
) {
  return expectContract(
    await request.post('/api/ledger/journals', {
      headers: await mutate(FA),
      data: { transactionCurrency: 'USD', reasonCode: 'ADJ-CHARGEBACK', reason, lines },
    }),
    201,
    Journal,
  );
}

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

test.describe('finance and payroll exports (094b)', () => {
  test('an intercompany recharge export carries the posted due-from / due-to pair, balances, nets to zero and is exported once', async ({
    request,
  }) => {
    const { recharge, journal, recharges } = await freshRecharge(request);
    const q = `type=intercompany_recharges&period=${PERIOD}&legalEntityId=${ENTITIES.germany}`;
    const p = await preview(request, q);
    expect(p).toMatchObject({ balanced: true, unmappedLines: 0, problem: null, canCreate: true });
    // The preview's lines for this recharge are exactly the posted journal's lines.
    const mine = p.lines.filter((l) => l.journalId === journal.id);
    expect(mine).toHaveLength(2);
    const fromLedger = journal.lines.map((l) => ({
      lineNo: l.lineNo,
      account: l.account,
      reporting: l.reporting.amountMinor,
    }));
    expect(
      mine.map((l) => ({
        lineNo: l.journalLineNo,
        account: l.account === ERP.dueFrom ? 'intercompany_due_from' : 'intercompany_due_to',
        reporting: l.debit.amountMinor - l.credit.amountMinor,
      })),
    ).toEqual(expect.arrayContaining(fromLedger));
    const dueFrom = mine.find((l) => l.account === ERP.dueFrom)!;
    const dueTo = mine.find((l) => l.account === ERP.dueTo)!;
    expect(dueFrom.legalEntityId).toBe(ENTITIES.germany);
    expect(dueTo.legalEntityId).toBe(ENTITIES.india);
    // The pair nets to zero at group level, in the reporting and the transaction currency.
    expect(dueFrom.debit.amountMinor).toBe(recharge.total.amountMinor);
    expect(dueFrom.debit.amountMinor - dueTo.credit.amountMinor).toBe(0);
    expect(dueFrom.transaction.amountMinor + dueTo.transaction.amountMinor).toBe(0);
    expect(p.debitTotal).toEqual(p.creditTotal);
    expect(p.debitTotal.amountMinor).toBe(sum(p.lines.map((l) => l.debit.amountMinor)));

    // Create: one balanced batch with its files; the same key replays it.
    const key = randomUUID();
    const created = await expectContract(
      await create(
        request,
        { type: 'intercompany_recharges', legalEntityId: ENTITIES.germany },
        await mutate(FA, key),
      ),
      201,
      FinanceExportDetail,
    );
    expect(created.export).toMatchObject({
      type: 'intercompany_recharges',
      period: PERIOD,
      status: 'sent',
      duplicate: false,
      target: 'file',
      lineCount: p.lineCount,
      debitTotal: p.debitTotal,
      creditTotal: p.creditTotal,
    });
    expect(created.export.number).toMatch(/^EXP-2026-\d{4}$/);
    expect(created.lines.map((l) => l.sourceRef)).toEqual(p.lines.map((l) => l.sourceRef));
    const replay = await create(
      request,
      { type: 'intercompany_recharges', legalEntityId: ENTITIES.germany },
      await mutate(FA, key),
    );
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect(((await replay.json()) as FinanceExportDetail).export.id).toBe(created.export.id);

    // 053a reads Exported for the recharge the ERP now has.
    expect((await recharges()).items.find((r) => r.id === recharge.id)?.status).toBe('exported');

    // The CSV: one row per line, the journal link kept, debit and credit totals equal.
    const csv = await download(request, created.export.id, 'csv');
    expect(csv.link.fileName).toBe(`${created.export.number}-intercompany-recharges-${PERIOD}.csv`);
    const rows = csvRows(csv.body);
    expect(rows[0].slice(0, 7)).toEqual([
      'export_id',
      'legal_entity',
      'period',
      'accounting_date',
      'journal_id',
      'journal_line',
      'account',
    ]);
    expect(rows.length).toBe(created.lines.length + 2);
    expect(rows.filter((r) => r[4] === journal.id)).toHaveLength(2);
    const total = rows[rows.length - 1];
    const debitCol = rows[0].findIndex((h) => h.startsWith('debit'));
    const creditCol = rows[0].findIndex((h) => h.startsWith('credit'));
    expect(total[0]).toBe('Total');
    expect(total[debitCol]).toBe(total[creditCol]);
    const xlsx = await download(request, created.export.id, 'xlsx');
    expect(xlsx.body.subarray(0, 2).toString('latin1')).toBe('PK');

    // Exported once: nothing new for HYL-DE this month; re-sending needs a reason and is a duplicate.
    const after = await preview(request, q);
    expect(after).toMatchObject({ nothingToExport: true, canCreate: false });
    expect(after.message).toBe('No new items for November 2026 in HYL-DE.');
    await expectProblem(
      await create(request, { type: 'intercompany_recharges', legalEntityId: ENTITIES.germany }),
      409,
      'FINANCE_EXPORT_NOTHING_TO_EXPORT',
    );
    const again = await preview(request, `${q}&includeExported=true`);
    expect(again.duplicates).toBe(again.lineCount);
    expect(again.lines.every((l) => l.alreadyExported && l.exportedIn)).toBe(true);
    expect(again.previousExports.map((e) => e.number)).toContain(created.export.number);
    await expectProblem(
      await create(request, {
        type: 'intercompany_recharges',
        legalEntityId: ENTITIES.germany,
        includeExported: true,
      }),
      422,
      'FINANCE_EXPORT_REASON_REQUIRED',
    );
    const resent = await expectContract(
      await create(request, {
        type: 'intercompany_recharges',
        legalEntityId: ENTITIES.germany,
        includeExported: true,
        reason: 'The ERP import job failed after receipt; sending the file again.',
      }),
      201,
      FinanceExportDetail,
    );
    expect(resent.export.duplicate).toBe(true);
    expect(resent.export.debitTotal).toEqual(resent.export.creditTotal);
    expect(resent.lines.filter((l) => l.journalId === journal.id)).toHaveLength(2);
    expect(resent.lines.every((l) => l.alreadyExported)).toBe(true);
    const resentCsv = csvRows((await download(request, resent.export.id, 'csv')).body);
    expect(resentCsv.slice(1, -1).every((r) => r[r.length - 1] === 'yes')).toBe(true);

    // Mark posted with the ERP document number; once only; 053a reads Posted.
    const posted = await expectContract(
      await request.post(`/api/finance/exports/${created.export.id}/posted`, {
        headers: await mutate(FA),
        data: { erpDocumentNumber: 'JV-2026-11-0042' },
      }),
      200,
      FinanceExportSummary,
    );
    expect(posted).toMatchObject({
      status: 'posted',
      erpDocumentNumber: 'JV-2026-11-0042',
      canMarkPosted: false,
    });
    await expectProblem(
      await request.post(`/api/finance/exports/${created.export.id}/posted`, {
        headers: await mutate(FA),
        data: { erpDocumentNumber: 'JV-2026-11-0043' },
      }),
      409,
      'FINANCE_EXPORT_ALREADY_POSTED',
    );
    expect((await recharges()).items.find((r) => r.id === recharge.id)?.status).toBe('posted');

    // Audited: creation, the re-send with its reason, each link handed out, and Mark posted.
    const trail = (await auditFor(request, created.export.id)).map((e) => e.action);
    expect(trail.filter((a) => a === 'finance_export.created')).toHaveLength(1);
    expect(trail.filter((a) => a === 'finance_export.downloaded')).toHaveLength(2);
    expect(trail.filter((a) => a === 'finance_export.marked_posted')).toHaveLength(1);
    const resentTrail = await auditFor(request, resent.export.id);
    const resentEvent = resentTrail.find((e) => e.action === 'finance_export.resent');
    expect(resentEvent?.reason).toBe(
      'The ERP import job failed after receipt; sending the file again.',
    );

    // The list for the month shows both, newest first.
    const list = await expectContract(
      await request.get(`/api/finance/exports?period=${PERIOD}&type=intercompany_recharges`, {
        headers: await as(FA),
      }),
      200,
      FinanceExportList,
    );
    expect(list.periodLabel).toBe('November 2026');
    const ids = list.items.map((i) => i.id);
    expect(ids.indexOf(resent.export.id)).toBeLessThan(ids.indexOf(created.export.id));
    expect(list.items.find((i) => i.id === created.export.id)?.entityLabel).toBe(
      'HYL-DE to HYL-IN',
    );
  });

  test('a chargeback and its reclass reversal export balance against the ledger, by GL account and cost center', async ({
    request,
  }) => {
    const { root } = await directorTree(request, { teamEntity: ENTITIES.india });
    const blr = await indiaBudget(request, root.id, seedId('31000000', 2));
    const hyd = await indiaBudget(request, root.id, seedId('31000000', 3));
    // Spend lands on Bengaluru, then is charged back to Hyderabad, then the chargeback is corrected.
    const spend = await manualJournal(request, 'B5 opening actual on Bengaluru', [
      { budgetId: blr.id, account: 'actual', side: 'debit', amountMinor: 118_000 },
      {
        budgetId: null,
        account: 'obligations',
        side: 'credit',
        amountMinor: 118_000,
        legalEntityId: ENTITIES.india,
      },
    ]);
    // A manual journal never moves amounts between budgets, so a chargeback is two journals through
    // payables clearing: the spend leaves Bengaluru and lands on Hyderabad.
    const chargeOut = await manualJournal(request, 'Team offsite charged out of Bengaluru', [
      { budgetId: blr.id, account: 'actual', side: 'credit', amountMinor: 40_000 },
      {
        budgetId: null,
        account: 'obligations',
        side: 'debit',
        amountMinor: 40_000,
        legalEntityId: ENTITIES.india,
      },
    ]);
    const chargeback = await manualJournal(request, 'Team offsite charged to Hyderabad', [
      { budgetId: hyd.id, account: 'actual', side: 'debit', amountMinor: 40_000 },
      {
        budgetId: null,
        account: 'obligations',
        side: 'credit',
        amountMinor: 40_000,
        legalEntityId: ENTITIES.india,
      },
    ]);
    const reclass = await expectContract(
      await request.post(`/api/ledger/journals/${chargeback.id}/reversals`, {
        headers: await mutate(FA),
        data: { reasonCode: 'EXC-RECLASS', reason: 'Charged to the wrong site' },
      }),
      201,
      Journal,
    );

    const q = `type=chargeback_reclass&period=${PERIOD}&legalEntityId=${ENTITIES.india}`;
    const p = await preview(request, q);
    expect(p).toMatchObject({ balanced: true, unmappedLines: 0, canCreate: true });
    for (const j of [spend, chargeOut, chargeback, reclass]) {
      const lines = p.lines.filter((l) => l.journalId === j.id);
      // Every line of these journals is a GL line; each journal balances on its own.
      expect(lines).toHaveLength(j.lines.length);
      expect(sum(lines.map((l) => l.debit.amountMinor))).toBe(
        sum(lines.map((l) => l.credit.amountMinor)),
      );
      for (const l of j.lines) {
        const e = lines.find((x) => x.journalLineNo === l.lineNo)!;
        expect(e.debit.amountMinor - e.credit.amountMinor).toBe(l.reporting.amountMinor);
        expect(e.transaction).toEqual(l.transaction);
      }
    }
    const cb = p.lines.filter(
      (l) => (l.journalId === chargeback.id || l.journalId === chargeOut.id) && l.costCenter,
    );
    // Actual spend maps to the entity's GL for the budget category, with the budget's cost center.
    expect(
      cb
        .filter((l) => l.account === ERP.employeeEvents)
        .map((l) => [l.costCenter, l.debit.amountMinor, l.credit.amountMinor]),
    ).toEqual(
      expect.arrayContaining([
        ['CC-IN-HYD-210', 40_000, 0],
        ['CC-IN-BLR-200', 0, 40_000],
      ]),
    );
    expect(p.lines.find((l) => l.journalId === spend.id && l.credit.amountMinor > 0)?.account).toBe(
      ERP.payables,
    );
    expect(p.lines.find((l) => l.journalId === reclass.id)?.description).toContain(
      'EXC-RECLASS: Charged to the wrong site',
    );

    // Exports never move money: both budgets read the same before and after the export.
    const balancesBefore = [await budget(request, blr.id), await budget(request, hyd.id)];
    const created = await expectContract(
      await create(request, { type: 'chargeback_reclass', legalEntityId: ENTITIES.india }),
      201,
      FinanceExportDetail,
    );
    expect(created.export.debitTotal).toEqual(created.export.creditTotal);
    expect([await budget(request, blr.id), await budget(request, hyd.id)]).toEqual(balancesBefore);
    expect(created.lines.filter((l) => l.journalId === reclass.id)).toHaveLength(2);
    const rows = csvRows((await download(request, created.export.id, 'csv')).body);
    const total = rows[rows.length - 1];
    expect(total[rows[0].findIndex((h) => h.startsWith('debit'))]).toBe(
      total[rows[0].findIndex((h) => h.startsWith('credit'))],
    );
    // A CSV cell that starts like a formula is neutralised (the reason is free text).
    const formula = await manualJournal(request, '=HYPERLINK("http://example.test")', [
      { budgetId: blr.id, account: 'actual', side: 'debit', amountMinor: 100 },
      {
        budgetId: null,
        account: 'obligations',
        side: 'credit',
        amountMinor: 100,
        legalEntityId: ENTITIES.india,
      },
    ]);
    const second = await expectContract(
      await create(request, { type: 'chargeback_reclass', legalEntityId: ENTITIES.india }),
      201,
      FinanceExportDetail,
    );
    expect(second.lines.map((l) => l.journalId)).toEqual([formula.id, formula.id]);
    const text = (await download(request, second.export.id, 'csv')).body.toString('utf8');
    expect(text).not.toMatch(/,=HYPERLINK/);
    expect(text).toContain('Chargeback - ADJ-CHARGEBACK: =HYPERLINK');
    expect((await auditFor(request, created.export.id)).map((e) => e.action)).toContain(
      'finance_export.created',
    );
  });

  test('an export that does not balance cannot be created and says why', async ({ request }) => {
    const { root } = await directorTree(request);
    const uk = await fundedChild(request, root.id, {
      owner: 'department-head',
      amountMinor: 100_000,
      legalEntityId: ENTITIES.uk,
    });
    // Actual spend offset against the earmark reserve, which is BudgetFlow-only: the ERP lines have no offset.
    await manualJournal(request, 'B5 actual with no GL offset', [
      { budgetId: uk.id, account: 'actual', side: 'debit', amountMinor: 3_000 },
      {
        budgetId: null,
        account: 'earmark_reserve',
        side: 'credit',
        amountMinor: 3_000,
        legalEntityId: ENTITIES.uk,
      },
    ]);
    const p = await preview(
      request,
      `type=chargeback_reclass&period=${PERIOD}&legalEntityId=${ENTITIES.uk}`,
    );
    expect(p).toMatchObject({ balanced: false, canCreate: false });
    expect(p.debitTotal.amountMinor).not.toBe(p.creditTotal.amountMinor);
    expect(p.problem).toMatch(/^Debits USD [\d,.]+, credits USD [\d,.]+\.$/);
    await expectProblem(
      await create(request, { type: 'chargeback_reclass', legalEntityId: ENTITIES.uk }),
      422,
      'FINANCE_EXPORT_NOT_BALANCED',
    );
  });

  test('a payroll export carries each person’s reportable benefit as the benefit ledger states it, then only what is new', async ({
    request,
  }) => {
    const ledger = async () =>
      expectContract(
        await request.get(
          `/api/finance/benefits/ledger?legalEntityId=${ENTITIES.uk}&asOf=2026-11-30`,
          { headers: await as(FA) },
        ),
        200,
        BenefitLedgerView,
      );
    const before = await ledger();
    const reportable = before.items.filter((r) => (r.reportable?.amountMinor ?? 0) > 0);
    expect(
      reportable.find((r) => r.personId === OLIVER_UK && r.thresholdName === UK_RULE)?.reportable,
    ).toEqual({
      amountMinor: 16_800,
      currency: 'GBP',
    });

    const q = `type=payroll_benefits&period=${PERIOD}&legalEntityId=${ENTITIES.uk}`;
    const p = await preview(request, q);
    expect(p).toMatchObject({ balanced: true, problem: null });
    // From the seed nothing was exported yet: totals per person equal the benefit ledger's
    // reportable amounts for every person who has one.
    const people = [...new Set(reportable.map((r) => r.personId))].sort();
    expect(p.personTotals.map((t) => t.personId).sort()).toEqual(people);
    for (const t of p.personTotals) {
      const fromLedger = sum(
        reportable.filter((r) => r.personId === t.personId).map((r) => r.reportable!.amountMinor),
      );
      expect(t.reportable.amountMinor).toBe(fromLedger);
    }
    const created = await expectContract(
      await create(request, { type: 'payroll_benefits', legalEntityId: ENTITIES.uk }),
      201,
      FinanceExportDetail,
    );
    expect(created.export).toMatchObject({
      type: 'payroll_benefits',
      personCount: created.personTotals.length,
      reportableTotal: p.reportableTotal,
      debitTotal: { amountMinor: 0, currency: 'USD' },
    });
    const oliver = created.personTotals.find((t) => t.personId === OLIVER_UK);
    expect(oliver?.reportable).toEqual({ amountMinor: 16_800, currency: 'GBP' });
    // Every line's cumulative amount is the ledger's reportable for that person and threshold.
    for (const l of created.lines) {
      const r = reportable.find((x) => x.personId === l.personId && x.thresholdName === l.benefit);
      expect(l.sourceRef.endsWith(`:${r!.reportable!.amountMinor}`)).toBe(true);
      expect(l.taxYear).toEqual(r!.window);
    }
    const rows = csvRows((await download(request, created.export.id, 'csv')).body);
    expect(rows[0]).toEqual([
      'export_id',
      'legal_entity',
      'employee_id',
      'employee_name',
      'benefit',
      'tax_year_from',
      'tax_year_to',
      'reportable_amount',
      'currency',
      'duplicate_send',
    ]);
    expect(rows.find((r) => r[2] === OLIVER_UK)?.slice(4, 9)).toEqual([
      UK_RULE,
      '2026-04-06',
      '2027-04-05',
      '168.00',
      'GBP',
    ]);

    // Nothing new until the ledger changes; then only the increase goes to payroll.
    expect((await preview(request, q)).nothingToExport).toBe(true);
    const extra = await expectContract(
      await request.post('/api/finance/benefits/entries', {
        headers: await mutate(FA),
        data: {
          personId: OLIVER_UK,
          benefitType: 'employee_events',
          entryDate: '2026-11-10',
          amount: { amountMinor: 1_200, currency: 'GBP' },
          description: 'B5 late team dinner',
        },
      }),
      201,
      BenefitEntry,
    );
    const delta = await preview(request, q);
    expect(delta.lines).toHaveLength(1);
    expect(delta.lines[0]).toMatchObject({
      personId: OLIVER_UK,
      reportable: { amountMinor: 1_200, currency: 'GBP' },
      alreadyExported: false,
    });
    expect(delta.lines[0].sourceRef.endsWith(':18000')).toBe(true);
    // Put the ledger back so other scenarios read the seeded amounts.
    await expectContract(
      await request.post(`/api/finance/benefits/entries/${extra.id}/reverse`, {
        headers: await mutate(FA),
        data: { reason: 'B5 scenario clean-up' },
      }),
      201,
      BenefitEntry,
    );
    expect((await preview(request, q)).nothingToExport).toBe(true);
    // Payroll goes to one entity's payroll at a time.
    await expectProblem(
      await create(request, { type: 'payroll_benefits' }),
      422,
      'VALIDATION_FAILED',
    );
  });

  test('scope: finance reads, only the finance admin creates, payroll lines need benefits access, the operator sees nothing', async ({
    request,
  }) => {
    const list = await expectContract(
      await request.get(`/api/finance/exports?period=${PERIOD}`, { headers: await as(FA) }),
      200,
      FinanceExportList,
    );
    expect(list.canCreate).toBe(true);
    const payroll = list.items.find((i) => i.type === 'payroll_benefits')!;
    const journals = list.items.find((i) => i.type === 'chargeback_reclass')!;
    expect(payroll && journals).toBeTruthy();

    for (const user of ['finance-controller', 'auditor'] as const) {
      const l = await expectContract(
        await request.get(`/api/finance/exports?period=${PERIOD}`, { headers: await as(user) }),
        200,
        FinanceExportList,
      );
      expect(l.canCreate).toBe(false);
      expect(l.items.every((i) => !i.canMarkPosted && !i.canResend && i.canDownload)).toBe(true);
      await expectProblem(
        await create(
          request,
          { type: 'chargeback_reclass', legalEntityId: ENTITIES.india },
          await mutate(user),
        ),
        403,
        'FORBIDDEN',
      );
      await expectProblem(
        await request.post(`/api/finance/exports/${journals.id}/posted`, {
          headers: await mutate(user),
          data: { erpDocumentNumber: 'X-1' },
        }),
        403,
        'FORBIDDEN',
      );
    }
    // The auditor reads the payroll lines (benefits.read); the integration admin sees the delivery
    // list but no lines or files: payroll names employees and journals are finance data.
    await expectContract(
      await request.get(`/api/finance/exports/${payroll.id}`, { headers: await as('auditor') }),
      200,
      FinanceExportDetail,
    );
    const ia = await expectContract(
      await request.get(`/api/finance/exports?period=${PERIOD}`, {
        headers: await as('integration-admin'),
      }),
      200,
      FinanceExportList,
    );
    expect(ia.items.length).toBe(list.items.length);
    expect(ia.items.every((i) => !i.canDownload)).toBe(true);
    for (const id of [payroll.id, journals.id]) {
      await expectProblem(
        await request.get(`/api/finance/exports/${id}`, { headers: await as('integration-admin') }),
        403,
        'FORBIDDEN',
      );
      await expectProblem(
        await request.get(`/api/finance/exports/${id}/download?format=csv`, {
          headers: await as('integration-admin'),
        }),
        403,
        'FORBIDDEN',
      );
    }
    await expectProblem(
      await request.get(
        `/api/finance/exports/preview?type=payroll_benefits&period=${PERIOD}&legalEntityId=${ENTITIES.uk}`,
        { headers: await as('integration-admin') },
      ),
      403,
      'FORBIDDEN',
    );
    // Roles outside finance are refused outright, and so is the platform operator without a grant.
    for (const user of ['budget-owner', 'employee', 'super-admin'] as const) {
      const res = await request.get(`/api/finance/exports?period=${PERIOD}`, {
        headers: await as(user),
      });
      expect([403, 404]).toContain(res.status());
    }
  });
});
