// Scenario data for the Phase 11 close and year-end checks, created through the API so every
// scenario owns what it closes. Period status changes run on a fiscal calendar the scenario creates
// in the Initech Sandbox tenant, so closing and locking never blocks another scenario's postings.
import { expect, type APIRequestContext } from '@playwright/test';
import {
  BudgetDetail,
  ClosePeriodDetail,
  FiscalCalendarDetail,
  LegalEntity,
  PlanVersionDetail,
  YearEndRun,
  type CloseCheckCode,
} from '@bf/contracts';
import { SEED, userById, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';

export const uniq = () => randomUUID().slice(0, 8).toUpperCase();

export const SANDBOX = SEED.tenants.sandbox;

/** A calendar-year fiscal calendar nobody else uses, with its own legal entity on it. */
export async function sandboxCalendar(
  request: APIRequestContext,
  opts: { years: number[]; withEntity?: boolean } = { years: [2026] },
) {
  const suffix = uniq();
  const calendar = await expectContract(
    await request.post('/api/finance/fiscal-calendars', {
      headers: await mutate('sandbox-admin'),
      data: {
        name: `Close scenario ${suffix}`,
        definition: { type: 'calendar_year', labelBy: 'end' },
        years: opts.years,
      },
    }),
    201,
    FiscalCalendarDetail,
  );
  let entity: typeof LegalEntity._output | null = null;
  if (opts.withEntity !== false) {
    entity = await expectContract(
      await request.post('/api/finance/legal-entities', {
        headers: await mutate('sandbox-admin'),
        data: {
          code: `CS-${suffix}`,
          name: `Close scenario entity ${suffix}`,
          country: 'US',
          functionalCurrency: 'USD',
          fiscalCalendarId: calendar.id,
        },
      }),
      201,
      LegalEntity,
    );
  }
  return { calendar, entity, suffix };
}

export async function closeDetail(
  request: APIRequestContext,
  periodId: string,
  user: SeedUserId = 'sandbox-admin',
) {
  return expectContract(
    await request.get(`/api/close/periods/${periodId}`, { headers: await as(user) }),
    200,
    ClosePeriodDetail,
  );
}

export function check(detail: typeof ClosePeriodDetail._output, code: CloseCheckCode) {
  const found = detail.entities.flatMap((e) => e.checks).find((c) => c.code === code);
  expect(found, `check ${code} is on the checklist`).toBeDefined();
  return found!;
}

/** Signs off the GL tie-out for an entity and period: one person prepares, a different one signs. */
export async function signOffTieOut(
  request: APIRequestContext,
  input: { month: string; legalEntityId: string },
) {
  const created = await request.post('/api/actuals/tie-outs', {
    headers: await mutate('sandbox-controller'),
    data: {
      legalEntityId: input.legalEntityId,
      month: input.month,
      toleranceMinor: 0,
      fileName: `gl-balances-${input.month}.csv`,
      // A scenario calendar has no postings, so an empty general ledger ties out exactly.
      content: 'cost_center,gl_account,amount,currency',
    },
  });
  // Re-closing a reopened period reuses the tie-out that is already signed off for that month.
  if (created.status() === 409) {
    expect((await created.json()).code).toBe('TIEOUT_SIGNED_OFF');
    return null;
  }
  expect(created.status(), await created.text()).toBe(201);
  const run = (await created.json()) as { id: string };
  const signed = await request.post(`/api/actuals/tie-outs/${run.id}/sign-off`, {
    headers: await mutate('sandbox-admin'),
    data: { comment: 'Close scenario: nothing posted in this period.' },
  });
  expect(signed.status(), await signed.text()).toBe(200);
  return run.id;
}

/** Runs the nightly ledger rebuild check and waits for its verdict. */
export async function ledgerCheck(request: APIRequestContext, user: SeedUserId) {
  const queued = await request.post('/api/integrity/ledger-checks', {
    headers: await mutate(user),
  });
  expect(queued.status(), await queued.text()).toBe(202);
  const { id } = (await queued.json()) as { id: string };
  let run: { status: string; summary?: unknown; flagsRaised: number } = {
    status: 'queued',
    flagsRaised: 0,
  };
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/integrity/ledger-checks/${id}`, {
          headers: await as(user),
        });
        run = (await res.json()) as typeof run;
        return run.status;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toMatch(/^(clean|drift_detected|failed)$/);
  return run;
}

/** A Hyland root in a chosen fiscal year, created through an additive, signed-off plan revision. */
export async function rootInYear(
  request: APIRequestContext,
  opts: { fiscalYearId: string; amountMinor: number; code: string; name: string },
) {
  const revision = await expectContract(
    await request.post('/api/plan-versions', {
      headers: await mutate('finance-admin'),
      data: {
        fiscalYearId: opts.fiscalYearId,
        kind: 'current',
        label: `Year end ${opts.code}`,
        lines: [
          {
            code: opts.code,
            name: opts.name,
            amountMinor: opts.amountMinor,
            legalEntityId: SEED.legalEntities.acmeUs,
          },
        ],
      },
    }),
    201,
    PlanVersionDetail,
  );
  // New money needs a second Finance Admin and the CEO; a revision that already has what it needs
  // answers PLAN_VERSION_NOT_EDITABLE, which is the signal to stop asking.
  for (const user of ['finance-admin-2', 'ceo'] as const) {
    const res = await request.post(`/api/plan-versions/${revision.id}/approve`, {
      headers: await mutate(user),
    });
    if (res.status() === 409) {
      expect((await res.json()).code).toBe('PLAN_VERSION_NOT_EDITABLE');
      break;
    }
    expect(res.status(), await res.text()).toBe(200);
  }
  const budget = await expectContract(
    await request.post('/api/budgets', {
      headers: await mutate('ceo'),
      data: {
        name: opts.name,
        code: opts.code,
        legalEntityId: SEED.legalEntities.acmeUs,
        currency: 'USD',
        fiscalYearId: opts.fiscalYearId,
        planVersionId: revision.id,
        originalAmount: { amountMinor: opts.amountMinor, currency: 'USD' },
        ownerPersonId: userById('finance-admin').personId,
      },
    }),
    201,
    BudgetDetail,
  );
  return { budget, planVersionId: revision.id };
}

export async function childInYear(
  request: APIRequestContext,
  parentId: string,
  opts: {
    fiscalYearId: string;
    code: string;
    name: string;
    owner?: SeedUserId;
    costCenterId?: string;
  },
) {
  return expectContract(
    await request.post('/api/budgets', {
      headers: await mutate('finance-admin'),
      data: {
        name: opts.name,
        code: opts.code,
        parentId,
        legalEntityId: SEED.legalEntities.acmeUs,
        currency: 'USD',
        fiscalYearId: opts.fiscalYearId,
        ownerPersonId: userById(opts.owner ?? 'finance-admin').personId,
        ...(opts.costCenterId ? { costCenterId: opts.costCenterId } : {}),
      },
    }),
    201,
    BudgetDetail,
  );
}

export async function setRolloverPolicy(
  request: APIRequestContext,
  budgetId: string,
  rolloverPolicyId: string,
) {
  const res = await request.put(`/api/close/budgets/${budgetId}/rollover-policy`, {
    headers: await mutate('finance-admin'),
    data: { rolloverPolicyId, reason: 'Year-end scenario' },
  });
  expect(res.status(), await res.text()).toBe(200);
}

export async function policyIdByCode(request: APIRequestContext, code: string) {
  const res = await request.get('/api/close/rollover-policies', {
    headers: await as('finance-admin'),
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items: { id: string; code: string }[] };
  const found = body.items.find((p) => p.code === code);
  expect(found, `rollover policy ${code} is seeded`).toBeDefined();
  return found!.id;
}

export async function yearEndRun(request: APIRequestContext, runId: string) {
  return expectContract(
    await request.get(`/api/close/year-end-runs/${runId}`, { headers: await as('finance-admin') }),
    200,
    YearEndRun,
  );
}
