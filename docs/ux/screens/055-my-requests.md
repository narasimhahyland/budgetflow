# 055 My requests

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P5.

## Design

| State                          | Image                                                       | Stitch screen                      |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------- |
| all requests (Event Organizer) | `design/stitch/055-my-requests/default--desktop--light.png` | `9a68bf191d9a4cbc98ea610f89adfaae` |

## Purpose

A requester's list of everything they asked for, with status, current step and next approver, so they never have to chase approvals.

## Roles

All requesters (every role that can create requests).

## Entry points

Sidebar Requests > My requests; after submitting 057 or 056a; notifications.

## Content and actions

New request (menu: additional funds, purchase, Inter-Director Budget Contribution Request). Tabs with counts: All, Drafts, Pending, Approved, Rejected. Search and filters (type, budget). Table: ID, title, type, amount (USD), budget, status, current step or approver with due time, updated. Row opens 060 (or 056a for contributions).

## Data and permissions

Only the signed-in user's requests (`request:read-own`); server-side paging and sorting.

## States

| State                | Behaviour                                                     |
| -------------------- | ------------------------------------------------------------- |
| Empty (not exported) | `sat-empty-state` "You have no requests yet" with New request |
| Loading              | skeleton rows                                                 |
| Partially approved   | requested and approved amounts both shown                     |
| Rejected             | important tone with the short reason                          |

## Budget safety and audit

Pending (warning), approved (success), rejected (important), draft (neutral). Read-only list; no audit entries.

## Responsive and accessibility

Mobile: list items with title, amount, status and next step; tabs scroll horizontally.

## Related screens and navigation

056a, 057, 060, 064 request history.

## Assumptions and open questions

- Stitch used an error-red chip for "Rejected"; the design system maps rejected to the important tone.
- The "Approved by" name in one row is a Stitch placeholder (fictional).
