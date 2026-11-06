# 087 Forecast and variance report

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Reports > Forecast and variance (`/reports/forecast-variance`), in the shared report frame of 079. The chart-first view is 016; the forecast cycle where owners submit is 87a (P11).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the report frame of 079. Planned Stitch states, to be generated in a later session:

| State                                        | Planned image                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| forecast against authorized, with commentary | `design/stitch/087-forecast-variance-report/default--desktop--light.png` |
| compare two forecast snapshots               | `compare-snapshots--desktop--light.png`                                  |
| mobile                                       | `default--mobile--light.png`                                             |

## Purpose

List every budget's year-end forecast against its authorized amount with the variance, the method used and the owner's commentary where the variance is large, and compare forecast snapshots over time, so FP&A can explain where the year will land without chasing owners.

## Roles

Finance Admin, Finance Controller, CEO, Auditor, Read-only Analyst (all budgets); budget owners scoped to their subtree.

## Entry points

079 catalog; 016 forecast view "View report"; 87a cycle "Report"; 16a board pack (variance page); scheduled delivery (091).

## Content and actions

Frame from 079 (filters FY2026, scope, forecast snapshot (latest accepted, or a named cycle such as "October reforecast"), method, "Commentary required only"; Save view, Schedule delivery, Export CSV, XLSX, PDF). Toolbar: "Compare with snapshot" (select an earlier snapshot), "Constant currency" (on).

Table (October reforecast, as of 31 Oct 2026, amounts USD):

| Budget               | Authorized | Actual YTD | Committed | Forecast at year end | Method               | Variance       | Variance % | Commentary                                                       |
| -------------------- | ---------- | ---------- | --------- | -------------------- | -------------------- | -------------- | ---------- | ---------------------------------------------------------------- |
| India Region         | 30,000.00  | 8,600.00   | 9,400.00  | 27,400.00            | Run-rate             | 2,600.00 under | 8.7%       | -                                                                |
| United States Region | 40,000.00  | 15,300.00  | 11,500.00 | 41,800.00            | Owner input          | 1,800.00 over  | 4.5%       | -                                                                |
| Europe Region        | 30,000.00  | 9,450.00   | 6,900.00  | 24,900.00            | Committed + pipeline | 5,100.00 under | 17.0%      | "Wellbeing paused; Q4 events moved to January." (Sophie Laurent) |
| Employee Experience  | 100,000.00 | 33,350.00  | 27,800.00 | 94,100.00            | Mixed                | 5,900.00 under | 5.9%       | -                                                                |

- Variance threshold from the cycle (at least 10% and at least USD 1,000.00): rows above it need commentary; missing commentary shows a warning tag "Commentary due 12 Nov".
- Overs above the budget's tolerance use the error tone with the word "over".
- Compare with snapshot adds "Previous forecast" and "Change" columns (Europe Region: September USD 27,300.00, change -USD 2,400.00).
- Chart: forecast against authorized by region with the forecast bar dashed, and "View as table".
- Drill-down: forecast cell opens the snapshot detail (method inputs: run-rate basis, pipeline items, owner input), actual and committed open the ledger lines (079).

## Data and permissions

`reports.ts` forecast endpoint over `forecast_snapshots` (budget or event, method `run_rate`, `committed_pipeline` or `owner_input`, as-of date, amount, `variance_bps`, commentary, status draft, submitted, commentary required, accepted, superseded) joined with ledger balances. Roll-ups count child budgets once and show "Mixed" when children use different methods. Scope by `report.read`. Forecasts are read here; owners submit them in 87a.

The sidebar entry (Insights > Forecast and variance) and the route guard both use `report.read`, and
that matches the server: `ReportsService.assertCanRead` admits tenant-wide roles and owners scoped to
their subtree, which is exactly the set holding `report.read` in `GET /api/me`. Unlike 16a, no
difference is needed here.

## States

| State                   | Behaviour                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------ |
| Default                 | as above                                                                             |
| No forecast cycle       | info banner "No accepted forecast yet; showing run-rate forecasts" (system-computed) |
| Commentary due          | warning tags; filter "Commentary required only"                                      |
| Compare                 | extra columns as above                                                               |
| Empty / loading / error | shared frame states (079)                                                            |

## Budget safety and audit

Forecast values are dashed or hatched (forecast, not actual); variance and FX effect are computed by the API; FX never counts as variance. Exports and schedules are audited.

## Responsive and accessibility

Tablet: Commentary moves into an expandable row. Mobile: one card per budget with forecast, variance and commentary. Variance direction is written ("under", "over").

## Satori components

Shared report frame from 079; `mat-table` with expandable rows, `sat-status-tag` (Commentary due, method), `sat-rich-tooltip` (method explanation), `sat-banner`; Angular Material select (snapshot); chart from `libs/web/ui/charts` with dashed forecast series; `bf-money`.

## Related screens and navigation

016 forecast and variance view, 87a forecast cycle (P11), 080 budget versus actual, 086 unused and expired, 16a board pack, 079 reports.

## Decisions taken

- Without an accepted forecast the report shows system run-rate forecasts, labelled, rather than an empty report.
- The variance threshold that requires commentary is set per forecast cycle (87a), defaulting to at least 10% and at least USD 1,000.00, so small budgets with large percentages and large budgets with tiny percentages do not create noise.
- Roll-up rows show "Mixed" when children use different methods, with the breakdown in the drill-down.
