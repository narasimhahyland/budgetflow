# 043 Events dashboard

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 9 batch. Build phase P9. Events > Overview (`/events`), the landing page of the Events area from P9; the event list (044) moves to Events > All events.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the card and table language of 044 and 046. Planned Stitch states, to be generated in a later session:

| State                 | Planned image                                                    |
| --------------------- | ---------------------------------------------------------------- |
| organizer overview    | `design/stitch/043-events-dashboard/default--desktop--light.png` |
| empty (no events yet) | `empty--desktop--light.png`                                      |
| location manager view | `manager--desktop--light.png`                                    |
| mobile                | `default--mobile--light.png`                                     |

## Purpose

Give organizers and location managers one page that answers "what is coming up, what needs me, and is the money in place?" across their events: RSVP progress, funding gaps, quotes to choose, overdue tasks, events waiting for reconciliation and how recent events performed.

## Roles

Event Organizer and co-organizers (their events); Location Manager and Regional Manager (events in their locations or funded by their budgets); other budget owners scoped to events their budgets fund; Finance Controller (read, all events); CEO scoped. Employees use 115 and their invitations (47a) instead.

## Entry points

Sidebar Events (landing); 115 for organizers ("Your events"); digests (64a organizer weekly) "Open events"; notifications about RSVPs, quotes and tasks.

## Content and actions

Header bar: title "Events", scope and quarter; actions "Create event" (`sat-split-button`: From a template (45a), Blank event (045), Clone an event (45a clone dialog)), Export (CSV, XLSX, PDF). Filter chips: period (This quarter), location, "Only events I organize".

KPI cards (sample Rahul Verma, Q4 FY2026):

- Upcoming events (next 30 days): 4.
- Funded for upcoming events: USD 21,400.00 of USD 24,600.00 in caps (gap USD 3,200.00, warning tone).
- Cost per attendee, events closed this quarter: planned USD 300.00, actual USD 300.77 (Offsite 2026).
- Participation, events closed this quarter: 74% attended of those invited.
- Waiting for reconciliation: none (Offsite 2026 closed on 5 Nov); the card links to 053 when an event is Completed or Reconciling.

Needs your attention (list, each with one action):

- "RSVPs close tomorrow for Bengaluru Diwali celebration: 182 of 220 responded" -> Send reminder (47a).
- "Hyderabad townhall is 70% funded (USD 4,200.00 of USD 6,000.00)" -> Request contribution (056a).
- "3 catering quotes are waiting for a decision" (Hyderabad townhall) -> Compare quotes (51a).
- "Book the photographer is 1 day overdue" (Diwali celebration) -> Open checklist (46b).
- "Survey results are ready for Offsite 2026: 4.4 of 5 from 41 responses" -> Open scorecard (54b).

Upcoming events (table): date, event and code, locations, status tag, RSVP bar (going against capacity), funding bar (funded against cap), next task, organizer. Samples: Bengaluru Diwali celebration (EVT-2026-0112, 14 Nov, Bengaluru, Funded, 168 going of 220, USD 9,000.00 of USD 9,000.00); Hyderabad townhall (EVT-2026-0105, 5 Dec, Hyderabad, Approved, invitations not sent, USD 4,200.00 of USD 6,000.00); Bengaluru team pottery workshop (21 Nov, 12 going of 12); Quarterly team lunch, Hyderabad (recurring series 45a, 18 Dec).

Right column: month calendar with event dots (click filters the table to that day); "Recently closed" with cost per attendee and feedback score per event, linking to 54b.

## Data and permissions

Read models over events, participants (RSVP and attendance from 47a and 47e), funding (P5 contributions), commitments, checklist tasks (46b), quotes (51a) and surveys (54a), from the P9 events contract extension (`events.ts`). Scope by `PolicyService.can(event.read)`: organizers and co-organizers, owners of funding budgets, managers of the event's locations, finance. Figures come from the API; per-head and participation values are computed server-side from attendance. Amounts in USD.

## States

| State           | Behaviour                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Default         | as above                                                                                                                                    |
| Empty           | `sat-empty-state` "No events yet" with "Start from a template" (45a) and "Create a blank event" (045); template thumbnails below            |
| Nothing pending | attention card shows "Nothing needs you right now" in success tone                                                                          |
| Manager view    | KPIs by location with a location column in the table; attention items for budgets they own (funding requests, quotes above their threshold) |
| Loading         | `sat-ghost` KPI cards, list and table                                                                                                       |
| Error           | partial: banner naming the failed source ("RSVP data unavailable") with Retry; total: `sat-500-error-state`                                 |
| Forbidden       | `sat-403-error-state` (Employee opening `/events`)                                                                                          |

## Budget safety and audit

Funding bars separate approved funding (solid, success) from pending contributions (hatched, warning); a gap uses the warning tone, an over-cap commitment the error tone. Read-only page; exports are audited (who exported which scope and period).

## Responsive and accessibility

Tablet: KPI cards wrap two by three; calendar moves below the table. Mobile: attention list first, then upcoming events as cards with both bars, KPIs as a horizontal scroller, calendar hidden behind "Calendar". Progress bars have text equivalents ("168 going of 220").

## Satori components

`sat-header-bar`, `sat-split-button` (Create event), `sat-interactive-card` (KPIs, attention items, event cards on mobile), `satInteractiveTag` (filters), `mat-table` with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag` (event lifecycle), `sat-banner`, `sat-empty-state`, `sat-ghost`, `sat-500-error-state`, `sat-403-error-state`; Angular Material datepicker calendar (month view), progress bars, menu; Export menu from 000.

## Related screens and navigation

044 event list, 045 create event, 45a templates and clone, 046 event details, 46b checklist, 47a invitations and RSVP, 47e attendance and per-head recalculation, 51a vendor quotes, 053 reconciliation, 54b ROI scorecard, 056a co-funding request, 115 employee dashboard.

## Decisions taken

- The dashboard becomes the Events landing page from P9; the event list (044) stays one click away as "All events". Recommended because organizers start from "what needs me", not from a full list.
- Attention items carry exactly one action each and disappear when the underlying work is done (same rule as 123 tasks).
- The local holiday and festival overlay stays out of this calendar until P15 (43a).
