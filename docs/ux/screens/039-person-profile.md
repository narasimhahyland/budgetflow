# 039 Person profile and reporting lines

Status: built in Phase 3 without a Stitch design (none existed for this screen); implemented from the design system (`docs/ux/design-system.md`) with Satori components first and Angular Material second, light theme only. Pending design review. Covers inventory screens 39 Employee profile, 40 Reporting relationship management. Route `/org/people/:personId`.

## Purpose

Show one person's details, reporting history and direct reports, and let org admins change the manager from an effective date.

## Roles

All roles with `org.read` within scope; Organization Admin changes managers.

## Entry points

People directory rows, direct-report links.

## Content and actions

- Facts: email, location, team, manager, employing entity, cost center, employment type, timezone, start date.
- Reporting history table (manager, solid or matrix, from, to).
- Direct reports list.
- Change manager (org.manage): new manager, effective date, reason. The current solid line closes the day before; loops and self-reporting are refused.

## Data

`getPerson`, `changeReportingLine`, `listPeople` (picker).

## Permissions

`org.read`; `allowedActions` contains `org.manage` for admins.

## States

Loading, 404 when outside scope, error banner on refusal, success banner.

## Audit

One audit event per reporting-line change with reason.

## Responsive

Single column.

## Related screens

038, 033.

## Open questions

- Matrix lines are shown; adding matrix lines from the UI is planned with Phase 7 approvals routing.
