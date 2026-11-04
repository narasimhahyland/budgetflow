# 026 Reduce budget

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P4. Dialog over 021 budget details.

## Design

| State                    | Image                                                        | Stitch screen                      |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------- |
| dialog (valid reduction) | `design/stitch/026-reduce-budget/dialog--desktop--light.png` | `8ffc2b68da1549939a97f827ff5e9699` |
| below floor (blocked)    | `below-floor--desktop--light.png`                            | `a16b2b3124d145feb7b357b9bbc08c4e` |

## Purpose

Lower a budget's authorized amount, never below what is already committed, spent or passed to children, and decide where the cut money goes.

## Roles

Parent budget owners and Finance Admin / Finance Controller within DoA. Not the budget's own owner unless policy allows.

## Entry points

021 budget details menu; 023 hierarchy row menu; rules engine proposals (reforecast).

## Content and actions

Two-column dialog. Left: current position (authorized, pending requests, approved commitments, actual, allocated to child budgets) and the highlighted floor (committed + actual + children); position bar with floor and new-authorized markers. Right: "Reduce by" (USD), read-only new authorized with headroom above the floor, destination radios (return to parent, contingency reserve, unallocated company pool), reason code, typed reason, notify checkbox. Info line: commitments and pending requests are not affected. Footer: Cancel, "Reduce by USD 8,000.00".

## Data and permissions

`budget:reduce` on the node; reason codes from the taxonomy (106b); idempotency key; floor computed server-side at submit and re-checked under lock.

## States

| State                     | Behaviour                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Validation                | amount, reason code and reason (10+ characters) required                                                                        |
| Below floor               | error banner, field error "Maximum reduction is USD 10,000.00", red new-authorized and hatched gap on the bar; primary disabled |
| Loading / error / success | as in 024; success snackbar and the budget shows a "Reduced" tag                                                                |

## Budget safety and audit

Pending requests are counted in the floor shown but are not cancelled (unlike set to zero). One reduction journal (authorized down, destination up) and one audit entry with reason code and text.

## Responsive and accessibility

Mobile: single column, full-screen dialog with sticky footer. Bar has a text alternative ("New authorized USD 32,000.00, USD 2,000.00 above the floor").

## Related screens and navigation

021, 023, 027 freeze, 028 set to zero, 088 audit log, 106b reason codes.

## Assumptions and open questions

- Should pending requests count in the floor (as designed, conservative) or only approved commitments?
- Stitch rendered the destination radios with invented helper lines ("global treasury envelope"); ignore those, the labels are the design.
