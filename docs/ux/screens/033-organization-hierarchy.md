# 033 Organization hierarchy

Status: built in Phase 3 without a Stitch design (none existed for this screen); implemented from the design system (`docs/ux/design-system.md`) with Satori components first and Angular Material second, light theme only. Pending design review. Covers inventory screens 33 Organization hierarchy, 34 Organization chart (indented tree), 35 Department details, 36 Team details, 37 Location management. Route `/org`.

## Purpose

Show Hyland's org hierarchy (company, business units, regions, locations, departments, teams) as of any date, with each unit's manager, legal entity, timezone, people, headcount, cost centers and full effective-dated history, and let org admins add units and make dated changes.

## Roles

Primary: Organization Admin. Read: Finance Admin, Finance Controller, CEO, Auditor, Analyst (whole org); Budget Owner, Department Head, Regional Manager, Location Manager (their subtrees); Employee and Event Organizer (own location and team).

## Entry points

Sidebar Organization; links from the people directory, headcount and cost centers.

## Content and actions

- As-of date (defaults to today) drives the tree and the detail panel.
- Left: searchable indented tree (`role=tree`), kind and code per row; the selected unit has a primary stripe.
- Right: unit header with breadcrumb of ancestors and a kind status tag (neutral when the unit closes); facts (manager, legal entity, timezone, people, headcount by type with snapshot date, active dates); units below (chips); cost centers; history table (from, to, change, name, parent, manager, reason).
- Change unit (org.manage): rename, move under another unit, change manager or close the unit from an effective date, with a required reason. History before the date is kept.
- Add unit below (org.manage): kind limited to the allowed child kinds, code, name, effective date, optional reason.
- Import org file (org.manage): opens the org import screen.

## Data

`listOrgUnits`, `getOrgUnit`, `createOrgUnit`, `changeOrgUnit`, `listPeople` (manager picker), `listLegalEntities`.

## Permissions

`org.read` to open; buttons follow the unit's `allowedActions` (`org.manage`). The API filters by scope and answers 404 for hidden units.

## States

Loading (Satori ghost rows), empty search, 403/404/500 states with retry, success banner after a change, inline error banner with the API's plain-English detail (for example a backdated change).

## Audit

Each create, change and close writes one audit event with changed fields, effective date and reason.

## Responsive

Two columns from 960 px; the tree stacks above the detail below that.

## Related screens

038 People, 022c Headcount, 041 Cost centers, 042 Org import.

## Open questions

- Org chart (34) is the indented tree in this build; a graphical chart awaits a Stitch design.
- Should moves of units with budgets warn about budget owners (Phase 4)?
