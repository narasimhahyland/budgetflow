# 015b Participation and reach

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Dashboards > Participation (`/dashboards/participation`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the chart language of 011. Planned Stitch states, to be generated in a later session:

| State                   | Planned image                                                        |
| ----------------------- | -------------------------------------------------------------------- |
| reach by location       | `design/stitch/015b-participation-reach/default--desktop--light.png` |
| small groups suppressed | `suppressed--desktop--light.png`                                     |
| no attendance data yet  | `empty--desktop--light.png`                                          |
| mobile                  | `default--mobile--light.png`                                         |

## Purpose

Show whether engagement money reaches people, not only whether it is spent: the share of employees who attended at least one event, by location, department and employment type, how often people take part, and how many have not taken part this year, without exposing individuals.

## Roles

CEO, Finance Admin, Read-only Analyst, Organization Admin (People Ops) (all locations); Regional and Location Managers and Department Heads scoped to their people.

## Entry points

Insights > Dashboards; 011 link; 54b scorecard "Participation"; 084 department comparison; executive weekly digest.

## Content and actions

Header bar: title, FY2026 (Jan-Oct), as-of time, Schedule delivery, Export (CSV, XLSX, PDF). Filter chips: location, department, employment type, event category.

KPI cards: reach 67.2% (1,001 of 1,490 eligible employees attended at least one event); events per participant 2.4; attendance rate of people who said Going 91%; not yet reached 489 people.

Reach chart by location (bars with the company reach as a reference line) and monthly reach trend (cumulative); both with "View as table".

Table by location:

| Location  | Eligible | Reached (1+ events) | Reach | Events held | Avg events per participant | Going but no-show |
| --------- | -------- | ------------------- | ----- | ----------- | -------------------------- | ----------------- |
| Bengaluru | 420      | 302                 | 71.9% | 14          | 2.7                        | 7%                |
| Hyderabad | 310      | 210                 | 67.7% | 9           | 2.1                        | 9%                |
| Westlake  | 520      | 338                 | 65.0% | 18          | 2.5                        | 10%               |
| London    | 240      | 151                 | 62.9% | 7           | 1.9                        | 12%               |

Tabs to switch the table to By department and By employment type (employee, contractor, intern; contractors shown even when not eligible for per-head budgets, labelled "not eligible").

"Not yet reached" card: counts by location and team only, with a link for managers to their own team's invitations (47a); no names are listed in this dashboard.

## Data and permissions

`reports.ts` participation endpoint over `event_participants` attendance (47e; only Attended and Walk-in count), invitations (47a), people and employment type (P3), and HR snapshots for the eligible denominator. Groups with fewer than 5 people are suppressed in every breakdown. Scope by `report.read`; managers receive only their scope. No individual-level rows are returned.

## States

| State             | Behaviour                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Default           | as above                                                                                     |
| Suppressed        | cells for groups under 5 show "Fewer than 5" with a tooltip explaining why                   |
| No attendance yet | empty state "Participation appears once organizers mark attendance (47e)" with a link to 043 |
| Partial data      | info banner "3 completed events have no attendance marked" with a link to the list           |
| Loading / error   | `sat-ghost`; error banner with Retry                                                         |

## Budget safety and audit

No money on this page apart from links to cost per attendee (54b, 085). Read-only; exports and schedules are audited.

## Responsive and accessibility

Mobile: KPI scroller, charts replaced by tables as cards. Percentages are accompanied by counts ("302 of 420"); suppressed cells are explained in text.

## Satori components

`sat-header-bar`, `sat-interactive-card` (KPIs), `sat-navigation-tabs` (breakdowns), `satInteractiveTag` (filters), `mat-table`, `sat-banner`, `sat-rich-tooltip`, `sat-empty-state`, `sat-ghost`; bar and line charts from `libs/web/ui/charts`; Export menu from 000.

## Related screens and navigation

15a fairness view, 084 department comparison, 047a invitations, 47e attendance, 54a survey, 54b scorecard, 043 events dashboard, 122a gamified participation (P15).

## Decisions taken

- Reach counts people who actually attended (Attended or Walk-in), not those invited or who said Going.
- Every breakdown suppresses groups under 5 people and the dashboard never lists names. Recommended so participation data cannot single out individuals.
- Contractors and interns appear in the employment-type breakdown even when not eligible for per-head budgets, labelled, so People Ops sees who is left out.
