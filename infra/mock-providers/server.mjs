// Mock external systems for the BudgetFlow connectors (Phase 12). Every connector in Mock mode talks
// to this server, so functional runs are deterministic and offline. The data is fictional: made-up
// vendors, made-up people, made-up card programs. The only real company name is Hyland.
//
// Credentials here are placeholders. Any bearer token is accepted except one that contains "expired",
// which answers 401 so the "credentials expired" state can be proven.
//
// Control plane (tests only):
//   POST /_control/reset                     forget armed failures and received webhooks
//   POST /_control/arm {path, status, times} make the next `times` calls to `path` fail with `status`
//   GET  /_control/received?path=/receiver/hook   webhook deliveries this server received
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { handleNavan, resetNavan } from './navan.mjs';

const PORT = Number(process.env.PORT ?? 4010);

/** Armed failures: path -> { status, times }. */
const armed = new Map();
/** Webhook deliveries this server received, newest last. */
const received = [];

const json = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
};

const unauthorized = (res) =>
  json(res, 401, { error: '401 Unauthorized: check the client secret' });

const authorized = (req, res) => {
  const header = req.headers['authorization'] ?? '';
  if (!/^Bearer\s+\S+/i.test(header)) {
    unauthorized(res);
    return false;
  }
  if (/expired/i.test(header)) {
    unauthorized(res);
    return false;
  }
  return true;
};

/** Returns a status to fail with when the caller armed one for this path, consuming one use. */
const armedFailure = (path) => {
  const a = armed.get(path);
  if (!a || a.times <= 0) return null;
  a.times -= 1;
  if (a.times <= 0) armed.delete(path);
  return a.status;
};

const since = (url, field, rows) => {
  const from = url.searchParams.get('since') ?? url.searchParams.get('from');
  if (!from) return rows;
  return rows.filter((r) => String(r[field]) >= from);
};

// Fixtures -----------------------------------------------------------------------------------
// November 2026, Hyland India (HYL-IN), United States (HYL-US) and Germany (HYL-DE).

const ERP_GL_LINES = [
  {
    name: 'ERPX-2611-0101',
    posting_date: '2026-11-05',
    debit: '21500.00',
    currency: 'INR',
    company: 'HYL-IN',
    cost_center: 'CC-IN-BLR-200',
    account: '6100',
    project: 'BLR-ANNUAL-26',
    supplier: 'Spice Route Caterers',
    remarks: 'Annual Day stage and lighting',
  },
  {
    name: 'ERPX-2611-0102',
    posting_date: '2026-11-05',
    debit: '7400.00',
    currency: 'INR',
    company: 'HYL-IN',
    cost_center: 'CC-IN-HYD-210',
    account: '6140',
    project: 'HYD-HACK-26',
    supplier: 'City Cabs',
    remarks: 'Hack Week shuttle, second week',
  },
  {
    name: 'ERPX-2611-0103',
    posting_date: '2026-11-06',
    debit: '1250.00',
    currency: 'USD',
    company: 'HYL-US',
    cost_center: 'CC-US-NYC-300',
    account: '6100',
    project: 'NYC-OFFSITE-26',
    supplier: 'Northside Print',
    remarks: 'Offsite signage',
  },
  {
    name: 'ERPX-2612-0104',
    posting_date: '2026-12-01',
    debit: '3300.00',
    currency: 'USD',
    company: 'HYL-US',
    cost_center: 'CC-US-NYC-300',
    account: '6100',
    project: '',
    supplier: 'Harbor View Hotel Group',
    remarks: 'December leadership lunch',
  },
];

const ODOO_MOVE_LINES = ERP_GL_LINES.slice(0, 3).map((l, i) => ({
  id: 7100 + i,
  date: l.posting_date,
  debit: Number(l.debit),
  currency_id: l.currency,
  company_code: l.company,
  analytic_account: l.cost_center,
  account_code: l.account,
  analytic_tag: l.project,
  partner_name: l.supplier,
  name: l.remarks,
}));

