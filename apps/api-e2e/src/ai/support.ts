// Phase 13 scenario support. Matching scenarios own their data: each one creates a budget on an
// otherwise unused cost centre and imports a spend line against it, so the AI ranker has exactly one
// plausible target and running the file again never depends on what an earlier run consumed.
import { expect, type APIRequestContext } from '@playwright/test';
import {
  ActualDetail,
  ActualList,
  AiMatchSuggestion,
  AiMatchSuggestionList,
  BudgetDetail,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { createRoot } from '../support/plan-root';
import { allocate } from '../support/factory';
import { csv, importAndPost } from '../actuals/support';

/** A cost centre no seeded budget uses, so only this scenario's budget can be suggested. */
const COST_CENTRE_CODE = 'CC-IN-BLR-220';

/** A budget on the scenario's own cost centre, funded and owned by the budget owner. */
export async function budgetOnOwnCostCentre(request: APIRequestContext): Promise<BudgetDetail> {
  const root = await createRoot(request, {
    amountMinor: 20_000_000,
    name: `P13 root ${randomUUID().slice(0, 6)}`,
  });
  const costCenterId = await costCentreId(request);
  const child = await expectContract(
    await request.post('/api/budgets', {
      headers: await mutate('ceo'),
      data: {
        name: `P13 matching ${randomUUID().slice(0, 6)}`,
        parentId: root.id,
        legalEntityId: SEED.legalEntities.acmeIndia,
        costCenterId,
        currency: 'USD',
        fiscalYearId: SEED.fiscalYears.acmeFy2026,
        ownerPersonId: userById('budget-owner').personId,
      },
    }),
    201,
    BudgetDetail,
  );
  await allocate(request, root.id, child.id, { amountMinor: 5_000_000, currency: 'USD' });
  return child;
}

async function costCentreId(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/org/cost-centers', { headers: await as('finance-admin') });
  expect(res.status(), 'the cost centre list is readable').toBe(200);
  const body = (await res.json()) as { items: { id: string; code: string }[] };
  const centre = body.items.find((c) => c.code === COST_CENTRE_CODE);
  expect(
    centre,
    `${COST_CENTRE_CODE} exists in the seed and no seeded budget uses it`,
  ).toBeDefined();
  return centre!.id;
}

/**
 * An unmatched spend line on the scenario's own budget: no event code and no mapping rule, so the
 * deterministic matching steps leave it for the AI ranker exactly as 080f describes.
 */
export async function unmatchedLine(
  request: APIRequestContext,
): Promise<{ budget: BudgetDetail; actual: ActualDetail }> {
  const budget = await budgetOnOwnCostCentre(request);
  const ref = `P13-${randomUUID().slice(0, 8).toUpperCase()}`;
  await importAndPost(
    request,
    csv([
      `${ref},2026-11-10,240.00,USD,HYL-IN,${COST_CENTRE_CODE},6100,,,AI matching scenario,,,charge`,
    ]),
  );
  const list = await expectContract(
    await request.get(`/api/actuals?status=all&q=${encodeURIComponent(ref)}`, {
      headers: await as('finance-admin'),
    }),
    200,
    ActualList,
  );
  const line = list.items.find((i) => i.sourceRef === ref);
  expect(line, `the imported line ${ref} is in the queue`).toBeDefined();
  const actual = await expectContract(
    await request.get(`/api/actuals/${line!.id}`, { headers: await as('finance-admin') }),
    200,
    ActualDetail,
  );
  expect(actual.actual.status, 'the deterministic steps left it unmatched').toBe('unmatched');
  return { budget, actual };
}

/** Runs the ranker for one line and returns the suggestion it produced for it. */
export async function suggestionFor(
  request: APIRequestContext,
  actualId: string,
): Promise<AiMatchSuggestion> {
  await expectContract(
    await request.post('/api/ai/matching-suggestions/run', {
      headers: await as('finance-admin'),
      data: { actualIds: [actualId] },
    }),
    200,
    AiMatchSuggestionList,
  );
  const list = await expectContract(
    await request.get('/api/ai/matching-suggestions?status=open', {
      headers: await as('finance-admin'),
    }),
    200,
    AiMatchSuggestionList,
  );
  const suggestion = list.items.find((i) => i.actualId === actualId);
  expect(suggestion, 'the ranker produced a suggestion for this line').toBeDefined();
  return suggestion!;
}
