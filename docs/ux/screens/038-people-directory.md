# 038 People directory

Status: built in Phase 3 without a Stitch design (none existed for this screen); implemented from the design system (`docs/ux/design-system.md`) with Satori components first and Angular Material second, light theme only. Pending design review. Covers inventory screens 38 Employee directory. Route `/org/people`.

## Purpose

Find Hyland people you are allowed to see, with location, team, employing entity, cost center, employment type and manager.

## Roles

All roles with `org.read`; scope as for 033.

## Entry points

Sidebar People; links from the hierarchy.

## Content and actions

- Search (name, email, title, debounced) and unit filter (subtree).
- Satori row-state table: name and title (primary action opens the profile), location and team, entity and cost center, type tag, manager.
- Show more pages through the cursor.

## Data

`listPeople` (scope, total, cursor), `listOrgUnits` for the filter.

## Permissions

`org.read`; the API restricts rows to the caller's scope.

## States

Loading, empty results, 403/500 with retry.

## Audit

Read only.

## Responsive

The table scrolls horizontally on small screens.

## Related screens

039 Person profile, 033 Hierarchy.

## Open questions

- Export of the directory is planned with reports (Phase 10).
