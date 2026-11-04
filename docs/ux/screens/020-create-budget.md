# 020 Create budget

Status: proposed - awaiting user review. Light theme only. UX core set (todo `ux-core-screens`). New screen.

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share. Stitch wrote 'Hyland Inc. (US01)' for the legal entity; use the entity code (US01).

## Design

| State                                      | Image                                                         | Stitch screen                      |
| ------------------------------------------ | ------------------------------------------------------------- | ---------------------------------- |
| default (soft warning on parent remainder) | `design/stitch/020-create-budget/default--desktop--light.png` | `84742f901e8f4ddc93296e9dd568b52f` |

## Purpose

Create a budget under a parent with every accounting field the ledger needs (legal entity, cost center, budget currency at the locked plan rate) and its controls, seeing the effect on the parent before saving.

## Roles

Primary: Department Head, Regional Manager, Budget Owner, Finance Controller. Secondary: Finance Admin.

## Entry points

Budget list (019) Create; hierarchy (023) Add child; executive dashboard empty state (011).

## Content and actions

- Basics: name, parent (shows its unallocated amount), category, budget type (operating, event, shared event, contingency).
- Ownership: owner, co-owners.
- Accounting: legal entity, cost center (required on leaf budgets), budget currency with the locked plan rate note, amount with reporting-currency equivalent.
- Controls: control mode (hard, soft, track), tolerance, alert thresholds, period phasing.
- Right summary: parent available before and after, soft warning when the parent is nearly fully allocated, approval needed (DoA).
- Footer: Save draft, Create budget.

## Data and permissions

Parent balances and plan rates from the API; `budget:create` on the parent; above the user's DoA limit the budget is created as Pending approval.

## States

| State           | Treatment                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Validation      | Required fields, cost center required for leaf, amount above parent available: hard block with reason, Create disabled |
| Soft warning    | Parent left nearly empty: warning tag, can proceed (image)                                                             |
| Blocked parent  | Parent frozen or set to zero: banner, form read only                                                                   |
| Error / success | Banner with API detail / navigate to 021 with snackbar                                                                 |

## Budget safety and audit

Amount shown in budget and reporting currency at plan rate; create writes one audit entry and a balanced allocation journal.

## Responsive and accessibility

Tablet and mobile: summary moves under the form. Fields have visible labels and helper text; errors linked to fields.

## Related screens and navigation

019 budget list, 021 budget details, 022 allocation workspace, 023 hierarchy. Breadcrumb Home / Budgets / New budget.

## Open questions

- Can a budget's currency differ from its legal entity's functional currency?