const NETSUITE_TRANSACTIONS = ERP_GL_LINES.slice(0, 2).map((l, i) => ({
  tranId: `NS-2611-${20 + i}`,
  tranDate: l.posting_date,
  amount: l.debit,
  currency: { symbol: l.currency },
  subsidiary: { name: l.company },
  department: { name: l.cost_center },
  account: { acctNumber: l.account },
  custbody_event_code: l.project,
  entity: { companyName: l.supplier },
  memo: l.remarks,
}));

const WORKDAY_JOURNAL_LINES = ERP_GL_LINES.slice(2).map((l, i) => ({
  journalLineId: `WD-2611-${40 + i}`,
  accountingDate: l.posting_date,
  amount: l.debit,
  currency: l.currency,
  company: l.company,
  costCenter: l.cost_center,
  ledgerAccount: l.account,
  worktag: l.project,
  supplier: l.supplier,
  memo: l.remarks,
}));

const RAMP_TRANSACTIONS = [
  {
    id: 'RMP-5501',
    user_transaction_time: '2026-11-05',
    amount: '86.40',
    currency_code: 'USD',
    merchant_name: 'Cafe Mocha',
    card_program: 'US corporate card',
    entity_code: 'HYL-US',
    cost_center: 'CC-US-NYC-300',
    gl_account: '6100',
    event_code: '',
    memo: 'Team coffee',
  },
  {
    id: 'RMP-5502',
    user_transaction_time: '2026-11-06',
    amount: '412.00',
    currency_code: 'USD',
    merchant_name: 'Lakeside Banquets',
    card_program: 'US corporate card',
    entity_code: 'HYL-US',
    cost_center: 'CC-US-NYC-300',
    gl_account: '6100',
    event_code: 'NYC-OFFSITE-26',
    memo: 'Offsite extras',
  },
];

const BREX_TRANSACTIONS = [
  {
    id: 'BRX-9001',
    posted_at_date: '2026-11-05',
    amount: { amount: '6400', currency: 'INR' },
    merchant: { raw_descriptor: 'Garden City Catering Co.' },
    card_program: 'India corporate card',
    entity_code: 'HYL-IN',
    cost_center: 'CC-IN-HYD-210',
    gl_account: '6100',
    event_code: 'HYD-HACK-26',
    memo: 'Hack Week snacks',
  },
];

const CONCUR_ENTRIES = [
  {
    ID: 'CNR-77-2001',
    TransactionDate: '2026-11-05',
    TransactionAmount: '86.40',
    TransactionCurrencyCode: 'USD',
    CompanyCode: 'HYL-US',
    CostCenter: 'CC-US-NYC-300',
    AccountCode: '6100',
    EventCode: '',
    VendorDescription: 'Cafe Mocha',
    Description: 'Team coffee (itemised from card)',
    ExpenseTypeName: 'Meals - team',
    CardTransactionId: 'RMP-5501',
  },
  {
    ID: 'CNR-77-2002',
    TransactionDate: '2026-11-06',
    TransactionAmount: '240.00',
    TransactionCurrencyCode: 'USD',
    CompanyCode: 'HYL-US',
    CostCenter: 'CC-US-NYC-300',
    AccountCode: '6100',
    EventCode: 'NYC-OFFSITE-26',
    VendorDescription: 'Harbor View Hotel Group',
    Description: 'Offsite breakfast',
    ExpenseTypeName: 'Meals - team',
    CardTransactionId: '',
  },
  {
    ID: 'CNR-77-2003',
    TransactionDate: '2026-11-06',
    TransactionAmount: '95.00',
    TransactionCurrencyCode: 'USD',
    CompanyCode: 'HYL-US',
    CostCenter: 'CC-US-NYC-300',
    AccountCode: '6100',
    EventCode: '',
    VendorDescription: 'Riverside Wellness',
    Description: 'Wellness session',
    ExpenseTypeName: 'Wellness - other',
    CardTransactionId: '',
  },
];

// Navan (Phase 16a) lives in ./navan.mjs: real paths, OAuth client credentials, windows, jobs.

