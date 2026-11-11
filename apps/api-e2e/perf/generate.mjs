#!/usr/bin/env node
// Phase 17 large-dataset generator. Grows the ledger through the product's own commands, so that
// balances, the nightly rebuild check and the audit hash chain stay consistent: writing rows directly
// would break the invariants the performance run is meant to be measured with.
//
// How: one mapping rule matches lines carrying the memo marker PERF-GEN and charges them to New York
// Events (hard control, USD 15,000.00 available on a fresh seed). Generated actuals are uploaded in
// batches and posted; posting runs every proposed line through the same matching engine a person's
// manual match uses, so each line posts its journal and its audit entry, and hard control is checked
// on every one.
//
// THIS CONSUMES MOST OF THAT BUDGET. Run it only on a stack you reseed afterwards
// (scripts/stack.sh reset): other suites read the seeded figures.
//
// Usage: BF_API_PORT=… BF_KEYCLOAK_PORT=… BF_E2E_PASSWORD=… node apps/api-e2e/perf/generate.mjs \
//          [--plan] [--lines 10000] [--batch 250] [--amount 1.00]
import { randomUUID } from 'node:crypto';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; export the stack's ports and the dev password`);
  return v;
};

const PLAN_ONLY = flag('plan');
const LINES = Number(arg('lines', '10000'));
const BATCH = Number(arg('batch', '250'));
const AMOUNT = arg('amount', '1.00');
const API = `http://localhost:${need('BF_API_PORT')}`;
const ISSUER = `http://localhost:${need('BF_KEYCLOAK_PORT')}/realms/budgetflow`;
const PASSWORD = need('BF_E2E_PASSWORD');
const TENANT = '10000000-0000-4000-8000-000000000001';

// Seeded ids and codes (libs/seed): the target budget, its legal entity and cost center.
const TARGET_BUDGET = '71000000-0000-4000-8000-000000000001'; // New York Events
const US_ENTITY_ID = '20000000-0000-4000-8000-000000000001';
const ENTITY_CODE = 'HYL-US';
const COST_CENTER_CODE = 'CC-US-NYC-300';
const GL_ACCOUNT_CODE = '6100';
const MARKER = 'PERF-GEN';
const DATE = '2026-11-05'; // inside the open November period for the US entity

const HEADER =
  'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,event_code,vendor,memo,reference,original_ref,kind';

async function token(user) {
  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: process.env.BF_E2E_CLIENT_ID ?? 'budgetflow-e2e',
      username: `${user}@example.test`,
      password: PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`token for ${user}: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

let bearer = '';
async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      'x-tenant-id': TENANT,
      'content-type': 'application/json',
      ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const minorOf = (amount) => Math.round(Number(amount) * 100);

bearer = await token('finance.controller');
const budget = await call('GET', `/api/budgets/${TARGET_BUDGET}`);
const availableMinor = budget.available?.underRules?.amountMinor ?? 0;
const neededMinor = LINES * minorOf(AMOUNT);
console.log(`target: ${budget.name} (${budget.currency}), available ${availableMinor / 100}`);
console.log(`plan:   ${LINES} lines x ${AMOUNT} = ${neededMinor / 100} in batches of ${BATCH}`);
if (neededMinor > availableMinor) {
  throw new Error(
    'the plan exceeds the budget available under its rules; hard control would refuse it',
  );
}
if (PLAN_ONLY) process.exit(0);

const rules = await call('GET', '/api/actuals/mapping-rules');
let rule = rules.items.find((r) => r.match?.memoContains === MARKER);
if (!rule) {
  rule = await call('POST', '/api/actuals/mapping-rules', {
    name: 'Performance generator lines to New York Events',
    priority: 9000,
    match: { legalEntityId: US_ENTITY_ID, memoContains: MARKER },
    targetBudgetId: TARGET_BUDGET,
  });
}
console.log(`rule:   ${rule.name}`);

const run = randomUUID().slice(0, 8).toUpperCase();
let posted = 0;
const started = Date.now();
for (let start = 0; start < LINES; start += BATCH) {
  const rows = [];
  for (let i = start; i < Math.min(start + BATCH, LINES); i++) {
    rows.push(
      [
        `PERF-${run}-${String(i).padStart(6, '0')}`,
        DATE,
        AMOUNT,
        'USD',
        ENTITY_CODE,
        COST_CENTER_CODE,
        GL_ACCOUNT_CODE,
        '',
        'Generated vendor',
        `${MARKER} line ${i}`,
        '',
        '',
        'charge',
      ].join(','),
    );
  }
  const batch = await call('POST', '/api/actuals/imports', {
    source: 'erp',
    fileName: `perf-${run}-${start}.csv`,
    content: [HEADER, ...rows].join('\n'),
  });
  const result = await call('POST', `/api/actuals/imports/${batch.id}/post`);
  posted += rows.length;
  const matched = result.summary?.matched ?? result.matched ?? '?';
  console.log(
    `batch ${start / BATCH + 1}: ${rows.length} lines, matched ${matched}, ${posted}/${LINES}`,
  );
}
console.log(`done: ${posted} lines in ${Math.round((Date.now() - started) / 1000)} s`);
