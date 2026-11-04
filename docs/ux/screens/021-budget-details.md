# 021 Budget details

Status: proposed - awaiting user review. Light theme only. UX core set (todo `ux-core-screens`). New screen.

## Design
| State | Image | Stitch screen |
| --- | --- | --- |
| default (overview tab) | `design/stitch/021-budget-details/default--desktop--light.png` | `787bc0a0e3214fc09104ec89258e0707` |

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
