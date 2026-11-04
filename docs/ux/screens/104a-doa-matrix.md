# 104a Delegation-of-authority matrix

Status: built in Phase 3 without a Stitch design (none existed for this screen); implemented from the design system (`docs/ux/design-system.md`) with Satori components first and Angular Material second, light theme only. Pending design review. Covers inventory screens 104a Delegation-of-authority matrix (seeded, read-only). Route `/finance/doa`.

## Purpose

Show the active DoA matrix (role or person × spend type × legal entity × limit in USD) and check which limit applies to an approver for an amount.

## Roles

Finance Admin, Finance Controller, CEO, Auditor (read).

## Entry points

Sidebar Delegation of authority.

## Content and actions

- Check a limit: role, spend type, legal entity, amount and currency (other currencies convert at the locked plan rate); result banner: within the limit, above the limit (escalates) or no authority, with the row that applied.
- Matrix table: who (role or person-specific), spend type, entity, limit, effective dates; version and approver in the header.

## Data

`getDoaMatrix`, `lookupDoa`, `listLegalEntities`.

## Permissions

`doa.read`.

## States

Loading, no active matrix (empty), errors banner.

## Audit

Read only (no audit).

## Responsive

Form wraps; table scrolls.

## Related screens

059 Approval inbox (Phase 5) enforces it; Phase 7 makes it editable.

## Open questions

- None beyond the pending design review.
