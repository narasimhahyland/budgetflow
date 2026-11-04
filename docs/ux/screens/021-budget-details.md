# 021 Budget details

Status: proposed - awaiting user review. Light theme only. UX core set (todo `ux-core-screens`). New screen.

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share. 'Available under this budget's rules' label; Reduce and Set to zero actions added.

## Design

| State                  | Image                                                          | Stitch screen                      |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------- |
| default (overview tab) | `design/stitch/021-budget-details/default--desktop--light.png` | `cf9d2c2bddc748998e466c140f6e123f` |
| controls-drawer        | `controls-drawer--desktop--light.png`                          | `f39bbb30c36c42a596813293d438f0f5` |

The freeze dialog over this page is spec [027](027-freeze-budget.md).

## Purpose

Everything about one budget: balances by bucket, forecast, currency, controls and rules, commitments, actuals, requests, children, versions and audit, with the owner's actions.

## Roles

Primary: Budget Owner, Location Manager. Secondary: parent owners, Finance roles, Auditor and Read-only Analyst (read only).

## Entry points

Hierarchy (023), budget list (019), search, notifications, dashboard alerts.

## Content and actions

- Header: name, status and threshold tags, owner, legal entity, cost center, currency; Request increase, Transfer, menu (Reduce, Freeze, Set to zero), Create event.
- Tabs: Overview, Commitments, Actuals, Requests, Children, Versions, Audit.
- Overview: KPI cards (budget, committed, actual, available); budget bar with held, pre-encumbered, encumbered, actual, accrued, available; forecast with dashed line; currency card (budget and reporting currency, plan rate, FX effect); controls card (mode, thresholds, rules applying, DoA); recent commitments table; activity timeline from the audit log.

## Budget controls drawer (Phase 4)

Opened from the controls card or the menu ("Controls"). Right drawer (480px): which buckets count against available (pending requests, approved commitments, actual, accrued); mode (hard block, soft warning, track only); tolerance % (soft mode only); limits (per event, per person per event on planned attendance, per category per period, "+ Add limit"); owner alert thresholds 50/80/100% with email and in-app channels; "Inherited from India Region" with an Override toggle. Saving creates a new budget version and one audit entry. Requires `budget:configure-controls` (parent owner or Finance Admin); owners see the drawer read-only. Stitch drew the page behind the drawer on the Versions tab; the drawer is the design.

## Data and permissions

Cached balances (equal to the nightly rebuild), commitments, forecast, rules matched, audit entries. Actions follow `PolicyService.can`; disabled actions show the reason.

## States

Loading (`sat-ghost`), empty tabs (no commitments yet), frozen (info banner, lock tag, actions disabled with reason), set to zero (important banner), error (500 state with Retry), success snackbars for actions.

## Budget safety and audit

Each bucket has its own segment; forecast dashed; FX effect separate. Every action from this page is audited; the Audit tab lists entries for this budget.

## Responsive and accessibility

Tablet: two-column cards collapse to one. Mobile: KPI cards scroll horizontally; tabs become a select. Tab panels use proper `tablist` semantics.

## Related screens and navigation

023 hierarchy, 024 allocate to child, 025 transfer, 026 reduce, 027 freeze, 028 set to zero, 030 version history, 046 event details. Breadcrumb Home / Budgets / India Region / Bengaluru Events; tab in the URL.

## Open questions

- Should forecast be visible to Location Managers or only to Finance and parent owners?
- Stitch render notes: PO and quote references and their USD conversions are illustrative.
