#!/usr/bin/env node
// Phase 17 performance run: autocannon against the running local stack, one read endpoint at a time,
// each as the role that uses it. Writes <out>/results.json and <out>/README.md.
//
// Usage: BF_API_PORT=… BF_KEYCLOAK_PORT=… BF_E2E_PASSWORD=… node apps/api-e2e/perf/run.mjs \
//          [--out evidence/phase-17/perf] [--connections 10] [--duration 15]
//
// Numbers from a laptop stack measure regressions between runs on the same machine, not production
// capacity. autocannon reports fixed percentiles (p50, p90, p97.5, p99); there is no p95, so both
// neighbours are recorded rather than an interpolated figure. A run is only valid if every response
// was 2xx: a fast 403 is not a performance result, so non-2xx responses are counted and reported.
import autocannon from 'autocannon';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; export the stack's ports and the dev password`);
  return v;
};

const OUT = arg('out', 'evidence/phase-17/perf');
const CONNECTIONS = Number(arg('connections', '10'));
const DURATION = Number(arg('duration', '15'));
const API = `http://localhost:${need('BF_API_PORT')}`;
const ISSUER = `http://localhost:${need('BF_KEYCLOAK_PORT')}/realms/budgetflow`;
const PASSWORD = need('BF_E2E_PASSWORD');
const CLIENT = process.env.BF_E2E_CLIENT_ID ?? 'budgetflow-e2e';
const TENANT = '10000000-0000-4000-8000-000000000001'; // the seeded Hyland tenant

// Read paths people hit most, plus the ones that do the most work per request.
const ENDPOINTS = [
  { name: 'Budget list', path: '/api/budgets', user: 'finance.controller' },
  { name: 'Budget summary', path: '/api/budgets/summary', user: 'finance.controller' },
  { name: 'Approval inbox', path: '/api/approvals/inbox', user: 'department.head' },
  { name: 'Budget health dashboard', path: '/api/dashboards/health', user: 'finance.controller' },
  {
    name: 'Report run: budget vs actual',
    path: '/api/reports/budget-vs-actual/run',
    user: 'finance.controller',
  },
  { name: 'Events', path: '/api/events', user: 'finance.controller' },
  { name: 'Actuals', path: '/api/actuals', user: 'finance.controller' },
  { name: 'Audit log', path: '/api/audit/events', user: 'auditor' },
  { name: 'Audit hash-chain verification', path: '/api/audit/verification', user: 'auditor' },
];

async function token(user) {
  const res = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT,
      username: `${user}@example.test`,
      password: PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`token for ${user}: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

const ms = (n) => Math.round(n * 10) / 10;

const results = [];
for (const e of ENDPOINTS) {
  const headers = { authorization: `Bearer ${await token(e.user)}`, 'x-tenant-id': TENANT };
  const probe = await fetch(`${API}${e.path}`, { headers });
  if (!probe.ok)
    throw new Error(`${e.name}: probe returned HTTP ${probe.status}; fix before measuring`);
  const r = await autocannon({
    url: `${API}${e.path}`,
    headers,
    connections: CONNECTIONS,
    duration: DURATION,
  });
  const row = {
    endpoint: e.name,
    path: e.path,
    role: e.user.replace('.', '-'),
    requests: r.requests.total,
    throughput_rps: ms(r.requests.average),
    p50_ms: ms(r.latency.p50),
    p90_ms: ms(r.latency.p90),
    p97_5_ms: ms(r.latency.p97_5),
    p99_ms: ms(r.latency.p99),
    max_ms: ms(r.latency.max),
    non2xx: r.non2xx,
    errors: r.errors,
    timeouts: r.timeouts,
  };
  results.push(row);
  console.log(
    `${row.endpoint.padEnd(32)} ${String(row.throughput_rps).padStart(7)} req/s  p50 ${row.p50_ms} ms  p97.5 ${row.p97_5_ms} ms  non-2xx ${row.non2xx}`,
  );
}

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, 'results.json'),
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      connections: CONNECTIONS,
      durationSeconds: DURATION,
      results,
    },
    null,
    2,
  ) + '\n',
);
const table = [
  '| Endpoint | Role | Requests | Req/s | p50 ms | p90 ms | p97.5 ms | p99 ms | Non-2xx |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map(
    (r) =>
      `| ${r.endpoint} (\`${r.path}\`) | ${r.role} | ${r.requests} | ${r.throughput_rps} | ${r.p50_ms} | ${r.p90_ms} | ${r.p97_5_ms} | ${r.p99_ms} | ${r.non2xx} |`,
  ),
].join('\n');
writeFileSync(join(OUT, 'table.md'), table + '\n');
const bad = results.filter((r) => r.non2xx > 0 || r.errors > 0 || r.timeouts > 0);
if (bad.length) {
  console.error(
    `invalid run: ${bad.map((r) => r.endpoint).join(', ')} returned non-2xx, errors or timeouts`,
  );
  process.exit(1);
}
