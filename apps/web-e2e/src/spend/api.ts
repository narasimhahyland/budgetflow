// Phase 5 journey data, created through the API: each journey builds its own USD budget tree
// (CEO root, Lena's department, Jordan's team) so the seeded tree and the seed personas' queues
// that visual baselines use stay as they are.
import { expect, request, type Browser, type Page } from '@playwright/test';
import { SEED, userById, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { allocate, api, createChild, createRoot } from '../budgets/api';
import { MAILPIT_URL } from '../support/env';
import { authFile } from '../support/roles';

export const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
export const usdText = (minor: number) =>
  `USD ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
export const suffix = () => randomUUID().slice(0, 6);
export const desktopOnly = (name: string) =>
  name === 'desktop' ? undefined : 'mutating journey runs once, on desktop';
/** Phone-only journeys (the `/m/*` app) run once, on the emulated phone with touch. */
export const mobileOnly = (name: string) =>
  name === 'mobile' ? undefined : 'phone journey runs once, on the mobile project';

interface Detail {
  id: string;
  ref: string;
  status: string;
  myTaskId: string | null;
  onHold: boolean;
  cancelReason: string | null;
}
interface EventDetail {
  id: string;
  name: string;
  status: string;
  ownFundsRequest: { id: string } | null;
}

/** Root (CEO) → department (Lena Fischer, department head) → team (Jordan, budget owner). */
export async function directorTree(teamMinor = 5_000_000) {
  const tag = suffix();
  const root = await createRoot({ amountMinor: 50_000_000, name: `P5 journey root ${tag}` });
  const dept = await createChild(root.id, {
    name: `P5 journey department ${tag}`,
    owner: 'department-head',
    as: 'ceo',
  });
  await allocate(root.id, dept.id, 10_000_000, 'ceo');
  const team = await createChild(dept.id, {
    name: `P5 journey team ${tag}`,
    owner: 'budget-owner',
    as: 'department-head',
  });
  await allocate(dept.id, team.id, teamMinor, 'department-head');
  return { root, dept, team, tag };
}

/**
 * A budget owned by `owner` with one spending request waiting on them, so a journey that needs a
 * pending approval does not depend on the seeded personas' queues surviving the API scenarios.
 */
export async function waitingApprovalFor(owner: SeedUserId, amountMinor = 120_000) {
  const tag = suffix();
  const root = await createRoot({ amountMinor: 20_000_000, name: `P8 journey root ${tag}` });
  const owned = await createChild(root.id, {
    name: `P8 journey ${owner} ${tag}`,
    owner,
    as: 'ceo',
  });
  await allocate(root.id, owned.id, 5_000_000, 'ceo');
  const team = await createChild(owned.id, {
    name: `P8 journey team ${tag}`,
    owner: 'budget-owner',
    as: owner,
  });
  await allocate(owned.id, team.id, 2_000_000, owner);
  const req = await spendingRequest(team.id, amountMinor, 'budget-owner', `P8 journey ask ${tag}`);
  return { root, owned, team, request: req, tag };
}

/** A second department under the root owned by Lena: the giving budget for contributions. */
export async function giverBudget(rootId: string, tag: string, amountMinor = 3_000_000) {
  const giver = await createChild(rootId, {
    name: `P5 journey giver ${tag}`,
    owner: 'department-head',
    as: 'ceo',
  });
  await allocate(rootId, giver.id, amountMinor, 'ceo');
  return giver;
}

export const getRequest = (id: string, as: SeedUserId = 'budget-owner') =>
  api<Detail>(as, 'get', `/api/requests/${id}`);

export const spendingRequest = (
  budgetId: string,
  amountMinor: number,
  as: SeedUserId = 'budget-owner',
  title = `Journey request ${suffix()}`,
) =>
  api<Detail>(as, 'post', '/api/requests', {
    kind: 'spending',
    budgetId,
    amount: usd(amountMinor),
    spendType: 'team_lunch',
    title,
    purpose: 'Team lunch after the quarterly planning day',
  });

export async function taskOf(id: string, as: SeedUserId, type: 'requests' | 'contributions') {
  const d = await api<{ myTaskId: string | null }>(as, 'get', `/api/${type}/${id}`);
  expect(d.myTaskId, `${as} holds a task on ${id}`).toBeTruthy();
  return d.myTaskId!;
}

export const decide = (taskId: string, as: SeedUserId, body: Record<string, unknown>) =>
  api(as, 'post', `/api/approvals/tasks/${taskId}/decision`, {
    noConflictAttested: true,
    ...body,
  });

/** Jordan's event on his team budget, submitted and approved by Lena (owner above). */
export async function approvedEvent(homeBudgetId: string, estimateMinor: number, ownMinor: number) {
  const event = await api<EventDetail>('budget-owner', 'post', '/api/events', {
    name: `Journey event ${suffix()}`,
    eventType: 'offsite',
    homeBudgetId,
    startsAt: '2026-12-03T09:00:00.000Z',
    endsAt: '2026-12-03T17:00:00.000Z',
    toleranceBps: 500,
    locationOrgUnitIds: [SEED.orgUnits.newYork],
    estimate: usd(estimateMinor),
    ownFunds: usd(ownMinor),
  });
  const submitted = await api<EventDetail>(
    'budget-owner',
    'post',
    `/api/events/${event.id}/submit`,
    {},
  );
  const task = await taskOf(submitted.ownFundsRequest!.id, 'department-head', 'requests');
  await decide(task, 'department-head', { decision: 'approve' });
  return api<EventDetail>('budget-owner', 'get', `/api/events/${event.id}`);
}

/**
 * Phase 9 journeys need an approved event with people on it: same flow as `approvedEvent`, with the
 * participants, estimate and own funds the journey asks for.
 */
export async function approvedEventWith(
  homeBudgetId: string,
  opts: { name: string; estimateMinor: number; ownMinor: number; participantPersonIds: string[] },
) {
  const event = await api<EventDetail>('budget-owner', 'post', '/api/events', {
    name: opts.name,
    eventType: 'offsite',
    homeBudgetId,
    startsAt: '2026-12-03T09:00:00.000Z',
    endsAt: '2026-12-03T17:00:00.000Z',
    toleranceBps: 500,
    locationOrgUnitIds: [SEED.orgUnits.newYork],
    estimate: usd(opts.estimateMinor),
    ownFunds: usd(opts.ownMinor),
    participantPersonIds: opts.participantPersonIds,
  });
  const submitted = await api<EventDetail>(
    'budget-owner',
    'post',
    `/api/events/${event.id}/submit`,
    {},
  );
  const task = await taskOf(submitted.ownFundsRequest!.id, 'department-head', 'requests');
  await decide(task, 'department-head', { decision: 'approve' });
  return api<EventDetail>('budget-owner', 'get', `/api/events/${event.id}`);
}

/** Phase 4 control endpoints as the finance admin; the worker consumes `budget.control_changed`. */
export async function control(budgetId: string, action: 'freeze' | 'set_to_zero') {
  const reason = `Journey ${action.replace(/_/g, ' ')}`;
  if (action === 'freeze') {
    return api('finance-admin', 'post', `/api/budgets/${budgetId}/freeze`, {
      reason,
      reasonCode: 'FRZ-POLICY',
    });
  }
  const pv = await api<{ floorMinor: number }>(
    'finance-admin',
    'post',
    `/api/budgets/${budgetId}/controls/preview`,
    { action, destination: 'parent' },
  );
  const b = await api<{ name: string; code: string | null }>(
    'finance-admin',
    'get',
    `/api/budgets/${budgetId}`,
  );
  return api('finance-admin', 'post', `/api/budgets/${budgetId}/set-to-zero`, {
    reason,
    reasonCode: 'RED-REPRIORITIZE',
    destination: 'parent',
    confirmedFloorMinor: pv.floorMinor,
    confirmText: b.code ?? b.name,
  });
}

/** A page signed in as another role, for journeys that hand over between people. */
export async function pageAs(browser: Browser, role: SeedUserId): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(role) });
  return ctx.newPage();
}

/** The newest email to `role` whose subject contains `subject`, from Mailpit. */
export async function mailTo(role: SeedUserId, subject: string) {
  const ctx = await request.newContext();
  const to = userById(role).username;
  try {
    let id: string | undefined;
    await expect
      .poll(
        async () => {
          const res = await ctx.get(
            `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`,
          );
          const body = (await res.json()) as { messages: { ID: string; Subject: string }[] };
          id = body.messages.find((m) => m.Subject.includes(subject))?.ID;
          return Boolean(id);
        },
        { timeout: 45_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    const msg = (await (await ctx.get(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as {
      Subject: string;
      Text: string;
    };
    return msg;
  } finally {
    await ctx.dispose();
  }
}

/** The app path of a link in an email ("Approve USD 1.00: http://…" or "Reject: http://…"). */
export function linkPath(text: string, label: string): string {
  const line = text.split('\n').find((l) => l.startsWith(label));
  expect(line, `email line starting with "${label}"`).toBeTruthy();
  const url = new URL(line!.slice(line!.indexOf('http')).trim());
  return `${url.pathname}${url.search}`;
}

/** A minimal valid PDF, so the server-side file signature check passes. */
export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
