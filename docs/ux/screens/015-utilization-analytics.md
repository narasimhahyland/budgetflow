# 015 Budget utilization analytics

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Dashboards > Utilization (`/dashboards/utilization`). The point-in-time table is the utilization report (082); this dashboard shows the trend and pace.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the chart language of 011 and 082. Planned Stitch states, to be generated in a later session:

| State                         | Planned image                                                         |
| ----------------------------- | --------------------------------------------------------------------- |
| monthly trend against phasing | `design/stitch/015-utilization-analytics/default--desktop--light.png` |
| by category                   | `by-category--desktop--light.png`                                     |
| mobile                        | `default--mobile--light.png`                                          |

## Purpose

Show how utilization builds up over the year against the phasing plan, which locations, teams and categories run ahead or behind, and how pending requests would change the picture, so owners can correct pace mid-year instead of discovering it in Q4.

## Roles

CEO, Finance Admin, Finance Controller, Read-only Analyst (all budgets); budget owners scoped to their subtree; Auditor read.

## Entry points

Insights > Dashboards; 011 "Utilization" KPI; 082 report "See trend"; 013 "Pace" check.

## Content and actions

Header bar: title, scope, FY2026, as-of time, Schedule delivery (091), Export (CSV, XLSX, PDF). Filter chips: scope, location, category, budget type.

KPI cards: utilization 61.2% ((committed USD 27,800.00 + actual USD 33,350.00) / authorized USD 100,000.00); phased to date 81.3% of the year (USD 81,300.00); pace index 0.75 (utilization against phased to date); pending USD 4,000.00 shown separately ("would add 4.0 points").

Trend chart: monthly cumulative committed plus actual against the cumulative phasing line, January to December, with the remaining months as a dashed forecast; toggle "Show pending" adds a hatched band.

Breakdown (tabs By location, By team, By category): horizontal bars of utilization with the phased-to-date marker on each bar; table alternative with authorized, committed, actual, pending, utilization, pace index. Samples by location: Westlake 69.1% (pace 0.85), Bengaluru 68.1% (0.84), London 55.2% (0.68), Hyderabad 50.7% (0.62).

Ahead and behind lists: top 5 budgets ahead of phasing and top 5 behind, each linking to 021.

## Data and permissions

`reports.ts` utilization trend endpoint over monthly ledger snapshots (committed, actual, pending) and period allotments (032a); utilization = (committed + actual) / authorized with pending shown separately; child allocations counted once. Scope by `report.read`.

## States

| State           | Behaviour                                                                         |
| --------------- | --------------------------------------------------------------------------------- |
| Default         | as above                                                                          |
| Show pending    | hatched band and KPI "with pending 65.2%" as a secondary line                     |
| No phasing      | phasing line drawn as even with a note "Budgets without phasing use even phasing" |
| Empty           | "No budgets in this scope for FY2026"                                             |
| Loading / error | `sat-ghost` chart and cards; error banner with Retry                              |

## Budget safety and audit

Pending is hatched amber and never part of the utilization figure; forecast months are dashed. Read-only; exports and schedules are audited.

## Responsive and accessibility

Tablet: breakdown below the trend. Mobile: KPI scroller, chart replaced by the monthly table, breakdown as a list. Every chart has "View as table"; pace is written as "behind plan" or "ahead of plan" next to the index.

## Satori components

`sat-header-bar`, `sat-interactive-card` (KPIs), `sat-navigation-tabs` (breakdown), `satInteractiveTag` (filters), `mat-table`, `sat-rich-tooltip` (utilization and pace definitions), `sat-ghost`; Angular Material slide toggle (Show pending); line and bar charts from `libs/web/ui/charts`; Export menu from 000.

## Related screens and navigation

082 utilization report, 011 executive dashboard, 013 health, 032a period phasing, 080 budget versus actual, 083 location comparison, 021 budget details.

## Decisions taken

- Pace index (utilization against phased to date) is the headline comparison, because absolute utilization means little without the phasing plan.
- Pending requests are an optional overlay, never part of utilization (product answer of 2026-11-05).
