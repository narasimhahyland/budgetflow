# 018a Approval performance (cycle time, bottlenecks)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Dashboards > Approval performance (`/dashboards/approval-performance`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the dashboard layout of 011. Planned Stitch states, to be generated in a later session:

| State                      | Planned image                                                         |
| -------------------------- | --------------------------------------------------------------------- |
| cycle time and bottlenecks | `design/stitch/018a-approval-performance/default--desktop--light.png` |
| approver detail            | `approver--desktop--light.png`                                        |
| approver's own view        | `own--desktop--light.png`                                             |

## Purpose

Measure how fast approvals happen and where they get stuck (cycle time by step, kind and channel, SLA compliance, slowest approvers, rework from "request changes") so finance can fix routing, thresholds or delegation instead of guessing why events are delayed.

## Roles

Finance Admin, Finance Controller, CEO (all approvers by name); Read-only Analyst (aggregates, no names); approvers see their own figures against the company median.

## Entry points

Insights > Dashboards; 018 "Performance"; 090 approval history "See performance"; 076 SLA policy "Compliance"; 18b product analytics "Time to approve".

## Content and actions

Header bar: title, period (last 90 days), Schedule delivery, Export (CSV, XLSX, PDF). Filter chips: request kind, region, amount band, channel.

KPI cards: median time to approve 9.5 hours (target under 24 hours); 90th percentile 31 hours; SLA compliance 91%; requests with changes requested 12%; decisions made outside the web app 54%.

Charts (each with "View as table"):

- Cycle time by step (median and 90th percentile bars): budget owner 6.1 h; parent owner 8.4 h; Finance Controller 14.2 h; CEO 20.5 h; giving director (co-funding) 26.0 h.
- Channel mix of decisions: web 46%, email 22%, Slack 18%, mobile 8%, Teams 6%; median time by channel (Slack 2.3 h, email 4.8 h, web 11.0 h).
- Weekly trend: median cycle time and SLA compliance.

Bottleneck approvers (table, minimum 10 decisions in the period): approver, step, decisions, median wait, 90th percentile, past SLA, delegations used. Samples: Sophie Laurent, parent owner, 38 decisions, median 22.0 h, 9 past SLA, no delegate set; Jordan Lee, parent owner, 41, 12.5 h, 3, delegate set; Priya Raman, Finance Controller, 57, 14.2 h, 4.

Suggestions panel (rules-based, never automatic): "Sophie Laurent is the slowest step for Europe: consider a delegate during travel (062) or raising the parent-owner threshold for Europe from USD 1,000.00 (071a)."

## Data and permissions

`reports.ts` approval performance endpoint over approval actions (decision, step, approver, delegate, channel from `approval_channel`, SLA timers, escalations, changes requested) for the period. Names appear only for roles with `report.read` at tenant scope; Analysts receive aggregated figures; approvers receive their own figures plus company medians. Approvers with fewer than 10 decisions are grouped as "Others".

## States

| State                   | Behaviour                                                                     |
| ----------------------- | ----------------------------------------------------------------------------- |
| Default                 | as above                                                                      |
| Approver detail         | selected approver: their decisions over time, by channel, past-SLA items list |
| Own view                | "Your median 6.8 hours, company 9.5 hours"; no other names                    |
| Small sample            | info "Fewer than 30 decisions in this filter; medians may move a lot"         |
| Empty / loading / error | `sat-ghost`; error banner with Retry                                          |

## Budget safety and audit

No money moves here. Exports and schedules are audited. The page reads approval records; it does not change routing or limits (suggestions link to 062, 070, 071a).

## Responsive and accessibility

Mobile: KPI scroller, charts replaced by tables, bottleneck list as cards. Times are written with units ("22.0 hours").

## Satori components

`sat-header-bar`, `sat-interactive-card` (KPIs, suggestions), `satInteractiveTag` (filters), `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-rich-tooltip` (median and percentile definitions), `sat-banner`, `sat-ghost`; bar, donut and line charts from `libs/web/ui/charts`; Export menu from 000.

## Related screens and navigation

018 pending approvals, 090 approval history, 062 delegations, 070 routing, 071a threshold table, 076 SLA policy, 18b product analytics, 061a, 061b, 061c, 59a channels.

## Decisions taken

- Named approver figures are visible to Finance Admin, Finance Controller and CEO; Analysts see aggregates and approvers see only themselves against the company median. Recommended to make bottlenecks fixable without turning the page into a league table.
- Approvers need at least 10 decisions in the period to be ranked; others are grouped.
- Suggestions are written hints linking to the configuration screens; nothing changes automatically.
