// Mock of the Navan Expense API for Phase 16a (gap package B1). Paths and shapes follow Navan's public
// developer documentation as summarised in docs/research/navan-integration.md; where the documentation
// does not name a value (the token path, the region header, the job status words), the mock picks one
// and docs/architecture/navan-integration.md lists it as a value to confirm before live use. All data is fictional.
//
// Behaviour the contract tests rely on:
//   - OAuth 2.0 client credentials at POST /navan/v1/oauth/token (form body). Tokens last 12 hours.
//     A `scope` parameter strips the Expense Write scope, as the documentation warns. A client id
//     containing "readonly" never gets write. A client secret containing "expired" is refused.
//   - Client ids containing "-eu" are EU accounts: every call must carry `x-navan-region: eu`.
//   - Transaction lists need a modified-date window (`modifiedFrom`, `modifiedTo`) of at most 93
//     days, page with `limit` (1-500) and `cursor`, and answer `{ data, nextCursor }`.
//   - PATCH /transactions takes at most 100 items and needs the write scope.
//   - Custom-field options change through async batch jobs (at most 5,000 operations) that report
//     IN_PROGRESS on the first poll and COMPLETED on the next.
//   - Receipts are presigned links that expire after 7 days.
//
// Control plane (tests only):
//   GET  /_control/navan/state                 tokens issued, calls received, options, patches
//   POST /_control/navan/transactions {items}  add transactions (merged with the fixtures by id)
//   POST /_control/navan/users {items}         add users
//   POST /_control/navan/expire-tokens         every issued token answers 401 from now on

const DAY_MS = 86_400_000;
const MAX_WINDOW_DAYS = 93;
const MAX_PAGE = 500;
const MAX_PATCH = 100;
const MAX_JOB_OPERATIONS = 5000;
const TOKEN_SECONDS = 12 * 60 * 60;
const RECEIPT_SECONDS = 7 * 24 * 60 * 60;
const REGION_HEADER = 'x-navan-region';

export const NAVAN_BASE = '/navan/v1/expense';

/** Path segment per transaction type, as listed in the documentation. */
const TYPE_PATHS = {
  'card-transactions': 'CARD',
  'connect-transactions': 'CONNECT',
  'manual-transactions': 'MANUAL',
  repayments: 'REPAYMENT',
  fees: 'FEE',
  adjustments: 'ADJUSTMENT',
  'daily-rebates': 'REBATE',
  disputes: 'DISPUTE',
};

/** Custom fields defined in the fictional Navan account. Options are what BudgetFlow publishes. */
const FIELDS = [
  { id: 'cf-event-code', name: 'Event code', type: 'LIST' },
  { id: 'cf-cost-center', name: 'Cost center', type: 'LIST' },
  { id: 'cf-trip-purpose', name: 'Trip purpose', type: 'TEXT' },
];

const tx = (t) => ({
  hrFields: {},
  glCode: null,
  customFields: [],
  receipt: null,
  originalTransactionId: null,
  erpSyncStatus: 'NOT_SYNCED',
  ...t,
});

/**
 * November 2026 fixtures for the demo stack and the connect journey. Scenarios add their own through
 * the control plane with ids they own, so they never depend on these.
 */
