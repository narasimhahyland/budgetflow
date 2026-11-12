// Gap B3 (080g), invariants 106 and 107: recoverable GST/VAT never uses budget; the net amount plus
// the non-recoverable tax does, on a commitment and on an actual, exactly at the available amount and
// one minor unit above. The split comes from the published rule set in force (seeded, fictional) and
// is recorded once on the commitment or actual; the ledger rebuild still balances afterwards.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { RequestDetail, TaxBreakdown, TaxRuleSetView, TaxRulesView } from '@bf/contracts';
import { TENANTS } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole, asOwner, pgError } from '../support/db';
import {
  decideOk,
  directorTree,
  ENTITIES,
  getRequest,
  runLedgerCheck,
  spendingRequest,
  usd,
} from '../support/p5';
import { actualByRef, buckets, uniq } from '../actuals/support';

const TAX_HEADER =
  'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,event_code,vendor,memo,reference,original_ref,kind,tax_amount,tax_category';

async function team(request: APIRequestContext, entity: string, teamMinor: number) {
  return (
    await directorTree(request, {
      teamEntity: entity,
      deptEntity: entity,
      teamMinor,
      deptMinor: 1_000_000,
    })
  ).team;
}

function taxedRequest(
  request: APIRequestContext,
  budgetId: string,
  netMinor: number,
  taxMinor: number,
  spendType: string,
) {
  return spendingRequest(request, 'budget-owner', budgetId, usd(netMinor), {
    spendType,
    title: `Taxed ${spendType} ${randomUUID().slice(0, 6)}`,
    tax: { amount: usd(taxMinor) },
  });
}

/** Every approval step: the owner above, then finance review when little budget is left. */
async function approveAll(request: APIRequestContext, requestId: string) {
  for (const role of ['department-head', 'finance-controller'] as const) {
    const d = await getRequest(request, role, requestId);
    if (d.myTaskId) await decideOk(request, role, d.myTaskId, { decision: 'approve' });
  }
  expect((await getRequest(request, 'budget-owner', requestId)).status).toBe('approved');
}

