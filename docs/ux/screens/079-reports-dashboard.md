# 079 Reports dashboard

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Reports (`/reports`); every report lives at `/reports/<report-id>`. This spec also defines the shared report frame used by 080-087, 082 and 088a.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the report layout of the 082 design. Planned Stitch states, to be generated in a later session:

| State                                      | Planned image                                                     |
| ------------------------------------------ | ----------------------------------------------------------------- |
| report catalog                             | `design/stitch/079-reports-dashboard/default--desktop--light.png` |
| search with no results                     | `no-results--desktop--light.png`                                  |
| owner view (scoped catalog)                | `owner--desktop--light.png`                                       |
| shared report frame with drill-down drawer | `report-frame-drawer--desktop--light.png`                         |

## Purpose

Be the front door to every report: find the right report by question, open saved views and favourites, see what is scheduled to whom, and give every report the same frame (filters, drill-down to ledger lines, saved views, scheduled delivery and Export), so people learn reporting once.

## Roles

CEO, Finance Admin, Finance Controller, Auditor and Read-only Analyst (all reports in scope); budget owners (Department Head, Regional Manager, Location Manager, Budget Owner) see reports filtered to their subtree. Employees and organizers have no reports area (they use 115 and 043).

## Entry points

Sidebar Insights > Reports; "View report" links on dashboards (011-018b); scheduled delivery emails and chat posts; global search ("utilization report").

## Content and actions

Catalog page:

- Header bar: title, search field ("Search reports, for example 'unused budget'"), "Scheduled reports" (091).
- Favourites row (cards with the user's saved views, for example "India utilization, monthly").
- Catalog grouped by question, each card with name, one-line question, last opened, favourite star:
  - Budgets: Budget versus actual (080), Allocation (081), Utilization (082), Unused and expired (086), Forecast and variance (087).
  - Comparisons: Location comparison (083), Department comparison (084).
  - Events: Event spending (085).
  - Approvals: Approval history (090), Approval performance (18a).
  - Finance: Board and FP&A pack (16a), GL tie-out (080c), Exceptions (17a).
  - Audit: Audit log (088), Evidence pack (88a).
- Recent exports and schedules strip: last 5 exports with status; "3 schedules active" link to 091.

Shared report frame (all reports):

- Header bar: report name, scope ("India Region and below"), "As of 4 Nov 2026, 09:40 IST", actions Save view, Schedule delivery (opens the 091 schedule dialog prefilled with the current filters), Export menu (CSV, XLSX, PDF; no Share action).
- Filter bar: fiscal year and period (FY2026, Jan-Oct), org scope (tree select limited to the viewer's scope), dimension chips (location, legal entity, cost center, category, budget type), saved views select; Reset.
- Toolbar: Group by, Columns, and where the report has transaction-currency amounts a "Constant currency" toggle (plan rate) with the FX effect in its own column.
- Body: optional chart with "View as table", then the table with a totals row; amounts in USD with integer-cent precision from the API; child allocations counted once in roll-ups.
- Drill-down: a row opens a side sheet with the ledger lines behind the figure (accounting date, journal id, bucket, amount in USD, transaction currency amount, rate type and rate, source: request, approval, import line or event) and a link to the journal (`getJournal`) and to the budget (021).
- Footer note when the viewer is scoped: "Showing budgets you can see."

## Data and permissions

New P10 `reports.ts` contract and `libs/api/reports` serve every report from read models that reconcile to the ledger; drill-down uses `budgetLedger` and `getJournal` (existing ledger contracts). `PolicyService.can(report.read)` with the viewer's scope (tenant for CEO, FA, FC, AUD, AN; owned subtree for owners); the catalog hides reports the viewer cannot open. Saved views store filters only, never data. Exports above 10,000 rows run as background jobs and notify on completion (123).

## States

| State            | Behaviour                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Catalog          | as above                                                                                                        |
| No favourites    | favourites row replaced by "Star a report or save a view to see it here"                                        |
| Search no result | "No report matches 'cash'. Try 'actual' or 'spend'."                                                            |
| Owner view       | only reports with owner scope; scope chip fixed to their subtree                                                |
| Frame: loading   | `sat-ghost` table rows and chart frame                                                                          |
| Frame: empty     | "No data for FY2026 Jan-Oct in this scope" with Reset filters                                                   |
| Frame: error     | partial: banner naming the failed source with Retry; total: `sat-500-error-state`                               |
| Frame: export    | small: download starts and snackbar "Exported 214 rows"; large: snackbar "Export is running. We'll notify you." |
| Forbidden        | `sat-403-error-state` when opening a report link outside the viewer's role                                      |

## Budget safety and audit

Every report uses the bucket swatches and labels of the design system: pending (hatched warning) separate from committed and actual; company-wide Available labelled as such; per-budget figures as "Available under this budget's rules" with the tooltip. FX effect is a separate column, never folded into actual. Exports and schedule changes are audited (who, report, filters, format); report views are product analytics events.

## Responsive and accessibility

Catalog: cards reflow to one column on mobile. Report frame: desktop and tablet; mobile shows the chart replaced by the table with the first column pinned and the drill-down as a full-screen sheet. Tables have captions with report name, scope and period; totals rows are marked as such for screen readers.

## Satori components

`sat-header-bar`, `sat-action-bar`, `sat-interactive-card` (catalog and favourites), `satInteractiveTag` (dimension chips), `mat-table` with `satTableWithRowStates`, `mat-sort`, `mat-paginator`, `sat-rich-tooltip` (Available definitions), `sat-empty-state`, `sat-ghost`, `sat-500-error-state`, `sat-403-error-state`; Angular Material side sheet (drill-down), tree select (scope), slide toggle (constant currency), menu (Export, Group by, Columns), snackbar; charts from `libs/web/ui/charts` with "View as table".

## Related screens and navigation

080-087 reports, 082 utilization, 088 audit log, 88a evidence pack, 090 approval history, 091 export and scheduled reports, 16a board pack, 17a exceptions, 18a approval performance, 011-018b dashboards. Breadcrumb Insights / Reports / report name; filters are kept in the URL so links reproduce the view.

## Decisions taken

- One shared report frame for every report (filters, drill-down to ledger lines, saved views, Schedule, Export) instead of per-report layouts. Recommended so finance learns it once and every figure can be traced to the ledger.
- The catalog is organised by the question people ask, not by data source.
- Exports over 10,000 rows run in the background with a notification, never blocking the page.
- Saved views store filters only; the data is always recomputed at open, so a saved view never shows stale numbers.
