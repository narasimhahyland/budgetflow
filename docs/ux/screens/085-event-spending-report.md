# 085 Event spending report

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Reports > Event spending (`/reports/event-spending`), in the shared report frame of 079.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the report frame of 079. Planned Stitch states, to be generated in a later session:

| State               | Planned image                                                         |
| ------------------- | --------------------------------------------------------------------- |
| events in period    | `design/stitch/085-event-spending-report/default--desktop--light.png` |
| grouped by category | `by-category--desktop--light.png`                                     |
| mobile              | `default--mobile--light.png`                                          |

## Purpose

List every event's money in one table (funded, committed, spent, cost per attendee, surplus returned, who co-funded it) so finance and owners can see where event money goes, which events ran over or under, and open each event's scorecard.

## Roles

Finance Admin, Finance Controller, CEO, Auditor, Read-only Analyst (all events); budget owners see events their budgets fund or own; organizers use 043 instead.

## Entry points

079 catalog; 043 "Export events" for managers; 011 drill-down by category Events; scheduled delivery (091).

## Content and actions

Frame from 079 (filters FY2026, period, location, status, category, organizer, cross-entity only; Save view, Schedule delivery, Export CSV, XLSX, PDF). Toolbar: Group by (none, location, category, status, month).

KPI strip: events 48; funded USD 96,400.00; spent USD 71,250.00; open commitments USD 9,800.00; surplus returned USD 6,920.00; average cost per attendee USD 47.60.

Table (amounts USD):

| Event (code)                                 | Dates     | Location  | Status   | Funded    | Committed open | Actual    | Attendees | Cost per attendee | Surplus returned | Co-funders |
| -------------------------------------------- | --------- | --------- | -------- | --------- | -------------- | --------- | --------- | ----------------- | ---------------- | ---------- |
| Offsite 2026 (EVT-2026-0087)                 | 22-24 Oct | Bengaluru | Closed   | 24,000.00 | 0.00           | 20,452.40 | 68        | 300.77            | 3,547.60         | 3          |
| Bengaluru Diwali celebration (EVT-2026-0112) | 14 Nov    | Bengaluru | Funded   | 9,000.00  | 7,800.00       | 940.00    | -         | -                 | -                | 2          |
| Westlake summer party (EVT-2026-0064)        | 18 Jul    | Westlake  | Closed   | 6,500.00  | 0.00           | 6,120.00  | 102       | 60.00             | 380.00           | 1          |
| Hyderabad townhall (EVT-2026-0105)           | 5 Dec     | Hyderabad | Approved | 4,200.00  | 350.00         | 0.00      | -         | -                 | -                | 1          |

- Status tags follow the event lifecycle; cross-entity events carry an "Intercompany" tag with the recharge status.
- Row actions: Open event (046), Scorecard (54b), Reconciliation (053) for Completed or Reconciling events.
- Cost per attendee appears only once attendance is final (47e); otherwise "-".
- FX effect column (optional through Columns) shows the event's FX effect separately.
- Chart: actual against funded per month for the filtered events, with "View as table".

## Data and permissions

`reports.ts` event spending endpoint over events (P5), commitments, actuals at the locked plan rate, attendance (47e), contributions and surplus returns (054). Scope by `report.read` plus event visibility: an owner sees events their budgets fund or own. Contributors see each other's amounts on co-funded events (product answer of 2026-11-05).

## States

| State           | Behaviour                                            |
| --------------- | ---------------------------------------------------- |
| Default         | as above                                             |
| Grouped         | group rows with subtotals; child events counted once |
| Empty           | "No events in this period" with Reset filters        |
| Loading / error | shared frame states (079)                            |

## Budget safety and audit

Open commitments (teal) and actual (violet) are separate columns; surplus shows only posted returns; FX effect is separate. Exports and schedules are audited.

## Responsive and accessibility

Tablet: Co-funders and Surplus columns move behind "Columns". Mobile: one card per event with funded, actual and status. Status tags use icon and text.

## Satori components

Shared report frame from 079; `mat-table` with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag`, `satCardSurfaceContainerLowest` (KPI strip), `sat-rich-tooltip`; chart from `libs/web/ui/charts`; `bf-money`.

## Related screens and navigation

043 events dashboard, 044 event list, 046 event details, 053 reconciliation, 054 close event, 54b scorecard, 46a co-funding board, 079 reports.

## Decisions taken

- Cost per attendee is shown only when attendance is final, so planned and actual are never mixed in one column.
- The report lists events of every status in the period, with open commitments separate from actuals, rather than closed events only. Recommended so finance sees upcoming exposure, not only history.
