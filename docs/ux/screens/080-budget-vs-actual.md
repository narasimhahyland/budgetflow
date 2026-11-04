# 080 Budget versus actual report

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Reports > Budget versus actual (`/reports/budget-vs-actual`), in the shared report frame of 079.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the report frame of 079. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                    |
| ------------------------------- | ---------------------------------------------------------------- |
| grouped by budget, year to date | `design/stitch/080-budget-vs-actual/default--desktop--light.png` |
| monthly columns                 | `monthly--desktop--light.png`                                    |
| drill-down to ledger lines      | `drill-down--desktop--light.png`                                 |
| mobile                          | `default--mobile--light.png`                                     |

## Purpose

Compare what each budget planned to spend by now (its phased allotments) with what it actually spent, show commitments separately, and keep exchange-rate effects out of the variance, so owners and finance can see real under- and overspend early and trace any figure to its ledger lines.

## Roles

Finance Admin, Finance Controller, CEO, Auditor, Read-only Analyst (all budgets); budget owners scoped to their subtree.

## Entry points

079 catalog; 011 and 016 "View report"; 087 forecast report link; scheduled delivery (091).

## Content and actions

Frame from 079 (Save view, Schedule delivery, Export CSV, XLSX, PDF; filters FY2026, Jan-Oct, scope, location, entity, category). Toolbar: Group by (Region > Budget by default), "Include commitments in variance" toggle (off), "Monthly columns" toggle, "Constant currency" toggle (on: actuals at the locked plan rate; off: also shows actuals at the month-end reporting rate).

Table (sample India Region, Jan-Oct, amounts USD):

| Budget           | Authorized (year) | Phased to date | Actual   | Committed | Variance (phased - actual) | Variance % | FX effect |
| ---------------- | ----------------- | -------------- | -------- | --------- | -------------------------- | ---------- | --------- |
| Bengaluru Events | 10,000.00         | 8,000.00       | 3,950.00 | 3,600.00  | 4,050.00 under             | 50.6%      | -18.40    |
| Hyderabad Events | 8,000.00          | 6,400.00       | 2,300.00 | 3,100.00  | 4,100.00 under             | 64.1%      | -10.70    |
| India Wellbeing  | 12,000.00         | 10,000.00      | 2,350.00 | 2,700.00  | 7,650.00 under             | 76.5%      | -9.70     |
| India Region     | 30,000.00         | 24,400.00      | 8,600.00 | 9,400.00  | 15,800.00 under            | 64.8%      | -38.80    |

- With "Include commitments in variance" on, the variance column becomes "phased - committed - actual" (India Region USD 6,400.00 under).
- Variance shows "under" or "over" in words; overs use the warning tone above 0% and the error tone above the budget's tolerance.
- FX effect: difference between actuals at the month-end reporting rate and at the locked plan rate (negative = favourable); never part of actual or variance.
- Monthly columns: Jan to Oct, each with phased and actual; current month marked "Open period".
- Chart (above the table): phased against actual by month as columns with a cumulative line; "View as table".
- Drill-down from any amount: ledger lines (for example Bengaluru Events actual: 46 lines; 12 Oct, JNL-2026-08812, actual, USD 642.10, INR 53,615.35 at plan rate 83.50, source import line AIB-2026-0031/14).

## Data and permissions

`reports.ts` endpoint for budget versus actual returns per budget: authorized, phased-to-date (from period allotments, 032a), actual (actual bucket), committed (encumbered), pending (pre-encumbered, available as an optional column), variance and FX effect, with child allocations counted once in group rows. Drill-down uses `budgetLedger` and `getJournal`. Scope by `report.read`. Periods follow the fiscal calendar (108); the current open period is labelled.

## States

| State           | Behaviour                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------- |
| Default         | as above                                                                                     |
| Monthly         | wide table with sticky budget column; horizontal scroll                                      |
| Not phased      | budgets without phasing show "Even" phasing and an info icon "Phased evenly: no phasing set" |
| Drill-down      | side sheet with ledger lines and totals that equal the clicked figure                        |
| Empty           | "No budgets in this scope for FY2026"                                                        |
| Loading / error | shared frame states (079)                                                                    |

## Budget safety and audit

Actual (solid violet), committed (teal) and pending (hatched amber) keep their swatches; variance is computed by the API, never in the browser; FX effect is a separate column. Exports and schedules are audited.

## Responsive and accessibility

Tablet: columns Committed and FX effect move behind "Columns". Mobile: one card per budget with phased, actual and variance, drill-down full screen. Table caption names scope and period; "under" and "over" are words.

## Satori components

Shared report frame from 079; `mat-table` with `satTableWithRowStates`, `sat-status-tag` (over tolerance), `sat-rich-tooltip` (variance and FX definitions), `sat-banner`; Angular Material slide toggles, side sheet; chart from `libs/web/ui/charts`; `bf-money`.

## Related screens and navigation

079 reports, 032a period phasing, 016 forecast and variance view, 087 forecast and variance report, 082 utilization, 16a board pack, 021 budget details, 091 schedules.

## Decisions taken

- Variance compares phased-to-date budget with actual by default, with a toggle to include commitments. Recommended because finance reads budget versus actual as spend against plan, while owners also need committed money in view.
- Constant currency (locked plan rate) is the default; the month-end view only adds information and the FX effect stays in its own column.
- Budgets without phasing are compared with even phasing and labelled, rather than excluded.
