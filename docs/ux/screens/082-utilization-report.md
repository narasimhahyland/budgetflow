# 082 Utilization snapshot (utilization report)

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P10 (snapshot used earlier by P5 utilization views).

## Design

| State                        | Image                                                                       | Stitch screen                      |
| ---------------------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| report with Export menu open | `design/stitch/082-utilization-report/export-menu-open--desktop--light.png` | `59e534643729460eb19c1ca5c8e475f1` |

## Purpose

A point-in-time view of how much of each budget is pending, committed, spent and still available, rolled up with child allocations counted once.

## Roles

CEO, Finance Admin, Finance Controller, Analyst; owners scoped to their subtree.

## Entry points

Insights > Reports > Utilization; executive dashboard (011) drill-down; scheduled delivery emails.

## Content and actions

Actions: Schedule delivery, Export (CSV, XLSX, PDF menu; no Share). Filters: fiscal year, group by, child budgets counted once. KPI cards: authorized, pending requests, approved commitments, actual, company-wide Available (tooltip with the definition), utilization. Chart: stacked horizontal bars by region with value labels outside the bars and a "View as table" alternative. Table of budgets: owner, authorized, pending, commitments, actual, available, utilization bar.

## Data and permissions

Scoped by `PolicyService.can(report:read)`; Available = Authorized - pending - approved commitments - actual, company-wide, child allocations counted once; reconciles to the ledger.

## States

| State                            | Behaviour                                                            |
| -------------------------------- | -------------------------------------------------------------------- |
| Loading / empty / error          | skeletons; empty "No budgets in this scope"; error banner with retry |
| Schedule delivery (not exported) | email, Slack or Teams channel, frequency, format                     |

## Budget safety and audit

Pending is hatched amber, commitments teal, actual violet, available grey; never colour alone (legend and table). Exports are logged as product analytics events.

## Responsive and accessibility

Mobile: KPI carousel, chart replaced by the table. Chart has a data table alternative.

## Related screens and navigation

011, 015, 021, 091 export and scheduled reports.

## Assumptions and open questions

- Utilization formula: (commitments + actual) / authorized, excluding pending (as designed)?
