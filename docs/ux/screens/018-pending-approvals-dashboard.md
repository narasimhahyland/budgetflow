# 018 Pending approvals dashboard

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Dashboards > Pending approvals (`/dashboards/pending-approvals`). The personal work list stays the approval inbox (059).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the dashboard layout of 011. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                               |
| ------------------------------- | --------------------------------------------------------------------------- |
| pending across the organization | `design/stitch/018-pending-approvals-dashboard/default--desktop--light.png` |
| one approver's queue            | `approver--desktop--light.png`                                              |
| nudge confirmation              | `nudge--desktop--light.png`                                                 |
| mobile                          | `default--mobile--light.png`                                                |

## Purpose

Show what is waiting for approval across the organization (how much money is pending, at which step, with whom, how old, and what is past its SLA) so finance and leaders can unblock events, nudge slow approvers or set up delegates, without deciding on someone else's behalf.

## Roles

CEO, Finance Admin, Finance Controller (whole organization); budget owners and managers see items on their budgets and their team's approvers; Auditor read.

## Entry points

Insights > Dashboards; 011 "Pending approvals" card; 063 escalated "See all pending"; 076 SLA policy "Monitor".

## Content and actions

Header bar: title, scope, as-of time, Export (CSV, XLSX, PDF). Filter chips: request kind (spending, additional funds, over budget, co-funding, budget increase), region, step, SLA (within, due today, breached), amount band.

KPI cards: pending items 38; pending amount USD 4,000.00 pre-encumbered plus USD 6,500.00 in co-funding requests (earmarks not yet held); past SLA 5; median wait so far 11.2 hours.

By step (bar): budget owner 21, parent owner 9, Finance Controller 4, CEO 1, giving director (co-funding) 3; each bar split by SLA state.

Aging table (rows: approvers; columns: 0-1 day, 1-2 days, 2-5 days, over 5 days; cells with counts and amounts): Sophie Laurent 2 past SLA (USD 1,980.00); Jordan Lee 1 due today; Priya Raman 4 within SLA.

Items table: request, kind, requester, budget, amount (USD with transaction currency), current step and approver (delegate if active), waiting time, SLA tag, channel last notified (email, Slack, Teams, push). Row actions:

- Nudge approver (sends a reminder through their channels; once per 4 hours per item).
- Open request (060).
- For Finance Admin: "Suggest a delegate" (opens 062 for the approver to confirm; never assigns one directly).

## Data and permissions

`reports.ts` pending approvals endpoint over approval tasks (P5 and P7: step, approver, delegate, SLA timer, escalation) and requests (pre-encumbered amounts); co-funding requests show requested amounts as not yet held. Scope by `report.read` plus approval visibility: owners see tasks on their budgets. Nudge calls the notifications API with an idempotency window. No decision endpoint is reachable from this page.

## States

| State           | Behaviour                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Default         | as above                                                                                                                         |
| Approver drill  | approver selected: their queue with ages, delegation status ("Delegated to Anand Kumar until 15 Nov") and out-of-office if known |
| Nudge           | confirmation "Reminder sent to Sophie Laurent by Slack and email"; button disabled for 4 hours                                   |
| Nothing pending | success empty state "Nothing is waiting for approval"                                                                            |
| Loading / error | `sat-ghost`; error banner with Retry                                                                                             |

## Budget safety and audit

Pending amounts are pre-encumbered (hatched warning) and separate from approved commitments; co-funding requests show their requested amount as not yet held. Nudges are recorded in the request history (064); exports are audited. Nobody can approve from this dashboard.

## Responsive and accessibility

Tablet: aging table scrolls with the approver column pinned. Mobile: KPI scroller and items as cards with Nudge. SLA tags are words ("Past SLA by 6 hours").

## Satori components

`sat-header-bar`, `sat-interactive-card` (KPIs), `satInteractiveTag` (filters), `mat-table` with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag` (SLA), `sat-empty-state`, `sat-ghost`; Angular Material menu (row actions), snackbar; bar chart from `libs/web/ui/charts`; Export menu from 000.

## Related screens and navigation

059 approval inbox, 060 request details, 062 delegated approval, 063 escalated approval, 064 request history, 076 SLA policy, 18a approval performance, 011 executive dashboard.

## Decisions taken

- The dashboard can nudge approvers and suggest delegates but never decide or reassign. Recommended because decisions must stay with the person who holds the delegation-of-authority limit.
- Nudges are limited to one per item every 4 hours to avoid spamming approvers.
- Co-funding requests are shown with their requested amount, marked as not yet held, because earmarks only exist after the giving director approves.
