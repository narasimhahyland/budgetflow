# 022c HR headcount import and refresh

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P3 (per-head use in P4).

Updated 2026-11-05 to the product answer: the import is **all-or-nothing**. Any row error blocks Apply; the user downloads a row-error report, fixes the file and uploads it again. There is no "skip error rows" option. The exported image predates this answer (it shows a "Skip the 3 error rows and import the rest" checkbox and an invented "ERP Sync Trigger" panel); build from this spec. A replacement variant is queued: the Stitch daily screen-generation limit was reached on 2026-11-05 (see the review log).

## Design

| State                      | Image                                                                | Stitch screen                      |
| -------------------------- | -------------------------------------------------------------------- | ---------------------------------- |
| review step (3 error rows) | `design/stitch/022c-hr-headcount-import/default--desktop--light.png` | `2bbc03b0659b40a692b6c393d0a4cced` |

Differences from the image: remove the skip checkbox and the "ERP Sync Trigger" panel; the error panel title becomes "Fix 3 rows to import" with "Download row-error report"; Apply import is disabled with the reason "Import is all or nothing: fix the 3 rows and upload the file again"; the "Rows with errors" KPI reads "Blocks import".

## Purpose

Load headcount by location, entity and cost center from an HR export so per-head allocations (USD 15.00 per eligible employee per month, prorated; fictional) use current numbers, with a clear preview of the budget impact before applying. A file applies completely or not at all, so headcount never reflects half a file.

## Roles

Organization Admin, Finance Admin. Owners of per-head budgets see the result in 022a.

## Entry points

Settings > People data; 022a "View headcount import"; the HR integration (93) later replaces the file with a sync.

## Content and actions

Stepper Upload, Map columns, Review, Apply. File chip and effective date. KPI cards: rows read, matched employees, new hires, leavers, rows with errors. Table "Headcount change by location": location, legal entity, cost center, previous, new, change, per-head allocation change (USD per month) with a total row; the table is a preview and applies only when every row is valid.

Error panel (when any row fails): title "Fix 3 rows to import", up to five row messages (row number, column, value, message: "Row 77: cost center CC-4410 not found"), "Download row-error report" (CSV with every failing row: row number, column, submitted value, message, plus the original row), and "Upload corrected file" (returns to step 1 with the mapping kept). Option: recalculate per-head allocations after import (true-up next period). Footer: Back, Apply import (disabled while any row fails).

## Data and permissions

`people:import` (OA, FA). Rows match employees by employee ID; locations and cost centers must exist (P3 master data). Validation runs over the whole file before anything is written; Apply runs in one transaction and is idempotent per file hash. The row-error report is generated from the same validation result.

## States

| State                              | Behaviour                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Upload (step 1, not exported)      | `sat-upload-area` with template download and last import summary                                                  |
| Map columns (step 2, not exported) | source column to field mapping with required fields marked                                                        |
| Review, all rows valid             | success summary "1,248 rows ready"; Apply import enabled                                                          |
| Review with errors                 | error panel with the row-error report; Apply import disabled with the reason (all or nothing); nothing is written |
| Apply failed                       | error banner; the transaction rolls back and the previous headcount stays in force                                |
| Success                            | snackbar; true-up proposals appear in 022a                                                                        |

## Budget safety and audit

No money moves on import; the true-up creates proposals that owners apply in 022a. A rejected file changes nothing. One audit entry per applied import with counts; one audit entry per blocked attempt with the error count; affected owners notified after a successful apply.

## Responsive and accessibility

Desktop and tablet only for import; mobile shows a read-only summary. Tables have header scope; error rows link to their row number; the disabled Apply button exposes its reason as text next to it, not only in a tooltip.

## Related screens and navigation

022a per-head driver allocation, 038 employee directory, 041 cost centers, 093 HR integration.

## Assumptions and open questions

- Decided 2026-11-05: all-or-nothing import with a downloadable row-error report; per-head rate is per eligible employee per month, prorated.
- Numbering: per-head allocation uses its inventory number 22a (`022a-per-head-driver-allocation`, renamed from 024a on 2026-11-05).

## Implementation

Built in Phase 3 at `/org/headcount` (Import HR file). Deviations from this design and the questions for review: `evidence/phase-03/visual-qa/design-parity/design-parity.md`. If the build lets users skip error rows, it must change to all-or-nothing to match this spec (follow-up for the people-data owner).
