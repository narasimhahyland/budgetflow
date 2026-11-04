# 024 Allocate budget to child unit

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P4. Dialog over 023 budget hierarchy.

## Design

| State                                        | Image                                                             | Stitch screen                      |
| -------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| default (within limits)                      | `design/stitch/024-allocate-to-child/default--desktop--light.png` | `3788f697dcb04f20b3e427041214c05a` |
| blocked (over parent available and over DoA) | `blocked--desktop--light.png`                                     | `159aa5cd95bf4007870ce6a9eb4c7fff` |

## Purpose

Move money from a parent budget to one child unit with the impact on both visible before confirming, and stop allocations the parent cannot cover.

## Roles

Parent budget owners (CEO, Finance Admin, Department Head, Regional Manager, Location Manager) within their delegation-of-authority allocation limit. Finance Controller, Auditor, Analyst read only.

## Entry points

023 hierarchy "Allocate budget" or row menu; 021 budget details; 022 allocation workspace for bulk.

## Content and actions

"From" card (parent, owner, "Available under this budget's rules" with tooltip). "To child unit" select with current authorized. Amount (USD prefix, helper with the maximum). Allocation method: Fixed amount or Per-head driver (opens 022a). Effective date. Note to owner. Impact preview: parent available before and after, child authorized before and after, stacked bar (allocated to children, available, committed and actual), DoA check line, ledger and audit note. Footer: Cancel, "Allocate USD 25,000.00" (amount in the label).

## Data and permissions

`budget:allocate` on the parent through `PolicyService.can`; child must be a direct child in the same fiscal year; amounts in integer cents, USD. Idempotency key per dialog submit; ordered row locks parent then child.

## States

| State                       | Behaviour                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation                  | amount required, greater than 0, at most parent available                                                                                                                 |
| Blocked                     | error banner, field error, impact in error red with overflow bar, DoA line in error; primary disabled with "Fix the amount to continue"; link "Request an increase" (057) |
| Soft warning (not exported) | leaves parent under its alert threshold: warning line, can proceed                                                                                                        |
| Loading                     | button spinner; dialog stays open                                                                                                                                         |
| Error                       | API problem detail in an error banner; nothing posted                                                                                                                     |
| Success                     | snackbar "USD 25,000.00 allocated to Hyderabad Office"; tree updates                                                                                                      |

## Budget safety and audit

Allocated (violet) and available (teal) are distinct segments; hard block uses the error container with the action disabled. One allocation journal and one audit entry; child owner notified.

## Responsive and accessibility

Mobile: full-screen dialog, impact preview below the form, sticky footer. Focus to title; Esc cancels; the impact region is `aria-live="polite"`.

## Related screens and navigation

023, 021, 022, 022a, 057, 088.

## Assumptions and open questions

- Can a parent allocate to a grandchild directly? Assumed no (direct children only).
- Above the allocator's DoA limit: block (as designed) or route for approval? Designed as block with "Request an increase".
