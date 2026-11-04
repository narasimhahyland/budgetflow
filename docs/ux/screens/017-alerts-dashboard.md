# 017 Alerts and exceptions dashboard

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Dashboards > Alerts (`/dashboards/alerts`). Budget alerts for owners and executives; control exceptions for finance and audit are on 17a. The original Stitch project has a screen for 17; this spec restyles it to the budget-safety rules.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the alerts card of 011. Planned Stitch states, to be generated in a later session:

| State               | Planned image                                                    |
| ------------------- | ---------------------------------------------------------------- |
| open alerts         | `design/stitch/017-alerts-dashboard/default--desktop--light.png` |
| acknowledged alerts | `acknowledged--desktop--light.png`                               |
| all clear           | `empty--desktop--light.png`                                      |
| mobile              | `default--mobile--light.png`                                     |

## Purpose

List every alert on the budgets a person is responsible for (thresholds crossed, controls applied, pace ahead of plan, forecast overruns, unused money at risk, overdue approvals, stale commitments) with what it means and the one action that resolves it, so owners and executives act before money runs out or lapses.

## Roles

Budget owners (Location Manager, Regional Manager, Department Head, Budget Owner) for their subtree; CEO, Finance Admin, Finance Controller, Read-only Analyst for all budgets; Auditor read.

## Entry points

011 "Alerts and exceptions" card "See all"; 013 health; alert notifications (123, email, Slack, Teams, push); owner weekly digest.

## Content and actions

Header bar: title, scope, as-of time, Export (CSV, XLSX, PDF). Tabs: Open (23), Acknowledged, Resolved (last 30 days). Filter chips: alert type, severity, region, "Only budgets I own".

Severity summary: Hard block 1, Warning 14, Information 8.

Alert list (cards in a single column on desktop, newest first within severity):

- Hard block (error tone): "Westlake Team Activities reached 100% (hard mode). New requests are blocked." Action: Request an increase (029) or Release a commitment (085a).
- Warning: "Bengaluru Events passed 80%: USD 8,050.00 of USD 10,000.00 committed or spent." Action: Open budget.
- Warning: "Westlake Team Activities is 131% of its phased plan with 2 months left." Action: Review phasing (032a).
- Warning: "United States Region forecast is USD 1,800.00 over authorized." Action: Open forecast (087).
- Warning: "India Wellbeing: USD 4,200.00 is forecast to lapse on 31 Dec." Action: Plan spend or release (086).
- Warning: "2 approvals for your budgets are past their SLA." Action: Open pending approvals (018).
- Information (info tone with lock): "Bengaluru Wellbeing was frozen by Meera Iyer on 2 Nov. Existing commitments continue." Action: Open budget.
- Information (important tone): "Europe Wellbeing was set to zero on 21 Oct; 2 pending requests were returned." Action: Open budget.
- Each card: budget, owner, raised at, rule or threshold that raised it, Acknowledge (with optional note), Snooze 7 days (warnings and information only).

## Data and permissions

`reports.ts` alerts endpoint over alert records raised by the threshold, control, pace, forecast, lapse, SLA and hygiene checks (the same checks as 013, plus owner thresholds 50/80/100% set in P4). Acknowledge and snooze are per user and do not change the budget. Scope by `report.read` and budget ownership; hard-block alerts cannot be snoozed.

## States

| State           | Behaviour                                                                           |
| --------------- | ----------------------------------------------------------------------------------- |
| Open            | as above                                                                            |
| Acknowledged    | cards greyed with who acknowledged and the note; re-raised if the condition worsens |
| Resolved        | condition no longer true (for example spend released); kept 30 days                 |
| All clear       | success empty state "No alerts on your budgets"                                     |
| Loading / error | `sat-ghost` cards; error banner with Retry                                          |
| Forbidden       | `sat-403-error-state` (Employee)                                                    |

## Budget safety and audit

Tones follow the design system: hard block (error, action disabled elsewhere with the reason), soft warning (warning), frozen (info with lock), set to zero (important). Alerts resolve themselves when the condition clears. Acknowledgements and snoozes are product analytics, not audit; the underlying controls are audited where they happen.

## Responsive and accessibility

Tablet and mobile: one card per alert with the action full width; filters in a sheet. Severity is written on each card ("Hard block", "Warning", "Information").

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `satInteractiveTag` (filters), `sat-banner` style cards via `sat-interactive-card` with tone, `sat-status-tag` (severity), `sat-empty-state`, `sat-ghost`, `sat-403-error-state`; Angular Material menu (Snooze), dialog (acknowledge with note); Export menu from 000.

## Related screens and navigation

011 executive dashboard, 013 health, 17a exceptions dashboard, 018 pending approvals, 021 budget details, 029 revise budget, 032a phasing, 085a commitment hygiene, 086 unused, 087 forecast, 123 notifications.

## Decisions taken

- 017 covers budget alerts for owners and executives, while 17a covers control exceptions for finance and audit. Recommended because the two audiences take different actions.
- Alerts resolve automatically when the condition clears; acknowledging only records that someone has seen it, and a worsening condition raises it again.
- Hard-block alerts cannot be snoozed.
