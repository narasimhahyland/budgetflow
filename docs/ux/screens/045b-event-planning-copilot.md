# 045b Event planning copilot

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Side panel "Plan with copilot" in the create event wizard (045) and on draft events (046); quote comparison summary in 51a.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the 045 wizard and the AI output pattern of 11a. Planned Stitch states, to be generated in a later session:

| State                                | Planned image                                                           |
| ------------------------------------ | ----------------------------------------------------------------------- |
| copilot panel with budget per head   | `design/stitch/045b-event-planning-copilot/default--desktop--light.png` |
| activity ideas and checklist starter | `ideas--desktop--light.png`                                             |
| quote comparison summary (51a)       | `quote-summary--desktop--light.png`                                     |
| not enough history                   | `no-history--desktop--light.png`                                        |

## Purpose

Help organizers start from experience instead of a blank page: a realistic budget per head for the city and activity based on Hyland's own past events, activity ideas people rated well or voted for, a starter checklist and quote request, and a plain comparison of the quotes received, all as suggestions the organizer accepts into the normal event flow.

## Roles

Event Organizers and co-organizers, Location Managers creating events; budget owners see the same suggestions when reviewing a draft event.

## Entry points

045 wizard "Plan with copilot" (first step); 046 draft event "Copilot"; 044a idea "Plan this" (opens 045 with the copilot); 51a "Summarise quotes"; 011a assistant "Help me plan a team day in Bengaluru".

## Content and actions

Inputs (prefilled from the wizard): city (Bengaluru), people (60), type (team day out), month (February 2027), budget to charge (Bengaluru Events, "Available under this budget's rules" USD 7,450.00).

Suggestions (AI tag, Sources and confidence on each):

- Budget per head: "Similar team days in Bengaluru cost USD 22.00-31.00 per head (median USD 26.40, 9 events in FY2025-26). For 60 people: about USD 1,580.00." Use fills the estimate in 045 (organizer edits).
- Activity ideas: "Cooking class (rated 4.6 by attendees, 3 events)", "Board games cafe (4.4, 2 events)", "Volunteering day with a partner charity (4.7, 1 event)", "Cricket match (top idea on your team's board, 31 votes)". Use sets the activity and opens a quote request draft.
- Timing: "Avoid 26 Jan (Republic Day, Bengaluru office closed). Fridays had 91% attendance against 78% on Wednesdays."
- Checklist starter (46b): venue, catering with dietary counts from 47b, transport, photo consent reminder, invitations 3 weeks ahead; Use adds the items to 46b.
- Quote request draft (51a): "Team day for 60 in Bengaluru, February, vegetarian options for 40% (from last year's needs)"; the organizer chooses vendors and sends it in 51a.

Quote comparison summary (in 51a, after quotes arrive): "Deccan Kitchen Co is lowest (USD 22.28 per head) but has a 30% deposit; Spice Route Caterers is USD 1.72 per head more, is a Preferred vendor and includes a live counter. Both are within the per-head limit." The organizer still selects in 51a with the required reason when not choosing the lowest.

## Data and permissions

New P15 `ai.ts` endpoint over the organizer's readable data: completed events of the same template and city (costs per head from 085, attendance from 47e, ratings from 54a), the team's idea board (44a), holiday calendars (43a), last year's attendee needs counts (47b, aggregated, no names), the vendor master status (106c) and the quotes on the event (51a). No external web search: suggestions draw only on BudgetFlow data. The model receives aggregates, never attendee names or needs per person. Using a suggestion fills wizard fields client-side; nothing is saved until the organizer saves or submits through 045 and 51a. Each call writes an `ai_query_log` row.

## States

| State              | Behaviour                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Default            | suggestions as above                                                                                           |
| Used               | fields filled show "From copilot" until edited                                                                 |
| Not enough history | "Fewer than 3 similar events in Bengaluru. Showing company-wide figures for team days." (labelled)             |
| Above available    | warning "About USD 1,580.00 is more than the USD 1,200.00 left; consider fewer activities or co-funding (56a)" |
| Quote summary      | shown when at least 2 quotes are in                                                                            |
| AI off             | panel hidden; 045 and 51a unchanged                                                                            |
| Unavailable        | shared AI banner; the wizard works normally                                                                    |
| Loading            | `sat-ghost` cards                                                                                              |

## Budget safety and audit

Estimates are labelled with their sample size and never become commitments: money is committed only when the organizer selects a quote in 51a and the normal approval runs. The budget check in 045 uses "Available under this budget's rules". The copilot never contacts vendors, books or sends anything. Saved events and commitments record the suggestion ids they used.

## Responsive and accessibility

Desktop and tablet as a side panel; mobile as a full-screen sheet from the wizard. Each suggestion's Use button names what it fills ("Use USD 1,580.00 as the estimate").

## Satori components

`sat-interactive-card` (suggestions), `sat-tag` (AI, "From copilot"), `sat-banner`, `sat-rich-tooltip` (sample sizes), `sat-ghost`, `sat-empty-state`; Angular Material side sheet, snackbar; `bf-ai-sources`, `bf-money`.

## Related screens and navigation

045 create event, 046 event details, 46b checklist, 47b attendee needs, 51a vendor quotes, 44a idea board, 43a holiday overlay, 54a survey, 54b scorecard, 085 event spending, 011a assistant, 113a AI settings.

## Decisions taken

- The copilot uses only Hyland's own past events, ratings, ideas and calendars, with no external web search. Recommended so suggestions are grounded in real costs and never invent venues or prices.
- Every suggestion fills a field the organizer can edit; nothing is saved, sent or booked by the copilot.
- Budget per head is always shown with its sample size and falls back to labelled company-wide figures when the city has fewer than 3 similar events.
- The quote summary explains trade-offs but the organizer still selects and gives the reason in 51a.
