# 084 Department comparison report

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Reports > Department comparison (`/reports/department-comparison`). Same layout and frame as 083, with departments as columns.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec and 083. Planned Stitch states, to be generated in a later session:

| State                         | Planned image                                                         |
| ----------------------------- | --------------------------------------------------------------------- |
| five departments side by side | `design/stitch/084-department-comparison/default--desktop--light.png` |
| department head view          | `department-head--desktop--light.png`                                 |

## Purpose

Compare departments on budget they own and on spend attributed to their people (through the cost split by each attendee's cost center), per head, so leaders can see which functions benefit from engagement money and which are left out, independent of which location organised the event.

## Roles

CEO, Finance Admin, Finance Controller, Read-only Analyst, Auditor (all departments); Department Heads see their department against the company average.

## Entry points

079 catalog; 083 "Switch to departments"; 15b participation "By department"; scheduled delivery (091).

## Content and actions

Everything in 083 applies (choose up to 6, totals or per head, drill-down, chart, Export, Schedule), with these differences:

- Columns are departments from the org hierarchy (sample: Engineering, Product, Sales, Customer Support, Finance and Operations).
- Two money blocks: "Budgets owned by the department" (authorized, committed, actual, pending, utilization) and "Spend attributed to the department's people" (event and activity cost allocated by attendee cost center, 049 and 47e).
- Rows: eligible headcount, attributed spend per head, participation (% of the department at one or more events), events attended per person, cost per attendee.
- Sample: Engineering 610 people, attributed spend USD 14,200.00 (USD 23.28 per head), participation 61%; Customer Support 280 people, USD 9,100.00 (USD 32.50 per head), participation 74%.
- Note under the table: "Attributed spend follows each attendee's cost center at the time of the event."

## Data and permissions

`reports.ts` comparison endpoint with dimension `department`: owned budgets roll up by owning org unit; attributed spend comes from `event_cost_splits` by cost center mapped to departments through the effective-dated org closure (P3), using the mapping on the event date. Scope by `report.read`; Department Heads receive their department plus a company average computed server-side.

## States

| State            | Behaviour                                                                               |
| ---------------- | --------------------------------------------------------------------------------------- |
| Default          | as above                                                                                |
| Department head  | two columns: their department and "Company average"                                     |
| No owned budgets | owned block shows "No budgets owned" for departments that only receive attributed spend |
| Other states     | as 083 and the shared frame (079)                                                       |

## Budget safety and audit

Owned and attributed money are separate blocks with their own labels so nothing is counted twice; pending stays separate from committed and actual. Exports and schedules are audited.

## Responsive and accessibility

As 083. Block headings are table row groups announced by screen readers.

## Satori components

As 083 (shared frame from 079, `mat-table`, `sat-rich-tooltip`, button toggle, chart from `libs/web/ui/charts`).

## Related screens and navigation

083 location comparison, 15b participation and reach, 049 cost split, 47e attendance, 033 organization hierarchy, 079 reports.

## Decisions taken

- Departments are compared on two separate measures, budgets they own and spend attributed to their people. Recommended because most engagement budgets are owned by locations, so ownership alone would show most departments as zero.
- Attribution follows the attendee's cost center on the event date (effective-dated), so reorganisations do not rewrite history.
