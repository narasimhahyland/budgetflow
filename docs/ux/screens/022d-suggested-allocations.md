# 022d Suggested allocations

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 13 batch. Build phase P13. Side panel "Suggest a split" in the allocation workspace (022) and the allocation grid (22b) (`/budgets/:budgetId/allocate?suggest=1`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the 022 workspace and the AI output pattern of 11a. Planned Stitch states, to be generated in a later session:

| State                             | Planned image                                                          |
| --------------------------------- | ---------------------------------------------------------------------- |
| suggestion panel next to the grid | `design/stitch/022d-suggested-allocations/default--desktop--light.png` |
| weights adjusted                  | `weights--desktop--light.png`                                          |
| suggestion applied as a draft     | `applied-draft--desktop--light.png`                                    |
| not enough data                   | `no-data--desktop--light.png`                                          |

## Purpose

Help an owner split money among child budgets on evidence instead of gut feel, using eligible headcount, how much of last year's budget each child used and how many people each child's events reached, with the reasons visible and every amount reproducible, then let the owner adjust and submit the split as a normal allocation change.

## Roles

Owners of the parent budget (BO, DH, RM, LM) and Finance Admin, with `budget.allocate` on the parent. CEO for top-level splits. Read-only roles do not see the action.

## Entry points

022 header "Suggest a split" (next to "Grid view"); 22b toolbar "Suggest amounts"; 023a roll forward "Suggest new amounts" after cloning last year's tree; 16b nudge "Redistribute"; 11a answer link "Suggest a split for India Region".

## Content and actions

Sample: Meera Iyer, India Region, has USD 9,000.00 unallocated for wellbeing in Q1 FY2027.

Panel:

- Amount to split: USD 9,000.00 (defaults to the parent's unallocated amount, editable down to zero, never above "Available under this budget's rules").
- Children included (checkboxes): Bengaluru Events, Bengaluru Wellbeing, Hyderabad Wellbeing; Hyderabad Events shown disabled with "Driven by headcount (22a), not included".
- Weights (sliders that always total 100%): eligible headcount 50%, last year's use 30%, participation 20%. "Suggested weights" button resets to the AI-proposed weights; the reason is shown: "Bengaluru Wellbeing left 39% of last year's budget unused, so last year's use carries more weight than usual."
- Suggestion table: child, eligible headcount, last year's use, reach (15b), current allocation, suggested, change, per eligible head after the split:
  - Bengaluru Events: 420, 98%, 71.9%, USD 0.00, USD 4,300.00, +USD 4,300.00, USD 10.24.
  - Bengaluru Wellbeing: 420, 61%, -, USD 0.00, USD 2,100.00, +USD 2,100.00, USD 5.00.
  - Hyderabad Wellbeing: 310, 92%, -, USD 0.00, USD 2,600.00, +USD 2,600.00, USD 8.39.
  - Total USD 9,000.00; rounding note "Rounded to USD 50.00; remainder added to the largest line".
- Why per line (expandable) and Sources (HR snapshot of 1 Nov, FY2026 budgets of the same children, participation report), AI tag and confidence.
- Actions: "Use these amounts" (fills the grid 22b or the workspace as an unsaved draft change, each line tagged "From suggestion"), Dismiss, Helpful or Not helpful.

After "Use these amounts": the normal 22b footer shows the total against available, cell checks run, and the owner edits any line, then "Save draft" or "Submit as one change". The suggestion panel stays open for comparison; lines the owner changed lose the "From suggestion" tag.

## Data and permissions

New P13 `ai.ts` endpoint `POST /api/ai/allocation-suggestion` with parent budget, amount and children; facts come from read services under the caller's scope: HR headcount snapshot and eligibility (22c, 22a rules), prior-year authorized and consumed per child (ledger), participation per child's location (15b; groups under 5 people are excluded from the participation weight). Amounts are computed deterministically from the weights; the model proposes the weights and writes the reasons. Applying fills a client-side draft; nothing is saved until the owner saves or submits through the 22b change-set endpoint with its idempotency key, parent-available check under ordered row locks and delegation-of-authority routing. Each suggestion writes an `ai_query_log` row; a submitted change set records the suggestion id, model id and version.

## States

| State           | Behaviour                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Default         | panel as above                                                                                                           |
| Weights edited  | table recomputes instantly; "Custom weights" tag; "Suggested weights" restores                                           |
| Applied draft   | grid lines tagged "From suggestion"; footer checks as in 22b                                                             |
| Over available  | amount field error "USD 9,500.00 is more than India Region's USD 9,000.00 available under its rules"                     |
| Partial data    | info banner "No participation data for Hyderabad Wellbeing; its participation weight uses the India average"             |
| Not enough data | "Suggestions need a headcount snapshot and at least one prior year or 3 months of spending." with Import headcount (22c) |
| Frozen parent   | action hidden; frozen or zero parents cannot allocate (022 rules)                                                        |
| AI off          | "Suggest a split" hidden; manual allocation unchanged                                                                    |
| Unavailable     | shared AI banner in the panel; the grid stays fully usable                                                               |
| Loading         | `sat-ghost` table rows                                                                                                   |

## Budget safety and audit

A suggestion can never exceed the parent's "Available under this budget's rules" or set a child below its committed plus actual plus children; the normal grid checks still run and decide. Per-head-driven children are excluded. Nothing posts to the ledger until the owner submits; the change set is one journal and one audit entry listing every line, with the suggestion reference.

## Responsive and accessibility

Desktop only for applying (the grid is desktop-only for editing); tablet shows the suggestion read-only. Sliders have numeric inputs next to them and announce the new total; the per-line reasons are text, not tooltips only.

## Satori components

`sat-tag` (AI, "From suggestion"), `sat-banner`, `sat-rich-tooltip` (weight definitions), `sat-empty-state`, `sat-ghost`, `satImportantButton` (Use these amounts); Angular Material side sheet, slider with number fields, checkboxes, table, snackbar; `bf-ai-sources`, `bf-money`.

## Related screens and navigation

022 allocation workspace, 22b allocation grid, 22a per-head driver, 22c headcount import, 023a roll forward, 15b participation, 15a fairness view, 16b spending outlook, 31a what-if scenarios (P15), 011a assistant, 113a AI settings.

## Decisions taken

- A suggestion only fills a draft; the owner edits and submits it as a normal allocation change with all checks. Recommended because allocation is a delegation decision that stays with the owner.
- Amounts are reproducible: a visible formula over headcount, last year's use and participation; the model proposes the weights and explains them, and the owner can change the weights.
- Children driven by the per-head driver are excluded, since their amount follows headcount by design.
- Amounts are rounded to USD 50.00 with the remainder on the largest line, so suggestions read like plans rather than calculator output.
- Participation counts only groups of 5 or more people, matching the suppression rule of 15b.
