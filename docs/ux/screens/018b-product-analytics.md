# 018b Product analytics dashboard

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Admin > Product analytics (`/admin/product-analytics`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the dashboard layout of 011. Planned Stitch states, to be generated in a later session:

| State                        | Planned image                                                      |
| ---------------------------- | ------------------------------------------------------------------ |
| product KPIs against targets | `design/stitch/018b-product-analytics/default--desktop--light.png` |
| target missed                | `target-missed--desktop--light.png`                                |
| not enough data yet          | `insufficient--desktop--light.png`                                 |

## Purpose

Track whether BudgetFlow is working as a product for Hyland (owners activated and active, time to first allocation, time to approve, share of actuals matched automatically, budget left unused, channel adoption) against the agreed targets, using the analytics events pipeline from Phase 2, never personal data.

## Roles

Organization Admin and Finance Admin (view, export); CEO read.

## Entry points

Admin > Product analytics; executive weekly digest (optional section); 18a "Time to approve" link.

## Content and actions

Header bar: title, period (last 30 days, 90 days, fiscal year), Export (CSV, XLSX, PDF).

KPI cards with target and trend (sparkline):

- Owner activation: 78% of budget owners made an allocation or decision within 14 days of getting a budget (target 70%), success.
- Weekly active owners: 61 of 88 owners (69%) (target 70% monthly active), warning.
- Time to first allocation: median 2.4 days from budget activation.
- Time to approve: median 9.5 hours (target under 24 hours), success.
- Auto-match rate: 83% of imported actuals matched without a person (target 80%), success.
- Unused budget at period end: 12% of phased allotment unused in October.

Charts (each with "View as table"):

- Activation funnel for owners invited this year: invited 96, signed in 92, viewed a budget 90, allocated or decided 75.
- Weekly active owners and employees (lines).
- Decisions by channel over time (web, email, Slack, Teams, mobile).
- Auto-match rate by source (file, card, expense) per month.

Definitions panel: each KPI's definition, event names used (for example `allocation.created`, `approval.decided`, `actual.imported`, `actual.matched`) and the target with who set it.

## Data and permissions

Read model over `product_analytics_events` (Phase 2 `AnalyticsService.track`; properties are counts and flags only, never names or amounts) joined with role membership counts. `tenant.settings.manage` (Organization Admin) or `report.read` at tenant scope (Finance Admin, CEO). Targets are tenant settings (defaults: activation 70%, time to approve under 24 hours, auto-match 80%, monthly active owners 70%). No per-person drill-down exists.

## States

| State           | Behaviour                                                                             |
| --------------- | ------------------------------------------------------------------------------------- |
| Default         | as above                                                                              |
| Target missed   | KPI card in the warning tone with "Below target (70%)" in words                       |
| Insufficient    | fewer than 14 days or 20 owners of data: info "Not enough data yet" on affected cards |
| Loading / error | `sat-ghost`; error banner with Retry                                                  |
| Forbidden       | `sat-403-error-state`                                                                 |

## Budget safety and audit

No money on this page apart from the unused-budget percentage (from the ledger). Product analytics are separate from the audit log by design; exports of this dashboard are audited.

## Responsive and accessibility

Mobile: KPI cards as a list, charts as tables. Targets and status are written next to each value.

## Satori components

`sat-header-bar`, `sat-interactive-card` (KPIs), `sat-status-tag` (On target, Below target), `sat-rich-tooltip` (definitions), `sat-banner`, `sat-ghost`, `sat-403-error-state`; funnel, line and bar charts from `libs/web/ui/charts`; Export menu from 000.

## Related screens and navigation

18a approval performance, 080a actuals import (auto-match), 086 unused budget, 103 user and role management, 10a guided setup (P14).

## Decisions taken

- Product KPIs are tracked against the plan's default targets (activation 70%, approve under 24 hours, auto-match 80%, monthly active owners 70%) as KPIs, not decision gates. Recommended because they guide improvement rather than stop work.
- The dashboard never drills down to individuals; analytics events carry counts and flags only.
- It sits under Admin for Organization Admin and Finance Admin, not in the reports catalog for every role.
