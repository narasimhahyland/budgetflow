# 023 Budget hierarchy

Status: proposed - awaiting user review. Light theme only. Start screen 4 (todo `ux-s04-hierarchy`). Satori variant of the original Stitch screen `dec44effba994665a7ccea3ea2fe7287` (unchanged). Also serves 014 (organization-wide budget hierarchy) as the read-only view for executive roles.

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share. Owner moved under the unit name and the currency into the column headers so the Status column is visible.

## Design

| State              | Image                                                            | Stitch screen                      |
| ------------------ | ---------------------------------------------------------------- | ---------------------------------- |
| default            | `design/stitch/023-budget-hierarchy/default--desktop--light.png` | `e4937537c29c4b6986a6b0ab6fd34fae` |
| set-to-zero dialog | `set-to-zero-dialog--desktop--light.png`                         | `f22169b605bf4fdd91317204ecd40ced` |

## Purpose

Show the budget tree for a scope with each node's budget, committed, actual, available and status, and let owners act on a node (allocate to child, transfer, reduce, freeze, set to zero) with the impact visible before they commit.

## Roles

- Primary: Department Head, Regional Manager, Budget Owner, Finance Controller.
- Secondary: CEO/Executive and Read-only Analyst (read only), Location Manager (own subtree), Auditor (read only).

## Entry points

Sidebar Budgets > Budget hierarchy; drill-down from the executive dashboard (011) and budget list (019); global search result.

## Content and actions

- Header bar: Export, Compare versions, Allocate budget (primary).
- Toolbar: filter, status and category chips, "Show commitments" toggle, Tree / Org chart switch.
- Splitter (`sat-splitter`): tree table on the left, detail panel on the right.
- Tree table: budget unit with owner as a second line, currency, budget, committed, actual, available, used % bar, status tag. Row-state stripes: info (frozen), important (set to zero), warning (threshold). Selected row uses the primary container tint.
- Detail panel: owner, co-owner, legal entity, cost center, budget currency, locked plan rate; budget bar with one segment per bucket (allocated out, held, pre-encumbered, encumbered, actual, accrued, available); amounts in budget currency with reporting equivalent; FX effect line; actions Allocate to child, Transfer, and a menu with Reduce, Freeze, Set to zero; delegation block (delegated by, DoA limit); recent activity from the audit log.
- Set to zero (Material dialog): impact table (current budget, committed, actual, child budgets, floor = committed + actual + children, amount that can be cut in budget and reporting currency), destination for the cut money, affected commitments and pending requests that will be rejected, reason code, typed reason, notify toggle, "recorded in the audit log" note, type ZERO to confirm, red Set to zero button.

## Data

Budget node: id, name, parent, owner, co-owners, legal entity, cost center, category, budget currency, plan rate, status, version; bucket balances (cached, equal to the nightly rebuild); utilization; delegation and DoA limit of the viewer; impact preview from the API for reduce, freeze and set to zero.

## Permissions

- Viewing a node needs `budget:read` on its subtree; amounts outside scope are not shown.
- Allocate, transfer, reduce, freeze and set to zero each need their own permission on the node and pass through `PolicyService.can`; the UI hides actions the API says are not allowed and shows a reason for disabled ones (for example "Budget is frozen").
- Set to zero above the user's DoA limit becomes a request for approval instead of an immediate action.

## States

| State            | Treatment                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Loading          | `sat-ghost` rows in the tree and the detail panel                                                                            |
| Empty            | No budgets in scope: `sat-empty-state` with Create budget (020)                                                              |
| Error            | `sat-500-error-state` in the content slot with Retry                                                                         |
| Frozen node      | Info stripe and Frozen tag with lock icon; banner in the detail panel; allocate and request actions disabled with the reason |
| Set to zero node | Important stripe and tag; available 0.00; only Restore (request) and history actions                                         |
| Confirmation     | Set-to-zero dialog (image); freeze and reduce use the same dialog pattern (specs 026-028)                                    |
| Success          | Snackbar "Bengaluru Events set to zero. 2 requests rejected, owners notified." with View audit entry                         |
| Validation       | Missing reason code or reason, wrong confirmation word: field errors, button disabled                                        |

## Budget safety

Allocated vs available and every bucket have their own segment; frozen (lock, info) vs zero (important) are distinct; budget currency shown with reporting equivalent at the locked plan rate; the FX effect is a separate line.

## Audit

Every mutation from this screen writes one hash-chained audit entry (actor, role, delegation used, before and after values, reason code, typed reason, request id). The dialog says so before confirming.

## Responsive

Tablet: detail panel becomes a right drawer opened from the row. Mobile: tree becomes an indented list of cards with available and status; actions in a bottom sheet; dialogs full screen.

## Accessibility

Tree table uses `role="treegrid"` with arrow-key navigation and `aria-expanded`; status tags carry text; the confirm field has a visible label and error text.

## Related screens

011 executive dashboard, 019 budget list, 020 create budget, 021 budget details, 022 allocation workspace, 024 allocate to child, 025 transfer, 026 reduce, 027 freeze, 028 set to zero, 088 audit log.

## Navigation

Breadcrumb Home / Budgets / Budget hierarchy; selecting a node updates the URL (`?node=`), so links and back work.

## Assumptions

Child budgets of a set-to-zero node are reduced first or block the action (cascade is optional per plan); the floor never lets available go below committed + actual + children.

## Open questions

- Should the detail panel open by default or only on row selection?
- Cascade on set to zero: offer "also set children to zero" in the dialog, or block until children are handled?
