# 106c Vendor master

Status: built in Phase 3 without a Stitch design (none existed for this screen); implemented from the design system (`docs/ux/design-system.md`) with Satori components first and Angular Material second, light theme only. Pending design review. Covers inventory screens 106c Vendor master. Route `/finance/vendors`.

## Purpose

Keep the vendor master with approved, preferred, blocked and not-reviewed vendors for events and engagement.

## Roles

Finance Admin maintains; every member reads (organizers pick vendors).

## Entry points

Sidebar Vendors.

## Content and actions

- Search and status filter.
- Table: vendor and ERP id, category, country, status tag; change status with a reason.
- Add vendor (name, status, category, country).

## Data

`listVendors`, `createVendor`, `updateVendor`.

## Permissions

`tenant.read`; `master_data.manage` to change.

## States

Loading, empty, errors and success banners.

## Audit

One audit event per create and status change.

## Responsive

Table scrolls.

## Related screens

Phase 7 vendor controls block commitments to blocked vendors.

## Open questions

- None beyond the pending design review.
