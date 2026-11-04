# 051 Event expense and commitment tracking

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 2. Build phase P5. "Commitments" tab of 046.

## Design

| State                         | Image                                                             | Stitch screen                      |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| default (catering row opened) | `design/stitch/051-event-commitments/default--desktop--light.png` | `f1f2395f9bdd422ea5813f65a6a99419` |

## Purpose

Track every commitment against the event's funding cap, from pending request to consumed, with actuals in their transaction currency next to the USD amount.

## Roles

Organizer and co-organizers; funding owners; Finance Controller.

## Entry points

046 tab Commitments; 057 after approval; 080b when an actual matches.

## Content and actions

KPI cards: funding cap, approved commitments, pending, actual, "Available under this event's rules" (tooltip). Stacked bar (actual, committed, pending hatched, available). Table: Commitment, Vendor, Service date, Status (Pre-encumbered, Encumbered, Partially consumed, Consumed, Released, Cancelled), Amount, Actual, Remaining, Funded by (per-contributor split). Expanded row lists matched actuals: transaction currency amount, USD at the locked plan rate, FX effect at month-end shown separately. Actions: Add commitment, Request additional funds (057); row menu Release remainder, Cancel (fees consumed).

## Data and permissions

Commitments with one funding line per contributor (from 049 shares). Available = cap - approved - pending - actual. INR and EUR actuals convert at the FY plan rate; FX never consumes budget.

## States

Over cap: Add commitment blocked with "Exceeds available by USD …" and a link to 057. Empty: "No commitments yet". Release: confirmation dialog with amount returned per contributor.

## Budget safety and audit

Pending (warning, hatched) and approved (solid) are distinct; releases and cancellations post reversals and audit entries.

## Responsive and accessibility

Mobile: commitment cards; expanded actuals as a nested list. The bar has a text breakdown.

## Related screens and navigation

046, 049, 052, 057, 080a, 080b, 053.

## Assumptions and open questions

- Known render issue: Stitch drew a sidebar with invented items (Delegations, Ledger verification) and a ledger-hash footer; the shell is 000a and there is no hash footer on this page.
