# 044 Event list

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 2. Build phase P5.

## Design

| State   | Image                                                      | Stitch screen                      |
| ------- | ---------------------------------------------------------- | ---------------------------------- |
| default | `design/stitch/044-event-list/default--desktop--light.png` | `6ff4d3633ba3412fb8116ff52a8a87bb` |

## Purpose

All events in scope with their funding, spend and lifecycle status; the way into event details (046).

## Roles

Event Organizers, Location and Regional Managers; owners scoped; Finance Controller read.

## Entry points

Sidebar Events; 115 employee dashboard "All events"; search.

## Content and actions

Header: Export menu, Create event (045). Tabs by lifecycle group (Upcoming, In progress, Reconciling, Closed, Drafts) with counts; filters (search, location, status, organizer, date range). Table: Event (name, then event code, locations and organizer), Date, Funding cap, Funded (bar with amount), Committed, Actual, Status (lifecycle tag plus context tags such as "2 unmatched actuals" or "Budget set to zero"). Row click opens 046.

## Data and permissions

`event:list` scoped by `PolicyService` (organizer, co-organizer, owners of funding budgets, contributors). Amounts in USD; funded = approved funding sources against the cap.

## States

Empty: "No events yet" with Create event. No results: Clear filters. Loading skeleton; error banner with Retry.

## Budget safety and audit

Events funded by a frozen or set-to-zero budget carry the tag; Create is blocked from those budgets (045). Read-only list.

## Responsive and accessibility

Mobile: event cards (name, date, status, funded bar). Funded bars have text values.

## Related screens and navigation

045, 046, 046a, 053, 054.

## Assumptions and open questions

- "Funding" is shown as the lifecycle step between Approved and Committed (as in 046).
