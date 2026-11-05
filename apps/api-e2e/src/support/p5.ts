// Phase 5 scenario helpers: each scenario builds its own USD budget tree, event and requests through the
// API (never the seeded Bengaluru/India budgets or the seed personas' queues, which visual baselines use).
import { expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import {
  BudgetDetail,
  ContributionDetail,
  ControlResult,
  DecisionResponse,
  EventDetail,
  IntegrityCheckRun,
  RequestDetail,
  type CreateEventBody,
  type DecisionRequest,
} from '@bf/contracts';
import { SEED, userById, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from './auth';
import { expectContract } from './contract';
import { env } from './env';
import { allocateOk, createRoot, type Money } from './factory';
import { post, preview } from '../budgets/p4';

export const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD' });

export const ENTITIES = {
  us: SEED.legalEntities.acmeUs,
  india: SEED.legalEntities.acmeIndia,
  germany: SEED.legalEntities.acmeEurope,
  uk: '20000000-0000-4000-8000-000000000006',
};

/** A USD child budget with a chosen owner and legal entity, funded from its parent. */
export async function fundedChild(
  request: APIRequestContext,
  parentId: string,
  opts: {
    owner: SeedUserId;
    amountMinor: number;
    legalEntityId?: string;
    as?: SeedUserId;
    name?: string;
  },
) {
  const res = await request.post('/api/budgets', {
    headers: await mutate(opts.as ?? 'ceo'),
    data: {
      name: opts.name ?? `P5 ${opts.owner} ${randomUUID().slice(0, 6)}`,
      parentId,
      legalEntityId: opts.legalEntityId ?? ENTITIES.us,
      currency: 'USD',
      fiscalYearId: SEED.fiscalYears.acmeFy2026,
      ownerPersonId: userById(opts.owner).personId,
    },
  });
  const child = await expectContract(res, 201, BudgetDetail);
  await allocateOk(request, parentId, child.id, usd(opts.amountMinor), { as: opts.as ?? 'ceo' });
  return child;
}

/** Root (CEO) → department (Lena, department head) → team (Jordan, budget owner). */
export async function directorTree(
  request: APIRequestContext,
  opts: { teamEntity?: string; deptEntity?: string; teamMinor?: number; deptMinor?: number } = {},
) {
  const root = await createRoot(request, {
    amountMinor: 50_000_000,
    name: `P5 root ${randomUUID().slice(0, 6)}`,
  });
  const dept = await fundedChild(request, root.id, {
    owner: 'department-head',
    amountMinor: opts.deptMinor ?? 10_000_000,
    legalEntityId: opts.deptEntity,
  });
  const team = await fundedChild(request, dept.id, {
    owner: 'budget-owner',
    amountMinor: opts.teamMinor ?? 5_000_000,
    legalEntityId: opts.teamEntity,
    as: 'department-head',
  });
  return { root, dept, team };
}

export async function createEvent(
  request: APIRequestContext,
  as_: SeedUserId,
  body: Partial<CreateEventBody> & Pick<CreateEventBody, 'homeBudgetId' | 'ownFunds'>,
) {
  return expectContract(
    await request.post('/api/events', {
      headers: await mutate(as_),
      data: {
        name: `Scenario event ${randomUUID().slice(0, 6)}`,
        eventType: 'offsite',
        startsAt: '2026-12-03T09:00:00.000Z',
        endsAt: '2026-12-03T17:00:00.000Z',
        toleranceBps: 1000,
        locationOrgUnitIds: [SEED.orgUnits.newYork],
        estimate: usd(1_000_000),
        ...body,
      },
    }),
    201,
    EventDetail,
  );
}

export async function getEvent(request: APIRequestContext, as_: SeedUserId, id: string) {
  return expectContract(
    await request.get(`/api/events/${id}`, { headers: await as(as_) }),
    200,
    EventDetail,
  );
}

export async function eventAction(
  request: APIRequestContext,
  as_: SeedUserId,
  id: string,
  verb: string,
  data: object = {},
) {
  return request.post(`/api/events/${id}/${verb}`, { headers: await mutate(as_), data });
}

export async function getRequest(request: APIRequestContext, as_: SeedUserId, id: string) {
  return expectContract(
    await request.get(`/api/requests/${id}`, { headers: await as(as_) }),
    200,
    RequestDetail,
  );
}

export async function getContribution(request: APIRequestContext, as_: SeedUserId, id: string) {
  return expectContract(
    await request.get(`/api/contributions/${id}`, { headers: await as(as_) }),
    200,
    ContributionDetail,
  );
}

export async function spendingRequest(
  request: APIRequestContext,
  as_: SeedUserId,
  budgetId: string,
  amount: Money,
  extra: Record<string, unknown> = {},
) {
  return request.post('/api/requests', {
    headers: await mutate(as_),
    data: {
      kind: 'spending',
      budgetId,
      amount,
      spendType: 'team_lunch',
      title: `Scenario request ${randomUUID().slice(0, 6)}`,
      purpose: 'Scenario spend',
      ...extra,
    },
  });
}

export async function decideTask(
  request: APIRequestContext,
  as_: SeedUserId,
  taskId: string,
  body: Partial<DecisionRequest> & Pick<DecisionRequest, 'decision'>,
  key?: string,
) {
  return request.post(`/api/approvals/tasks/${taskId}/decision`, {
    headers: await mutate(as_, key),
    data: { noConflictAttested: true, ...body },
  });
}

export async function decideOk(
  request: APIRequestContext,
  as_: SeedUserId,
  taskId: string,
  body: Partial<DecisionRequest> & Pick<DecisionRequest, 'decision'>,
) {
  return expectContract(await decideTask(request, as_, taskId, body), 200, DecisionResponse);
}

/** The pending task of `as_` on a request or contribution (from the detail's myTaskId). */
export async function taskOf(
  request: APIRequestContext,
  as_: SeedUserId,
  type: 'request' | 'contribution',
  id: string,
) {
  const detail =
    type === 'request'
      ? await getRequest(request, as_, id)
      : await getContribution(request, as_, id);
  expect(detail.myTaskId, `${as_} should hold a pending task on ${type} ${id}`).toBeTruthy();
  return detail.myTaskId!;
}

/** Submit the event and have the owner chain approve its own funds; returns the event once approved. */
export async function approvedEvent(
  request: APIRequestContext,
  organizer: SeedUserId,
  approver: SeedUserId,
  body: Parameters<typeof createEvent>[2],
) {
  const event = await createEvent(request, organizer, body);
  const submitted = await expectContract(
    await eventAction(request, organizer, event.id, 'submit'),
    200,
    EventDetail,
  );
  expect(submitted.status).toBe('submitted');
  const own = submitted.ownFundsRequest!;
  await decideOk(request, approver, await taskOf(request, approver, 'request', own.id), {
    decision: 'approve',
  });
  const approved = await getEvent(request, organizer, event.id);
  expect(['approved', 'funded']).toContain(approved.status);
  return approved;
}

export async function contribute(
  request: APIRequestContext,
  as_: SeedUserId,
  data: { eventId: string; giverBudgetId: string; amount: Money; mode?: 'earmark' | 'transfer' },
) {
  return request.post('/api/contributions', {
    headers: await mutate(as_),
    data: { purpose: 'Co-fund the scenario event', ...data },
  });
}

export async function budget(request: APIRequestContext, id: string) {
  return expectContract(
    await request.get(`/api/budgets/${id}`, { headers: await as('finance-admin') }),
    200,
    BudgetDetail,
  );
}

export async function runLedgerCheck(request: APIRequestContext) {
  const queued = await expectContract(
    await request.post('/api/integrity/ledger-checks', {
      headers: await mutate('finance-controller'),
    }),
    202,
    IntegrityCheckRun,
  );
  let run = queued;
  await expect
    .poll(
      async () => {
        run = await expectContract(
          await request.get(`/api/integrity/ledger-checks/${queued.id}`, {
            headers: await as('finance-controller'),
          }),
          200,
          IntegrityCheckRun,
        );
        return run.status;
      },
      { timeout: 60_000, intervals: [500, 1000] },
    )
    .toMatch(/^(clean|drift_detected|failed)$/);
  return run;
}

export async function auditFor(request: APIRequestContext, resourceId: string) {
  const res = await request.get(`/api/audit/events?resourceId=${resourceId}&limit=100`, {
    headers: await as('auditor'),
  });
  expect(res.status()).toBe(200);
  return (
    (await res.json()) as {
      items: {
        action: string;
        changes: Record<string, { to?: unknown }>;
        onBehalfOfPersonId?: string | null;
        reason: string | null;
      }[];
    }
  ).items;
}

// Mailpit ---------------------------------------------------------------------------------------

const mailpit = () => `http://localhost:${env('BF_MAILPIT_PORT')}`;

/** Waits for the newest email to `to` whose subject contains `subject`; returns its HTML and text. */
export async function waitForMail(
  to: string,
  subject: string,
): Promise<{ html: string; text: string; subject: string }> {
  const ctx = await pwRequest.newContext();
  try {
    let found: { ID: string; Subject: string } | undefined;
    await expect
      .poll(
        async () => {
          const res = await ctx.get(
            `${mailpit()}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`,
          );
          const body = (await res.json()) as { messages: { ID: string; Subject: string }[] };
          found = body.messages.find((m) => m.Subject.includes(subject));
          return Boolean(found);
        },
        { timeout: 45_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    const msg = (await (await ctx.get(`${mailpit()}/api/v1/message/${found!.ID}`)).json()) as {
      HTML: string;
      Text: string;
      Subject: string;
    };
    return { html: msg.HTML, text: msg.Text, subject: msg.Subject };
  } finally {
    await ctx.dispose();
  }
}

/** The approve and reject tokens from an actionable approval email. */
export function emailTokens(mail: { text: string }): { approve: string; reject: string } {
  const pick = (label: string) => {
    const line = mail.text.split('\n').find((l) => l.startsWith(label));
    const url = line?.slice(line.indexOf('http')).trim() ?? '';
    return decodeURIComponent(new URL(url).searchParams.get('token') ?? '');
  };
  return { approve: pick('Approve '), reject: pick('Reject:') };
}

// Budget controls --------------------------------------------------------------------------------

/**
 * Applies a budget control through Phase 4's control endpoints as the finance admin; each publishes
 * `budget.control_changed` through the outbox, which the worker consumes.
 */
export async function applyControl(
  request: APIRequestContext,
  budgetId: string,
  action: 'freeze' | 'unfreeze' | 'reduce' | 'set_to_zero' | 'restore',
  amountMinor = 1_000,
) {
  const reason = { reason: `Scenario ${action}` };
  const path = `/api/budgets/${budgetId}/${action.replace(/_/g, '-')}`;
  let data: Record<string, unknown> = reason;
  if (action === 'freeze') data = { ...reason, reasonCode: 'FRZ-POLICY' };
  if (action === 'reduce' || action === 'set_to_zero') {
    const pv = await preview(request, budgetId, {
      action,
      destination: 'parent',
      ...(action === 'reduce' ? { amountMinor } : {}),
    });
    data = {
      ...reason,
      reasonCode: 'RED-REPRIORITIZE',
      destination: 'parent',
      confirmedFloorMinor: pv.floorMinor,
    };
    if (action === 'reduce') data['amountMinor'] = amountMinor;
    else {
      const b = await budget(request, budgetId);
      data['confirmText'] = b.code ?? b.name;
    }
  }
  return expectContract(await post(request, path, data), 200, ControlResult);
}
