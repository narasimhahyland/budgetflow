# 046a Live co-funding board

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P5.

## Design

| State                         | Image                                                             | Stitch screen                      |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| board with one event selected | `design/stitch/046a-co-funding-board/default--desktop--light.png` | `7514232b50e44649a2bf5ec564378463` |

## Purpose

Show, live, how close each multi-funded event is to its cap: which Inter-Director Budget Contribution Requests are approved, partial, pending or declined, and the remaining gap.

## Roles

Event Organizers (their events), contributing owners (events they fund or are asked to fund), Finance Controller and CEO (all, read).

## Entry points

Sidebar Events > Co-funding board; 046 "Open co-funding board"; 056a.

## Content and actions

Title with a live indicator and last update time. Actions: Export (CSV, XLSX, PDF menu; no Share), Request contribution. Left: event cards with cap, funded progress and pending count. Right for the selected event: KPI strip (cap, approved, pending, gap), stacked funding bar to the cap with legend (pending hatched), contributions table (request, from budget and director, requested, approved, mode earmark or transfer, status, updated), live activity feed.

## Data and permissions

Visible events filtered by `PolicyService.can(event:read)`; live updates by server-sent events or polling every 15 seconds.

## States

| State                | Behaviour                                                        |
| -------------------- | ---------------------------------------------------------------- |
| Empty (not exported) | "No events are being co-funded" with a link to events            |
| Fully funded         | success tag on the card; gap hidden                              |
| Stale connection     | info banner "Live updates paused, last updated hh:mm" with Retry |
| Loading              | skeleton cards and bar                                           |

## Budget safety and audit

Approved (success) versus pending (warning, hatched) never share a colour; partial approvals show requested and approved side by side. The board is read-only; decisions happen in 056a and are audited there.

## Responsive and accessibility

Mobile: event list first, tap opens the event's funding view. Bar has a table alternative; live feed is a polite live region.

## Related screens and navigation

046, 056a, 055, 059.

## Assumptions and open questions

- Should contributors see other contributors' amounts? Designed as visible to everyone on the board.
- Stitch shows the signed-in user as Priya Raman (Finance Controller) instead of the organizer; either works.
