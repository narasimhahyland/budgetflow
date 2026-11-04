# 042 Org hierarchy import

Status: built in Phase 3 without a Stitch design (none existed for this screen); implemented from the design system (`docs/ux/design-system.md`) with Satori components first and Angular Material second, light theme only. Pending design review. Covers inventory screens 9 Initial organization hierarchy import, 42 Organization import and synchronization. Route `/org/import`.

## Purpose

Create, rename and move org units from a CSV file at one effective date, with a dry run that shows the plan and every problem first.

## Roles

Organization Admin (tenant-wide `org.manage`).

## Entry points

Hierarchy page Import org file.

## Content and actions

- Effective date, CSV (code, name, kind, parent_code, legal_entity_code, timezone) by drop, picker or paste, optional reason.
- Validate shows created / changed / unchanged counts, a plan table with action tags and a problems table (line, column, message).
- Import applies the plan in one transaction; parents are created before children.

## Data

`importOrgUnits` (dry run, apply).

## Permissions

Tenant-wide `org.manage`; others 403.

## States

Problems banner, success banner, errors inline.

## Audit

One audit event per applied import (created and changed codes).

## Responsive

Single column.

## Related screens

33.

## Open questions

- HR and ERP connectors (Phase 12) will call the same import.
