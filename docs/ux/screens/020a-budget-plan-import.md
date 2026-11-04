# 020a Budget-plan spreadsheet import with column mapping

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4.

## Design

| State                      | Image                                                                   | Stitch screen                      |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| map-columns                | `design/stitch/020a-budget-plan-import/map-columns--desktop--light.png` | `8542c95359f342a8b163b5f700cc841a` |
| review (validation errors) | `review--desktop--light.png`                                            | `31e41681158045389fe905538171544f` |

## Purpose

Load the approved annual plan from a spreadsheet into Draft budgets, with column mapping and row checks before anything is created.

## Roles

Finance Admin. CEO approves the submitted plan.

## Entry points

019 Import plan; 019 empty state; 011 "Import budget plan".

## Content and actions

Stepper: Upload, Map columns, Review, Submit.

- Map columns: file chip with Replace file; table Spreadsheet column, Sample value, BudgetFlow field (select), Match; side card "Import rules" (amounts read as USD, root total must equal the approved plan, unknowns flagged next, nothing created until submit, remember mapping).
- Review: counts (rows, ready, warnings, errors), error banner, filter chips, table Row, Budget, Parent, Owner, Amount, Check; side card "What happens on submit" (creates Draft budgets, sends the plan to the CEO, budgets become Active on approval). Footer: Download error rows, Back, Submit plan for approval (disabled while errors remain).

## Data and permissions

`plan:import` (FA). Parsing is server-side; owner, entity and cost center resolved against master data (P3). Root budgets must tie to the approved plan version (invariant). Idempotent per file hash.

## States

Errors block submit; warnings (children exceed parent, closing cost center) allow submit with confirmation. Upload errors (wrong format, over size) on the Upload step. Success: snackbar and redirect to 019 filtered to Draft.

## Budget safety and audit

Nothing posts until the plan is approved; on approval one authorization journal per root and allocation journals per child. One audit entry for the import (file name, hash, counts) and one for the approval.

## Responsive and accessibility

Desktop-first (finance task); tablet stacks the side card under the table. Mapping selects are labelled with the spreadsheet column; errors link to their rows.

## Related screens and navigation

019, 023, 023a, 022b, 088.

## Assumptions and open questions

- Plan total in the sample is USD 110,000.00 for FY2027 (FY2026 was USD 100,000.00).
- Should warnings require a typed acknowledgement? Assumed a checkbox.
