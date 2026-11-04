# 087c Rollover, lapse and sweep policies

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 11 batch. Build phase P11. Review-added screen (catalog section G: "rollover policies: lapse, carry full, carry capped, carry with approval; sweep to parent or corporate"). Finance > Year-end > Rollover policies (`/finance/rollover-policies`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the finance master-data layout of 106b. Planned Stitch states, to be generated in a later session:

| State                              | Planned image                                                      |
| ---------------------------------- | ------------------------------------------------------------------ |
| policies and assignment rules      | `design/stitch/087c-rollover-policies/default--desktop--light.png` |
| policy editor dialog               | `editor--desktop--light.png`                                       |
| budget overrides                   | `overrides--desktop--light.png`                                    |
| change after freeze date (blocked) | `blocked--desktop--light.png`                                      |

## Purpose

Decide in advance what happens to unused money at year end, budget by budget: lapse it, carry all of it, carry up to a cap, or carry only with approval, and where lapsed money goes (back to the parent or to a corporate pool), so owners know the rule all year and the year-end run (87b) applies it without debate.

## Roles

Finance Admin (create and assign policies); Finance Controller, CEO and Auditor (read); budget owners see their budget's policy on 021 and in 086.

## Entry points

Finance > Year-end > Rollover policies; 87b setup check "Rollover policies assigned"; 021 controls drawer "Rollover policy" link; 086 policy column; 108 plan-rate and year-end card.

## Content and actions

Tabs: Policies, Assignment rules, Budget overrides.

Policies (table): code, name, mode, cap, sweep target, budgets using it, actions Edit, Archive. Defaults:

| Code           | Name                | Mode                | Cap | Sweep to  | Budgets |
| -------------- | ------------------- | ------------------- | --- | --------- | ------- |
| LAPSE-PARENT   | Lapse to parent     | Lapse               | -   | Parent    | 812     |
| LAPSE-CORP     | Lapse to corporate  | Lapse               | -   | Corporate | 96      |
| CARRY-10       | Carry up to 10%     | Carry capped        | 10% | Parent    | 344     |
| CARRY-APPROVAL | Carry with approval | Carry with approval | -   | Parent    | 141     |
| CARRY-FULL     | Carry everything    | Carry full          | -   | -         | 19      |

Policy editor dialog: code (fixed after first use), name, mode (radio: Lapse, Carry full, Carry capped, Carry with approval), cap % of authorized (Carry capped only, 1-100), sweep target for the part that does not carry (Parent, Corporate), plain-English preview ("At year end, up to 10% of authorized carries into next year; the rest returns to the parent budget"), example with USD 8,000.00 authorized and USD 900.00 unused: "USD 800.00 carries, USD 100.00 returns to the parent."

Assignment rules (ordered, first match wins): by budget type and category, for example "Contingency reserve: Carry full", "Event budgets: Lapse to parent", "Wellbeing category: Lapse to parent", "Operating budgets in India Region: Carry up to 10%", default "Lapse to parent". Drag to reorder; "Preview assignment" shows how many budgets each rule matches.

Budget overrides: budgets with a policy set directly (budget, policy, set by, reason); "Add override" (budget picker, policy, reason).

Footer note: "Changes apply to FY2026 year-end until the commitment freeze date (15 Dec 2026)."

## Data and permissions

Uses `rollover_policies` (code, name, mode `lapse`, `carry_full`, `carry_capped`, `carry_with_approval`, `cap_bps`, `sweep_to` `parent` or `corporate`) and the budgets' `rollover_policy_id`; new P11 `close.ts` data for assignment rules and overrides with reasons. `master_data.manage` (Finance Admin) to edit; `budget.read` to see a budget's policy. After the year-end run's commitment freeze date, policy and assignment changes for that year are rejected (`ROLLOVER_LOCKED_FOR_YEAR_END`). Codes cannot change once a budget uses the policy.

## States

| State           | Behaviour                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Default         | as above                                                                                            |
| Editor          | dialog as above; preview updates live                                                               |
| Validation      | "Cap must be between 1% and 100%", "Code already exists"                                            |
| Unassigned      | warning banner "14 budgets have no policy; the default rule gives them Lapse to parent" with a list |
| Locked          | after the freeze date: info banner and editing disabled with the reason                             |
| Archive in use  | Archive disabled with "Used by 19 budgets"                                                          |
| Loading / error | `sat-ghost`; error banner with Retry                                                                |

## Budget safety and audit

Policies move no money until the year-end run; previews say "At year end". Policy, rule and override changes are audited with before and after values and the reason.

## Responsive and accessibility

Desktop and tablet; mobile read-only. Mode radios have descriptions; the preview sentence is announced when it changes; drag-and-drop rules have Move up and Move down alternatives.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `mat-table` with `satTableWithRowStates`, `sat-status-tag` (mode), `satDragDropList` (assignment rules), `sat-banner`, `sat-ghost`; Angular Material dialog, radio group, form fields, autocomplete (budget picker), snackbar.

## Related screens and navigation

87b year-end run, 086 unused and expired, 86a reclaim and redistribute, 021 budget details, 029a contingency reserve, 108 fiscal calendar.

## Decisions taken

- Policies are assigned by ordered rules (budget type, category, region) with per-budget overrides that need a reason; the default is "Lapse to parent". Recommended because most budgets follow a few patterns and exceptions must be visible.
- The contingency reserve carries in full by default (it is a separate root outside program totals).
- Policies lock for the year at the commitment freeze date so owners cannot change the rule just before year end.
- Lapsed money returns to the parent by default; sweeping to a corporate pool is an explicit policy choice.
