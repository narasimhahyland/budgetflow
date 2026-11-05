# 015c Outcome linkage (pulse, eNPS and retention versus participation)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Review-added screen (catalog section K: "outcome linkage: pulse survey or eNPS per event, retention vs participation"; plan Phase 15). Insights > Dashboards > Outcomes (`/dashboards/outcomes`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the chart language of 011 and the suppression rules of 15b. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                    |
| ------------------------------- | ---------------------------------------------------------------- |
| outcomes overview               | `design/stitch/015c-outcome-linkage/default--desktop--light.png` |
| retention by participation band | `retention--desktop--light.png`                                  |
| small groups suppressed         | `suppressed--desktop--light.png`                                 |
| not enough data                 | `empty--desktop--light.png`                                      |

## Purpose

Help leadership and People Ops answer "does the engagement money do any good?": how attendees rate events and the company (pulse and eNPS), which event types score best for their cost, and whether people who take part stay longer, shown carefully as correlation, without exposing individuals.

## Roles

CEO, Organization Admin (People Ops), Finance Admin, Read-only Analyst (company and region level); Regional Managers see event pulse and eNPS for their region; organizers see their own events' results in 54a and 54b.

## Entry points

Insights > Dashboards; 15b participation "Outcomes"; 54b event scorecard "Compare outcomes"; 011b leadership summary "Engagement" section; quarterly executive digest.

## Content and actions

Header bar: title, FY2026, as-of time, Schedule delivery, Export (CSV, XLSX, PDF). Filter chips: region, event category, period. Permanent info banner: "These figures show association, not cause. People who attend events may differ in other ways."

KPI cards: average event pulse 4.3 of 5 (2,140 responses); eNPS +32 (survey of 1,060 employees, October); reach 67.2% (15b); 12-month retention: participants 94.1%, non-participants 88.7% (groups of at least 10).

Event outcomes by category (table, with "View as table" chart): category, events, avg cost per attendee (USD), attendance rate, avg pulse, responses. Samples: Team events 41, USD 21.40, 89%, 4.2, 980; Festivals 6, USD 26.80, 93%, 4.6, 610; Wellbeing sessions 18, USD 12.10, 74%, 4.1, 320; Volunteering 4, USD 9.50, 81%, 4.7, 90.

Retention by participation band (bars with group sizes): 0 events (489 people) 88.7%; 1-2 events (612) 93.2%; 3 or more (389) 95.4%. By region (only regions with at least 10 people in every band).

eNPS trend by quarter and by region (line chart, "View as table"), with the survey question in a tooltip: "How likely are you to recommend Hyland as a place to work?"

## Data and permissions

New P15 `reports.ts` outcomes endpoint over survey results (54a: event pulse; company eNPS pulses run with the same survey tool), attendance (47e; Attended and Walk-in), people and employment dates from HR imports (P3, 093: leaver dates for retention), and event costs (085). Retention cohorts use people employed at the start of the window. Groups under 10 people are suppressed in retention figures and under 5 in survey figures; no individual rows are returned or exported. `report.read` with company or regional scope; Regional Managers get only their region's pulse and eNPS, not retention.

## States

| State           | Behaviour                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Default         | as above                                                                                           |
| Suppressed      | "Fewer than 10 people" in retention cells, "Fewer than 5 responses" in survey cells, with tooltips |
| Not enough data | "Outcomes appear after 3 months of attendance and at least one survey." with links to 54a and 47e  |
| No eNPS survey  | eNPS card shows "No company pulse yet" with a link to schedule one (54a)                           |
| Loading / error | `sat-ghost`; error banner with Retry                                                               |

## Budget safety and audit

Costs per attendee come from the ledger-backed event spending report (085) in USD; no money moves here. Read-only; exports and schedules are audited.

## Responsive and accessibility

Mobile: KPI scroller, tables as cards, charts replaced by tables. Every percentage is shown with its group size ("94.1% of 1,001 people").

## Satori components

`sat-header-bar`, `sat-interactive-card` (KPIs), `satInteractiveTag` (filters), `sat-banner` (association note), `mat-table`, `sat-rich-tooltip`, `sat-empty-state`, `sat-ghost`; bar and line charts from `libs/web/ui/charts`; Export menu from 000.

## Related screens and navigation

015b participation and reach, 054a survey, 054b scorecard, 085 event spending, 011b leadership summary, 122a gamified participation, 093 HR integration.

## Decisions taken

- Outcomes are shown as association with a permanent note, never as proof that events cause retention. Recommended so leaders do not over-read the numbers.
- Retention needs groups of at least 10 people and survey figures at least 5 responses; nothing is shown per person.
- Regional Managers see pulse and eNPS for their region but not retention, which stays at company and region level for People Ops and leadership.
- Outcomes never adjust budgets automatically; they inform people's decisions.
