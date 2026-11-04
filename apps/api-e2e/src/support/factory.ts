// Scenario data created through the API (never by writing tables), so every scenario owns its budgets.
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { AllocationResponse, BudgetDetail, type CreateBudgetRequest } from '@bf/contracts';
import { SEED, userById, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from './auth';
import { expectContract } from './contract';

export type Money = { amountMinor: number; currency: string };

const ENTITY_BY_CURRENCY: Record<string, string> = {
  INR: SEED.legalEntities.acmeIndia,
  EUR: SEED.legalEntities.acmeEurope,
};

export async function createRoot(
  request: APIRequestContext,
  opts: {
    amountMinor: number;
    currency?: string;
    as?: SeedUserId;
    owner?: SeedUserId;
    control?: CreateBudgetRequest['control'];
    name?: string;
  },
) {
  const currency = opts.currency ?? 'USD';
  const res = await request.post('/api/budgets', {
    headers: await mutate(opts.as ?? 'ceo'),
    data: {
      name: opts.name ?? `Scenario root ${randomUUID().slice(0, 8)}`,
      legalEntityId: SEED.legalEntities.acmeUs,
      currency,
      fiscalYearId: SEED.fiscalYears.acmeFy2026,
      planVersionId: SEED.planVersions.acmeFy2026Original,
      originalAmount: { amountMinor: opts.amountMinor, currency },
      ...(opts.owner ? { ownerPersonId: userById(opts.owner).personId } : {}),
      ...(opts.control ? { control: opts.control } : {}),
    },
  });
  return expectContract(res, 201, BudgetDetail);
}

export async function createChild(
  request: APIRequestContext,
  parentId: string,
  opts: { currency: string; as?: SeedUserId; owner?: SeedUserId; legalEntityId?: string },
) {
  const res = await request.post('/api/budgets', {
    headers: await mutate(opts.as ?? 'ceo'),
    data: {
      name: `Scenario child ${opts.currency} ${randomUUID().slice(0, 8)}`,
      parentId,
      legalEntityId:
        opts.legalEntityId ?? ENTITY_BY_CURRENCY[opts.currency] ?? SEED.legalEntities.acmeUs,
      currency: opts.currency,
      fiscalYearId: SEED.fiscalYears.acmeFy2026,
      ...(opts.owner ? { ownerPersonId: userById(opts.owner).personId } : {}),
    },
  });
  return expectContract(res, 201, BudgetDetail);
}

export async function allocate(
  request: APIRequestContext,
  parentId: string,
  childBudgetId: string,
  amount: Money,
  opts: { as?: SeedUserId; key?: string; accountingDate?: string } = {},
): Promise<APIResponse> {
  return request.post(`/api/budgets/${parentId}/allocations`, {
    headers: await mutate(opts.as ?? 'ceo', opts.key),
    data: {
      childBudgetId,
      amount,
      ...(opts.accountingDate ? { accountingDate: opts.accountingDate } : {}),
    },
  });
}

export async function allocateOk(
  request: APIRequestContext,
  parentId: string,
  childId: string,
  amount: Money,
  opts: { as?: SeedUserId; accountingDate?: string } = {},
) {
  return expectContract(
    await allocate(request, parentId, childId, amount, opts),
    201,
    AllocationResponse,
  );
}

export async function getBudget(
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

export function expectMoney(actual: Money, amountMinor: number, currency: string): void {
  expect(actual).toEqual({ amountMinor, currency });
}
