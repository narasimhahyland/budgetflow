# 081 Allocation report

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Reports > Allocation (`/reports/allocation`), in the shared report frame of 079.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the report frame of 079 and the tree table of 023. Planned Stitch states, to be generated in a later session:

| State             | Planned image                                                     |
| ----------------- | ----------------------------------------------------------------- |
| allocation tree   | `design/stitch/081-allocation-report/default--desktop--light.png` |
| changes in period | `changes--desktop--light.png`                                     |
| mobile            | `default--mobile--light.png`                                      |

## Purpose

Show who allocated how much to whom, what is still unallocated at each level, which allocations follow a per-head driver, and every allocation change in a period with its reason, with a visible check that each parent's allocated-out amount equals its children's authorized amounts.

## Roles

Finance Admin, Finance Controller, CEO, Auditor, Read-only Analyst (all budgets); budget owners scoped to their subtree.

## Entry points

079 catalog; 023 hierarchy "Allocation report"; 089 allocation history (per budget) "See all changes"; scheduled delivery (091).

## Content and actions

Frame from 079 (filters FY2026, scope, budget type, status; Save view, Schedule delivery, Export CSV, XLSX, PDF). Tabs: Allocation tree, Changes in period.

Allocation tree (tree table, expand and collapse; amounts USD):

| Budget               | Owner          | Authorized | Allocated out | Unallocated | Children | Driver   | Check |
| -------------------- | -------------- | ---------- | ------------- | ----------- | -------- | -------- | ----- |
| Employee Experience  | Daniel Brooks  | 100,000.00 | 100,000.00    | 0.00        | 3        | Fixed    | Ties  |
| India Region         | Meera Iyer     | 30,000.00  | 30,000.00     | 0.00        | 3        | Fixed    | Ties  |
| Bengaluru Events     | Anand Kumar    | 10,000.00  | 0.00          | 10,000.00   | 0        | Fixed    | -     |
| Hyderabad Events     | Suresh Menon   | 8,000.00   | 0.00          | 8,000.00    | 0        | Per head | -     |
| United States Region | Jordan Lee     | 40,000.00  | 34,000.00     | 6,000.00    | 2        | Fixed    | Ties  |
| Europe Region        | Sophie Laurent | 30,000.00  | 26,000.00     | 4,000.00    | 3        | Fixed    | Ties  |
| Europe Wellbeing     | Sophie Laurent | 0.00       | 0.00          | 0.00        | 0        | Fixed    | -     |

- Status tags next to names (Active, Frozen with lock, Set to zero in the important tone).
- Driver "Per head" shows a tooltip: "USD 15.00 a month per eligible employee, prorated; last true-up 3 Oct from the HR headcount refresh."
- Check column: "Ties" (success) when allocated out equals the sum of children's authorized; "Does not tie" (error) with the difference otherwise, linking to the integrity check (`over_allocated` or `hierarchy_mismatch` flag).
- Unallocated at leaf budgets is their own spending room; the column header tooltip explains this.
- Contingency reserve (separate root, outside program totals) appears as its own top-level row.

Changes in period (table): date, change type (Allocation, Per-head true-up, Transfer, Reduction, Freeze, Set to zero, Contingency release, Roll forward), from, to, amount, reason code and reason, by, approved by, journal link. Samples (October 2026):

- 3 Oct, Per-head true-up, India Region to Hyderabad Events, USD 180.00, "HR headcount refresh", system, approved by Meera Iyer.
- 14 Oct, Transfer, Westlake Team Activities to US Wellbeing, USD 1,500.00, "Rebalance between programs", Jordan Lee.
- 21 Oct, Set to zero, Europe Wellbeing to Europe Region, USD 6,000.00, "Program paused", Olivia Grant.
- 28 Oct, Contingency release, Contingency reserve to Europe Region, USD 2,000.00, "Unplanned event", approved by Marco Bianchi and Olivia Grant.

Drill-down: any amount opens the ledger lines (allocated out and authorized postings) in the side sheet of 079.

## Data and permissions

`reports.ts` allocation endpoint over the ledger (authorized and allocated-out buckets), budget versions and allocation history (089), with the hierarchy check computed server-side (parent allocated out equals children's authorized, the Phase 1 invariant). Scope by `report.read`; owners see their subtree and the parent's line only as a label. Reason codes from 106b.

## States

| State           | Behaviour                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Tree            | as above; first two levels expanded                                                                                      |
| Changes         | as above; filter by change type                                                                                          |
| Does not tie    | error tag on the row and a banner "1 budget does not tie. Finance has been notified." with a link to the integrity check |
| Empty changes   | "No allocation changes in October 2026"                                                                                  |
| Loading / error | shared frame states (079)                                                                                                |

## Budget safety and audit

Frozen (info with lock) and set to zero (important) use their own tags; allocated and available are separate columns. Every change row links to its journal and audit entry; exports and schedules are audited.

## Responsive and accessibility

Tablet: Owner and Children columns move behind "Columns". Mobile: tree becomes a drill-in list (tap a budget to see its children). Tree table uses `aria-level` and expanded state; "Ties" is a word, not only a colour.

## Satori components

Shared report frame from 079; `mat-table` as a tree table with `satTableWithRowStates`, `sat-navigation-tabs`, `sat-status-tag`, `sat-banner`, `sat-rich-tooltip` (driver and unallocated explanations); Angular Material side sheet; `bf-money`, `bf-budget-status`.

## Related screens and navigation

023 hierarchy, 089 allocation history, 022a per-head driver, 025 transfer, 026 reduce, 028 set to zero, 029a contingency release, 106b reason codes, 079 reports.

## Decisions taken

- The report shows the parent-equals-children check on every row, so a broken hierarchy is visible to finance in the report itself, not only in the nightly check.
- Changes in period include every movement type that alters authorized or allocated-out amounts, each with its reason code, in one list.
- The contingency reserve appears as its own root, never inside program totals (product answer of 2026-11-05).