const FIXTURE_TRANSACTIONS = [
  tx({
    id: 'NVN-CARD-1001',
    type: 'CARD',
    transactionDate: '2026-11-04',
    modifiedAt: '2026-11-05T08:00:00.000Z',
    amount: '220.00',
    currency: 'GBP',
    merchant: 'Thames Side Hotel',
    description: 'London hotel, one night',
    user: { id: 'nvn-u-07', email: 'department.head@example.test' },
    hrFields: { subsidiary: 'HYL-UK', costCenter: 'CC-EU-LON-410', department: 'LON-SALES' },
    glCode: '6140',
    receiptToken: 'rcpt-1001',
  }),
  tx({
    id: 'NVN-CONNECT-1002',
    type: 'CONNECT',
    transactionDate: '2026-11-06',
    modifiedAt: '2026-11-06T18:00:00.000Z',
    amount: '412.00',
    currency: 'USD',
    merchant: 'Lakeside Banquets',
    description: 'Offsite extras (card linked in Navan)',
    user: { id: 'nvn-u-06', email: 'budget.owner@example.test' },
    hrFields: { subsidiary: 'HYL-US', costCenter: 'CC-US-NYC-300' },
    glCode: '6100',
    customFields: [{ fieldId: 'cf-event-code', value: 'NYC-OFFSITE-26' }],
  }),
  tx({
    id: 'NVN-MANUAL-1003',
    type: 'MANUAL',
    transactionDate: '2026-11-07',
    modifiedAt: '2026-11-08T09:30:00.000Z',
    amount: '64.50',
    currency: 'USD',
    merchant: 'Metro Taxi',
    description: 'Reimbursement: airport taxi',
    user: { id: 'nvn-u-06', email: 'budget.owner@example.test' },
    hrFields: { subsidiary: 'HYL-US', costCenter: 'CC-US-NYC-300' },
    glCode: '6140',
  }),
  tx({
    id: 'NVN-FEE-1004',
    type: 'FEE',
    transactionDate: '2026-11-08',
    modifiedAt: '2026-11-08T12:00:00.000Z',
    amount: '3.20',
    currency: 'USD',
    merchant: 'Navan',
    description: 'Foreign transaction fee',
    user: { id: 'nvn-u-06', email: 'budget.owner@example.test' },
    hrFields: { subsidiary: 'HYL-US', costCenter: 'CC-US-NYC-300' },
    glCode: '6900',
  }),
  tx({
    id: 'NVN-REPAY-1005',
    type: 'REPAYMENT',
    transactionDate: '2026-11-09',
    modifiedAt: '2026-11-09T10:00:00.000Z',
    amount: '-20.00',
    currency: 'USD',
    merchant: 'Metro Taxi',
    description: 'Employee repaid a personal part of a reimbursement',
    user: { id: 'nvn-u-06', email: 'budget.owner@example.test' },
    hrFields: { subsidiary: 'HYL-US', costCenter: 'CC-US-NYC-300' },
    originalTransactionId: 'NVN-MANUAL-1003',
  }),
  tx({
    id: 'NVN-REBATE-1006',
    type: 'REBATE',
    transactionDate: '2026-11-10',
    modifiedAt: '2026-11-10T23:00:00.000Z',
    amount: '-1.10',
    currency: 'USD',
    merchant: 'Navan',
    description: 'Daily card rebate',
    user: { id: 'nvn-u-06', email: 'budget.owner@example.test' },
    hrFields: { subsidiary: 'HYL-US', costCenter: 'CC-US-NYC-300' },
  }),
];

const FIXTURE_USERS = [
  { id: 'nvn-u-06', email: 'budget.owner@example.test', name: 'Jordan Smith', active: true },
  { id: 'nvn-u-07', email: 'department.head@example.test', name: 'Lena Fischer', active: true },
  { id: 'nvn-u-99', email: 'contractor.one@example.test', name: 'Casey Contractor', active: true },
];

const state = {
  /** token -> { clientId, scopes, region, expiresAt } */
  tokens: new Map(),
  tokenRequests: [],
  calls: [],
  extraTransactions: new Map(),
  extraUsers: new Map(),
  /** fieldId -> Map(value -> { value, label, active }) */
  options: new Map(),
  jobs: new Map(),
  patches: [],
  counter: 0,
};

export function resetNavan() {
  state.tokens.clear();
  state.tokenRequests.length = 0;
  state.calls.length = 0;
  state.extraTransactions.clear();
  state.extraUsers.clear();
  state.options.clear();
  state.jobs.clear();
  state.patches.length = 0;
}

const send = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
};

/** A deterministic, tiny PNG so a stored receipt passes the DocumentStore's signature check. */
const RECEIPT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const allTransactions = () => {
  const byId = new Map(FIXTURE_TRANSACTIONS.map((t) => [t.id, t]));
  for (const [id, t] of state.extraTransactions) byId.set(id, tx(t));
  return [...byId.values()];
};

