# API responses behind Home's figures

Local stack, deterministic seed, clock pinned to `2026-11-16T09:00:00Z`. Tokens are never recorded;
each file is the response body only, for the role named in the file name. Captured with the same
calls `apps/web-e2e/src/shell/home-overview.spec.ts` makes while asserting the rendered figures.

| File                                      | Call                                    | What it backs on screen                                                            |
| ----------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `ceo--budgets-summary.json`               | `GET /api/budgets/summary`              | the four KPI tiles and the share in the answer line                                |
| `ceo--dashboards-health.json`             | `GET /api/dashboards/health`            | the attention count in the answer line, Needs attention, the table's health filter |
| `ceo--approvals-inbox.json`               | `GET /api/approvals/inbox?tab=assigned` | Waiting on your decision                                                           |
| `department-head--budgets-summary.json`   | `GET /api/budgets/summary`              | the narrower subtree figures                                                       |
| `department-head--dashboards-health.json` | `GET /api/dashboards/health`            | the "Europe Region and below" scope label and note                                 |
| `employee--dashboards-health.json`        | `GET /api/dashboards/health`            | the 403 that makes the section absent rather than broken                           |

## The figures the CEO's Home shows, and where each comes from

| On screen             | Value                         | Source field                                                                     |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Answer line share     | 18%                           | `(held + preEncumbered + encumbered + actual) / authorized` of `budgets/summary` |
| Answer line time left | 45 days left                  | `me.fiscalYears` FY2026 `endDate` less health `asOf`                             |
| Answer line attention | 10 of the 11 budgets          | health `summary.watch + summary.atRisk` of `summary.budgets`                     |
| Authorized            | USD 103,000.00                | `budgets/summary.authorized`                                                     |
| Committed             | USD 11,021.77 (11%)           | `held + preEncumbered + encumbered`                                              |
| Actual                | USD 7,338.02 (7.1%)           | `budgets/summary.actual`                                                         |
| Available             | USD 84,640.21 (82%)           | `budgets/summary.available`                                                      |
| Worst attention row   | United States Region, At risk | health `rows[0]`, the API's own order and `reasons` text                         |
