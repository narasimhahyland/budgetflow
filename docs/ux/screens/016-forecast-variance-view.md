# 016 Budget forecast and variance view

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Dashboards > Forecast (`/dashboards/forecast`). The table-first report is 087; owners submit forecasts in the cycle (87a, P11).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the chart language of 011. Planned Stitch states, to be generated in a later session:

| State                                | Planned image                                                          |
| ------------------------------------ | ---------------------------------------------------------------------- |
| year-end landing by region           | `design/stitch/016-forecast-variance-view/default--desktop--light.png` |
| no accepted forecast (run-rate only) | `run-rate--desktop--light.png`                                         |
| mobile                               | `default--mobile--light.png`                                           |

## Purpose

Show where the year will land: the year-end forecast against authorized for the company and each region, how the forecast moved since the last cycle, how much of it is already committed or spent, and which variances still need an owner's explanation.

## Roles

CEO, Finance Admin, Finance Controller, Read-only Analyst (all budgets); budget owners scoped to their subtree; Auditor read.

## Entry points

Insights > Dashboards; 011 forecast card "Open forecast"; 87a cycle "Dashboard"; executive weekly digest.

## Content and actions

Header bar: title, FY2026, forecast snapshot select ("October reforecast, accepted 3 Nov"), Schedule delivery, Export (CSV, XLSX, PDF).

KPI cards: forecast at year end USD 94,100.00 against authorized USD 100,000.00 (USD 5,900.00 under, 5.9%); change since September -USD 2,700.00; already committed or spent USD 61,150.00 (65% of the forecast); variances needing commentary 1 of 3 regions; FX effect year to date -USD 214.60 (separate, not in the forecast).

Landing chart ("waterfall"): actual to date USD 33,350.00 + open commitments USD 27,800.00 + pipeline (pending and planned events) USD 7,600.00 + run-rate for the remaining months USD 25,350.00 = forecast USD 94,100.00, against the authorized line; forecast segments dashed or hatched; "View as table".

By region (bars: authorized, forecast dashed; variance labels in words): India USD 27,400.00 (USD 2,600.00 under); United States USD 41,800.00 (USD 1,800.00 over, warning); Europe USD 24,900.00 (USD 5,100.00 under, "Commentary: Wellbeing paused; Q4 events moved to January").

Forecast movement line: monthly forecast snapshots (July to October) against authorized.

Method mix: run-rate 1 region, owner input 1, committed plus pipeline 1 (small legend with counts).

Row links: each region opens 087 filtered; "Open forecast cycle" for Finance Admin (87a).

## Data and permissions

`reports.ts` forecast summary endpoint over `forecast_snapshots` (methods `run_rate`, `committed_pipeline`, `owner_input`; statuses; `variance_bps`; commentary) and ledger balances; the landing chart components (actual, committed, pipeline, run-rate remainder) are returned by the API and sum to the forecast. Scope by `report.read`.

## States

| State                   | Behaviour                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Default                 | as above                                                                                   |
| Run-rate only           | info banner "No accepted forecast yet. Showing run-rate forecasts computed by BudgetFlow." |
| Commentary missing      | warning tag on the region with "Commentary due 12 Nov"                                     |
| Empty / loading / error | `sat-ghost` chart and cards; error banner with Retry                                       |

## Budget safety and audit

Current (actual, committed) is solid; forecast parts (pipeline, run-rate) are dashed or hatched; overs above tolerance use the error tone with the word "over". FX effect is separate. Read-only; exports and schedules are audited.

## Responsive and accessibility

Mobile: KPI scroller; waterfall replaced by its table; regions as cards. The waterfall table lists each component and the total.

## Satori components

`sat-header-bar`, `sat-interactive-card` (KPIs), `sat-status-tag`, `sat-banner`, `sat-rich-tooltip` (methods), `sat-ghost`; Angular Material select (snapshot); waterfall, bar and line charts from `libs/web/ui/charts` with dashed forecast series; Export menu from 000.

## Related screens and navigation

087 forecast and variance report, 87a forecast cycle (P11), 011 executive dashboard, 080 budget versus actual, 086 unused and expired, 16a board pack.

## Decisions taken

- The landing chart decomposes the forecast into actual, open commitments, pipeline and run-rate remainder, so leaders can see how much of the forecast is already locked in.
- The dashboard shows the latest accepted forecast by default and falls back to labelled run-rate forecasts before the first cycle.
