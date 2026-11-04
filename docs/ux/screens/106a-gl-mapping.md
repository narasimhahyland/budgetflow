# 106a GL accounts and category mapping

Status: built in Phase 3 without a Stitch design (none existed for this screen); implemented from the design system (`docs/ux/design-system.md`) with Satori components first and Angular Material second, light theme only. Pending design review. Covers inventory screens 106 Categories and custom fields (categories read), 106a GL accounts and category-to-GL mapping. Route `/finance/gl`.

## Purpose

Show each entity's GL accounts and the effective-dated mapping of budget categories to GL accounts for employee and client attendees.

## Roles

Finance Admin maintains; every member reads.

## Entry points

Sidebar GL accounts.

## Content and actions

- Entity picker and as-of date.
- Mapping table: category, employee account, client account, since.
- Change a mapping: category, attendees, account of the same entity, effective date (the current mapping ends the day before).
- Accounts table and Add account.

## Data

`listLegalEntities`, `listCategories`, `listGlAccounts`, `createGlAccount`, `listGlMappings`, `createGlMapping`.

## Permissions

`tenant.read`; `master_data.manage` to change.

## States

Loading, empty, errors inline, success banner.

## Audit

One audit event per account and mapping change.

## Responsive

Tables scroll.

## Related screens

102a.

## Open questions

- Custom fields per category are Phase 14.
