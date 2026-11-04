# 019 Budget list

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 1 (todo `ux-groups`). Build phase P4.

## Design

| State                   | Image                                                       | Stitch screen                      |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------- |
| default                 | `design/stitch/019-budget-list/default--desktop--light.png` | `faebb2af8d2c4cd69521c53587b67034` |
| empty (new fiscal year) | `empty--desktop--light.png`                                 | `12fb15b614ac4a29901083f13f413587` |

## Purpose

Find any budget in scope as a flat, filterable list; the tree lives in 023.

## Roles

CEO, Finance Admin full; owners (BO, DH, RM, LM) see their subtree; FC, AUD, AN read only (no Create or Import).

## Entry points

Sidebar Budgets > Budget list; search results "See all budgets"; 011 drill-down.

## Content and actions

- Header: Export menu (CSV, XLSX, PDF), Import plan (020a), Create budget (020).
- Filter bar: search, Status, Type, Owner, Legal entity, saved filter ("My budgets"), Clear. Tabs with counts: All, Active, Frozen, Set to zero, Draft.
- Info line: "Available = budget - pending requests - committed - actual. Each budget's own control rules apply on its details page."
- Table: Budget (parent as second line), Owner, Type, Budget, Committed, Actual, Available (USD in headers), Used bar with %, Status, row menu (Open, Allocate, Transfer, Freeze, Reduce, Set to zero, as permitted). Row stripes: info for frozen, important for set to zero; warning tag for a crossed alert threshold.
- Empty (FY2027): "No budgets for FY2027 yet" with Roll forward FY2026 (023a), Import plan (020a), Create budget (020) and three explainer cards.

## Data and permissions

`budget:list` filtered by `PolicyService` scope; Available here is the company-wide definition per row; the details page shows "Available under this budget's rules". Server-side paging and sorting.

## States

Loading: table skeleton rows. Error: error banner with Retry above the table. No results for filters: inline empty state with Clear filters. Forbidden actions are hidden, not disabled.

## Budget safety and audit

Frozen (lock, info tone) and set to zero (important tone) are distinct; draft budgets show no Used bar. Read-only page; exports are audited (who, filters, format).

## Responsive and accessibility

Tablet: Owner and Type collapse into the Budget cell. Mobile: card list with name, status, available. Used bars have text percentages; row stripes are paired with status tags.

## Related screens and navigation

020, 020a, 021 (row click), 023, 023a, 025, 026, 027, 028.

## Assumptions and open questions

- Should Read-only Analysts see the row menu at all? Assumed no.
