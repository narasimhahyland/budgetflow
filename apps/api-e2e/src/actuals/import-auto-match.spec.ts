// Invariants 15 and 8 (P6): an actuals file imports with validation, a duplicate guard within and across
// files, local currency converted to USD at the locked plan rate, auto-match by commitment reference,
// event code with cost center and vendor with amount; matched lines post (encumbered to actual), the rest
// go to the unmatched queue. Import and match are recorded as product analytics events.
import { expect, test } from '@playwright/test';
import { ActualList, Journal } from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import {
  actualByRef,
  buckets,
  CC,
  commitmentState,
  createCommitment,
  createEvent,
  csv,
  post,
  refs,
  spendBudget,
  uniq,
  upload,
} from './support';

const analyticsCount = (name: string) =>
  asOwner(async (c) =>
    Number(
      (await c.query(`select count(*) from product_analytics_events where name = $1`, [name]))
        .rows[0].count,
    ),
  );

test.describe('actuals import with auto-match', () => {
  test('upload converts at the plan rate, proposes matches, skips duplicates and rejects invalid lines; posting fills the queue with the rest', async ({
    request,
  }) => {
    const r = await refs();
    const budget = await spendBudget(request);
    const e1 = await createEvent({
      budgetId: budget.id,
      status: 'in_progress',
      costCenterId: CC.bengaluru,
    });
    const e2 = await createEvent({
      budgetId: budget.id,
      status: 'in_progress',
      costCenterId: CC.hyderabad,
    });
    const cExact = await createCommitment({
      budgetId: budget.id,
      amountMinor: 8_325_000,
      currency: 'INR',
      description: 'Catering (INR)',
    });
    const cEvent = await createCommitment({
      budgetId: budget.id,
      amountMinor: 50_000,
      eventId: e1.id,
      costCenterId: CC.bengaluru,
      vendorId: r.vendor('Spice Route Caterers'),
    });
    const cVendor = await createCommitment({
      budgetId: budget.id,
      amountMinor: 30_000,
      vendorId: r.vendor('Deccan Event Studio'),
    });
    const cPartial = await createCommitment({
      budgetId: budget.id,
      amountMinor: 200_000,
      eventId: e2.id,
      costCenterId: CC.hyderabad,
    });
    const p = `S${uniq()}`;
    const content = csv([
      `${p}-1,2026-11-03,83250.00,INR,HYL-IN,CC-IN-BLR-200,6100,,,Catering invoice,${cExact.reference},,charge`,
      `${p}-2,2026-11-03,41625.00,INR,HYL-IN,CC-IN-BLR-200,6100,${e1.eventCode},Spice Route Caterers,Snacks,,,charge`,
      `${p}-3,2026-11-03,297.00,USD,HYL-IN,,6100,,Deccan Event Studio,Decor,,,charge`,
      `${p}-4,2026-11-03,800.00,USD,HYL-IN,CC-IN-HYD-210,6100,${e2.eventCode},,First instalment,,,charge`,
      `${p}-5,2026-11-03,1000.00,EUR,HYL-IN,,6100,,Canal Events BV,Venue Berlin,,,charge`,
      `${p}-5,2026-11-03,1000.00,EUR,HYL-IN,,6100,,Canal Events BV,Venue Berlin (repeated),,,charge`,
      `${p}-6,2026-11-03,10.00,XXX,HYL-IN,,6100,,,Unknown currency,,,charge`,
    ]);
    const importedBefore = await analyticsCount('actual.imported');
    const matchedBefore = await analyticsCount('actual.matched');

    const batch = await upload(request, content);
    expect(batch.status).toBe('review');
    expect(batch.summary).toMatchObject({
      linesRead: 7,
      imported: 5,
      rejected: 1,
      duplicatesSkipped: 1,
      autoMatched: 2,
      partiallyMatched: 2,
      unmatched: 1,
      matchRateBps: 8000,
      reportingCurrency: 'USD',
    });
    expect(batch.issues).toEqual([expect.objectContaining({ field: 'currency' })]);
    const inr = batch.summary.byCurrency.find((c) => c.currency === 'INR')!;
    expect(inr).toEqual({
      currency: 'INR',
      lines: 2,
      transactionMinor: 12_487_500,
      planRate: '83.250000000000',
      reportingMinor: 150_000,
    });
    expect(batch.summary.byCurrency.find((c) => c.currency === 'EUR')!.reportingMinor).toBe(
      108_696,
    );
    expect(Object.fromEntries(batch.summary.rules.map((x) => [x.rule, x.lines]))).toEqual({
      reference: 1,
      event_cost_center: 2,
      vendor_amount: 1,
    });

    // Lines under review are not in the queue yet.
    const queueBefore = await expectContract(
      await request.get(`/api/actuals?batchId=${batch.id}`, {
        headers: await as('finance-controller'),
      }),
      200,
      ActualList,
    );
    expect(queueBefore.items).toHaveLength(0);

    const posted = await post(request, batch.id);
    expect(posted.status).toBe('posted');
    expect(posted.summary.posted).toMatchObject({ matched: 4, toQueue: 1 });
    expect(posted.summary.posted!.period?.label).toBeTruthy();

    const b = await buckets(request, budget.id);
    expect(b.balances.budgetCurrency.actual).toEqual({
      amountMinor: 100_000 + 50_000 + 29_700 + 80_000,
      currency: 'USD',
    });
    expect(b.balances.budgetCurrency.encumbered).toEqual({ amountMinor: 120_000, currency: 'USD' });
    expect(b.balances.available.amountMinor).toBe(5_000_000 - 120_000 - 259_700);

    expect((await commitmentState(request, budget.id, cExact.id)).status).toBe('consumed');
    expect((await commitmentState(request, budget.id, cEvent.id)).status).toBe('consumed');
    const vendor = await commitmentState(request, budget.id, cVendor.id);
    expect(vendor).toMatchObject({
      status: 'consumed',
      encumbered: { amountMinor: 0 },
      released: { amountMinor: 300 },
    });
    const partial = await commitmentState(request, budget.id, cPartial.id);
    expect(partial).toMatchObject({
      status: 'partially_consumed',
      encumbered: { amountMinor: 120_000 },
    });

    // The exact INR match posted a balanced journal with the currency triplet at the locked plan rate.
    const exact = await actualByRef(request, `${p}-1`);
    expect(exact.actual).toMatchObject({
      status: 'matched',
      transaction: { amountMinor: 8_325_000, currency: 'INR' },
      reporting: { amountMinor: 100_000, currency: 'USD' },
    });
    expect(exact.matches[0]).toMatchObject({
      fit: 'exact',
      rule: 'reference',
      relief: { amountMinor: 100_000 },
    });
    const journal = await expectContract(
      await request.get(`/api/ledger/journals/${exact.matches[0].journalIds[0]}`, {
        headers: await as('finance-controller'),
      }),
      200,
      Journal,
    );
    expect(journal.balanced).toBe(true);
    const actualLine = journal.lines.find((l) => l.account === 'actual')!;
    expect(actualLine).toMatchObject({
      transaction: { amountMinor: 8_325_000, currency: 'INR' },
      budget: { amountMinor: 100_000, currency: 'USD' },
      reporting: { amountMinor: 100_000, currency: 'USD' },
      budgetRate: { type: 'plan', value: '0.012012012012' },
    });

    const queued = await actualByRef(request, `${p}-5`);
    expect(queued.actual).toMatchObject({
      status: 'unmatched',
      note: 'No matching rule found.',
      reporting: { amountMinor: 108_696 },
    });
    const queue = await expectContract(
      await request.get(`/api/actuals?status=queue&q=${p}`, {
        headers: await as('finance-controller'),
      }),
      200,
      ActualList,
    );
    expect(queue.items.map((i) => i.sourceRef)).toEqual([`${p}-5`]);

    expect(await analyticsCount('actual.imported')).toBe(importedBefore + 1);
    expect(await analyticsCount('actual.matched')).toBe(matchedBefore + 1);
  });

  test('the same file cannot be imported twice and a line already imported in another file is skipped', async ({
    request,
  }) => {
    const p = `S${uniq()}`;
    const first = csv([`${p}-1,2026-11-03,25.00,USD,HYL-US,,6100,,,Coffee,,,charge`]);
    const batch = await upload(request, first);
    await post(request, batch.id);
    const again = await request.post('/api/actuals/imports', {
      headers: await mutate('finance-controller'),
      data: { source: 'erp', fileName: 'again.csv', content: first },
    });
    const problem = await expectProblem(again, 409, 'IMPORT_ALREADY_UPLOADED');
    expect(problem.params?.['batchId']).toBe(batch.id);

    const second = await upload(
      request,
      csv([
        `${p}-1,2026-11-03,25.00,USD,HYL-US,,6100,,,Coffee,,,charge`,
        `${p}-2,2026-11-04,12.00,USD,HYL-US,,6100,,,Tea,,,charge`,
      ]),
    );
    expect(second.summary).toMatchObject({ imported: 1, duplicatesSkipped: 1 });
  });

  test('only finance can import; auditors read the queue; employees see nothing', async ({
    request,
  }) => {
    const content = csv([`S${uniq()}-1,2026-11-03,25.00,USD,HYL-US,,6100,,,Coffee,,,charge`]);
    const body = { source: 'erp', fileName: 'x.csv', content };
    expect(
      (
        await request.post('/api/actuals/imports', { headers: await mutate('auditor'), data: body })
      ).status(),
    ).toBe(403);
    expect([403, 404]).toContain(
      (
        await request.post('/api/actuals/imports', {
          headers: await mutate('employee'),
          data: body,
        })
      ).status(),
    );
    expect((await request.get('/api/actuals', { headers: await as('auditor') })).status()).toBe(
      200,
    );
    expect([403, 404]).toContain(
      (await request.get('/api/actuals', { headers: await as('employee') })).status(),
    );
    expect([403, 404]).toContain(
      (await request.get('/api/actuals', { headers: await as('budget-owner') })).status(),
    );
  });
});
