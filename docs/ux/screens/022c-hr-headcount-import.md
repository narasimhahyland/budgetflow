# 022c HR headcount import and refresh

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P3 (per-head use in P4).

## Design

| State                                 | Image                                                                | Stitch screen                      |
| ------------------------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| review step (3 error rows, skippable) | `design/stitch/022c-hr-headcount-import/default--desktop--light.png` | `2bbc03b0659b40a692b6c393d0a4cced` |

## Purpose

Load headcount by location, entity and cost center from an HR export so per-head allocations (USD 15.00 per head per month, fictional) use current numbers, with a clear preview of the budget impact before applying.

## Roles

Organization Admin, Finance Admin. Owners of per-head budgets see the result in 024a.

## Entry points

Settings > People data; 024a "View headcount import"; the HR integration (93) later replaces the file with a sync.

## Content and actions

Stepper Upload, Map columns, Review, Apply. File chip and effective date. KPI cards: rows read, matched employees, new hires, leavers, rows with errors. Table "Headcount change by location": location, legal entity, cost center, previous, new, change, per-head allocation change (USD per month) with a total row. Error panel with row-level messages and "Download error rows". Options: skip error rows; recalculate per-head allocations (true-up next period). Footer: Back, Apply import.

## Data and permissions

`people:import` (OA, FA). Rows match employees by employee ID; locations and cost centers must exist (P3 master data). Apply is idempotent per file hash.

## States

| State                              | Behaviour                                                        |
| ---------------------------------- | ---------------------------------------------------------------- |
| Upload (step 1, not exported)      | `sat-upload-area` with template download and last import summary |
| Map columns (step 2, not exported) | source column to field mapping with required fields marked       |
| Review with errors                 | as designed; Apply allowed only with "skip error rows" checked   |
| Blocked                            | errors above 5% of rows: Apply disabled with reason              |
| Success                            | snackbar; true-up proposals appear in 024a                       |

## Budget safety and audit

No money moves on import; the true-up creates proposals that owners apply in 024a. One audit entry per import with counts; affected owners notified.

## Responsive and accessibility

Desktop and tablet only for import; mobile shows a read-only summary. Tables have header scope; error rows link to their row number.

## Related screens and navigation

024a per-head driver allocation, 038 employee directory, 041 cost centers, 093 HR integration.

## Assumptions and open questions

- Numbering: the inventory lists per-head allocation as 22a, but its design folder is `024a-per-head-driver-allocation`; this screen uses the inventory number 22c. Rename 024a to 022a?
- Is the per-head rate monthly or per event? Assumed monthly for the impact column.
