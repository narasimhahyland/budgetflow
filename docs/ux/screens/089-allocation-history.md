# 089 Allocation history

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1. Build phase P4.

## Design

| State   | Image                                                              | Stitch screen                      |
| ------- | ------------------------------------------------------------------ | ---------------------------------- |
| default | `design/stitch/089-allocation-history/default--desktop--light.png` | `b0f881de1eaa43f89b02c00e6c6c4d96` |

## Purpose

One list of every movement of authorized budget (allocation, transfer, reduction, increase, contingency release, per-head true-up) with who asked, who approved, why, and the journal.

## Roles

Finance Admin, Finance Controller, Auditor; owners scoped to their subtree.

## Entry points

Reports > Allocation history; 031 "Open allocation history"; 030 links.

## Content and actions

Export menu. Filters: date range, budget (with "and children"), type, changed by. Table: Date, Type (icon tag), From, To, Amount (USD), Requested by, Approved by, Reason, Journal link, "View in audit log". Footer: entry count and net movement into the filtered budgets.

## Data and permissions

Built from ledger journals of authorization buckets; scope-filtered. Server-side paging; export audited.

## States

No entries for filters: empty state with Clear filters. Loading skeleton; error banner with Retry.

## Budget safety and audit

Read-only; every row links to its balanced journal and audit entry, so totals reconcile to the ledger.

## Responsive and accessibility

Tablet: Reason and Journal move into a row expander. Type tags have icon and text.

## Related screens and navigation

030, 031, 088, 021.

## Assumptions and open questions

- Stitch colored "Reduction" amber; reductions use the neutral tag (warning tone is reserved for soft warnings and pending).
