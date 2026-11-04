# 058 Create over-budget request

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 2. Build phase P5.

## Design

| State   | Image                                                               | Stitch screen                      |
| ------- | ------------------------------------------------------------------- | ---------------------------------- |
| default | `design/stitch/058-over-budget-request/default--desktop--light.png` | `ded23f83e3694b73b84a43f939e32228` |

## Purpose

Ask to spend more than a budget has available, choosing how the gap is covered, with the stricter approval route made visible.

## Roles

Budget owners and requesters; approvers per the over-budget policy (finance always included).

## Entry points

117 or 057 when the amount exceeds available ("Request over budget"); 056 option "More than is available".

## Content and actions

Warning banner with the gap. Form: charge to (with available and mode chips), what for, vendor, amount, read-only "over budget by", gap options (spend over budget and track the overspend - only in soft or track mode; top up from the parent; ask another director via a co-funding request), justification, attachment. Side card "Approval route" with the reason for each step. Footer: Save draft, Submit over-budget request.

## Data and permissions

Over-budget policy (P7 config, seeded in P5): finance controller always approves; hard-block budgets cannot go negative, so the overspend option is disabled with the reason. A top-up creates a linked increase on the parent.

## States

Hard block (as designed): overspend option disabled. Soft mode: overspend allowed within tolerance, warning line "Leaves Bengaluru Events at -USD 650.00". Parent cannot cover: top-up option disabled with its available. Submitted: redirect to 060.

## Budget safety and audit

The full amount is pending on the charged budget until decided. Decisions and the linked top-up are audited together.

## Responsive and accessibility

Mobile: single column, route below. Disabled options keep their explanation visible (not only in a tooltip).

## Related screens and navigation

056, 056a, 057, 060, 061, 029.

## Assumptions and open questions

- Stitch added a "Policy POL-FIN-08" footer and an "Exception workflow" tag; ignore invented policy codes.
