# 041 Cost centers

Status: built in Phase 3 without a Stitch design (none existed for this screen); implemented from the design system (`docs/ux/design-system.md`) with Satori components first and Angular Material second, light theme only. Pending design review. Covers inventory screens 41 Cost-center management. Route `/org/cost-centers`.

## Purpose

List cost centers with legal entity, org unit and active dates as of a date; add and deactivate them.

## Roles

Organization Admin and Finance Admin maintain; every member reads (reference data for forms).

## Entry points

Sidebar Cost centers; hierarchy detail.

## Content and actions

- As-of date, count of active cost centers.
- Table: code and name, legal entity, org unit, active dates, status tag.
- Add cost center: code, name, legal entity, optional org unit, effective date.
- Deactivate from a date with a reason (last active day is the day before).

## Data

`listCostCenters`, `createCostCenter`, `changeCostCenter`, `listLegalEntities`, `listOrgUnits`.

## Permissions

`tenant.read` to read; `org.manage` or `master_data.manage` to change.

## States

Loading, empty, errors inline, success banner.

## Audit

One audit event per create, change or deactivation.

## Responsive

Table scrolls horizontally.

## Related screens

102a Legal entities, 033.

## Open questions

- Phase 4 enforces a cost center on leaf budgets.
