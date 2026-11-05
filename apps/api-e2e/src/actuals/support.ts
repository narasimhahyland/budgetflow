// Phase 6 scenario support. Budgets, events, funding and commitments come from the Phase 5 API: each
// scenario builds its own director tree (CEO, department head, budget owner) and funds an event whose
// commitments the actuals then match. Actuals themselves always go through the actuals API.
import { expect, type APIRequestContext } from '@playwright/test';
import {
  ActualDetail,
  ActualList,
  BudgetDetail,
  CommitmentHygieneList,
  ContributionDetail,
  EventCommitment,
  EventDetail,
  ImportBatch,
} from '@bf/contracts';
import { SEED, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { asOwner } from '../support/db';
import {
  approvedEvent,
  contribute,
  decideOk,
  directorTree,
  eventAction,
  fundedChild,
  taskOf,
  usd,
} from '../support/p5';

export const ACME = SEED.tenants.acme;
export const INDIA = SEED.legalEntities.acmeIndia;
export const US = SEED.legalEntities.acmeUs;
export const CC = SEED.costCenters;
export const uniq = () => randomUUID().slice(0, 8).toUpperCase();

/** Units of each currency per USD at the FY2026 plan rates (seed). */
const PER_USD: Record<string, number> = { USD: 1, INR: 83.25, EUR: 0.92, GBP: 0.79 };

/** USD minor units that comfortably cover an amount in another currency (event own funds). */
const usdCover = (amountMinor: number, currency: string) =>
  Math.ceil((amountMinor / (PER_USD[currency] ?? 1)) * 1.05) + 100;

/**
 * A USD team budget in the India (or another) entity with money to spend, owned by the budget owner
 * under a department owned by the department head (who approves its events' own funds).
 */
export async function spendBudget(
  request: APIRequestContext,
  opts: { amountMinor?: number; legalEntityId?: string } = {},
): Promise<BudgetDetail> {
  const teamMinor = opts.amountMinor ?? 5_000_000;
  const entity = opts.legalEntityId ?? INDIA;
  const { team } = await directorTree(request, {
    teamEntity: entity,
    deptEntity: entity,
    teamMinor,
    deptMinor: Math.max(10_000_000, teamMinor * 2),
  });
  return team;
}

/** A sibling budget owned by the department head (a contributor to events). */
export async function giverBudget(
  request: APIRequestContext,
  teamId: string,
  amountMinor = 2_000_000,
): Promise<BudgetDetail> {
  const team = await buckets(request, teamId);
  const dept = await buckets(request, team.parentId!);
  return fundedChild(request, dept.parentId!, {
    owner: 'department-head',
    amountMinor,
    legalEntityId: team.legalEntityId,
  });
}

/**
 * An event funded from the budget (own funds approved by the department head) with a unique event code,
 * moved on to the requested status.
 */
export async function createEvent(
  request: APIRequestContext,
  opts: {
    budgetId: string;
    status?: 'funded' | 'in_progress' | 'completed';
    costCenterId?: string;
    ownFundsMinor?: number;
    estimateMinor?: number;
  },
): Promise<{ id: string; eventCode: string }> {
  const eventCode = `SC-${uniq()}`;
  const own = opts.ownFundsMinor ?? 500_000;
  const event = await approvedEvent(request, 'budget-owner', 'department-head', {
    homeBudgetId: opts.budgetId,
    eventCode,
    costCenterId: opts.costCenterId,
    estimate: usd(opts.estimateMinor ?? own),
    ownFunds: usd(own),
    toleranceBps: 1000,
  });
  const steps =
    opts.status === 'completed'
      ? ['start', 'complete']
      : opts.status === 'in_progress'
        ? ['start']
        : [];
  for (const verb of steps)
    await expectContract(
      await eventAction(request, 'budget-owner', event.id, verb),
      200,
      EventDetail,
    );
  return { id: event.id, eventCode };
}

/** An approved Inter-Director Budget Contribution Request from the department head's budget, earmarked for the event. */
export async function contributeTo(
  request: APIRequestContext,
  opts: { eventId: string; giverBudgetId: string; amountMinor: number },
) {
  const c = await expectContract(
    await contribute(request, 'budget-owner', {
      eventId: opts.eventId,
      giverBudgetId: opts.giverBudgetId,
      amount: usd(opts.amountMinor),
    }),
    201,
    ContributionDetail,
  );
  await decideOk(
    request,
    'department-head',
    await taskOf(request, 'department-head', 'contribution', c.id),
    {
      decision: 'approve',
    },
  );
  return c;
}

export interface TestCommitment {
  id: string;
  reference: string;
  budgetId: string;
  eventId: string;
}

/**
 * An encumbered event commitment through Phase 5 (on a new funded event unless one is given). The GL
 * account and the non-refundable deposit come from the vendor contract, which the Phase 5 API does not
 * capture; scenarios that need them set them on the row.
 */
export async function createCommitment(
  request: APIRequestContext,
  opts: {
    budgetId: string;
    amountMinor: number;
    currency?: string;
    eventId?: string;
    costCenterId?: string;
    vendorId?: string;
    glAccountId?: string;
    description?: string;
    serviceStart?: string;
    serviceEnd?: string;
    nonRefundableDepositMinor?: number;
  },
): Promise<TestCommitment> {
  const currency = opts.currency ?? 'USD';
  const eventId =
    opts.eventId ??
    (
      await createEvent(request, {
        budgetId: opts.budgetId,
        costCenterId: opts.costCenterId,
        ownFundsMinor: usdCover(opts.amountMinor, currency),
      })
    ).id;
  const c = await expectContract(
    await request.post(`/api/events/${eventId}/commitments`, {
      headers: await mutate('budget-owner'),
      data: {
        description: opts.description ?? 'Scenario commitment',
        vendorId: opts.vendorId,
        amount: { amountMinor: opts.amountMinor, currency },
        serviceStart: opts.serviceStart ?? '2026-11-10',
        serviceEnd: opts.serviceEnd ?? '2026-11-12',
      },
    }),
    201,
    EventCommitment,
  );
  if (opts.glAccountId || opts.nonRefundableDepositMinor) {
    await asOwner(async (db) => {
      await db.query('begin');
      await db.query(`select set_config('app.tenant_id', $1, true)`, [ACME]);
      await db.query(
        `update commitments set gl_account_id = coalesce($2, gl_account_id), non_refundable_deposit_minor = $3 where id = $1`,
        [c.id, opts.glAccountId ?? null, opts.nonRefundableDepositMinor ?? 0],
      );
      await db.query('commit');
    });
  }
  return {
    id: c.id,
    reference: `CMT-${c.id.slice(-8).toUpperCase()}`,
    budgetId: opts.budgetId,
    eventId,
  };
}

/** Vendor and GL account ids from the Phase 3 seed. */
export async function refs() {
  return asOwner(async (c) => {
    const vendors = new Map<string, string>(
      (await c.query(`select id, name from vendors where tenant_id = $1`, [ACME])).rows.map((r) => [
        r.name,
        r.id,
      ]),
    );
    const gl = new Map<string, string>(
      (
        await c.query(
          `select g.id, e.code || '|' || g.code as k from gl_accounts g join legal_entities e on e.id = g.legal_entity_id where g.tenant_id = $1`,
          [ACME],
        )
      ).rows.map((r) => [r.k, r.id]),
    );
    return {
      vendor: (n: string) => vendors.get(n)!,
      gl: (entity: string, code: string) => gl.get(`${entity}|${code}`)!,
    };
  });
}

export const HEADER =
  'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,event_code,vendor,memo,reference,original_ref,kind';

export function csv(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

export async function upload(
  request: APIRequestContext,
  content: string,
  opts: { source?: string; user?: SeedUserId; fileName?: string } = {},
) {
  return expectContract(
    await request.post('/api/actuals/imports', {
      headers: await mutate(opts.user ?? 'finance-controller'),
      data: {
        source: opts.source ?? 'erp',
        fileName: opts.fileName ?? `scenario-${uniq()}.csv`,
        content,
      },
    }),
    201,
    ImportBatch,
  );
}

export async function post(
  request: APIRequestContext,
  batchId: string,
  user: SeedUserId = 'finance-controller',
) {
  return expectContract(
    await request.post(`/api/actuals/imports/${batchId}/post`, { headers: await mutate(user) }),
    200,
    ImportBatch,
  );
}

export async function importAndPost(
  request: APIRequestContext,
  content: string,
  opts: { source?: string } = {},
) {
  const batch = await upload(request, content, opts);
  return post(request, batch.id);
}

export async function actualByRef(request: APIRequestContext, ref: string) {
  const list = await expectContract(
    await request.get(`/api/actuals?status=all&q=${encodeURIComponent(ref)}`, {
      headers: await as('finance-controller'),
    }),
    200,
    ActualList,
  );
  const line = list.items.find((i) => i.sourceRef === ref);
  expect(line, `actual ${ref}`).toBeTruthy();
  return expectContract(
    await request.get(`/api/actuals/${line!.id}`, { headers: await as('finance-controller') }),
    200,
    ActualDetail,
  );
}

export async function commitmentState(
  request: APIRequestContext,
  budgetId: string,
  commitmentId: string,
) {
  const list = await expectContract(
    await request.get(`/api/actuals/commitments?status=all&budgetId=${budgetId}`, {
      headers: await as('finance-controller'),
    }),
    200,
    CommitmentHygieneList,
  );
  const c = list.items.find((i) => i.id === commitmentId);
  expect(c, `commitment ${commitmentId}`).toBeTruthy();
  return c!;
}

/** A budget with its bucket balances in the budget currency. */
export async function buckets(request: APIRequestContext, budgetId: string) {
  return expectContract(
    await request.get(`/api/budgets/${budgetId}`, { headers: await as('finance-admin') }),
    200,
    BudgetDetail,
  );
}
