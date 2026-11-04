# 106b Reason codes

Status: built in Phase 3 without a Stitch design (none existed for this screen); implemented from the design system (`docs/ux/design-system.md`) with Satori components first and Angular Material second, light theme only. Pending design review. Covers inventory screens 106b Reason-code taxonomy. Route `/finance/reason-codes`.

## Purpose

Maintain the reason codes that controls, corrections and decisions require (reduce, freeze, transfer, increase, reversal, exception, rejection, manual).

## Roles

Finance Admin maintains; every member reads.

## Entry points

Sidebar Reason codes.

## Content and actions

- Table: used for, code, label, status tag; retire and reinstate.
- Show retired codes toggle.
- Add reason code (category, code, label).

## Data

`listReasonCodes`, `createReasonCode`, `updateReasonCode`.

## Permissions

`tenant.read`; `master_data.manage` to change.

## States

Loading, errors and success banners.

## Audit

One audit event per create, retire and reinstate.

## Responsive

Table scrolls.

## Related screens

027 Freeze budget (Phase 4) and reversal screens use these codes.

## Open questions

- None beyond the pending design review.
