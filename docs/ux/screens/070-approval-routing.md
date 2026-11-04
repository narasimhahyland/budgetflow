# 070 Approval routing configuration (workflow builder)

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Rules and policies > Routing.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/070-approval-routing/default--desktop--light.png` (route for spending requests), `test-route--desktop--light.png` (test panel open), `validation--desktop--light.png`.

## Purpose

Define who approves what, in which order, for each request kind: the base chain by hierarchy, steps added by amount and remaining-budget thresholds or by rules, parallel steps, and how delegation of authority escalates a step when its approver's limit is not enough.

## Roles

Finance Admin (edit and publish), Organization Admin (edit), Finance Controller and Auditor (read).

## Entry points

066 tabs; 069 actions "Require approval" link to the route they extend; 050 and 060 "Why this route?" (read-only view for finance).

## Content and actions

Header: route selector by request kind (Spending, Budget, Additional funds, Over-budget, Exception, Inter-Director Budget Contribution Request), version tags (Active v3, Draft v4), Test route, Publish.

Canvas (vertical flow, left to right reading order kept simple):

1. Start: request submitted.
2. Step "Budget owner" (always; skipped when the requester is the owner, goes to the parent owner).
3. Condition "Amount above USD 500.00 or remaining after request below 10%" -> step "Parent budget owner".
4. Condition "Legal entity differs from the budget's entity" -> parallel step "Tax approver" next to the chain.
5. Condition "Amount above USD 5,000.00" -> step "Finance Controller".
6. Condition "Amount above USD 25,000.00" -> step "CEO".

The amount conditions come from the threshold table (071a) and show "From the threshold table" with a link; they are edited there, not on the canvas. 7. End: approved.

Each step card: approver source (role in hierarchy, named group, rule-added), mode (sequential or parallel; any one or all of a group), SLA (from 076), "Apply delegation of authority" (always on, read-only explanation: "If this approver's limit is below the amount, the step escalates to the next authority in 070a"). Side panel for the selected step with these fields. "Add step" and "Add condition" between steps.

Test route panel: inputs (budget, amount and currency, spend type, requester, legal entity); result list of steps with approver name, DoA limit and outcome (approves, escalates to, skipped because), identical to the route shown on 050 and 060; "Test only - nothing is saved".

## Data and permissions

Route definitions are versioned like rules (immutable once active, effective-dated); evaluation is pure (`libs/domain`) and shared by the test panel, 050/060 explanations and live routing. Rules (069) can add steps; the route defines the base chain. `routing:edit`, `routing:publish`.

## States

| State           | Behaviour                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Default         | as above                                                                                                                         |
| Test route      | panel with the computed chain; mismatch with live route never occurs (same evaluator)                                            |
| Validation      | a condition without a following step, an empty group, or a route without an end: inline errors; Publish disabled with the reason |
| Self-approval   | a step that could resolve to the requester shows "Skipped for the requester; goes to the next authority" (info)                  |
| Publish confirm | dialog: changes compared with v3, effective date, number of open requests that keep their old route                              |
| Read only       | Finance Controller and Auditor: canvas without edit controls                                                                     |

## Budget safety and audit

Ownership alone never satisfies a step: every step shows its DoA check. Publishing writes an audit entry with the full route version; open requests keep the route they started with.

## Responsive and accessibility

Tablet: side panel overlays. Mobile: read-only list of steps. The canvas has a list view alternative ("View as list") that is keyboard and screen-reader friendly.

## Related screens and navigation

050, 060 (why this route), 062, 063, 069, 070a, 071a threshold table, 076.

## Assumptions and open questions

- Thresholds shown are fictional samples; the production values come from the threshold table (071a).
