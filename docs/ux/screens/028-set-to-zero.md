# 028 Set budget to zero

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P4. Dialog over 021 budget details (023 has the same dialog in its `set-to-zero-dialog` state).

## Design

| State                               | Image                                                      | Stitch screen                      |
| ----------------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| dialog (complete, ready to confirm) | `design/stitch/028-set-to-zero/dialog--desktop--light.png` | `87e6bda1828b461fba99670fb92ad232` |
| validation (cascade on, 3 errors)   | `validation--desktop--light.png`                           | `af5c1c5d8e5447be84651f289b1ea1c4` |

## Purpose

Stop all new spending on a budget: available becomes zero, new requests and allocations are blocked, approved commitments can still be paid, and the cut money goes to a chosen destination.

## Roles

Parent budget owners, Finance Admin, Finance Controller, CEO within DoA.

## Entry points

021 menu, 023 row menu and detail panel, freeze-and-zero policy (075) proposals.

## Content and actions

Important-tone banner "This stops all new spending". Left "Impact": authorized, actual, approved commitments (with purchase order count and View), allocated to child budgets, floor (committed + actual + children), money cut, pending requests that will be returned to requesters, child budgets list and "Also set child budgets to zero" toggle. Right "Decision": destination for cut money, reason code, typed reason, type-the-budget-name confirmation, audit and notification note. Footer: Cancel, red "Set to zero".

## Data and permissions

`budget:set-to-zero` on the node (and on each child when cascading). Floor recomputed under lock at submit. With cascade on, the floor excludes child allocations and includes the children's own committed and actual (USD 11,800.00 in the example).

## States

| State      | Behaviour                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| Validation | error summary ("3 fields need attention"), reason code, reason and name-match errors; red button disabled |
| Loading    | button spinner, inputs locked                                                                             |
| Error      | API problem detail banner; nothing changes                                                                |
| Success    | snackbar; budget shows the "Set to zero" tag (important tone) and the zero banner; requesters notified    |

## Budget safety and audit

Set to zero uses the important tone (never the info tone used by freeze). One audit entry with reason code, typed reason, floor, money cut, destination, cascaded children and returned requests; owners, child owners and requesters notified.

## Responsive and accessibility

Mobile: single column (impact first), full-screen dialog, sticky footer. Confirmation field announces match state; error summary links to fields.

## Related screens and navigation

021, 023, 026 reduce, 027 freeze, 075 freeze and zero-budget policy, 088 audit log.

## Assumptions and open questions

- Pending requests are returned (cancelled) on set to zero; confirm versus keeping them on hold as with freeze.
- Can a zeroed budget be restored, and is that a new allocation or an undo? Assumed a new allocation (append-only ledger).
