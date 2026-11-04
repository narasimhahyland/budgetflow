# 015a Fairness view: spend per head by location

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Dashboards > Fairness (`/dashboards/fairness`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the chart language of 011. Planned Stitch states, to be generated in a later session:

| State                            | Planned image                                                            |
| -------------------------------- | ------------------------------------------------------------------------ |
| spend per head by location       | `design/stitch/015a-fairness-spend-per-head/default--desktop--light.png` |
| headcount missing for a location | `headcount-missing--desktop--light.png`                                  |
| mobile                           | `default--mobile--light.png`                                             |

## Purpose

Answer "does engagement money reach every location fairly?": budget and spend per eligible employee by location in USD, against the company average, with the locations far below or above it called out.

## Roles

CEO, Finance Admin, Read-only Analyst (all locations); Organization Admin (People Ops) read; Regional Managers see their region's locations against the company average.

## Entry points

Insights > Dashboards; 011 link "Fairness"; 083 location comparison "Per head"; executive weekly digest.

## Content and actions

Header bar: title, FY2026, as-of time, Schedule delivery, Export (CSV, XLSX, PDF). Filter chips: category (default all engagement categories), budget type, "Include contractors" (off; follows eligibility rules).

KPI cards: company average budget per head USD 60.40 (USD 90,000.00 location budgets / 1,490 eligible); spend per head USD 20.50 (actual at locations USD 30,550.00 / 1,490); widest gap 3.3x (London against Hyderabad, spend per head).

Chart: per location, two bars (budget per head, spend per head) with the company average as a reference line; "View as table".

Table (headcount from the HR snapshot of 1 Oct 2026; amounts USD):

| Location  | Eligible headcount | Budget    | Budget per head | Actual    | Spend per head | Against company average |
| --------- | ------------------ | --------- | --------------- | --------- | -------------- | ----------------------- |
| Bengaluru | 420                | 16,000.00 | 38.10           | 5,300.00  | 12.62          | 62% (below)             |
| Hyderabad | 310                | 14,000.00 | 45.16           | 3,300.00  | 10.65          | 52% (below)             |
| Westlake  | 520                | 34,000.00 | 65.38           | 13,600.00 | 26.15          | 128% (above)            |
| London    | 240                | 26,000.00 | 108.33          | 8,350.00  | 34.79          | 170% (above)            |

- Callouts: locations below 75% or above 125% of the average spend per head are tagged "below" or "above", with a note "Different per-head rates by location may be intended; see program templates (020b)."
- Per-head rate line: shows the program's configured per-head rate per location where a per-head driver applies.
- Row action: "Compare in detail" (083).

## Data and permissions

`reports.ts` fairness endpoint: location budgets and actuals in USD at the locked plan rate (budgets are USD; local-currency actuals converted at the plan rate), eligible headcount from the latest HR snapshot (22c) using the program eligibility rules (employment type). Scope by `report.read`; Regional Managers get their locations plus the company average.

## States

| State                   | Behaviour                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Default                 | as above                                                                                     |
| Headcount missing       | row shows "No headcount" and is excluded from the average, with a warning banner linking 22c |
| Stale headcount         | info note when the snapshot is older than 45 days                                            |
| Empty / loading / error | `sat-ghost`; error banner with Retry                                                         |

## Budget safety and audit

All amounts USD; FX effect is not part of spend per head. Read-only; exports and schedules are audited.

## Responsive and accessibility

Mobile: KPI scroller, chart replaced by the table as cards. "Below" and "above" are words; the reference line is described in the table caption.

## Satori components

`sat-header-bar`, `sat-interactive-card` (KPIs), `satInteractiveTag` (filters), `mat-table`, `sat-status-tag` (below, above), `sat-banner`, `sat-rich-tooltip`, `sat-ghost`; grouped bar chart with reference line from `libs/web/ui/charts`; Export menu from 000.

## Related screens and navigation

083 location comparison, 15b participation and reach, 22c HR headcount import, 020b program templates, 011 executive dashboard.

## Decisions taken

- Fairness is measured as spend per eligible employee (actual), with budget per head beside it, against the company average. Recommended because budgets can be fair on paper while spend is not.
- Eligibility follows the program rules (contractors excluded by default) so the denominator matches per-head allocation.
- The view flags gaps (below 75% or above 125% of average) but does not judge them; intended differences are explained by program templates.