const allUsers = () => {
  const byId = new Map(FIXTURE_USERS.map((u) => [u.id, u]));
  for (const [id, u] of state.extraUsers) byId.set(id, u);
  return [...byId.values()];
};

/** What the API returns for a transaction: the receipt token becomes a presigned link. */
const present = (t, origin) => {
  const { receiptToken, receiptIssuedAt, ...rest } = t;
  if (!receiptToken) return { ...rest, receipt: null };
  const issued = receiptIssuedAt ? Date.parse(receiptIssuedAt) : Date.now();
  const expires = Math.floor(issued / 1000) + RECEIPT_SECONDS;
  return {
    ...rest,
    receipt: {
      url: `${origin}/navan/receipts/${encodeURIComponent(t.id)}?token=${receiptToken}&expires=${expires}`,
      contentType: 'image/png',
      expiresAt: new Date(expires * 1000).toISOString(),
    },
  };
};

const page = (rows, url) => {
  const limit = Number(url.searchParams.get('limit') ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    return { error: `limit must be between 1 and ${MAX_PAGE}` };
  }
  const cursor = url.searchParams.get('cursor');
  const offset = cursor ? Number(Buffer.from(cursor, 'base64url').toString()) : 0;
  const slice = rows.slice(offset, offset + limit);
  const next = offset + limit < rows.length;
  return {
    data: slice,
    nextCursor: next ? Buffer.from(String(offset + limit)).toString('base64url') : null,
  };
};

const readForm = (raw) => Object.fromEntries(new URLSearchParams(raw));

/** The bearer token's grant, or a reason it is refused. */
const grantFor = (req) => {
  const header = String(req.headers['authorization'] ?? '');
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return { status: 401, error: 'Missing bearer token' };
  const grant = state.tokens.get(m[1]);
  if (!grant) return { status: 401, error: 'Unknown token' };
  if (grant.revoked || grant.expiresAt < Date.now())
    return { status: 401, error: 'The access token has expired' };
  if (grant.region === 'eu' && String(req.headers[REGION_HEADER] ?? '').toLowerCase() !== 'eu') {
    return {
      status: 400,
      error: `This account is hosted in the EU region; send the ${REGION_HEADER} header`,
    };
  }
  return { grant };
};

const applyJob = (job) => {
  const field = state.options.get(job.fieldId) ?? new Map();
  state.options.set(job.fieldId, field);
  job.results = job.operations.map((op) => {
    if (!op.value)
      return { value: op.value, action: op.action, status: 'FAILED', error: 'value is required' };
    if (String(op.value).startsWith('REJECT-'))
      return {
        value: op.value,
        action: op.action,
        status: 'FAILED',
        error: 'Option value is not allowed',
      };
    if (op.action === 'DELETE') {
      field.delete(op.value);
    } else {
      const prev = field.get(op.value);
      field.set(op.value, {
        value: op.value,
        label: op.label ?? prev?.label ?? op.value,
        active: op.active ?? prev?.active ?? true,
      });
    }
    return { value: op.value, action: op.action, status: 'SUCCEEDED', error: null };
  });
  job.status = 'COMPLETED';
};

/**
 * Handles a Navan or Navan-control request. Returns false when the path is not Navan's, so the main
 * server can carry on routing.
 */
