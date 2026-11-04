# 013 Budget health overview

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Dashboards > Budget health (`/dashboards/health`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the dashboard layout of 011. Planned Stitch states, to be generated in a later session:

| State                          | Planned image                                                          |
| ------------------------------ | ---------------------------------------------------------------------- |
| health matrix and at-risk list | `design/stitch/013-budget-health-overview/default--desktop--light.png` |
| owner view                     | `owner--desktop--light.png`                                            |
| all healthy                    | `all-healthy--desktop--light.png`                                      |
| mobile                         | `default--mobile--light.png`                                           |

## Purpose

Show at a glance which budgets need attention and exactly why, using a small set of written health checks (pace, forecast, controls, hygiene, unused money), so leaders and finance can act on the few budgets that matter instead of reading every number.

## Roles

CEO, Finance Admin, Finance Controller, Read-only Analyst (all budgets); budget owners scoped to their subtree; Auditor read.

## Entry points

Insights > Dashboards; 011 "Budget health" link; 017 alerts "See health"; owner weekly digest.

## Content and actions

Header bar: title, scope, fiscal year, as-of time, Export (CSV, XLSX, PDF).

Summary: 1,412 budgets: Healthy 1,288, Watch 97, At risk 27 (each a filter chip).

Health checks (each budget gets the worst result across checks; every check is a rule with fixed thresholds shown in a tooltip):

- Pace: committed plus actual against phased to date. Watch above 110%, At risk above 125% with more than 2 months left.
- Forecast: forecast at year end against authorized. Watch above 100%, At risk above 105% or beyond the budget's tolerance.
- Controls: Frozen (Watch, info with lock), Set to zero with open commitments (Watch, important tone).
- Hygiene: commitments more than 30 days past service end, or unmatched actuals older than 30 days (Watch; At risk above USD 1,000.00).
- Unused: forecast unused that would lapse above 20% of authorized with less than 90 days left (Watch).

Health matrix: rows are regions (or the next level down for owners), columns are the five checks; each cell shows counts of Watch and At risk with the tone; click filters the list.

At-risk list (table): budget, owner, status tag, health tag, reasons (chips, for example "Pace 131% of phased", "Forecast USD 41,800.00 against USD 40,000.00"), last owner activity, Open budget (021). Samples:

- Westlake Team Activities (Jordan Lee): At risk, "Pace 131% of phased with 2 months left", "Forecast 6% over".
- India Wellbeing (Meera Iyer): Watch, "USD 4,200.00 would lapse (35%)".
- Europe Wellbeing (Sophie Laurent): Watch, "Set to zero with USD 380.00 open commitments".
- Hyderabad Events (Suresh Menon): Watch, "2 unmatched actuals older than 30 days".

## Data and permissions

`reports.ts` health endpoint evaluates the checks server-side from ledger balances, period allotments, forecasts (`forecast_snapshots`), budget status, commitments aging and actuals match status; thresholds are tenant settings with the defaults above. Scope by `report.read`; owners see their subtree. Child allocations counted once in matrix counts.

## States

| State           | Behaviour                                                             |
| --------------- | --------------------------------------------------------------------- |
| Default         | as above                                                              |
| Filtered        | chip or matrix cell selected; list shows the subset with a Clear link |
| All healthy     | success empty state "All 64 budgets in your scope are healthy"        |
| Owner view      | matrix rows are the owner's child budgets                             |
| Loading / error | `sat-ghost` matrix and list; error banner with Retry                  |
| Forbidden       | `sat-403-error-state`                                                 |

## Budget safety and audit

Frozen (info with lock) and set to zero (important) keep their own tones even inside the health columns; Watch uses warning, At risk uses error. Health never blocks anything: it is a view. Exports are audited.

## Responsive and accessibility

Tablet: matrix scrolls with the region column pinned. Mobile: summary chips and the at-risk list as cards; matrix hidden behind "By region". Health tags are words plus icons; reasons are text.

## Satori components

`sat-header-bar`, `satInteractiveTag` (summary chips), `mat-table` (matrix and list) with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag`, `satInlineChip` (reasons), `sat-rich-tooltip` (check thresholds), `sat-empty-state`, `sat-ghost`; Export menu from 000.

## Related screens and navigation

011 executive dashboard, 017 alerts, 086 unused and expired, 087 forecast and variance, 085a commitment hygiene, 080b unmatched actuals, 021 budget details.

## Decisions taken

- Health is a traffic light from five written checks with fixed thresholds, not an opaque numeric score. Recommended so every "At risk" can be explained in one sentence and acted on.
- Each budget takes the worst result of its checks; the reasons list shows all of them.
- Thresholds are company settings with the defaults above; owners cannot change them for their own budgets.
