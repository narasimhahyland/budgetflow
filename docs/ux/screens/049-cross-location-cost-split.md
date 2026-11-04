# 049 Cross-location cost allocation

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 2. Build phase P5. "Cost split" tab of 046.

## Design

| State   | Image                                                                     | Stitch screen                      |
| ------- | ------------------------------------------------------------------------- | ---------------------------------- |
| default | `design/stitch/049-cross-location-cost-split/default--desktop--light.png` | `2bdf89f808bf4016b4bf8e0003cd1854` |

## Purpose

Split an event's cost across locations, teams or employing legal entities, and flag cross-entity shares for intercompany recharge.

## Roles

Event Organizer edits; funding owners and Finance Controller read.

## Entry points

046 tab Cost split; 047 after adding participants.

## Content and actions

"Split by" (Location, Team, Employing entity) and method (by planned attendees, fixed shares, manual). Summary: planned cost, attendees, cost per head against the event's per-head limit. Table: Location, Legal entity, Cost center, Attendees, Share, Cost, Charged to budget, Intercompany tag. Totals row; stacked share bar; intercompany info banner naming the policy and tax approver. Side card "Split check" (100%, no unassigned attendees, per-head limit re-checked on actual attendance). Footer: Recalculate, Save split.

## Data and permissions

Participants carry employing entity and cost center (047, P3 master data). Shares drive the funding line per contributor on each commitment (051). Cross-entity shares create a recharge (053a) per the intercompany policy (block, at cost, with markup).

## States

Shares not 100%: error total and Save disabled. Policy "block" for a pair of entities: error banner, that share cannot be saved. Changed after commitments exist: warning that existing commitment splits are re-proposed for approval.

## Budget safety and audit

Saving creates a new split version with an audit entry; commitments keep the split they were approved with until re-approved.

## Responsive and accessibility

Tablet: Cost center and Intercompany move into a row expander. Share bar has a table alternative (the table itself).

## Related screens and navigation

046, 047, 051, 053a.

## Assumptions and open questions

- Per-head limit for this event is USD 150.00 (planned USD 120.00); the team-lunch USD 40.00 limit does not apply to events.