async function uploadTaxed(request: APIRequestContext, rows: string[]) {
  const res = await request.post('/api/actuals/imports', {
    headers: await mutate('finance-controller'),
    data: {
      source: 'erp',
      fileName: `b3-${uniq()}.csv`,
      content: [TAX_HEADER, ...rows].join('\n'),
      toleranceBps: 0,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const batch = await res.json();
  const posted = await request.post(`/api/actuals/imports/${batch.id}/post`, {
    headers: await mutate('finance-controller'),
  });
  expect(posted.status()).toBe(200);
  return posted.json();
}

test.describe('tax-aware consumption on commitments (080g)', () => {
  test('recoverable UK VAT never uses budget: exactly at available passes, one minor unit above is refused', async ({
    request,
  }) => {
    // Seeded rule: HYL-UK, training, any attendees, VAT-20, 100% recoverable.
    const t = await team(request, ENTITIES.uk, 100_000);
    const res = await taxedRequest(request, t.id, 100_000, 20_000, 'training');
    const r = await expectContract(res, 201, RequestDetail);
    expect(r.tax).toMatchObject({
      taxCode: 'VAT-20',
      recoverableShareBps: 10_000,
      net: usd(100_000),
      tax: usd(20_000),
      recoverable: usd(20_000),
      nonRecoverable: usd(0),
      usesBudget: usd(100_000),
      usesBudgetReporting: usd(100_000),
      posted: true,
    });
    const after = await buckets(request, t.id);
    expect(after.balances.budgetCurrency.preEncumbered.amountMinor).toBe(100_000);
    expect(after.balances.available.amountMinor).toBe(0);

    const t2 = await team(request, ENTITIES.uk, 100_000);
    await expectProblem(
      await taxedRequest(request, t2.id, 100_001, 20_000, 'training'),
      409,
      'INSUFFICIENT_AVAILABLE',
    );
    const untouched = await buckets(request, t2.id);
    expect(untouched.balances.budgetCurrency.preEncumbered.amountMinor).toBe(0);
  });

  test('non-recoverable India GST uses budget: net + GST exactly at available passes, one unit above is refused; approval encumbers the same', async ({
    request,
  }) => {
    // Seeded rule: HYL-IN, team lunch, employees, GST-18, 0% recoverable.
    const t = await team(request, ENTITIES.india, 100_000);
    const r = await expectContract(
      await taxedRequest(request, t.id, 84_746, 15_254, 'team_lunch'),
      201,
      RequestDetail,
    );
    expect(r.tax).toMatchObject({
      taxCode: 'GST-18',
      recoverableShareBps: 0,
      recoverable: usd(0),
      nonRecoverable: usd(15_254),
      usesBudget: usd(100_000),
    });
    expect((await buckets(request, t.id)).balances.available.amountMinor).toBe(0);

    // Approval is in net terms (the requested amount); the commitment keeps net + GST.
    await approveAll(request, r.id);
    const approved = await buckets(request, t.id);
    expect(approved.balances.budgetCurrency.preEncumbered.amountMinor).toBe(0);
    expect(approved.balances.budgetCurrency.encumbered.amountMinor).toBe(100_000);
    const detail = await getRequest(request, 'budget-owner', r.id);
    expect(detail.tax).toMatchObject({ posted: true, usesBudget: usd(100_000) });

    const t2 = await team(request, ENTITIES.india, 100_000);
    await expectProblem(
      await taxedRequest(request, t2.id, 84_746, 15_255, 'team_lunch'),
      409,
      'INSUFFICIENT_AVAILABLE',
    );
  });

  test('tax lines are append-only and the tax goes in the request currency', async ({
    request,
  }) => {
    const t = await team(request, ENTITIES.uk, 100_000);
    await expectProblem(
      await spendingRequest(request, 'budget-owner', t.id, usd(1_000), {
        spendType: 'training',
        tax: { amount: { amountMinor: 200, currency: 'GBP' } },
      }),
      422,
      'CURRENCY_MISMATCH',
    );
    const r = await expectContract(
      await taxedRequest(request, t.id, 10_000, 2_000, 'training'),
      201,
      RequestDetail,
    );
    const err = await asOwner((c) =>
      pgError(
        c.query(`update commitment_tax_lines set amount_minor = 0 where commitment_id = $1`, [
          r.commitmentId,
        ]),
      ),
    );
    expect(err?.message).toContain('append-only');
  });
});

test.describe('tax-aware consumption on actuals (080g)', () => {
  test('an actual uses its gross less recoverable VAT: exactly the commitment matches, one minor unit more waits in the queue', async ({
    request,
  }) => {
    const t = await team(request, ENTITIES.uk, 200_000);
    const r = await expectContract(
      await taxedRequest(request, t.id, 100_000, 20_000, 'training'),
      201,
      RequestDetail,
    );
    await approveAll(request, r.id);
    const ref = `CMT-${r.commitmentId!.slice(-8).toUpperCase()}`;
    const p = `TX${uniq()}`;
    await uploadTaxed(request, [
      `${p}-1,2026-11-03,1200.00,USD,HYL-UK,,,,,Training course,${ref},,charge,200.00,training`,
    ]);
    const line = await actualByRef(request, `${p}-1`);
    expect(line.tax).toMatchObject({
      gross: usd(120_000),
      recoverable: usd(20_000),
      nonRecoverable: usd(0),
      usesBudget: usd(100_000),
    });
    expect(line.actual.status).toBe('matched');
    const b = await buckets(request, t.id);
    expect(b.balances.budgetCurrency.actual.amountMinor).toBe(100_000);
    expect(b.balances.budgetCurrency.encumbered.amountMinor).toBe(0);

    // One minor unit more than the commitment (1200.01 gross, 200.00 recoverable) with no tolerance.
    const t2 = await team(request, ENTITIES.uk, 200_000);
    const r2 = await expectContract(
      await taxedRequest(request, t2.id, 100_000, 20_000, 'training'),
      201,
      RequestDetail,
    );
    await approveAll(request, r2.id);
    const ref2 = `CMT-${r2.commitmentId!.slice(-8).toUpperCase()}`;
    await uploadTaxed(request, [
      `${p}-2,2026-11-03,1200.01,USD,HYL-UK,,,,,Training course,${ref2},,charge,200.00,training`,
    ]);
    const over = await actualByRef(request, `${p}-2`);
    expect(over.tax?.usesBudget).toEqual(usd(100_001));
    expect(over.actual.status).toBe('unmatched');
    expect(over.candidates.find((c) => c.commitmentId === r2.commitmentId)).toMatchObject({
      differenceMinor: 1,
    });
    const b2 = await buckets(request, t2.id);
    expect(b2.balances.budgetCurrency.actual.amountMinor).toBe(0);
    expect(b2.balances.budgetCurrency.encumbered.amountMinor).toBe(100_000);
  });

  test('non-recoverable GST on an India actual uses budget, and a full reversal negates the line exactly', async ({
    request,
  }) => {
    const t = await team(request, ENTITIES.india, 200_000);
    const r = await expectContract(
      await taxedRequest(request, t.id, 84_746, 15_254, 'team_lunch'),
      201,
      RequestDetail,
    );
    await approveAll(request, r.id);
    const ref = `CMT-${r.commitmentId!.slice(-8).toUpperCase()}`;
    const p = `TI${uniq()}`;
    await uploadTaxed(request, [
      `${p}-1,2026-11-03,1000.00,USD,HYL-IN,,,,,Team lunch,${ref},,charge,152.54,team_lunch`,
    ]);
    const line = await actualByRef(request, `${p}-1`);
    expect(line.tax).toMatchObject({
      gross: usd(100_000),
      recoverable: usd(0),
      nonRecoverable: usd(15_254),
      usesBudget: usd(100_000),
    });
    expect(line.actual.status).toBe('matched');
    expect((await buckets(request, t.id)).balances.budgetCurrency.actual.amountMinor).toBe(100_000);

    // A UK VAT line reversed without a tax column takes the original's split, so it negates exactly.
    const uk = await team(request, ENTITIES.uk, 200_000);
    const r2 = await expectContract(
      await taxedRequest(request, uk.id, 100_000, 20_000, 'training'),
      201,
      RequestDetail,
    );
    await approveAll(request, r2.id);
    const ref2 = `CMT-${r2.commitmentId!.slice(-8).toUpperCase()}`;
    await uploadTaxed(request, [
      `${p}-2,2026-11-03,1200.00,USD,HYL-UK,,,,,Training course,${ref2},,charge,200.00,training`,
    ]);
    await uploadTaxed(request, [
      `${p}-3,2026-11-04,-1200.00,USD,HYL-UK,,,,,Reversal,,${p}-2,reversal,,`,
    ]);
    const rev = await actualByRef(request, `${p}-3`);
    expect(rev.tax).toMatchObject({
      gross: usd(-120_000),
      recoverable: usd(-20_000),
      usesBudget: usd(-100_000),
    });
    const net = await buckets(request, uk.id);
    expect(net.balances.budgetCurrency.actual.amountMinor).toBe(0);
  });

  test('the ledger rebuild still equals cached balances and every journal balances after taxed postings', async ({
    request,
  }) => {
    const run = await runLedgerCheck(request);
    expect(run.status).toBe('clean');
  });
});

test.describe('tax rules: versions, the tax approver and the calculator (080g)', () => {
  test('the calculator splits mixed attendance in proportion to employees present', async ({
    request,
  }) => {
    const q = new URLSearchParams({
      legalEntityId: ENTITIES.uk,
      categoryCode: 'employee_events',
      employees: '8',
      others: '2',
      amountMinor: '60000',
      taxMinor: '12000',
      currency: 'GBP',
    });
    const b = await expectContract(
      await request.get(`/api/finance/tax-rules/preview?${q}`, {
        headers: await as('finance-admin'),
      }),
      200,
      TaxBreakdown,
    );
    expect(b).toMatchObject({
      attendeeType: 'mixed',
      recoverableShareBps: 8_000,
      recoverable: { amountMinor: 9_600, currency: 'GBP' },
      nonRecoverable: { amountMinor: 2_400, currency: 'GBP' },
      usesBudget: { amountMinor: 62_400, currency: 'GBP' },
      posted: false,
    });
    // Reporting view at the locked FY2026 plan rate, never folded into the GBP amounts.
    expect(b.usesBudgetReporting.currency).toBe('USD');
  });

  test('finance drafts, the tax approver returns or publishes; published versions never change', async ({
    request,
  }) => {
    const view = await expectContract(
      await request.get('/api/finance/tax-rules', { headers: await as('finance-admin') }),
      200,
      TaxRulesView,
    );
    expect(view.current?.status).toBe('published');
    expect(view.canEdit).toBe(true);
    expect(view.canPublish).toBe(false);
    const draft = await expectContract(
      await request.post('/api/finance/tax-rules/drafts', {
        headers: await mutate('finance-admin'),
        data: {},
      }),
      201,
      TaxRuleSetView,
    );
    expect(draft.rules.length).toBe(view.current!.rules.length);
    const rules = draft.rules.map((r) => ({
      legalEntityId: r.legalEntityId,
      categoryCode: r.categoryCode,
      attendeeType: r.attendeeType,
      taxCode: r.taxCode,
      recoverableBps: r.recoverableBps,
      proportional: r.proportional,
    }));
    const put = async (body: unknown) =>
      request.put(`/api/finance/tax-rules/drafts/${draft.id}`, {
        headers: await mutate('finance-admin'),
        data: body,
      });
    const dup = await expectProblem(
      await put({ rules: [...rules, rules[0]] }),
      422,
      'VALIDATION_FAILED',
    );
    expect(dup.detail).toMatch(/^Two rules cover HYL-[A-Z]{2}, /);
    const bad = await expectProblem(
      await put({ rules: [{ ...rules[0], recoverableBps: 10_001, proportional: false }] }),
      422,
      'VALIDATION_FAILED',
    );
    expect(bad.detail).toBe('Recoverable share must be 0-100%.');
    const usIdx = rules.findIndex((r) => r.legalEntityId === ENTITIES.us);
    const changed = rules.map((r, i) => (i === usIdx ? { ...r, recoverableBps: 5_000 } : r));
    const saved = await put({ rules: changed });
    expect(saved.status()).toBe(200);
    expect(
      (await saved.json()).rules.find(
        (r: { legalEntityId: string }) => r.legalEntityId === ENTITIES.us,
      ).changeMarker,
    ).toBe('changed');

    const submit = await request.post(`/api/finance/tax-rules/drafts/${draft.id}/submit`, {
      headers: await mutate('finance-admin'),
      data: {},
    });
    expect(submit.status()).toBe(200);
    expect((await submit.json()).status).toBe('pending_approval');
    await expectProblem(await put({ rules: changed }), 409, 'INVALID_TRANSITION');
    // Finance cannot publish; the tax approver (Finance Controller) can.
    await expectProblem(
      await request.post(`/api/finance/tax-rules/drafts/${draft.id}/publish`, {
        headers: await mutate('finance-admin'),
        data: { effectiveFrom: '2027-01-01' },
      }),
      403,
      'FORBIDDEN',
    );
    const returned = await request.post(`/api/finance/tax-rules/drafts/${draft.id}/return`, {
      headers: await mutate('finance-controller'),
      data: { comment: 'Keep US sales tax non-recoverable.' },
    });
    expect((await returned.json()).status).toBe('returned');
    expect((await put({ rules })).status()).toBe(200);
    await request.post(`/api/finance/tax-rules/drafts/${draft.id}/submit`, {
      headers: await mutate('finance-admin'),
      data: {},
    });
    await expectProblem(
      await request.post(`/api/finance/tax-rules/drafts/${draft.id}/publish`, {
        headers: await mutate('finance-controller'),
        data: { effectiveFrom: '2026-01-01' },
      }),
      422,
      'VALIDATION_FAILED',
    );
    const published = await request.post(`/api/finance/tax-rules/drafts/${draft.id}/publish`, {
      headers: await mutate('finance-controller'),
      data: { effectiveFrom: '2027-01-01' },
    });
    expect(published.status()).toBe(200);
    const after = await expectContract(
      await request.get('/api/finance/tax-rules', { headers: await as('finance-controller') }),
      200,
      TaxRulesView,
    );
    // The new version starts later; the version in force today is unchanged.
    expect(after.current?.version).toBe(view.current!.version);
    expect(after.upcoming).toMatchObject({ id: draft.id, effectiveFrom: '2027-01-01' });
    expect(after.draft).toBeNull();

    // The database refuses to change a published version or its rules.
    const e1 = await asOwner((c) =>
      pgError(
        c.query(`update tax_rule_sets set effective_from = '2026-02-01' where id = $1`, [draft.id]),
      ),
    );
    expect(e1?.message).toContain('cannot change');
    const e2 = await asOwner((c) =>
      pgError(
        c.query(`update tax_rules set recoverable_bps = 0 where rule_set_id = $1`, [draft.id]),
      ),
    );
    expect(e2?.message).toContain('cannot change');
  });
});

test.describe('role scope (080g)', () => {
  test('only finance, the tax approver and auditors read tax rules; RLS hides another tenant’s', async ({
    request,
  }) => {
    for (const role of ['finance-admin', 'finance-controller', 'auditor'] as const)
      expect(
        (await request.get('/api/finance/tax-rules', { headers: await as(role) })).status(),
      ).toBe(200);
    for (const role of ['employee', 'budget-owner', 'ceo'] as const)
      await expectProblem(
        await request.get('/api/finance/tax-rules', { headers: await as(role) }),
        403,
        'FORBIDDEN',
      );
    await expectProblem(
      await request.post('/api/finance/tax-rules/drafts', {
        headers: await mutate('auditor'),
        data: {},
      }),
      403,
      'FORBIDDEN',
    );
    const n = await asAppRole(TENANTS.globex, (c) =>
      c.query(`select count(*)::int as n from tax_rules`),
    );
    expect(n.rows[0].n).toBe(0);
  });
});

test.describe('tax on changed requests and imported files (080g)', () => {
  async function changesRequested(request: APIRequestContext, counterMinor?: number) {
    const t = await team(request, ENTITIES.india, 1_000_000);
    const r = await expectContract(
      await taxedRequest(request, t.id, 100_000, 18_000, 'team_lunch'),
      201,
      RequestDetail,
    );
    const d = await getRequest(request, 'department-head', r.id);
    expect(
      (
        await request.post(`/api/approvals/tasks/${d.myTaskId}/decision`, {
          headers: await mutate('department-head'),
          data: {
            decision: 'request_changes',
            noConflictAttested: true,
            comment: 'Halve it',
            ...(counterMinor ? { counterOfferAmount: usd(counterMinor) } : {}),
          },
        })
      ).status(),
    ).toBe(200);
    return { t, r };
  }

  test('an accepted counter-offer commits the offered net plus its share of the GST, once', async ({
    request,
  }) => {
    const { t, r } = await changesRequested(request, 50_000);
    const accepted = await expectContract(
      await request.post(`/api/requests/${r.id}/accept-offer`, {
        headers: await mutate('budget-owner'),
        data: {},
      }),
      200,
      RequestDetail,
    );
    // GST-18 at 0% recoverable: 50,000 net + 9,000 GST.
    expect(accepted.tax).toMatchObject({
      net: usd(50_000),
      nonRecoverable: usd(9_000),
      usesBudget: usd(59_000),
    });
    const b = await buckets(request, t.id);
    expect(b.balances.budgetCurrency.encumbered.amountMinor).toBe(59_000);
    expect(b.balances.budgetCurrency.preEncumbered.amountMinor).toBe(0);
  });

  test('a resubmitted amount scales its tax unless a new tax is given', async ({ request }) => {
    const { t, r } = await changesRequested(request);
    const res = await expectContract(
      await request.post(`/api/requests/${r.id}/resubmit`, {
        headers: await mutate('budget-owner'),
        data: { amount: usd(50_000) },
      }),
      200,
      RequestDetail,
    );
    expect(res.tax).toMatchObject({ net: usd(50_000), tax: usd(9_000), usesBudget: usd(59_000) });
    expect((await buckets(request, t.id)).balances.budgetCurrency.preEncumbered.amountMinor).toBe(
      59_000,
    );
  });

  test('a reversal listed before its original in the same file takes the original’s split', async ({
    request,
  }) => {
    const p = `TR${uniq()}`;
    await uploadTaxed(request, [
      `${p}-2,2026-11-04,-1200.00,USD,HYL-UK,,,,,Reversal,,${p}-1,reversal,,`,
      `${p}-1,2026-11-03,1200.00,USD,HYL-UK,,,,,Training course,,,charge,200.00,training`,
    ]);
    const orig = await actualByRef(request, `${p}-1`);
    const rev = await actualByRef(request, `${p}-2`);
    expect(orig.tax?.usesBudget).toEqual(usd(100_000));
    expect(rev.tax).toMatchObject({ recoverable: usd(-20_000), usesBudget: usd(-100_000) });
  });

  test('the same expense from a feed with a tax column and one without is flagged as a duplicate', async ({
    request,
  }) => {
    const p = `TD${uniq()}`;
    await uploadTaxed(request, [
      `${p}-1,2026-11-03,1200.00,USD,HYL-UK,,,,Training ${p},Training course,,,charge,200.00,training`,
    ]);
    const res = await request.post('/api/actuals/imports', {
      headers: await mutate('finance-controller'),
      data: {
        source: 'card',
        fileName: `b3-card-${uniq()}.csv`,
        content: [
          'source_ref,transaction_date,amount,currency,legal_entity,merchant',
          `${p}-C,2026-11-03,1200.00,USD,HYL-UK,Training ${p}`,
        ].join('\n'),
      },
    });
    expect(res.status()).toBe(201);
    const card = await actualByRef(request, `${p}-C`);
    expect(card.actual.duplicateOfActualId).toBeTruthy();
  });

  test('unknown attendance never recovers tax under a rule that depends on who attended', async ({
    request,
  }) => {
    const q = new URLSearchParams({
      legalEntityId: ENTITIES.uk,
      categoryCode: 'employee_events',
      employees: '0',
      others: '0',
      amountMinor: '60000',
      taxMinor: '12000',
      currency: 'GBP',
    });
    const b = await expectContract(
      await request.get(`/api/finance/tax-rules/preview?${q}`, {
        headers: await as('finance-admin'),
      }),
      200,
      TaxBreakdown,
    );
    expect(b).toMatchObject({
      attendeeType: 'any',
      recoverableShareBps: 0,
      usesBudget: { amountMinor: 72_000 },
    });
  });

  test('the route preview prices net plus non-recoverable tax, as submission does', async ({
    request,
  }) => {
    const t = await team(request, ENTITIES.india, 100_000);
    const q = new URLSearchParams({
      budgetId: t.id,
      amountMinor: '84746',
      currency: 'USD',
      spendType: 'team_lunch',
      taxMinor: '15254',
    });
    const res = await request.get(`/api/requests/route-preview?${q}`, {
      headers: await as('budget-owner'),
    });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(200);
    expect(body.impact.availableAfter.amountMinor).toBe(0);
  });
});
