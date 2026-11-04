# 056a Inter-Director Budget Contribution Request

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P5. Exact term: "Inter-Director Budget Contribution Request" (an approved, audited contribution, never uncontrolled budget sharing).

## Design

| State                     | Image                                                                                | Stitch screen                      |
| ------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| contribute part (default) | `design/stitch/056a-inter-director-contribution-request/partial--desktop--light.png` | `15f6ffcd419b494c85228e0c6305479c` |
| contribute in full        | `full--desktop--light.png`                                                           | `108efc41af254da09c17f4eef27029c2` |
| decline                   | `decline--desktop--light.png`                                                        | `734b811f946c47f5babecdffeeaeca3b` |

## Purpose

Let the giving director decide on a request to co-fund another director's event: in full, in part, or decline, with the effect on their own budget and on the event's funding visible.

## Roles

Giving budget owner (decides, within their DoA); requesting owner (reads, gets notified); Finance Controller (reads; approves cross-entity cases when the intercompany policy requires).

## Entry points

Approval inbox (059), actionable email (061a), co-funding board (046a), 046 funding sources.

## Content and actions

Decision first: summary strip (requested amount, funding mode Earmark by default, event link, SLA), three option cards (Contribute in full; Contribute part with amount field and range; Decline), reason code (required for part and decline, optional for full), message to the requester, intercompany banner when entities differ, footer Cancel plus the primary action ("Contribute USD 6,500.00", "Contribute USD 12,000.00" or outlined important "Decline request"). Collapsible "Purpose and funding mode". Right: giving budget position with available before and after, and co-funding progress (cap, funded, this decision, gap). DoA note.

## Data and permissions

`contribution:decide` on the giving budget; DoA limit must cover the amount and legal entity; idempotency key per decision. Earmark keeps the money in the giving budget reserved for the event (unspent returns after close); Transfer moves it (disabled unless policy allows).

## States

| State                      | Behaviour                                                                  |
| -------------------------- | -------------------------------------------------------------------------- |
| Partial                    | amount between USD 1.00 and requested; reason code required                |
| Full                       | soft warning when it leaves the giving budget under 10% available          |
| Decline                    | reason code required; gap shown to the requester with suggested next steps |
| Outside DoA (not exported) | error line, primary disabled, "Escalate" as in 061                         |
| Already decided / expired  | read-only with the decision and who made it                                |

## Budget safety and audit

Earmarked money is shown as its own segment ("New earmark") in the giving budget bar. One audit entry with decision, amount, reason code and message; requester notified in app and by email.

## Responsive and accessibility

Mobile: option cards stack vertically; budget cards below. Option cards are a radio group with the amount field inside the selected option.

## Related screens and navigation

046, 046a, 059, 061a, 055, 088.

## Assumptions and open questions

- Requester side (creating the request) reuses this layout as a form; not designed separately here.
- Stitch rendered an extra "Approved Contribution Amount" caption in places; the option card amount is the source of truth.
