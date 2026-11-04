# 102a Legal entities

Status: built in Phase 3 without a Stitch design (none existed for this screen); implemented from the design system (`docs/ux/design-system.md`) with Satori components first and Angular Material second, light theme only. Pending design review. Covers inventory screens 6 Organization and legal-entity setup, 102a Legal entities. Route `/finance/legal-entities`.

## Purpose

Set up Hyland's legal entities with functional currency, fiscal calendar, tax jurisdiction and ERP company code.

## Roles

Finance Admin maintains; every member reads.

## Entry points

Sidebar Legal entities; onboarding step 6.

## Content and actions

- Table: entity name and code, country, functional currency, fiscal calendar, tax and ERP codes, cost-center count.
- Add legal entity (code, name, country, functional currency, calendar, tax, ERP).
- Edit name, tax jurisdiction and ERP code with a reason; functional currency and calendar are fixed once set.

## Data

`listLegalEntities`, `createLegalEntity`, `updateLegalEntity`, `listCurrencies`, `listFiscalCalendars`.

## Permissions

`tenant.read`; `master_data.manage` to change.

## States

Loading, errors inline, success banner.

## Audit

One audit event per create and change.

## Responsive

Table scrolls.

## Related screens

108 Fiscal calendars, 107 Rates.

## Open questions

- Intercompany policy screens arrive with Phase 5.
