# 083 Location comparison report

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Reports > Location comparison (`/reports/location-comparison`), in the shared report frame of 079. 084 department comparison uses the same layout with departments.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the report frame of 079. Planned Stitch states, to be generated in a later session:

| State                       | Planned image                                                       |
| --------------------------- | ------------------------------------------------------------------- |
| four locations side by side | `design/stitch/083-location-comparison/default--desktop--light.png` |
| per-head view               | `per-head--desktop--light.png`                                      |
| choose locations dialog     | `choose--desktop--light.png`                                        |
| mobile                      | `default--mobile--light.png`                                        |

## Purpose

Put locations side by side on the same measures (budget, spend, utilization, events, participation and cost per attendee), in totals or per eligible employee, so leaders can see where money and engagement differ and why, without exporting to a spreadsheet.

## Roles

CEO, Finance Admin, Finance Controller, Read-only Analyst, Auditor (all locations); Regional Managers compare locations within their region; Location Managers see their location against the regional average only.

## Entry points

079 catalog; 15a fairness view "Compare locations"; 011 regions table "Compare"; scheduled delivery (091).

## Content and actions

Frame from 079 (filters FY2026, Jan-Oct, category, budget type; Save view, Schedule delivery, Export CSV, XLSX, PDF). Toolbar: "Choose locations" (up to 6), "Totals or per head" segmented control, "Include child budgets" (on, counted once).

Comparison table (columns are locations, rows are measures; sample totals, USD):

| Measure                           | Bengaluru | Hyderabad | Westlake  | London    |
| --------------------------------- | --------- | --------- | --------- | --------- |
| Eligible headcount (HR, 1 Oct)    | 420       | 310       | 520       | 240       |
| Authorized                        | 16,000.00 | 14,000.00 | 34,000.00 | 26,000.00 |
| Committed                         | 5,600.00  | 3,800.00  | 9,900.00  | 6,000.00  |
| Actual                            | 5,300.00  | 3,300.00  | 13,600.00 | 8,350.00  |
| Pending                           | 600.00    | 600.00    | 1,800.00  | 700.00    |
| Utilization                       | 68.1%     | 50.7%     | 69.1%     | 55.2%     |
| Events held                       | 14        | 9         | 18        | 7         |
| Participation                     | 72%       | 67%       | 65%       | 63%       |
| Cost per attendee (closed events) | 41.20     | 36.80     | 58.90     | 64.10     |
| FX effect (separate)              | -24.10    | -14.70    | 0.00      | +12.40    |

- Per-head view divides money rows by eligible headcount (Bengaluru authorized USD 38.10 per head; London USD 108.33) and shows the company average as a reference column.
- Each cell is a drill-down to the budgets and ledger lines behind it (079 side sheet).
- Chart above the table: grouped bars for the selected measure (Utilization by default) with "View as table".
- Headcount comes from the latest HR snapshot (22c) with its date in the row label.

## Data and permissions

`reports.ts` comparison endpoint aggregates budgets by location org unit (P3 org model) with child allocations counted once, events and participation from P9 attendance, headcount from HR snapshots. Scope by `report.read`; Location Managers receive their location plus a regional average computed server-side (other locations' figures are not returned). Utilization = (committed + actual) / authorized, pending shown separately.

## States

| State                   | Behaviour                                                            |
| ----------------------- | -------------------------------------------------------------------- |
| Default                 | as above                                                             |
| Per head                | money rows per eligible employee; headcount row in bold              |
| Choose dialog           | location tree with checkboxes, limit 6 ("Remove one to add another") |
| Missing headcount       | per-head cells show "No headcount" with a link to 22c                |
| Manager view            | two columns: their location and "Region average"                     |
| Empty / loading / error | shared frame states (079)                                            |

## Budget safety and audit

Pending is a separate row, never included in utilization; FX effect is its own row and never folded into actual. Exports and schedules are audited.

## Responsive and accessibility

Tablet: up to 4 location columns visible, others scroll. Mobile: pick two locations to compare; table transposes to measures as cards. Column headers are location names with headcount; differences above 20% from the average carry the words "above average" or "below average".

## Satori components

Shared report frame from 079; `mat-table` (measure rows with row headers), `sat-banner`, `sat-rich-tooltip` (measure definitions); Angular Material button toggle (Totals or per head), dialog with tree (choose locations), slide toggle; grouped bar chart from `libs/web/ui/charts`; `bf-money`.

## Related screens and navigation

084 department comparison, 15a fairness view, 15b participation and reach, 082 utilization, 085 event spending, 22c headcount import, 079 reports.

## Decisions taken

- Up to six locations at once, with a totals or per-head switch. Recommended because more columns stop being readable and per-head is the fair comparison for engagement budgets.
- Location Managers compare their own location with the regional average only, never with named peers.
- Headcount for per-head figures always comes from the latest HR snapshot and shows its date.
