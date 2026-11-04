# 074 Over-budget policy

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch B. Build phase P7. Rules and policies > Over-budget.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/074-over-budget-policy/default--desktop--light.png`.

## Purpose

Decide, per control mode, what happens when a request or an actual would take a budget past its available amount: block, allow with approval up to a tolerance, or only record, and who approves the overage.

## Roles

Finance Admin (edit), Finance Controller and Auditor (read).

## Entry points

066 tabs; 058 over-budget request "Policy"; 021 controls drawer (control mode per budget links here for the company defaults).

## Content and actions

- Company defaults by control mode (cards): Hard (block above available; no tolerance); Soft (allow up to 10% or USD 1,000.00 over, whichever is lower, with parent owner approval; above that block); Track (allow and record; owner and Finance Controller notified).
- Who approves overages: parent budget owner up to USD 5,000.00 over; Finance Controller above; contributions from another director (056a) offered as the first option on 058.
- Justification: required text; attachments optional.
- Actuals over commitment (post-spend): within commitment tolerance (2% or USD 50.00) added to actual; above that an over-budget request is raised (080b link).
- Budgets using non-default settings: table of budgets with their mode and tolerance from 021 controls (read-only here).

## Data and permissions

Defaults feed new budgets and the over-budget rule (R-09); per-budget control basis, mode and tolerance live on the budget (P4). `rule:edit`, `rule:publish`.

## States

| State      | Behaviour                                                         |
| ---------- | ----------------------------------------------------------------- |
| Default    | as above                                                          |
| Validation | tolerance between 0 and 25%; amount cap above zero                |
| Unsaved    | changes bar; publish dialog lists budgets that inherit the change |

## Budget safety and audit

Hard block (error) versus soft with approval (warning) versus track (neutral, recorded) keep their tones. Published as audited rule versions; budgets with their own settings are not changed.

## Responsive and accessibility

Tablet fine; mobile read-only.

## Related screens and navigation

058, 021, 066, 080b, 056a.

## Assumptions and open questions

- Soft-mode default tolerance 10% capped at USD 1,000.00 is a fictional placeholder.
