# 077 Rule simulation and testing

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch B. Build phase P7. Rules and policies > a rule > Simulate (the single-request panel is already designed in 069 "conflict and simulation").

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). The single-request simulation is covered by `design/stitch/069-rule-builder/conflict-simulation--desktop--light.png`. Planned exports: `design/stitch/077-rule-simulation/default--desktop--light.png` (backtest over last month's requests), `request-detail--desktop--light.png`.

## Purpose

Show what a draft rule (or a draft threshold table, route or limit) would have done to real past requests before publishing: how many outcomes change, which ones, and why, with no side effects.

## Roles

Finance Admin, Organization Admin (run); Finance Controller and Auditor (read results).

## Entry points

069 Simulate; 067 row action; 068 "Simulate first"; 071a, 071, 072a and 073 Simulate.

## Content and actions

Header: draft being tested (R-12 v4 draft versus R-12 v3 active), period (October 2026, 611 requests), scope filter, Run again.

- Summary cards: unchanged 571; stricter 31 (more approvals or a block); looser 9 (fewer approvals or auto-approve); now blocked 2; conflicts 0.
- Outcome matrix (active outcome by draft outcome) with counts; selecting a cell filters the table.
- Table: request, requester, budget, amount (USD), active outcome, draft outcome, change tag (Stricter warning, Looser info, Blocked error), facts that made the difference ("remaining after request 8%").
- Request detail (state): side-by-side explanations, active versus draft, with matched rules and fact values, exactly as shown to approvers.
- Banner: "Simulation only - no data changed. Uses the same evaluator as live decisions."

Actions: Export results, Back to rule, Publish (opens 069 publish dialog with the summary attached).

## Data and permissions

Backtests evaluate stored request facts against draft versions with the production evaluator (pure, no writes); results are kept for 30 days for audit. Requesters' names are visible to finance roles only. `rule:simulate`.

## States

| State     | Behaviour                                                              |
| --------- | ---------------------------------------------------------------------- |
| Running   | progress "Evaluated 380 of 611 requests"; page usable                  |
| Default   | results as above                                                       |
| No change | success banner "The draft gives the same outcome for all 611 requests" |
| Too large | period above 10,000 requests: asks to narrow the period or scope       |
| Error     | banner with Retry; partial results discarded                           |

## Budget safety and audit

Simulation never posts, notifies or changes requests. Running a backtest is audited (who, what draft, which period).

## Responsive and accessibility

Desktop and tablet. Matrix cells are buttons with counts read aloud ("31 requests become stricter").

## Related screens and navigation

069, 067, 068, 071a, 078.

## Assumptions and open questions

- Answers the 069 open question: simulation runs against last month's real requests (read only) as well as a single test request.