const COUPA_PURCHASE_ORDERS = [
  {
    id: 'PO-2026-0251',
    'created-at': '2026-11-04',
    total: '1800.00',
    currency: { code: 'USD' },
    'company-code': 'HYL-US',
    'cost-center': 'CC-US-NYC-300',
    account: '6100',
    'event-code': 'NYC-OFFSITE-26',
    supplier: { name: 'Lakeside Banquets' },
    description: 'Offsite room hire, second day',
    'budgetflow-commitment-ref': '',
  },
];

const HR_WORKERS = [
  {
    worker_id: 'EMP-1001',
    legal_company: 'HYL-IN',
    location: 'Bengaluru',
    cost_center: 'CC-IN-BLR-200',
    supervisory_org: 'India Engineering',
    worker_type: 'Employee',
    hire_date: '2026-11-02',
    termination_date: '',
    status: 'joiner',
  },
  {
    worker_id: 'EMP-1002',
    legal_company: 'HYL-IN',
    location: 'Hyderabad',
    cost_center: 'CC-IN-HYD-210',
    supervisory_org: 'India Engineering',
    worker_type: 'Employee',
    hire_date: '2026-11-03',
    termination_date: '',
    status: 'joiner',
  },
  {
    worker_id: 'EMP-0912',
    legal_company: 'HYL-US',
    location: 'Remote - Europe',
    cost_center: '',
    supervisory_org: 'US Marketing',
    worker_type: 'Employee',
    hire_date: '2024-05-01',
    termination_date: '2026-11-04',
    status: 'leaver',
  },
];

const CALENDAR_RESPONSES = [
  { id: 'CAL-7001', attendee: 'rahul.verma@example.test', response: 'accepted', at: '2026-11-05' },
  { id: 'CAL-7002', attendee: 'emma.clarke@example.test', response: 'declined', at: '2026-11-05' },
  { id: 'CAL-7003', attendee: 'tom.reilly@example.test', response: 'tentative', at: '2026-11-06' },
];

const ADAPTIVE_PLAN = {
  version: 'FY2027 Budget, Approved',
  fiscalYear: 'FY2027',
  currency: 'USD',
  levels: [
    { level: 'Employee programs', amount: '110000.00' },
    { level: 'Reserve', amount: '10000.00' },
    { level: 'Innovation lab', amount: '15000.00' },
  ],
};

// Marketplace partners (Phase 16, 092d). Fictional partners with fictional prices.
//
// Booking answers are *stored*, not queued: a scenario arms the answer for the booking id it just
// created, and the catalogue keeps returning it. Nothing another scenario does can consume it, so
// two runs in the same stack never race for the same armed reply.
const PARTNER_CATALOGUES = {
  cityquest: [
    {
      externalRef: 'CQ-TREASURE-BLR',
      title: 'Team treasure hunt, Bengaluru',
      category: 'experiences',
      city: 'Bengaluru',
      pricePerHeadMinor: 185000,
      currency: 'INR',
      capacityMin: 20,
      capacityMax: 120,
      ratingBps: 45000,
      ratingCount: 4,
      includes: ['Two game masters', 'Props and clue kits', 'Prizes for the winning team'],
      cancellationTerms: 'Free until 7 days before; half the deposit after that.',
      deliveryCountries: [],
    },
    {
      externalRef: 'CQ-ESCAPE-HYD',
      title: 'Escape room afternoon, Hyderabad',
      category: 'experiences',
      city: 'Hyderabad',
      pricePerHeadMinor: 140000,
      currency: 'INR',
      capacityMin: 10,
      capacityMax: 60,
      ratingBps: 42000,
      ratingCount: 2,
      includes: ['Three rooms booked out', 'Host and scorekeeping'],
      cancellationTerms: 'Free until 5 days before.',
      deliveryCountries: [],
    },
  ],
  'fresh-plate': [
    {
      externalRef: 'FP-FESTIVAL-HYD',
      title: 'Festival buffet, Hyderabad',
      category: 'catering',
      city: 'Hyderabad',
      pricePerHeadMinor: 140000,
      currency: 'INR',
      capacityMin: 50,
      capacityMax: 400,
      ratingBps: 40000,
      ratingCount: 3,
      includes: ['Vegetarian and vegan counters', 'Service staff', 'Crockery and clearing'],
      cancellationTerms: 'Final numbers 3 days before; deposit held after that.',
      deliveryCountries: [],
    },
  ],
  'kindly-gifts': [
    {
      externalRef: 'KG-SNACK-KIT',
      title: 'Snack and team kit',
      category: 'gifts_and_kits',
      city: 'Bengaluru',
      pricePerHeadMinor: 3500,
      currency: 'USD',
      capacityMin: 1,
      capacityMax: 2000,
      ratingBps: 44000,
      ratingCount: 6,
      includes: ['Snack box', 'Notebook and pen', 'Delivery'],
      cancellationTerms: 'Free until dispatch.',
      deliveryCountries: ['IN', 'US', 'GB'],
    },
  ],
};

