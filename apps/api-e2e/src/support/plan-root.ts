import type { APIRequestContext } from '@playwright/test';
import { BudgetDetail, PlanVersionDetail, type CreateBudgetRequest } from '@bf/contracts';
import { SEED, userById, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { mutate } from './auth';
import { expectContract } from './contract';

/** Creates a scenario root through an additive plan revision (Finance Admin + CEO sign-off) and POST /api/budgets. */
export async function createRoot(
  request: APIRequestContext,
  opts: {
    amountMinor: number;
    currency?: string;
    as?: SeedUserId;
    owner?: SeedUserId;
    name?: string;
    code?: string;
    budgetType?: CreateBudgetRequest['budgetType'];
    control?: CreateBudgetRequest['control'];
  },
) {
  const currency = opts.currency ?? 'USD';
  const code = opts.code ?? `SC-${randomUUID().slice(0, 6).toUpperCase()}`;
  const name = opts.name ?? `Scenario root ${code}`;
  const fiscalYearId = SEED.fiscalYears.acmeFy2026;
  const revision = await expectContract(
    await request.post('/api/plan-versions', {
      headers: await mutate('finance-admin'),
      data: {
        fiscalYearId,
        kind: 'current',
        label: `Scenario ${code}`,
        lines: [
          {
            code,
            name,
            amountMinor: opts.amountMinor,
            legalEntityId: SEED.legalEntities.acmeUs,
          },
        ],
      },
    }),
    201,
    PlanVersionDetail,
  );
  await expectContract(
    await request.post(`/api/plan-versions/${revision.id}/approve`, {
      headers: await mutate('finance-admin-2'),
    }),
    200,
    PlanVersionDetail,
  );
  await expectContract(
    await request.post(`/api/plan-versions/${revision.id}/approve`, {
      headers: await mutate('ceo'),
    }),
    200,
    PlanVersionDetail,
  );
  const res = await request.post('/api/budgets', {
    headers: await mutate(opts.as ?? 'ceo'),
    data: {
      name,
      code,
      legalEntityId: SEED.legalEntities.acmeUs,
      currency,
      fiscalYearId,
      planVersionId: SEED.planVersions.acmeFy2026Original,
      originalAmount: { amountMinor: opts.amountMinor, currency },
      ...(opts.budgetType ? { budgetType: opts.budgetType } : {}),
      ...(opts.owner ? { ownerPersonId: userById(opts.owner).personId } : {}),
      ...(opts.control ? { control: opts.control } : {}),
    },
  });
  return expectContract(res, 201, BudgetDetail);
}
