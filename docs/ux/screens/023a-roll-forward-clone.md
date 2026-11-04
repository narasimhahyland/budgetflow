# 023a Roll forward or clone last year's tree

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4.

## Design

| State             | Image                                                               | Stitch screen                      |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------- |
| default (options) | `design/stitch/023a-roll-forward-clone/default--desktop--light.png` | `648988a008fb47d08301e57e8b39f61b` |

## Purpose

Start next year's budgets from this year's tree in one step, as Drafts, without touching the current year.

## Roles

Finance Admin and CEO.

## Entry points

019 empty state "Roll forward FY2026"; 023 hierarchy menu; 011 "Roll forward FY2026".

## Content and actions

Stepper Source, Options, Preview, Create. Left "What to copy": source tree (budget count); amounts radio (structure only at 0.00, FY2026 authorized amounts, adjusted by a percentage); checkboxes for period phasing, control mode and thresholds, per-head drivers (rates kept, headcount re-read from the latest HR import), skip closed and set-to-zero budgets; note that open commitments are not copied. Right "Preview": compact tree with amounts, skipped nodes struck through with a tag; summary (new budgets, total, all Draft); info banner. Footer: Back, "Create 39 draft budgets".

## Data and permissions

`plan:rollforward` (FA, CEO). Creates Draft budgets in the target fiscal year linked to their source; per-head amounts recomputed from the latest headcount snapshot. Job runs async with progress for large trees.

## States

Target year already has budgets: warning banner "FY2027 has 12 budgets; roll forward adds missing ones only" with a list. Target year not set up (P3 fiscal calendar): blocked banner linking 108. Success: snackbar and 019 filtered to FY2027 Draft.

## Budget safety and audit

Draft budgets post nothing; authorization happens when the FY2027 plan is approved (020a flow). One audit entry for the run (source, target, options, counts).

## Responsive and accessibility

Desktop and tablet; the preview stacks under the options on tablet. Tree preview is a `role="tree"` with expand/collapse.

## Related screens and navigation

019, 020a, 023, 108 fiscal calendar, 022a.

## Assumptions and open questions

- Stitch shows "Hyland Software" in the sidebar label; the shell shows "Hyland".
- Carry-forward of open commitments is a Phase 11 year-end action, not part of roll forward.
