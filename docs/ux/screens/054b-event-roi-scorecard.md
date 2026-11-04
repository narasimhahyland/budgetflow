# 054b Event ROI scorecard

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 9 batch. Build phase P9. Event details (046) new tab "Scorecard" (`/events/:eventId/scorecard`); linked from 043, 054 and the event spending report (085, P10).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the 046 frame and the KPI cards of 053. Planned Stitch states, to be generated in a later session:

| State                              | Planned image                                                        |
| ---------------------------------- | -------------------------------------------------------------------- |
| closed event scorecard             | `design/stitch/054b-event-roi-scorecard/default--desktop--light.png` |
| provisional (not closed yet)       | `provisional--desktop--light.png`                                    |
| compared with the template average | `compare--desktop--light.png`                                        |
| mobile                             | `default--mobile--light.png`                                         |

## Purpose

Judge value for money on one page: what each attendee really cost against plan, what no-shows cost, how many of the people invited took part, what attendees thought, and how the money from each co-funder was used and returned, compared with similar events.

## Roles

Event Organizer and co-organizers, owning and contributing owners, Finance Admin, Finance Controller, CEO (read); Analysts read through 085. Organizers can add notes.

## Entry points

046 tab "Scorecard" (available from Completed; final at Closed); 054 close confirmation "See the scorecard"; 043 "Recently closed"; 085 event spending report row action; 54a results link.

## Content and actions

Header bar: event name and code, dates, status tag (Closed), "Compare with" select (Team offsite template average, a specific earlier event), Export (CSV, XLSX, PDF).

Sample: Offsite 2026 (EVT-2026-0087), Bengaluru, 22-24 Oct 2026, organizer Rahul Verma, closed 5 Nov 2026.

KPI cards (planned against actual):

- Cost per attendee: planned USD 300.00 (USD 24,000.00 funded / 80 planned), actual USD 300.77 (USD 20,452.40 / 68 attended), +0.3%.
- Total cost: USD 20,452.40 of USD 24,000.00 funded; surplus USD 3,547.60 returned by share.
- Participation: 68 attended of 92 invited (73.9%).
- No-shows: 6 of 74 going (8.1%); no-show cost USD 570.00 (6 x USD 95.00 per-head catering and activities).
- Feedback: 4.4 of 5 from 41 responses (60%); 93% would attend again.
- FX effect: +USD 46.20, on its own card labelled "Not part of cost".

Cost by category (table and bar, planned against actual): Venue USD 8,000.00 / USD 7,820.00; Catering USD 7,600.00 / USD 6,460.00; Travel USD 4,800.00 / USD 4,152.40; Activities USD 2,400.00 / USD 2,020.00; Contingency USD 1,200.00 / USD 0.00.

Funding and returns (table): contributor, mode, approved, actual share (by attendance, 47e), surplus returned:

- Bengaluru Events (own funds): USD 15,000.00 approved; surplus USD 2,217.25.
- Hyderabad Events (IDBCR-2026-0042, earmark): USD 5,000.00; surplus USD 739.08.
- Westlake Team Activities (IDBCR-2026-0045, earmark, cross-entity, recharge RCH-2026-0012): USD 4,000.00; surplus USD 591.27.

Participation by location: Bengaluru 52 of 70 invited; Hyderabad 10 of 14; Westlake 6 of 8.

Comparison panel ("Team offsite template average, 4 events in FY2025-FY2026"): cost per attendee USD 285.40; participation 70%; no-show rate 11%; rating 4.1.

Organizer notes (editable by organizers until 30 days after close): "Book the venue 10 weeks ahead; the transport quote was 15% lower than last year."

## Data and permissions

Computed by the API from the ledger (final cost from matched actuals and consumed commitments at the locked plan rate), attendance and RSVP (47a, 47e), survey results (54a), contributions and surplus returns (P5, 054), with the comparison set from events sharing the template (45a) or chosen by the user. Read with `event.read` for the event; comparison uses only events the viewer can read, otherwise only aggregated template averages (minimum 3 events). Notes need `event.manage`. Nothing is computed in the browser.

## States

| State               | Behaviour                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Closed (default)    | as above                                                                                                                       |
| Provisional         | event Completed or Reconciling: warning banner "Provisional until the event closes: 2 unmatched actuals"; cost figures hatched |
| Not enough feedback | feedback card "Not enough responses yet (3 of 5 needed)"                                                                       |
| No attendance       | attendance not final: participation and per-attendee cards show "Mark attendance to see this" linking to 47e                   |
| Compare             | comparison columns next to each KPI with the difference in words ("USD 15.37 more per attendee")                               |
| Too few to compare  | "Comparison needs at least 3 similar events"                                                                                   |
| Before completion   | tab hidden until the event is Completed                                                                                        |
| Loading / error     | `sat-ghost` cards; error banner with Retry                                                                                     |

## Budget safety and audit

Planned and actual are always labelled; provisional figures are hatched until close. FX effect is shown separately and never counted as cost or surplus. Surplus figures come from the posted returns, not a recalculation. Read-only page; exports are audited, note edits are recorded in the event Activity tab.

## Responsive and accessibility

Tablet: KPI cards two by three. Mobile: KPI cards as a list, tables as cards, comparison as a line under each KPI. Charts have tables; differences are written ("+0.3% against plan"), not colour only.

## Satori components

`sat-header-bar`, `sat-interactive-card` (KPIs), `sat-status-tag`, `sat-banner` (provisional), `mat-table`, `sat-rich-tooltip` (how each KPI is computed), `sat-empty-state`, `sat-ghost`; Angular Material select (compare), form field (notes); bars from `libs/web/ui/charts` with "View as table"; Export menu from 000; `bf-money`.

## Related screens and navigation

046 event details, 053 reconciliation, 054 close event, 47e attendance, 54a survey and gallery, 45a templates (comparison set), 043 events dashboard, 085 event spending report (P10), 15b participation and reach (P10), 11b leadership summary (P15).

## Decisions taken

- The scorecard is a tab of the event, available from Completed and final at Closed, with provisional figures hatched. Recommended so organizers see it while memories are fresh but nobody quotes unfinished numbers.
- Comparison defaults to the average of events from the same template, and needs at least 3 events.
- No-show cost counts only per-head variable costs recorded on commitments (catering, tickets, activities), not fixed venue costs.
- No single "ROI score": the page shows the measures side by side, because a combined score hides the trade-offs owners need to see.
