# Phase 10 — Reports, dashboards and analytics (backend half)

Backend only. The Angular screens, Playwright journeys and visual baselines are a separate change by
the frontend agent; nothing here renders UI.

Branch `feat/p10-reports-backend`, worktree `../budget-delegation-and-control-worktrees/p10-reports`,
compose project `bf-p10-reports` (API 3100, Keycloak 8180, Postgres 5532, Mailpit 8125).

## What was built

| Area          | Where                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Contracts     | `libs/contracts/src/lib/domains/reports.ts` (15 endpoints), regenerated `libs/contracts/openapi/openapi.json`                    |
| Authorization | new action `report.schedule` in `libs/domain/.../policy.ts` and `docs/architecture/authorization.md`                             |
| Schema        | migration `0012_p10_reports` — `report_saved_views`, `report_schedules`, `report_schedule_runs`, `report_exports`, all FORCE RLS |
| Domain        | `libs/domain/src/lib/reports/{health,schedule}.ts` — the five health checks and the delivery cadence, both framework-free        |
| API           | `libs/api/reports` — report frame over ledger read models, health overview, saved views, schedules, exports                      |
| Worker        | `report.deliver` job and the `report.schedule_sweep` cron (every 5 minutes) in `apps/worker/src/app/jobs.service.ts`             |
| Seed          | prefix 81: three saved views, the three schedules of screen 091, one delivered run and its export                                |
| Scenarios     | `apps/api-e2e/src/reports/{reconciliation,scope,schedules,health}.spec.ts` (24 scenarios)                                        |

## Reports delivered

Nine report definitions served through one frame (`GET /api/reports/{reportId}/run`):
`budget-vs-actual` (080), `allocation` (081), `utilization` (082), `location-comparison` (083),
`department-comparison` (084), `event-spending` (085), `unused-expired` (086), `spend-per-head`
(015a), `participation-reach` (015b). Budget health overview (013) is `GET /api/dashboards/health`.

## Reconciliation to the ledger

Every run carries a `reconciliation` block built from `ledger_balances` for the budgets in scope.
Authorized is summed net of allocated out, so a parent and its children never count the same money
twice; Available is `Authorized − Held − Pre-encumbered − Encumbered − Actual`. Each report declares
which money columns must equal (or, for event money, not exceed) which buckets; a mismatch is
reported in `differences` and sets `ties: false`.

Measured on the seeded stack — every report over the whole tenant reports the same ledger totals:

```text
api/reconciliation-summary.txt
utilization            rows= 556 ties=True authorized=  3412149100 actual=   6047955 available=  3387398314 diffs=0
budget-vs-actual       rows= 556 ties=True authorized=  3412149100 actual=   6047955 available=  3387398314 diffs=0
allocation             rows= 556 ties=True authorized=  3412149100 actual=   6047955 available=  3387398314 diffs=0
location-comparison    rows=   9 ties=True authorized=  3412149100 actual=   6047955 available=  3387398314 diffs=0
department-comparison  rows=   2 ties=True authorized=  3412149100 actual=   6047955 available=  3387398314 diffs=0
event-spending         rows=  51 ties=True authorized=  3412149100 actual=   6047955 available=  3387398314 diffs=0
spend-per-head         rows=   9 ties=True authorized=  3412149100 actual=   6047955 available=  3387398314 diffs=0
participation-reach    rows=   5 ties=True authorized=  3412149100 actual=   6047955 available=  3387398314 diffs=0
unused-expired         rows= 556 ties=True authorized=  3412149100 actual=   6047955 available=  3387398314 diffs=0
```

## Functional outcome

| Outcome                                                                           | Proven by                             | Result |
| --------------------------------------------------------------------------------- | ------------------------------------- | ------ |
| Report totals equal the ledger buckets, child allocations counted once            | `reports/reconciliation.spec.ts`      | pass   |
| The same figures come back from `GET /api/budgets/{id}`                           | `reports/reconciliation.spec.ts`      | pass   |
| A drill-down returns the ledger lines (with the currency triplet) behind a figure | `reports/reconciliation.spec.ts`      | pass   |
| FX never consumes budget: a non-USD child reports at the locked plan rate         | `reports/reconciliation.spec.ts`      | pass   |
| The allocation report ties each parent to its children                            | `reports/reconciliation.spec.ts`      | pass   |
| Tenant roles report company-wide; owners see their subtree only                   | `reports/scope.spec.ts`               | pass   |
| An owner cannot widen the scope; employees and organizers get no reports          | `reports/scope.spec.ts`               | pass   |
| Figures never cross a tenant boundary, with or without a forged `X-Tenant-Id`     | `reports/scope.spec.ts`               | pass   |
| Schedule mutations are idempotent and leave exactly one audit entry each          | `reports/schedules.spec.ts`           | pass   |
| A recipient outside the scope is marked and skipped, never silently included      | `reports/schedules.spec.ts`           | pass   |
| Only channels the chat installation allows are accepted                           | `reports/schedules.spec.ts`           | pass   |
| Run now is queued, delivered by the worker and audited                            | `reports/schedules.spec.ts` + Mailpit | pass   |
| The five health checks explain every Watch and At risk and change nothing         | `reports/health.spec.ts`              | pass   |

24 Phase 10 scenarios pass. The whole API suite is 333 scenarios, all passing.

## Evidence files

- `api/reconciliation-summary.txt` — ledger reconciliation of all nine reports
- `api/utilization-by-location.json` — a report run in the shared frame (first rows)
- `api/event-spending.json` — event spending KPIs and rows
- `api/health-overview.txt` — health summary, matrix size and sample reasons
- `functional/scheduled-delivery-email.txt` — the email a scheduled run produced (Mailpit)
- `db/rls-policies.txt` — FORCE RLS and `tenant_isolation` on all four new tables
- `db/audit-actions.txt` — one audit action per reporting mutation
- `db/channel-posts.txt` — the Slack post carries headline figures with `attachment: false`
- `gate-summary.txt` — `scripts/gate.sh static` result

## Notes for the frontend agent

- The report frame is one shape for every report: `columns` (typed, `drillable`), `rows`
  (`cells` keyed by column), `totals`, `kpis`, `series`, `scope`, `reconciliation`. Render the
  table from `columns` and `cells`; never recompute money in the browser.
- `scope.note` is `"Showing budgets you can see."` exactly when the viewer is scoped; show it as
  the footer note of 079.
- `reconciliation.ties === false` means a figure disagrees with the ledger: surface it, do not hide it.
- Percentages are basis points (`bps`, 10,000 = 100%); money is always the reporting currency.
- Seeded ids for screens 079 and 091 are on `SEED.p10` (`views`, `schedules`, `runs`, `exports`).

## Out of scope / follow-ups

- Forecast and variance (087) and the board pack (16a) need `forecast_snapshots`, a Phase 11 table.
- Exports record what was exported and expire after 7 days, but no file is rendered into the
  DocumentStore yet; `documentId` stays null and the delivery email carries headline figures and a
  link rather than an attachment.
- Red-flag analytics (17b) is Phase 15, commitment hygiene (085a) shipped in Phase 6 and allocation
  history (089) in Phase 4; none of them are part of this change.
