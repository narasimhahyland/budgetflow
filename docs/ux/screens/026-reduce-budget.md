# 026 Reduce budget

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P4. Dialog over 021 budget details.

Updated 2026-11-05 to the product answer: pending requests are **excluded from the floor** and listed in the impact preview instead. The exported images predate this answer (they count USD 3,500.00 of pending requests in a USD 30,000.00 floor and cap the reduction at USD 10,000.00); build from this spec. Replacement variants are queued: the Stitch daily screen-generation limit was reached on 2026-11-05 (see the review log).

## Design

| State                    | Image                                                        | Stitch screen                      |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------- |
| dialog (valid reduction) | `design/stitch/026-reduce-budget/dialog--desktop--light.png` | `8ffc2b68da1549939a97f827ff5e9699` |
| below floor (blocked)    | `below-floor--desktop--light.png`                            | `a16b2b3124d145feb7b357b9bbc08c4e` |

Differences from the images: the floor row reads "Floor (approved commitments + actual + children) USD 26,500.00"; pending requests move out of the floor into the impact preview; the maximum reduction is USD 13,500.00; the info line no longer says pending requests are unaffected without the preview.

## Purpose

Lower a budget's authorized amount, never below what is already committed, spent or passed to children, show which pending requests the cut puts at risk, and decide where the cut money goes.

## Roles

Parent budget owners and Finance Admin / Finance Controller within DoA. Not the budget's own owner unless policy allows.

## Entry points

021 budget details menu; 023 hierarchy row menu; rules engine proposals (reforecast).

## Content and actions

Two-column dialog (sample: Bengaluru Events, authorized USD 40,000.00).

- Left, current position: authorized USD 40,000.00; approved commitments (encumbered) USD 12,000.00; actual USD 8,500.00; allocated to child budgets USD 6,000.00; highlighted **floor = approved commitments + actual + children = USD 26,500.00**. Position bar with the floor and new-authorized markers.
- Left, **impact preview** (below the position): "Pending requests (not in the floor): 2 requests, USD 3,500.00", each with id, requester, amount and whether it still fits after the cut ("Fits" success tag, or "Will not fit" warning tag). Text: "Pending requests stay pending. When approved they are checked against the new available."
- Right: "Reduce by" (USD), read-only new authorized with headroom above the floor, destination radios (return to parent, contingency reserve, unallocated company pool), reason code, typed reason, notify checkbox (owner and the requesters of pending requests that will not fit).
- Footer: Cancel, "Reduce by USD 8,000.00".

Worked example: reducing by USD 8,000.00 leaves USD 32,000.00 authorized, USD 5,500.00 above the floor, and USD 2,000.00 available after pending requests, so both pending requests still fit. Reducing by USD 13,500.00 is allowed (exactly the floor) but marks both pending requests "Will not fit" with a soft warning.

## Data and permissions

`budget:reduce` on the node; reason codes from the taxonomy (106b); idempotency key; floor (encumbered + actual + allocated out) computed server-side at submit and re-checked under lock; the pending list comes from the same preview call (`previewReduction`).

## States

| State                     | Behaviour                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation                | amount, reason code and reason (10+ characters) required                                                                                                   |
| Pending at risk           | soft warning banner (warning container, can proceed): "2 pending requests (USD 3,500.00) will not fit the new available"; the primary button stays enabled |
| Below floor               | error banner, field error "Maximum reduction is USD 13,500.00", red new-authorized and hatched gap on the bar; primary disabled                            |
| No pending requests       | the impact preview shows "No pending requests on this budget"                                                                                              |
| Loading / error / success | as in 024; success snackbar and the budget shows a "Reduced" tag                                                                                           |

## Budget safety and audit

Floor = approved commitments + actual + child allocations; pending requests are not part of it and are never cancelled by a reduction (set to zero, 028, cancels them; freeze, 027, holds them). Hard block (error container) only below the floor; pending requests at risk are a soft warning. One reduction journal (authorized down, destination up) and one audit entry with reason code, text and the pending requests listed in the preview.

## Responsive and accessibility

Mobile: single column, full-screen dialog with sticky footer; the impact preview follows the position block. Bar has a text alternative ("New authorized USD 32,000.00, USD 5,500.00 above the floor"). "Fits" and "Will not fit" tags carry icons and text, not colour alone.

## Related screens and navigation

021, 023, 027 freeze, 028 set to zero, 060 request details (from a pending row), 088 audit log, 106b reason codes.

## Assumptions and open questions

- Decided 2026-11-05: pending requests are excluded from the floor and listed in the impact preview.
- Stitch rendered the destination radios with invented helper lines ("global treasury envelope"); ignore those, the labels are the design.
