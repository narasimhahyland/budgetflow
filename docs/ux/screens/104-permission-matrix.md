# 104 Permission matrix

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 2 gaps batch. Build phase P2. Settings > Permissions (read-only).

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/104-permission-matrix/default--desktop--light.png`, `role-panel--desktop--light.png`.

## Purpose

Show exactly what each of the 14 roles may do, and at what scope, from the same rule table the API enforces, so admins and auditors can answer "who can do X" without reading code.

## Roles

Organization Admin, Auditor (read); Finance Admin and Finance Controller (read).

## Entry points

Settings navigation; 008 and 103 "What this role can do"; 088 audit questions.

## Content and actions

Header: "Permissions", text "Generated from the authorization rules the API enforces. Roles cannot be edited here.", Export (CSV, PDF), "Last changed in release 2026.11".

Legend chips: "Company-wide" (T), "Own budgets or org subtree" (O), "Only their own items" (S), "No access" (dash), each with icon and text.

Matrix: rows are actions grouped by area (Company, Organization, Budgets, Ledger, Requests and approvals, Events, Actuals, Reports and audit, Integrations), plain-English labels with the action key in small text (`budget.allocate`); columns are the 14 roles. Sticky first column and header. Sample row: "Allocate budget" - CEO O, FA T, BO O, DH O, RM O, LM O, others no access.

Role panel (click a column header): role description, every allowed action with scope, people with this role (count, link to 103), and notes: "Approval authority also needs a DoA limit (104a/070a); ownership alone never approves."

Filter: search actions, show only one area, compare two roles side by side.

## Data and permissions

Rendered from the API's published role grants (`ROLE_GRANTS`), never a separate copy. `tenant.read` plus admin or audit role to view.

## States

| State           | Behaviour                                        |
| --------------- | ------------------------------------------------ |
| Default         | as above                                         |
| Compare         | two role columns highlighted; differences listed |
| Loading / error | skeleton matrix; error banner                    |

## Budget safety and audit

Read-only; exports are audited. The DoA note prevents reading role grants as approval authority.

## Responsive and accessibility

Tablet: matrix scrolls horizontally with the action column pinned. Mobile: role picker then a list of actions. Cells use text abbreviations with tooltips and full names for screen readers, not colour alone.

## Related screens and navigation

008, 103, 104a DoA matrix, 070a, 088.

## Assumptions and open questions

- None beyond the design review.