/** booking id -> the answer the partner will give for it. */
const partnerAnswers = new Map();

// Routing ------------------------------------------------------------------------------------

/** path -> handler for GET fetches. Each returns the provider's own envelope shape. */
const FETCH_ROUTES = {
  '/erpnext/api/resource/GL Entry': (url) => ({
    data: since(url, 'posting_date', ERP_GL_LINES),
  }),
  '/erpnext/api/resource/Supplier': () => ({
    data: [{ name: 'Deccan Event Studio', tax_id: 'IN-FICTIONAL-01' }],
  }),
  '/odoo/jsonrpc/account.move.line': (url) => ({
    result: since(url, 'date', ODOO_MOVE_LINES),
  }),
  '/netsuite/services/rest/record/v1/transaction': (url) => ({
    items: since(url, 'tranDate', NETSUITE_TRANSACTIONS),
  }),
  '/workday-financials/ccx/api/v1/journalLines': (url) => ({
    data: since(url, 'accountingDate', WORKDAY_JOURNAL_LINES),
  }),
  '/ramp/developer/v1/transactions': (url) => ({
    data: since(url, 'user_transaction_time', RAMP_TRANSACTIONS),
  }),
  '/brex/v2/transactions/card/primary': (url) => ({
    items: since(url, 'posted_at_date', BREX_TRANSACTIONS),
  }),
  '/concur/api/v3.0/expense/entries': (url) => ({
    Items: since(url, 'TransactionDate', CONCUR_ENTRIES),
  }),
  '/coupa/api/purchase_orders': (url) => since(url, 'created-at', COUPA_PURCHASE_ORDERS),
  '/hr/api/workers': () => ({ workers: HR_WORKERS }),
  '/workday-hcm/ccx/api/v1/workers': () => ({ data: HR_WORKERS }),
  '/graph/v1.0/shared-calendar/events/responses': () => ({ value: CALENDAR_RESPONSES }),
  '/gcal/calendar/v3/calendars/budgetflow/events/responses': () => ({ items: CALENDAR_RESPONSES }),
  '/adaptive/api/v2/plan': () => ADAPTIVE_PLAN,
};

