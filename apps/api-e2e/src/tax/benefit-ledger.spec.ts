// Gap B3 (080h), invariants 105 and 106: the employee benefit ledger records each person's share of
// benefits per tax year, never moves budget money, is append-only (reversals are negating entries),
// and flags benefit-in-kind thresholds: exactly at the limit is Approaching, one minor unit above is
// Over with the reportable amount the threshold defines. Seeded thresholds and entries are fictional.
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  BenefitEntry,
  BenefitLedgerView,
  BenefitPersonView,
  BenefitThresholdList,
  BenefitThresholdView,
  EventAttendanceView,
  EventCommitment,
} from '@bf/contracts';
import { seedId, TENANTS, userById } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asAppRole, asOwner, pgError } from '../support/db';
import {
  approvedEvent,
  auditFor,
  directorTree,
  ENTITIES,
  runLedgerCheck,
  usd,
} from '../support/p5';
import { buckets, importAndPost, csv, uniq } from '../actuals/support';

const P = (n: number) => seedId('40000000', 100 + n);
const PEOPLE = {
  ameliaUk: P(50),
  oliverUk: P(51),
  graceUk: P(52),
  kavyaIn: P(16),
  masonUs: P(27),
  jonasDe: P(41),
};
const UK_RULE = 'UK annual staff functions';
const CAP_RULE = 'Per-employee annual cap (FY2026)';
const DE_RULE = 'Germany company events';

const gbp = (amountMinor: number) => ({ amountMinor, currency: 'GBP' });
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' });

async function ledger(request: APIRequestContext, query = '') {
  return expectContract(
    await request.get(`/api/finance/benefits/ledger${query}`, {
      headers: await as('finance-admin'),
    }),
    200,
    BenefitLedgerView,
  );
}

async function person(request: APIRequestContext, id: string) {
  return expectContract(
    await request.get(`/api/finance/benefits/people/${id}`, {
      headers: await as('finance-controller'),
    }),
    200,
    BenefitPersonView,
  );
}

const row = (v: { items: BenefitLedgerView['items'] }, personId: string, rule: string) =>
  v.items.find((r) => r.personId === personId && r.thresholdName === rule);

