// Helpers for the Phase 4 budget scenarios: controls, transfers, commitments posted as opening balances
// (manual journals; Phase 5 posts real commitments) and the ledger rebuild check.
import { expect, type APIRequestContext } from '@playwright/test';
import {
  BudgetDetail,
  ControlImpact,
  ControlResult,
  IntegrityCheckRun,
  Journal,
  SpendCheckResult,
} from '@bf/contracts';
import { SEED, type SeedUserId } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { allocateOk, createChild, createRoot } from '../support/factory';

export const USD = (amountMinor: number) => ({ amountMinor, currency: 'USD' });

/** Root with two USD children, the first funded with `childMinor`. */
export async function tree(
  request: APIRequestContext,
  rootMinor: number,
  childMinor: number,
  owner?: SeedUserId,
) {
  const root = await createRoot(request, { amountMinor: rootMinor, ...(owner ? { owner } : {}) });
  const a = await createChild(request, root.id, { currency: 'USD' });
  const b = await createChild(request, root.id, { currency: 'USD' });
  if (childMinor) await allocateOk(request, root.id, a.id, USD(childMinor));
  return { root, a, b };
}

export async function post(
  request: APIRequestContext,
  path: string,
  data: unknown,
  user: SeedUserId = 'finance-admin',
  key?: string,
) {
  return request.post(path, { headers: await mutate(user, key), data });
}

export async function preview(
  request: APIRequestContext,
  id: string,
  data: Record<string, unknown>,
  user: SeedUserId = 'finance-admin',
) {
  return expectContract(
    await request.post(`/api/budgets/${id}/controls/preview`, { headers: await as(user), data }),
    200,
    ControlImpact,
  );
}

export async function freeze(
  request: APIRequestContext,
  id: string,
  user: SeedUserId = 'finance-admin',
) {
  return expectContract(
    await post(
      request,
      `/api/budgets/${id}/freeze`,
      { reasonCode: 'FRZ-POLICY', reason: 'Policy review' },
      user,
    ),
    200,
    ControlResult,
  );
}

export async function spendCheck(
  request: APIRequestContext,
  id: string,
  data: Record<string, unknown>,
) {
  return expectContract(
    await request.post(`/api/budgets/${id}/spend-check`, {
      headers: await as('finance-admin'),
      data,
    }),
    200,
    SpendCheckResult,
  );
}

/** Commitments and actuals as finance opening balances (manual journals against counter accounts). */
export async function openingBalance(
  request: APIRequestContext,
  budgetId: string,
  account: 'pre_encumbered' | 'encumbered' | 'actual' | 'held',
  amountMinor: number,
  side: 'debit' | 'credit' = 'debit',
) {
  const counter = account === 'held' ? 'earmark_reserve' : 'obligations';
  return expectContract(
    await post(request, '/api/ledger/journals', {
      transactionCurrency: 'USD',
      reasonCode: 'ADJ-OPENING',
      reason: `Opening ${account}`,
      lines: [
        { budgetId, account, side, amountMinor },
        {
          budgetId: null,
          account: counter,
          side: side === 'debit' ? 'credit' : 'debit',
          amountMinor,
          legalEntityId: SEED.legalEntities.acmeUs,
        },
      ],
    }),
    201,
    Journal,
  );
}

export async function budget(
  request: APIRequestContext,
  id: string,
  user: SeedUserId = 'finance-admin',
) {
  return expectContract(
    await request.get(`/api/budgets/${id}`, { headers: await as(user) }),
    200,
    BudgetDetail,
  );
}

export const bal = (b: BudgetDetail) => {
  const c = b.balances.budgetCurrency;
  return {
    authorized: c.authorized.amountMinor,
    allocatedOut: c.allocatedOut.amountMinor,
    held: c.held.amountMinor,
    preEncumbered: c.preEncumbered.amountMinor,
    encumbered: c.encumbered.amountMinor,
    actual: c.actual.amountMinor,
  };
};

export async function rebuildCheck(request: APIRequestContext) {
  const queued = await expectContract(
    await request.post('/api/integrity/ledger-checks', { headers: await mutate('finance-admin') }),
    202,
    IntegrityCheckRun,
  );
  let run = queued;
  await expect
    .poll(
      async () => {
        run = await expectContract(
          await request.get(`/api/integrity/ledger-checks/${queued.id}`, {
            headers: await as('finance-admin'),
          }),
          200,
          IntegrityCheckRun,
        );
        return run.status;
      },
      { timeout: 60_000, intervals: [250, 500, 1000] },
    )
    .toMatch(/^(clean|drift_detected|failed)$/);
  return run;
}
