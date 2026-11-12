// Helpers for the Navan scenarios (16a, gap B1): connect Navan in Mock mode, feed the mock its own
// transactions through the control plane, run a sync in the worker and wait for it to finish.
import { expect, type APIRequestContext } from '@playwright/test';
import {
  ConnectionDetail,
  ImportBatch,
  SyncRunView,
  type NavanSettings,
  type SyncDirection,
  type SyncObject,
} from '@bf/contracts';
import { as, mutate } from './auth';
import { expectContract } from './contract';
import { mockApi } from './p12';

/** An EU client id: the mock refuses every call from it that lacks the region header. */
export const NAVAN_CLIENT_ID = 'budgetflow-eu-client';
/** Placeholder secret for the mock only; never a real credential. */
export const NAVAN_SECRET = 'navan-mock-secret-0001';
export const EVENT_FIELD = 'cf-event-code';
export const COST_CENTER_FIELD = 'cf-cost-center';
/** BF_FIXED_NOW of the stack (apps/web-e2e/visual/screens.json freezeTime): where every window ends. */
export const STACK_NOW = '2026-11-16T09:00:00.000Z';

export const NAVAN_DEFAULT_SETTINGS: Partial<NavanSettings> = {
  region: 'eu',
  expenseWrite: true,
  eventCodeFieldId: EVENT_FIELD,
  costCenterFieldId: COST_CENTER_FIELD,
  systemOfRecord: false,
  pageSize: 500,
  writeBatchSize: 100,
};

export interface NavanTx {
  id: string;
  type: 'CARD' | 'CONNECT' | 'MANUAL' | 'REPAYMENT' | 'FEE' | 'ADJUSTMENT' | 'REBATE' | 'DISPUTE';
  transactionDate: string;
  modifiedAt: string;
  amount: string;
  currency: string;
  merchant?: string;
  description?: string;
  user?: { id: string; email: string };
  hrFields?: { subsidiary?: string; costCenter?: string; department?: string };
  glCode?: string;
  customFields?: { fieldId: string; value: string }[];
  originalTransactionId?: string;
  receiptToken?: string;
  receiptIssuedAt?: string;
}

/** Connects Navan (or reconnects it when an earlier run left it connected) and returns its detail. */
export async function connectNavan(
  request: APIRequestContext,
  opts: { clientId?: string; settings?: Partial<NavanSettings> } = {},
): Promise<ConnectionDetail> {
  const body = {
    provider: 'navan',
    mode: 'mock',
    clientId: opts.clientId ?? NAVAN_CLIENT_ID,
    credential: NAVAN_SECRET,
    settings: { ...NAVAN_DEFAULT_SETTINGS, ...(opts.settings ?? {}) },
  };
  let res = await request.post('/api/integrations', {
    headers: await mutate('integration-admin'),
    data: body,
  });
  if (res.status() === 409) {
    const problem = (await res.json()) as { params?: { connectionId?: string } };
    const id = problem.params?.connectionId;
    expect(id, 'the existing Navan connection is named').toBeTruthy();
    await request.delete(`/api/integrations/connections/${id}`, {
      headers: await mutate('integration-admin'),
    });
    res = await request.post('/api/integrations', {
      headers: await mutate('integration-admin'),
      data: body,
    });
  }
  return expectContract(res, 201, ConnectionDetail);
}

export async function navanSettings(
  request: APIRequestContext,
  connectionId: string,
  settings: Partial<NavanSettings>,
) {
  return request.patch(`/api/integrations/connections/${connectionId}`, {
    headers: await mutate('integration-admin'),
    data: { settings },
  });
}

/** Starts a run (queued for the worker) and waits until the worker has finished it. */
export async function runNavan(
  request: APIRequestContext,
  connectionId: string,
  object: SyncObject,
  direction: SyncDirection,
  since?: string,
): Promise<SyncRunView> {
  const queued = await expectContract(
    await request.post(`/api/integrations/connections/${connectionId}/sync`, {
      headers: await mutate('integration-admin'),
      data: { object, direction, ...(since ? { since } : {}) },
    }),
    201,
    SyncRunView,
  );
  return waitForRun(request, queued.id);
}

export async function waitForRun(request: APIRequestContext, runId: string): Promise<SyncRunView> {
  let run: SyncRunView | null = null;
  await expect
    .poll(
      async () => {
        run = await expectContract(
          await request.get(`/api/integrations/sync-runs/${runId}`, {
            headers: await as('integration-admin'),
          }),
          200,
          SyncRunView,
        );
        return run.status;
      },
      { timeout: 60_000, intervals: [250, 500, 1000] },
    )
    .not.toBe('running');
  return run!;
}

export async function batchOf(request: APIRequestContext, batchId: string) {
  return expectContract(
    await request.get(`/api/actuals/imports/${batchId}`, { headers: await as('finance-admin') }),
    200,
    ImportBatch,
  );
}

export async function addNavanTransactions(items: NavanTx[]): Promise<void> {
  const api = await mockApi();
  await api.post('/_control/navan/transactions', { data: { items } });
}

export async function expireNavanTokens(): Promise<void> {
  const api = await mockApi();
  await api.post('/_control/navan/expire-tokens');
}

export interface NavanState {
  tokenRequests: { grantType: string; clientId: string; sentScope: boolean }[];
  calls: {
    method: string;
    path: string;
    query: Record<string, string>;
    region: string | null;
    status: number;
  }[];
  options: Record<string, { value: string; label: string; active: boolean }[]>;
  patches: { transactions: Record<string, unknown>[] }[];
  jobs: { id: string; fieldId: string; operations: number; polls: number; status: string }[];
}

export async function navanState(path?: string): Promise<NavanState> {
  const api = await mockApi();
  const res = await api.get('/_control/navan/state', { params: path ? { path } : {} });
  return (await res.json()) as NavanState;
}

export async function navanOption(fieldId: string, value: string) {
  return (await navanState()).options[fieldId]?.find((o) => o.value === value) ?? null;
}
