# 031a What-if reallocation scenarios

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Budgets > Scenarios (`/budgets/scenarios`, scenario `/budgets/scenarios/:scenarioId`, compare `/budgets/scenarios/compare`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the 023 hierarchy, the 031 comparison and the 028 impact preview. Planned Stitch states, to be generated in a later session:

| State                          | Planned image                                                      |
| ------------------------------ | ------------------------------------------------------------------ |
| scenario editor with impact    | `design/stitch/031a-what-if-scenarios/default--desktop--light.png` |
| compare scenarios side by side | `compare--desktop--light.png`                                      |
| floor violation                | `floor-violation--desktop--light.png`                              |
| promote to changes (review)    | `promote--desktop--light.png`                                      |

## Purpose

Let leadership see the consequences of a mid-year cut or reallocation before making it: try reductions, transfers, freezes and set-to-zero across the tree in a private scenario, see which events and commitments would be at risk, how fairness per head and company-wide Available would change, compare up to three scenarios with today, and promote the chosen one into real control actions with the usual reasons, previews and approvals.

## Roles

CEO and Finance Admin (create, edit, promote); Finance Controller (read and comment; collaborator by invitation); named collaborators among CEO, Finance Admin and Finance Controller. Owners of affected budgets do not see a scenario until it is promoted.

## Entry points

Budgets > Scenarios; 023 hierarchy "Try a what-if"; 031 comparison "Create scenario from this"; 16b outlook "Model a redistribution"; 22d suggested allocations "Compare as a scenario".

## Content and actions

Scenario list: name, created by, baseline (live ledger as of time), changes, status (Draft, Promoted, Archived), collaborators.

Scenario editor (sample "Europe -20% to fund India festivals", Olivia Grant):

- Left: budget tree (023) with the scenario column next to today's authorized; changed rows highlighted.
- Change list (add with "Add change"): Reduce Europe Region by 20% (USD 27,000.00 -> USD 21,600.00), destination India Region; Transfer USD 3,000.00 from United States Region to India Region; Freeze London Wellbeing; Set Europe Wellbeing to zero (destination parent).
- Impact panel (recomputed on each change):
  - Floors: "Europe Region floor is USD 23,100.00 (committed + actual + children). The 20% reduction goes USD 1,500.00 below the floor." (error tone; promote blocked until fixed, for example "Reduce by 14.4% instead").
  - Events and commitments at risk: "Europe winter social (EVT-2026-0122): USD 2,600.00 is already committed; commitments stay protected and can complete." "2 pending Europe requests would no longer fit and would be returned."
  - Fairness per eligible head (15a): India (730 eligible) USD 41.10 -> USD 52.60; Europe (397) USD 68.01 -> USD 54.41; United States (675) USD 59.26 -> USD 54.81.
  - Company-wide Available: unchanged (reallocation) or the change for set-to-zero to savings.
  - Explain (AI tag, optional): a short narrative of the impact with sources.
- Compare: pick up to 3 scenarios; columns Today, A, B, C; rows per region with authorized, available under rules, at-risk commitments, fairness per head; differences highlighted.
- Promote: review step lists each change as the real action it becomes (reduce 026, transfer 025, freeze 027, set to zero 028), each needing a reason code and typed reason (one shared reason can prefill all), the impact preview, notifications to affected owners, and approvals by the usual route (Finance Admin plus CEO for new money; parent owner for transfers). "Submit changes" creates them as one batch; the scenario becomes Promoted with links to each action.

## Data and permissions

New P15 `scenarios` table (per the phase handoff) with changes, collaborators and status; impact computed server-side by the same domain functions as the real actions (`validateReduction` floors, available, earmark protection, per-head fairness) against the live ledger at compute time, without writing to the ledger. `budget.control` and `budget.allocate` at company scope (CEO, Finance Admin) to create and promote; collaborators read. Promotion calls the existing control and transfer commands with idempotency keys; each follows its own validation, approvals and audit.

## States

| State           | Behaviour                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Draft           | editor as above                                                                                |
| Stale baseline  | warning banner "The ledger changed since 10:20 (3 commitments). Recalculate." with Recalculate |
| Floor violation | error line with the floor and a suggested amount; Promote disabled with the reason             |
| Compare         | side-by-side table                                                                             |
| Promote review  | per-action reasons and impact; Submit changes                                                  |
| Partly approved | promoted scenario shows each action's status (Applied, Waiting for CEO, Rejected)              |
| Archived        | read-only, can be duplicated                                                                   |
| Empty           | "No scenarios yet" with "Create scenario"                                                      |
| Loading / error | `sat-ghost`; error banner with Retry                                                           |

## Budget safety and audit

Scenarios never change budgets: nothing is posted until promotion, and promotion creates the normal actions with their floors (committed + actual + children), destinations, reason codes, typed reasons, impact previews and approvals. Existing commitments and earmarked co-funding contributions stay protected. Creating, editing and promoting scenarios are audited; each resulting action has its own audit entry linked to the scenario.

## Responsive and accessibility

Desktop only for editing (tree and impact side by side); tablet read-only. Changes are a list with full sentences; floor violations are announced and linked to the change that causes them.

## Satori components

`sat-header-bar`, `sat-splitter` (tree and impact), `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-rich-tooltip` (floor and fairness explanations), `sat-tag` (AI on the narrative), `sat-empty-state`, `sat-ghost`, `satImportantButton` (Submit changes); Angular Material dialog (add change, promote review), select, snackbar; `bf-money`.

## Related screens and navigation

023 hierarchy, 031 budget comparison, 025 transfer, 026 reduce, 027 freeze, 028 set to zero, 15a fairness view, 046a co-funding board, 16b spending outlook, 22d suggested allocations, 088 audit log.

## Decisions taken

- A scenario is a private draft that never touches the ledger; promotion turns it into the normal control actions, each with its own reason, preview and approval. Recommended so planning freedom never bypasses controls.
- Affected owners see nothing until promotion, then get the usual control notifications.
- Impact uses the same domain checks as the real actions, so a scenario that passes will not fail on promotion except for ledger changes since the last recalculation.
- Up to three scenarios can be compared with today.
- The narrative explanation is optional AI with sources; the numbers come from the domain calculations.
