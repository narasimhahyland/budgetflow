# 047 Add locations and participants

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P5. Participants tab of 046.

## Design

| State                                                            | Image                                                              | Stitch screen                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| participants tab (intercompany and missing cost center warnings) | `design/stitch/047-event-participants/default--desktop--light.png` | `6b3ca830ff7a491cb29e780f0317fe0c` |

## Purpose

Say who takes part and from where, so the event's cost splits correctly by location, employing entity and cost center, and cross-entity costs follow the intercompany policy.

## Roles

Event Organizer and co-organizers edit; contributing owners and Finance Controller read.

## Entry points

046 Participants tab; 045 create event step "Locations and participants".

## Content and actions

Toolbar: search, filters (location, entity, cost center), Import CSV, Add location, Add participants. Left card: locations with headcount, entity, share and per-head estimate. Table: name, employee ID, location, employing entity, cost center, status, cost share (USD), row selection for bulk actions. Banners: intercompany (info) and missing cost center (warning, "Fix now").

## Data and permissions

`event:manage-participants`; participants come from the employee directory (P3) with their employing entity and cost center; remote participants keep their own entity.

## States

| State                                  | Behaviour                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| Empty (not exported)                   | `sat-empty-state` "No participants yet" with Add participants and Import CSV  |
| Add participants dialog (not exported) | directory search with multi-select and live cost-share preview                |
| Validation                             | missing cost center blocks moving the event to Committed (warning until then) |
| Intercompany blocked (policy "block")  | error banner; cross-entity participants cannot be added                       |

## Budget safety and audit

Cost share recalculates from the cap; intercompany recharge mode shown per participant. Adds and removals are audited.

## Responsive and accessibility

Mobile: locations collapse into a summary chip row; table becomes a list with name, location and cost share.

## Related screens and navigation

046, 045, 038 employee directory, 053a intercompany recharge schedule.

## Assumptions and open questions

- RSVP (47a) replaces "Invited" status later (Phase 9); here status is organizer-managed.
