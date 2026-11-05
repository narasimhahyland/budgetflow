# 094a Planning integration: Adaptive Planning

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Review-added screen (catalog section G: "Adaptive Planning import (plan to root budgets) and export (actuals, commitments, forecast)"). Admin > Integrations > Planning (`/integrations/adaptive-planning`), in the connector frame of 092.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the connector frame of 092 and the import review of 020a. Planned Stitch states, to be generated in a later session:

| State                             | Planned image                                                      |
| --------------------------------- | ------------------------------------------------------------------ |
| overview, credentials expired     | `design/stitch/094a-adaptive-planning/default--desktop--light.png` |
| plan import preview (differences) | `import-preview--desktop--light.png`                               |
| import blocked by a floor         | `import-blocked--desktop--light.png`                               |
| export schedule and history       | `export--desktop--light.png`                                       |

## Purpose

Keep the FP&A plan and BudgetFlow from drifting apart: import the approved plan from Adaptive Planning into BudgetFlow's root budgets as a new plan version, and send actuals, commitments and forecasts back to Adaptive on a schedule, while BudgetFlow keeps owning the delegation below the plan.

## Roles

Integration Admin (connect, map, schedule); Finance Admin (runs imports, approves the plan version); CEO (co-approves imports that add new money); Finance Controller (read).

## Entry points

092 Planning tile; 020a budget-plan import "Import from Adaptive Planning"; 023a roll forward "Start from the Adaptive plan"; 087a forecast cycle close "Export to Adaptive"; 080e period close "Export actuals".

## Content and actions

Overview (sample: Needs attention): error banner "Adaptive Planning rejected the credentials on 3 Nov. Imports and exports are paused." with "Replace credentials" (Connection tab). Last import: FY2026 plan, 14 Jan 2026; last export: September actuals, 6 Oct 2026.

Import plan (wizard):

1. Source: Adaptive version (for example "FY2027 Budget, Approved"), sheet and level ("Employee programs"), fiscal year FY2027 (must exist in 108).
2. Mapping: Adaptive levels to BudgetFlow root budgets (Employee programs to Employee Experience; Reserve to Contingency reserve), accounts to categories, entity dimension to legal entities; unmapped rows listed.
3. Preview (differences against current root budgets or "New in FY2027"): Employee Experience USD 110,000.00 (FY2026 USD 100,000.00, +USD 10,000.00, "New money: Finance Admin and CEO approve"); Contingency reserve USD 10,000.00 (unchanged).
4. Result: a Draft plan version (`plan_versions` kind Current, status Draft) with root budgets in Draft for a new year, or a proposed revision for the current year; "Submit for approval".

Floors: a decrease below what the root has already allocated or used (allocated out + held + encumbered + actual) is blocked row by row with the amount allowed.

Export (Sync tab):

- What: actuals, open commitments, latest accepted forecast (87a), at a mapped level (regions by default) and by month.
- When: monthly after the period closes (80e), using the close snapshot; or on demand.
- Target versions in Adaptive: "Actuals" and "Forecast - BudgetFlow".
- History: export runs with period, rows, status (Sent, Failed), and a link to the snapshot used.

## Data and permissions

Import produces a plan version and root budget changes through the P4 plan import and revision commands (020a, 029), so validation, the new-money rule and floors (`validateReduction`) apply; nothing below the root budgets changes. Root budgets must tie to the approved plan version (Phase 1 invariant). Export reads `period_close_snapshots` and `forecast_snapshots`; runs are idempotent per period and version. `integration.manage` to configure; imports need `budget.create_root` (Finance Admin) and approval by Finance Admin plus CEO when the company total increases (product answer of 2026-11-05).

## States

| State            | Behaviour                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Needs attention  | as above; imports and exports paused                                                                                       |
| Import mapping   | unmapped rows block Next with the list                                                                                     |
| Preview          | as above                                                                                                                   |
| Blocked row      | FY2026 revision: error line "Employee Experience cannot drop to USD 95,000.00: USD 100,000.00 is allocated to its regions" |
| Approval pending | Draft plan version with "Waiting for Olivia Grant (CEO)"                                                                   |
| Export history   | as above; failed runs link to 100                                                                                          |
| Loading / error  | `sat-ghost`; provider errors go to 100                                                                                     |

## Budget safety and audit

Imports never post money until the plan version is approved; decreases are floored and need a reason like any reduction. Exports use closed-period snapshots so Adaptive receives numbers that will not move. Imports, approvals and exports are audited with the Adaptive version and the snapshot ids.

## Responsive and accessibility

Desktop and tablet; mobile read-only. The preview table has row headers and writes differences as "+USD 10,000.00" or "no change".

## Satori components

Connector frame from 092; Angular Material stepper (import), `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-rich-tooltip` (floor explanation), `satImportantButton` (Submit for approval), `sat-ghost`; Angular Material select, dialog, snackbar; `bf-money`.

## Related screens and navigation

020a budget-plan import, 023a roll forward, 029 revise budget, 030 version history, 080e period close, 087a forecast cycle, 108 fiscal calendar, 092 hub, 100 errors.

## Decisions taken

- Adaptive Planning feeds root budgets only, as a new plan version that needs approval; BudgetFlow owns everything below the roots. Recommended so FP&A owns the plan and owners keep their delegation.
- Exports go monthly after period close from the close snapshot, plus on demand.
- Increases to the company total need Finance Admin and CEO approval, decreases are floored at what is already allocated or used.
