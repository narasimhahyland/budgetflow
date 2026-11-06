# 016a Board and FP&A pack

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Reports > Board and FP&A pack (`/reports/board-pack`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the report frame of 079. Planned Stitch states, to be generated in a later session:

| State                                | Planned image                                                   |
| ------------------------------------ | --------------------------------------------------------------- |
| builder with preview (closed period) | `design/stitch/016a-board-fpa-pack/default--desktop--light.png` |
| variance page with FX bridge         | `variance-fx--desktop--light.png`                               |
| drill-down from a pack figure        | `drill-down--desktop--light.png`                                |
| open period (draft watermark)        | `draft--desktop--light.png`                                     |
| generating and ready                 | `generated--desktop--light.png`                                 |

## Purpose

Produce the monthly or quarterly board and FP&A pack from BudgetFlow in minutes: roll-ups by legal entity, region, function, category and period, plan against actual in constant currency with the FX effect bridged separately, top commitments, controls applied and exceptions, all from a closed-period snapshot so the numbers do not move after the pack is sent, with every figure traceable to its ledger lines.

## Roles

Finance Admin and Finance Controller (build, generate, schedule); CEO and Read-only Analyst (view and generate from saved pack definitions); Auditor (read).

## Entry points

079 catalog; 012 "Board pack"; 091 schedule "Monthly board pack"; 80e after a period closes ("Generate the October pack").

## Content and actions

Left panel, pack settings:

- As of: "October 2026 close snapshot (taken 4 Nov 2026, 18:00 IST)" (default: latest closed period); alternatives: an earlier closed period, or "Current open period (draft)".
- Compare: Plan version (Original, Current, Forecast; default Current) and prior period or prior year.
- Constant currency: on (transaction-currency actuals at the locked FY2026 plan rates; FX effect bridged separately).
- Pages (toggle and drag to reorder): Summary; By legal entity; By region; By function (attributed spend, as 084); By category; By period (monthly); Variance and FX bridge; Top commitments (above USD 2,500.00); Controls applied (freeze, reduce, set to zero with reasons); Exceptions summary; Co-funding and intercompany recharges.
- Actions: Save pack definition, Schedule (091, monthly after close), Generate (PDF and XLSX).

Right panel, live preview of the selected page; sample Summary (October 2026 close, USD): authorized 100,000.00; committed 27,800.00; actual 33,350.00; company-wide Available 34,850.00 (Authorized - pending USD 4,000.00 - committed - actual); utilization 61.2%; forecast at year end 94,100.00.

Sample By legal entity: IN01 authorized 30,000.00, actual 8,600.00; US01 40,000.00, 15,300.00; UK01 30,000.00, 9,450.00.

Variance and FX bridge page:

- Plan (phased to date) USD 81,300.00 against actual USD 33,350.00 and committed USD 27,800.00, by region, in constant currency.
- FX bridge by transaction currency: INR spend USD 19,092.81 at the plan rate (USD 1 = INR 83.50) and USD 18,910.51 at monthly average rates: FX effect -USD 182.30; GBP -USD 44.70; EUR +USD 12.40; total -USD 214.60, labelled "Not part of spend or variance".

Drill-down: any figure in the preview opens the ledger lines behind it (079 side sheet), filtered to the snapshot.

Cover page (generated PDF): "Hyland - Employee programs budget pack - October 2026", "Figures from the October 2026 close snapshot taken 4 Nov 2026, 18:00 IST. Items posted late are in November.", prepared by, page numbers; XLSX has one sheet per page with the underlying rows.

## Data and permissions

`reports.ts` pack endpoints render pages from `period_close_snapshots` (as-of balances per period and entity, append-only) for closed periods and from live read models for the draft option; plan versions from `plan_versions`; FX bridge from the currency triplet on actuals (transaction amount, rate type and rate) comparing plan rate with the reporting rate type set for the company (monthly average by default). Generation runs as a background job; files are stored in `DocumentStore` (7-day links). `report.read` at tenant scope to build and generate; saving definitions and schedules need `report.schedule` (new, 091).

The route guard and the sidebar entry use different permissions on purpose; they are not to be "aligned".

- The route guard uses `report.read`, the permission the endpoint names, so owner roles reach the
  page and see the `sat-403-error-state` the spec calls for rather than a dead route. The baselines
  `016a-board-pack--forbidden-owner--*` pin that state.
- The sidebar entry uses `audit.read`. `BoardPackService.assertCanBuild` asks for `report.read` **at
  tenant scope** and then refuses anyone who is not tenant-wide, but the permission set in
  `GET /api/me` is evaluated against the tenant resource, where an `owned` grant counts as soon as
  the actor owns a budget. So `report.read` in `/api/me` is true for `budget-owner`,
  `department-head`, `regional-manager` and `location-manager`, none of whom the pack admits:
  gating the entry on it would give four roles a navigation item that always answers 403.
- `audit.read` is the widest permission no owner role holds. It covers `ceo`, `finance-admin`,
  `finance-controller` and `auditor`. It costs `analyst` the shortcut, who the server does admit
  (tenant-wide `report.read`) and who reaches the pack from the 079 catalog header instead. No
  existing action covers the analyst without also covering the four owner roles, so one of the two
  errors is unavoidable; showing a working entry to four roles that cannot use it is the worse one.
  A dedicated action (for example `report.board_pack`) would fix it and belongs with 091's
  `report.schedule` work, not here.

## States

| State               | Behaviour                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Default             | builder and preview as above                                                                                              |
| Draft (open period) | warning banner "Draft: the period is open and figures can still change"; every page and the PDF carry a "Draft" watermark |
| Page has no data    | page preview "No controls applied in October 2026" (page kept, with the statement)                                        |
| Drill-down          | side sheet; totals equal the clicked figure                                                                               |
| Generating          | progress with page count; the user can leave and is notified (123)                                                        |
| Ready               | Download PDF and XLSX; "Generated from snapshot 4 Nov 18:00"                                                              |
| Failed              | error card with the failed page and Retry                                                                                 |
| Loading / error     | `sat-ghost` preview; error banner with Retry                                                                              |
| Forbidden           | `sat-403-error-state` for owner roles                                                                                     |

## Budget safety and audit

Company-wide Available is labelled with its definition (child allocations counted once). Forecast figures are dashed; FX effect is bridged separately and never mixed into actual or variance. Closed-period packs read immutable snapshots, so a regenerated pack matches the one sent. Generation, downloads, saved definitions and schedules are audited.

## Responsive and accessibility

Desktop for building; tablet shows the preview with settings in a drawer; mobile lists generated packs for download. The PDF is tagged with headings and table headers; every chart in the pack has its table on the same page or the next.

## Satori components

`sat-header-bar`, `sat-splitter` (settings and preview), `satDragDropList` (page order), `sat-banner` (draft), `sat-status-tag`, `sat-rich-tooltip` (definitions), `sat-ghost`, `sat-403-error-state`; Angular Material select, slide toggles, checkboxes, side sheet (drill-down), progress bar, snackbar; charts from `libs/web/ui/charts`; `bf-money`.

## Related screens and navigation

80e period close (P11, snapshots), 079 reports, 080 budget versus actual, 084 department comparison, 087 forecast and variance, 17a exceptions, 053a recharges, 091 schedules, 011 executive dashboard.

## Decisions taken

- The pack defaults to the latest closed-period snapshot; open-period packs are possible but watermarked "Draft" on every page. Recommended so numbers never move after a board pack is sent.
- Constant currency is on by default with an FX bridge per currency, using the company's reporting rate type (monthly average) against the locked plan rate.
- Pages are fixed building blocks that can be toggled and reordered, not free-form; finance gets a consistent pack every month.
- The XLSX carries the underlying rows for every page, so FP&A can extend the analysis without re-keying.
