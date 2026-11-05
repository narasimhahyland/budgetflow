# Phase 10 — Reports, dashboards and analytics (frontend half)

Screens, journeys and visual baselines against the Phase 10 endpoints already on `main`. No backend
change: `libs/contracts`, `libs/api/*`, `libs/domain` and the migrations are untouched.

Branch `feat/p10-reports-ui`, worktree `../budget-delegation-and-control-worktrees/p10-reports-ui`,
compose project `bf-p10-ui` (web 4330, API 3130, Keycloak 8210, Postgres 5562, Mailpit 8155,
MinIO 9130).

## What was built

| Area     | Where                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| Feature  | `libs/web/features/reports` — catalog, the shared report frame, drill-down, health, schedules |
| Routing  | `/reports` wired in `apps/web/src/app/app.routes.ts`; path mapping in `tsconfig.base.json`    |
| Journeys | `apps/web-e2e/src/reports/reports.spec.ts` — 11 journeys across three viewports               |
| Visual   | 12 screens in `apps/web-e2e/visual/screens.json`, 45 baselines in `src/__screenshots__`       |
| Docs     | `docs/architecture/phase-handoff.md` — the P10 row and the deferral of screens 87 and 16a     |

## Screens delivered

| Screen | Route                            | Role shown                            | States proven                                                         |
| ------ | -------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| 079    | `/reports`                       | finance admin, scoped owner, employee | loading, empty, error, forbidden, success, scoped                     |
| 013    | `/reports/health`                | finance controller                    | loading, empty ("every budget is healthy"), error, forbidden, success |
| 080    | `/reports/budget-vs-actual`      | finance controller                    | loading, empty, error, forbidden, success, truncated, drill-down      |
| 081    | `/reports/allocation`            | finance controller                    | same frame                                                            |
| 082    | `/reports/utilization`           | location manager (scoped)             | same frame, plus the drill-down state                                 |
| 083    | `/reports/location-comparison`   | finance controller                    | same frame                                                            |
| 084    | `/reports/department-comparison` | finance controller                    | same frame                                                            |
| 085    | `/reports/event-spending`        | finance controller                    | same frame                                                            |
| 086    | `/reports/unused-expired`        | finance controller                    | same frame                                                            |
| 015a   | `/reports/spend-per-head`        | CEO (tenant-wide only)                | same frame; 403 for a scoped owner                                    |
| 015b   | `/reports/participation-reach`   | CEO (tenant-wide only)                | same frame; 403 for a scoped owner                                    |
| 091    | `/reports/schedules`             | finance admin                         | loading, empty, error, forbidden, success, paused, skipped recipients |

The nine reports share one component: the server returns `columns`, `cells`, `kpis`, `series` and
`totals`, and the page lays them out. Screen 082 was rebuilt on this frame; the earlier utilization
page on `GET /api/utilization` is retired and the route `/reports/utilization` is unchanged.

## Rules followed

- **No money is computed in the browser.** Every amount is rendered from the `money` the API put in
  the cell, through `bf-money`. Percentages arrive as basis points and are divided by 100 for display
  only. The page never sums a column, and the totals row is the server's `totals`.
- **`scope.note` is shown exactly as written** — "Showing budgets you can see." — whenever the API
  sets it, with the scope label and the budget count beside it (`screens/079-report-catalog--scoped-owner--desktop.png`,
  `screens/082-utilization-report--drilldown--desktop.png`).
- **`reconciliation.ties === false` is surfaced, not hidden.** When the figures tie, a quiet line
  states it with the budget count and the authorized and available totals. When they do not, an
  `important` banner says the report is unverified and a table lists each difference with what the
  ledger says, what the report says and the gap. The seeded data ties, so the broken state is proven
  by the component path rather than a screenshot; the journeys assert that one of the two states is
  always on screen for every report.
- **Exports are described honestly.** The action is "Record an export", the confirmation says
  BudgetFlow does not produce a file yet, screen 091 repeats it in a standing banner, and there is no
  download link anywhere. A journey asserts the absence of one.

## Journeys

`apps/web-e2e/src/reports/reports.spec.ts`, run on desktop, tablet and mobile
(`gate/journeys.txt`): **53 passed, 6 skipped** (the three mutating journeys run once, on desktop).

| Journey                                                        | What it proves                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| a finance admin sees every report grouped by the question      | all nine reports, the four groups, saved views, no scope note when tenant-wide |
| budget versus actual renders the server figures                | the table rows and the reconciliation line equal the API response              |
| every report in the catalog opens in the same frame            | each of the nine opens and states where its figures came from                  |
| a drillable figure opens the ledger lines behind it            | drill-down to `GET /api/reports/{id}/drilldown`                                |
| an export is recorded honestly                                 | the notice says no file is produced                                            |
| the five checks are summarised, mapped and written out         | health summary, matrix columns, the worst budget's written reason              |
| a budget owner sees only their subtree, and is told so         | scope note, figures strictly smaller than tenant-wide, no sibling region       |
| the catalog hides a company-wide report from a scoped owner    | `spend-per-head` absent, and refused with the 403 state when reached by URL    |
| an employee has no reports area at all                         | the forbidden page renders in place at `/reports`                              |
| the seeded schedules show their rhythm, recipients and history | cadence, formats, channel, delivery history, export record, no download link   |
| a finance admin pauses a schedule and resumes it               | `PATCH /api/reports/schedules/{id}`                                            |
| an auditor saves the filters of a report and opens it again    | create, apply and delete a saved view                                          |

## Visual baselines

12 screens, 15 states, 45 baselines, generated in the pinned Playwright image
(`npm run e2e:update-snapshots`, filtered to these screens only). Three of them replace the old
screen 082 baselines, because that screen was rebuilt on the Phase 10 frame.

Baselines were verified twice to be sure they are not timing-dependent: once against a freshly reset
stack, and once after the worker's schedule sweep had delivered the due seeded schedules. Both pass.
Two determinism problems were found and fixed while doing this:

- the "Recent exports" counter moves when the worker delivers, so it is masked on screen 079;
- the schedule list came back in whatever order the database chose (the API orders by `createdAt`
  and the three seeded schedules share it), so the page sorts by name.

Screenshots in `screens/` are the committed baselines for the states worth reading in review.

## Gates

| Gate                                | Result                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `scripts/gate.sh static --affected` | PASS — secrets, lint, styles, satori, typecheck, build, openapi, db (`gate/static-gate-summary.txt`) |
| Journeys (desktop, tablet, mobile)  | PASS — 53 passed, 6 skipped (`gate/journeys.txt`)                                                    |
| Visual, these screens only          | PASS — 59 checks green against a reset stack and again after the worker sweep                        |

The full visual matrix and the full gate were left to CI, as the brief asked, because the machine is
shared with the Phase 11 and Phase 12 agents.

## Not built, and why

- **Screen 087 (forecast and variance)** and **16a (board pack)** read `forecast_snapshots`, a
  Phase 11 table that does not exist. Recorded in `docs/architecture/phase-handoff.md`.
- **Export file rendering.** No file is produced by the backend, so the UI records the export and
  says so rather than offering a download.
- **Navigation entries** for budget health and scheduled reports were deliberately not added to
  `libs/web/shell/src/lib/nav.ts`: both are reachable from the catalog, and editing the navigation
  would change the app-shell baselines of a screen this change does not own. Worth adding in the
  Phase 10 gate review.