async function record(
  request: APIRequestContext,
  body: {
    personId: string;
    entryDate: string;
    amount: { amountMinor: number; currency: string };
    benefitType?: string;
  },
) {
  return expectContract(
    await request.post('/api/finance/benefits/entries', {
      headers: await mutate('finance-admin'),
      data: { benefitType: 'employee_events', description: 'Scenario benefit', ...body },
    }),
    201,
    BenefitEntry,
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('benefit ledger per employee and tax year (080h)', () => {
  test('seeded thresholds evaluate per person in their own tax year, with status and reportable amount', async ({
    request,
  }) => {
    const v = await ledger(request);
    expect(v.asOf).toBe('2026-11-16');
    expect(row(v, PEOPLE.ameliaUk, UK_RULE)).toMatchObject({
      window: { fromDate: '2026-04-06', toDate: '2027-04-05' },
      counted: gbp(14_250),
      limit: gbp(15_000),
      status: 'approaching',
      reportable: gbp(0),
    });
    expect(row(v, PEOPLE.oliverUk, UK_RULE)).toMatchObject({
      counted: gbp(16_800),
      status: 'over',
      exceeded: 'whole',
      reportable: gbp(16_800),
    });
    // The company cap counts in USD at the locked plan rate and is never reportable.
    expect(row(v, PEOPLE.kavyaIn, CAP_RULE)).toMatchObject({ status: 'under', reportable: null });
    expect(row(v, PEOPLE.kavyaIn, CAP_RULE)!.counted.currency).toBe('USD');
    expect(row(v, PEOPLE.masonUs, CAP_RULE)).toMatchObject({
      counted: usd(28_800),
      status: 'approaching',
      reportable: null,
    });
    expect(v.templates.map((t) => t.name)).toContain(DE_RULE);
    const over = await ledger(request, '?status=over');
    expect(over.items.every((r) => r.status === 'over')).toBe(true);
  });

  test('exactly at the UK limit is Approaching; one minor unit above makes the whole amount reportable; a reversal takes it back', async ({
    request,
  }) => {
    // GBP 150.00 exactly, plus an entry in the previous UK tax year that must not count.
    const old = await record(request, {
      personId: PEOPLE.graceUk,
      entryDate: '2026-04-05',
      amount: gbp(9_000),
    });
    const at = await record(request, {
      personId: PEOPLE.graceUk,
      entryDate: '2026-11-02',
      amount: gbp(15_000),
    });
    expect(at.countedToward).toEqual([UK_RULE]);
    expect(at.reporting.currency).toBe('USD');
    let v = await ledger(request);
    expect(row(v, PEOPLE.graceUk, UK_RULE)).toMatchObject({
      counted: gbp(15_000),
      status: 'approaching',
      reportable: gbp(0),
    });

    const plusOne = await record(request, {
      personId: PEOPLE.graceUk,
      entryDate: '2026-11-03',
      amount: gbp(1),
    });
    v = await ledger(request);
    expect(row(v, PEOPLE.graceUk, UK_RULE)).toMatchObject({
      counted: gbp(15_001),
      status: 'over',
      reportable: gbp(15_001),
    });

    const reversal = await expectContract(
      await request.post(`/api/finance/benefits/entries/${plusOne.id}/reverse`, {
        headers: await mutate('finance-admin'),
        data: { reason: 'Recorded twice' },
      }),
      201,
      BenefitEntry,
    );
    expect(reversal).toMatchObject({ reversalOfId: plusOne.id, amount: gbp(-1) });
    await expectProblem(
      await request.post(`/api/finance/benefits/entries/${plusOne.id}/reverse`, {
        headers: await mutate('finance-admin'),
        data: { reason: 'Again' },
      }),
      409,
      'ALREADY_REVERSED',
    );
    v = await ledger(request);
    expect(row(v, PEOPLE.graceUk, UK_RULE)).toMatchObject({
      counted: gbp(15_000),
      status: 'approaching',
    });

    // The person's ledger: every entry (the old year's too), its reversal link, totals per rule.
    const p = await person(request, PEOPLE.graceUk);
    expect(p.entries.map((e) => e.id)).toEqual(
      expect.arrayContaining([old.id, at.id, plusOne.id, reversal.id]),
    );
    expect(p.entries.find((e) => e.id === plusOne.id)?.reversedById).toBe(reversal.id);
    expect(p.totals.find((t) => t.thresholdName === UK_RULE)?.counted).toEqual(gbp(15_000));
    // Next UK tax year (from 6 April 2027) starts again at zero.
    const next = await expectContract(
      await request.get(`/api/finance/benefits/people/${PEOPLE.graceUk}?asOf=2027-05-01`, {
        headers: await as('finance-admin'),
      }),
      200,
      BenefitPersonView,
    );
    expect(next.totals.find((t) => t.thresholdName === UK_RULE)).toBeUndefined();

    // Append-only in the database; one audit event per entry, none for a refused command.
    const err = await asOwner((c) =>
      pgError(
        c.query(`update employee_benefit_ledger set amount_minor = 0 where id = $1`, [at.id]),
      ),
    );
    expect(err?.message).toContain('append-only');
    expect((await auditFor(request, at.id)).map((e: { action: string }) => e.action)).toEqual([
      'benefit.recorded',
    ]);
    await expectProblem(
      await request.post('/api/finance/benefits/entries', {
        headers: await mutate('finance-admin'),
        data: {
          personId: PEOPLE.graceUk,
          entryDate: '2026-11-02',
          benefitType: 'employee_events',
          amount: gbp(0),
          description: 'Nothing',
        },
      }),
      422,
      'VALIDATION_FAILED',
    );
  });

  test('a per-event allowance published for Germany reports the excess per event and occasions beyond the limit', async ({
    request,
  }) => {
    const list = await expectContract(
      await request.get('/api/finance/benefits/thresholds', { headers: await as('finance-admin') }),
      200,
      BenefitThresholdList,
    );
    const de = list.items.find((t) => t.code === 'DE-COMPANY-EVENTS')!;
    expect(de).toMatchObject({
      template: true,
      status: 'published',
      basis: 'per_event',
      maxOccasions: 2,
    });
    const draft = await expectContract(
      await request.post('/api/finance/benefits/thresholds', {
        headers: await mutate('finance-admin'),
        data: {
          code: de.code,
          name: de.name,
          jurisdiction: de.jurisdiction,
          legalEntityIds: [ENTITIES.germany],
          benefitTypes: de.benefitTypes,
          limit: de.limit,
          basis: de.basis,
          maxOccasions: de.maxOccasions,
          periodStartMonth: de.periodStartMonth,
          periodStartDay: de.periodStartDay,
          exceeded: de.exceeded,
        },
      }),
      201,
      BenefitThresholdView,
    );
    expect(draft).toMatchObject({ version: 2, status: 'draft', legalEntityCodes: ['HYL-DE'] });
    const step = (as_: 'finance-admin' | 'finance-controller', verb: string, data: object = {}) =>
      mutate(as_).then((headers) =>
        request.post(`/api/finance/benefits/thresholds/${draft.id}/${verb}`, { headers, data }),
      );
    expect((await step('finance-admin', 'submit')).status()).toBe(200);
    await expectProblem(
      await step('finance-admin', 'publish', { effectiveFrom: '2026-11-16' }),
      403,
      'FORBIDDEN',
    );
    const pub = await expectContract(
      await step('finance-controller', 'publish', { effectiveFrom: '2026-11-16' }),
      200,
      BenefitThresholdView,
    );
    expect(pub.status).toBe('published');
    const e1 = await asOwner((c) =>
      pgError(c.query(`update benefit_thresholds set limit_minor = 1 where id = $1`, [draft.id])),
    );
    expect(e1?.message).toContain('cannot change');

    // Two events within the allowance, then one above it (excess 10.00), then a third... fourth occasion.
    await record(request, {
      personId: PEOPLE.jonasDe,
      entryDate: '2026-03-10',
      amount: eur(11_000),
    });
    let v = await ledger(request);
    expect(row(v, PEOPLE.jonasDe, DE_RULE)).toMatchObject({
      status: 'approaching',
      reportable: eur(0),
      occasions: 1,
    });
    await record(request, {
      personId: PEOPLE.jonasDe,
      entryDate: '2026-06-10',
      amount: eur(12_000),
    });
    v = await ledger(request);
    expect(row(v, PEOPLE.jonasDe, DE_RULE)).toMatchObject({
      status: 'over',
      reportable: eur(1_000),
      occasions: 2,
    });
    await record(request, {
      personId: PEOPLE.jonasDe,
      entryDate: '2026-09-10',
      amount: eur(5_000),
    });
    v = await ledger(request);
    expect(row(v, PEOPLE.jonasDe, DE_RULE)).toMatchObject({ reportable: eur(6_000), occasions: 3 });
    expect(v.templates.map((t) => t.name)).not.toContain(DE_RULE);
  });

  test('closing an event records each attended employee’s final cost per attendee, and the ledger still balances', async ({
    request,
  }) => {
    const employee = userById('employee').personId!;
    const analyst = userById('analyst').personId!;
    const { team } = await directorTree(request, { teamMinor: 6_000_000 });
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(100_000),
      ownFunds: usd(60_000),
      participantPersonIds: [employee, analyst],
    });
    const c = await expectContract(
      await request.post(`/api/events/${event.id}/commitments`, {
        headers: await mutate('budget-owner'),
        data: { description: 'Team dinner', amount: usd(50_000) },
      }),
      201,
      EventCommitment,
    );
    for (const verb of ['confirm-funding', 'start'])
      await request.post(`/api/events/${event.id}/${verb}`, {
        headers: await mutate('budget-owner'),
        data: {},
      });
    const att = await expectContract(
      await request.get(`/api/events/${event.id}/attendance`, {
        headers: await as('budget-owner'),
      }),
      200,
      EventAttendanceView,
    );
    const marks = att.participants.map((p) => ({ participantId: p.id, status: 'attended' }));
    expect(
      (
        await request.post(`/api/events/${event.id}/attendance`, {
          headers: await mutate('budget-owner'),
          data: { marks, finalize: true },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.post(`/api/events/${event.id}/complete`, {
          headers: await mutate('budget-owner'),
          data: {},
        })
      ).status(),
    ).toBe(200);
    const before = await buckets(request, team.id);
    const ref = `CMT-${c.id.slice(-8).toUpperCase()}`;
    const p = `EV${uniq()}`;
    await importAndPost(
      request,
      csv([`${p}-1,2026-11-03,500.00,USD,HYL-US,,,${event.eventCode},,Team dinner,${ref},,charge`]),
    );
    const closed = await request.post(`/api/events/${event.id}/close`, {
      headers: await mutate('budget-owner'),
      data: { reason: 'Reconciled' },
    });
    expect(closed.status(), await closed.text()).toBe(200);
    const after = await buckets(request, team.id);

    for (const id of [employee, analyst]) {
      const pv = await person(request, id);
      const e = pv.entries.find((x) => x.source.type === 'event' && x.source.id === event.id);
      expect(e, `benefit entry for ${id}`).toMatchObject({
        amount: usd(25_000),
        benefitType: 'employee_events',
      });
    }
    // The benefit ledger moved no budget money: only the actual and surplus return did.
    expect(
      after.balances.budgetCurrency.actual.amountMinor -
        before.balances.budgetCurrency.actual.amountMinor,
    ).toBe(50_000);
    const audit = await auditFor(request, event.id);
    const closeEvent = audit.find((a: { action: string }) => a.action === 'event.closed');
    expect(closeEvent?.changes.benefitEntryIds.to).toHaveLength(2);
    expect((await runLedgerCheck(request)).status).toBe('clean');
  });
});

test.describe('role scope (080h)', () => {
  test('individual benefits are visible to finance and auditors only; only finance records; RLS holds', async ({
    request,
  }) => {
    for (const role of ['finance-admin', 'finance-controller', 'auditor'] as const)
      expect(
        (await request.get('/api/finance/benefits/ledger', { headers: await as(role) })).status(),
      ).toBe(200);
    for (const role of ['employee', 'budget-owner', 'department-head', 'ceo', 'analyst'] as const) {
      await expectProblem(
        await request.get('/api/finance/benefits/ledger', { headers: await as(role) }),
        403,
        'FORBIDDEN',
      );
      await expectProblem(
        await request.get(`/api/finance/benefits/people/${PEOPLE.ameliaUk}`, {
          headers: await as(role),
        }),
        403,
        'FORBIDDEN',
      );
    }
    await expectProblem(
      await request.post('/api/finance/benefits/entries', {
        headers: await mutate('auditor'),
        data: {
          personId: PEOPLE.ameliaUk,
          entryDate: '2026-11-02',
          benefitType: 'employee_events',
          amount: gbp(100),
          description: 'Not allowed',
        },
      }),
      403,
      'FORBIDDEN',
    );
    // Forged tenant header: finance of Hyland asking as another tenant is refused.
    const forged = await request.get('/api/finance/benefits/ledger', {
      headers: await as('finance-admin', {}, TENANTS.globex),
    });
    expect([403, 404]).toContain(forged.status());
    const n = await asAppRole(TENANTS.globex, (c) =>
      c.query(`select count(*)::int as n from employee_benefit_ledger`),
    );
    expect(n.rows[0].n).toBe(0);
  });
});