/** path -> handler for POST pushes. Each answers with the external id it created. */
const PUSH_ROUTES = {
  '/erpnext/api/resource/Project': (body) => ({ data: { name: `PRJ-${body.reference}` } }),
  '/odoo/jsonrpc/account.analytic.tag': (body) => ({ result: { id: `TAG-${body.reference}` } }),
  '/netsuite/services/rest/record/v1/customsegment': (body) => ({ id: `SEG-${body.reference}` }),
  '/workday-financials/ccx/api/v1/worktags': (body) => ({ id: `WT-${body.reference}` }),
  '/ramp/developer/v1/limits': (body) => ({ id: `RMPLIM-${body.reference}` }),
  '/brex/v2/budgets': (body) => ({ id: `BRXBUD-${body.reference}` }),
  '/concur/api/v3.0/common/listitems': (body) => ({ ID: `LIST-${body.reference}` }),
  '/coupa/api/custom_fields': (body) => ({ id: `CPA-${body.reference}` }),
  '/adaptive/api/v2/actuals': (body) => ({ id: `ADP-${body.reference}` }),
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => resolve(raw));
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  if (path === '/health') return json(res, 200, { ok: true });

  // Control plane ------------------------------------------------------------------------------
  if (path === '/_control/reset' && req.method === 'POST') {
    armed.clear();
    received.length = 0;
    partnerAnswers.clear();
    resetNavan();
    return json(res, 200, { reset: true });
  }
  // Decides what a marketplace partner will answer for one booking (Phase 16, 092d).
  if (path === '/_control/partner-answer' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (!body.bookingId) return json(res, 422, { error: 'bookingId is required' });
    partnerAnswers.set(body.bookingId, { ...body });
    return json(res, 200, { armed: body.bookingId });
  }
  if (path === '/_control/arm' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    armed.set(body.path, { status: body.status ?? 500, times: body.times ?? 1 });
    return json(res, 200, { armed: body.path, status: body.status, times: body.times });
  }
  if (path === '/_control/received') {
    const want = url.searchParams.get('path');
    return json(res, 200, {
      items: want ? received.filter((r) => r.path === want) : received,
    });
  }

  // Marketplace partner catalogue: offers plus any answers to bookings it was asked about -------
  const catalogue = /^\/partners\/([a-z0-9-]+)\/catalogue$/.exec(path);
  if (catalogue && req.method === 'GET') {
    const offers = PARTNER_CATALOGUES[catalogue[1]];
    if (!offers) return json(res, 404, { error: `no mock partner ${catalogue[1]}` });
    const failed = armedFailure(path);
    if (failed) return json(res, failed, { error: 'The partner is unavailable' });
    return json(res, 200, { offers, bookingAnswers: [...partnerAnswers.values()] });
  }

  // Webhook receivers: where BudgetFlow delivers its signed outbound webhooks -------------------
  if (path === '/receiver/hook' || path === '/receiver/flaky-hook') {
    const raw = await readBody(req);
    const signature = String(req.headers['budgetflow-signature'] ?? '');
    const secret = String(req.headers['x-mock-verify-secret'] ?? '');
    let signatureValid = null;
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signature);
    if (secret && match) {
      const expected = createHmac('sha256', secret).update(`${match[1]}.${raw}`).digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(match[2]);
      signatureValid = a.length === b.length && timingSafeEqual(a, b);
    }
    received.push({
      path,
      at: new Date().toISOString(),
      signature,
      signatureValid,
      body: raw ? JSON.parse(raw) : null,
    });
    const failure = armedFailure(path);
    if (failure) return json(res, failure, { error: 'receiver unavailable' });
    return json(res, 200, { received: true });
  }

  const failure = armedFailure(path);
  if (failure) {
    // Rate limits say when to come back, as real providers do.
    const retryAfter = failure === 429 ? { 'retry-after': '1' } : {};
    return json(
      res,
      failure,
      {
        error:
          failure === 401
            ? '401 Unauthorized: check the client secret'
            : failure === 429
              ? 'Too many requests'
              : 'The provider is unavailable',
      },
      retryAfter,
    );
  }

  // Navan authenticates with its own OAuth tokens and region rules, so it routes before the shared
  // bearer check.
  if (await handleNavan(req, res, url, path, readBody)) return;

  if (!authorized(req, res)) return;

  if (req.method === 'GET') {
    const handler = FETCH_ROUTES[path];
    if (handler) return json(res, 200, handler(url));
  }
  if (req.method === 'POST') {
    const handler = PUSH_ROUTES[path];
    if (handler) {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.reference) return json(res, 422, { error: 'reference is required' });
      if (String(body.reference).startsWith('DUP-'))
        return json(res, 409, { error: 'duplicate external id' });
      return json(res, 201, handler(body));
    }
  }
  return json(res, 404, { error: `no mock route for ${req.method} ${path}` });
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`mock-providers listening on ${PORT}`);
});