export async function handleNavan(req, res, url, path, readBody) {
  if (path === '/_control/navan/state') {
    const want = url.searchParams.get('path');
    return (
      send(res, 200, {
        tokenRequests: state.tokenRequests,
        calls: want ? state.calls.filter((c) => c.path.startsWith(want)) : state.calls,
        options: Object.fromEntries(
          [...state.options.entries()].map(([id, m]) => [id, [...m.values()]]),
        ),
        patches: state.patches,
        jobs: [...state.jobs.values()].map((j) => ({
          id: j.id,
          fieldId: j.fieldId,
          operations: j.operations.length,
          polls: j.polls,
          status: j.status,
        })),
      }),
      true
    );
  }
  if (path === '/_control/navan/transactions' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    for (const t of body.items ?? []) state.extraTransactions.set(t.id, t);
    return (send(res, 200, { added: (body.items ?? []).length }), true);
  }
  if (path === '/_control/navan/users' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    for (const u of body.items ?? []) state.extraUsers.set(u.id, u);
    return (send(res, 200, { added: (body.items ?? []).length }), true);
  }
  if (path === '/_control/navan/expire-tokens' && req.method === 'POST') {
    for (const g of state.tokens.values()) g.revoked = true;
    return (send(res, 200, { expired: state.tokens.size }), true);
  }

  // Receipts: presigned, no bearer token, valid for seven days from issue.
  const receipt = /^\/navan\/receipts\/([^/]+)$/.exec(path);
  if (receipt && req.method === 'GET') {
    const id = decodeURIComponent(receipt[1]);
    const t = allTransactions().find((x) => x.id === id);
    const expires = Number(url.searchParams.get('expires') ?? 0);
    if (!t || url.searchParams.get('token') !== t.receiptToken)
      return (send(res, 403, { error: 'Signature does not match' }), true);
    if (expires * 1000 < Date.now())
      return (send(res, 403, { error: 'Request has expired' }), true);
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': RECEIPT_PNG.length });
    res.end(RECEIPT_PNG);
    return true;
  }

  if (!path.startsWith('/navan/')) return false;
  const origin = `http://${req.headers.host ?? 'mock-providers:4010'}`;

  if (path === '/navan/v1/oauth/token' && req.method === 'POST') {
    const form = readForm(await readBody(req));
    state.tokenRequests.push({
      at: new Date().toISOString(),
      grantType: form.grant_type ?? null,
      clientId: form.client_id ?? null,
      sentScope: 'scope' in form,
    });
    if (form.grant_type !== 'client_credentials')
      return (send(res, 400, { error: 'unsupported_grant_type' }), true);
    if (!form.client_id || !form.client_secret || /expired/i.test(form.client_secret))
      return (send(res, 401, { error: 'invalid_client: check the client id and secret' }), true);
    const write = !('scope' in form) && !/readonly/i.test(form.client_id);
    const scopes = write ? ['expense:read', 'expense:write'] : ['expense:read'];
    state.counter += 1;
    const token = `nvn-access-${state.counter}`;
    state.tokens.set(token, {
      clientId: form.client_id,
      scopes,
      region: /-eu\b|-eu-/i.test(form.client_id) ? 'eu' : 'us',
      expiresAt: Date.now() + TOKEN_SECONDS * 1000,
    });
    return (
      send(res, 200, {
        access_token: token,
        token_type: 'Bearer',
        expires_in: TOKEN_SECONDS,
        scope: scopes.join(' '),
      }),
      true
    );
  }

  const auth = grantFor(req);
  state.calls.push({
    at: new Date().toISOString(),
    method: req.method,
    path,
    query: Object.fromEntries(url.searchParams),
    region: req.headers[REGION_HEADER] ?? null,
    status: auth.grant ? 200 : auth.status,
  });
  if (state.calls.length > 5000) state.calls.splice(0, state.calls.length - 5000);
  if (!auth.grant) return (send(res, auth.status, { error: auth.error }), true);
  const canWrite = auth.grant.scopes.includes('expense:write');
  const sub = path.slice(NAVAN_BASE.length);

  // Transactions by type, by modified-date window.
  const typePath = /^\/([a-z-]+)$/.exec(sub)?.[1];
  if (req.method === 'GET' && typePath && TYPE_PATHS[typePath]) {
    const from = url.searchParams.get('modifiedFrom');
    const to = url.searchParams.get('modifiedTo');
    if (!from || !to)
      return (
        send(res, 400, {
          error: 'At least one date filter is required (modifiedFrom and modifiedTo)',
        }),
        true
      );
    const span = (Date.parse(to) - Date.parse(from)) / DAY_MS;
    if (!(span >= 0) || span > MAX_WINDOW_DAYS)
      return (
        send(res, 400, { error: `A date range can cover at most ${MAX_WINDOW_DAYS} days` }),
        true
      );
    const rows = allTransactions()
      .filter((t) => t.type === TYPE_PATHS[typePath])
      .filter((t) => t.modifiedAt >= from && t.modifiedAt < to)
      .sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt) || a.id.localeCompare(b.id))
      .map((t) => present(t, origin));
    const p = page(rows, url);
    if (p.error) return (send(res, 400, { error: p.error }), true);
    return (send(res, 200, p), true);
  }

  if (sub === '/transactions' && req.method === 'GET') {
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
    if (ids.length === 0 || ids.length > MAX_PATCH)
      return (send(res, 400, { error: `Look up between 1 and ${MAX_PATCH} ids` }), true);
    const rows = allTransactions()
      .filter((t) => ids.includes(t.id))
      // A fresh lookup issues fresh receipt links.
      .map((t) => present({ ...t, receiptIssuedAt: undefined }, origin));
    return (send(res, 200, { data: rows, nextCursor: null }), true);
  }

  if (sub === '/transactions' && req.method === 'PATCH') {
    if (!canWrite)
      return (send(res, 403, { error: 'This credential lacks the Expense: Write scope' }), true);
    const body = JSON.parse((await readBody(req)) || '{}');
    const items = body.transactions ?? [];
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_PATCH)
      return (
        send(res, 400, { error: `Send between 1 and ${MAX_PATCH} transactions per call` }),
        true
      );
    if (items.some((i) => 'erpSyncStatus' in i && i.erpSyncStatus !== 'SYNCED'))
      return (send(res, 400, { error: 'erpSyncStatus can only be set to SYNCED' }), true);
    state.patches.push({ at: new Date().toISOString(), transactions: items });
    return (
      send(res, 200, {
        results: items.map((i) => ({ id: i.id, status: 'UPDATED' })),
      }),
      true
    );
  }

  if (sub === '/users' && req.method === 'GET') {
    const p = page(
      allUsers().sort((a, b) => a.id.localeCompare(b.id)),
      url,
    );
    if (p.error) return (send(res, 400, { error: p.error }), true);
    return (send(res, 200, p), true);
  }

  if (sub === '/custom-fields' && req.method === 'GET') {
    return (
      send(res, 200, {
        data: FIELDS.map((f) => ({ ...f, optionCount: state.options.get(f.id)?.size ?? 0 })),
        nextCursor: null,
      }),
      true
    );
  }

  const batch = /^\/custom-fields\/([^/]+)\/options\/batch$/.exec(sub);
  if (batch && req.method === 'POST') {
    if (!canWrite)
      return (send(res, 403, { error: 'This credential lacks the Expense: Write scope' }), true);
    const field = FIELDS.find((f) => f.id === batch[1]);
    if (!field || field.type !== 'LIST')
      return (send(res, 404, { error: `No list field ${batch[1]}` }), true);
    const body = JSON.parse((await readBody(req)) || '{}');
    const operations = body.operations ?? [];
    if (
      !Array.isArray(operations) ||
      operations.length === 0 ||
      operations.length > MAX_JOB_OPERATIONS
    )
      return (
        send(res, 400, { error: `A job takes between 1 and ${MAX_JOB_OPERATIONS} operations` }),
        true
      );
    state.counter += 1;
    const job = {
      id: `nvn-job-${state.counter}`,
      fieldId: field.id,
      operations,
      polls: 0,
      status: 'PENDING',
      results: null,
    };
    state.jobs.set(job.id, job);
    return (send(res, 202, { jobId: job.id, status: 'PENDING' }), true);
  }

  const job = /^\/custom-fields\/jobs\/([^/]+)$/.exec(sub);
  if (job && req.method === 'GET') {
    const j = state.jobs.get(job[1]);
    if (!j) return (send(res, 404, { error: `No job ${job[1]}` }), true);
    j.polls += 1;
    if (j.polls === 1) j.status = 'IN_PROGRESS';
    else if (j.status !== 'COMPLETED') applyJob(j);
    return (
      send(res, 200, {
        jobId: j.id,
        status: j.status,
        results: j.status === 'COMPLETED' ? j.results : null,
      }),
      true
    );
  }

  return (send(res, 404, { error: `no mock route for ${req.method} ${path}` }), true);
}
