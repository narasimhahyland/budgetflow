# 030 Budget version history

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4. Versions tab of 021.

## Design

| State   | Image                                                                  | Stitch screen                      |
| ------- | ---------------------------------------------------------------------- | ---------------------------------- |
| default | `design/stitch/030-budget-version-history/default--desktop--light.png` | `c21bd746b3ca4ae9aca03cf4a435979f` |

## Purpose

Show every immutable version of a budget with who changed what, why, and the journal behind it; switch between plan versions (original, current, forecast).

## Roles

Everyone who can read the budget; auditors read all.

## Entry points

021 Versions tab; 031 "Compare versions"; audit log links.

## Content and actions

Budget header and tabs. Segmented "Plan version": Original, Current, Forecast. Note: versions are immutable. Left: timeline newest first (version chip, change with signed amount, requester, approver, date, reason code). Right: selected version details (field-by-field previous vs this version), links to the journal and audit log, Compare versions (031).

## Data and permissions

Versions are append-only rows; each links to the journal and audit entry that created it. Forecast versions arrive in P11; until then the Forecast segment is disabled with a tooltip.

## States

Single version: timeline shows "v1 Original" only and the compare action is disabled. Loading: timeline skeleton. Error: banner with Retry.

## Budget safety and audit

Nothing is editable here. Example chain (Bengaluru Events): v1 11,000.00, v2 reduced -2,000.00, v3 transfer out -1,500.00, v4 increase +2,500.00 = 10,000.00.

## Responsive and accessibility

Mobile: timeline only; details open as a page. Timeline is an ordered list with version labels.

## Related screens and navigation

021, 031, 089, 088.

## Assumptions and open questions

- Stitch added a "SHA-256 verified" indicator; the hash chain belongs to the audit log (088), not to versions.
