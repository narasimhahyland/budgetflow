# 022 Budget allocation workspace

Status: proposed - awaiting user review. Light theme only. Start screen 5 (todo `ux-s05-allocation`). Satori variant of the original Stitch screen `86199ca529d74bf89bd030aceeb70c26` (unchanged).

## Design
| State | Image | Stitch screen |
| --- | --- | --- |
| default | `design/stitch/022-budget-allocation-workspace/default--desktop--light.png` | `ccdbc282cac64caeba9a188fb6fcc676` |
| soft warning and hard block | `warning-block--desktop--light.png` | `0fd10f99e1ac45879ac85fb3a887e3ba` |

## Purpose
Let a budget owner split their budget across child budgets in one change: fixed amounts or a per-head driver, with the parent's available amount, the impact and the approval needed visible before submitting.

## Roles
- Primary: Regional Manager, Department Head, Budget Owner.
- Secondary: Finance Controller (all scopes), Finance Admin; Read-only Analyst sees it read only.

## Entry points
Allocate budget in 023 hierarchy or 021 budget details; sidebar Budgets > Allocation workspace.

## Content and actions
- Header: parent name, budget currency and locked plan rate; Import from Excel, Clone last year.
- Parent card: stacked bar (allocated out, committed, actual, available) with budget and available to allocate in budget and reporting currency.
- Allocation grid (keyboard first, paste from Excel): child budget, owner, driver (fixed or per head), rate, eligible headcount (tooltip explains exclusions and proration), current, change, new allocation, status. Add row creates a draft child.
- Totals: net change and unallocated after.
- Impact preview: before and after bars, checks (within parent available, within category limits), approval needed (DoA), where reductions go.
- Footer: Discard, Save draft, Submit allocation (primary).

## Data
Parent balances by bucket; children with driver config (rate, eligibility rules, proration); HR headcount snapshot date; plan rate; DoA limit of the user; validation result and impact from the API (the UI never computes availability).

## Permissions
`budget:allocate` on the parent; changes above the user's DoA limit are submitted for approval rather than applied. Owners of child budgets cannot raise their own allocation here.

## States
| State | Treatment |
| --- | --- |
| Loading | `sat-ghost` rows and bars |
| Empty | Parent has no children: empty state with Add child budget and Import |
| Soft warning | Warning stripe and tag on the row, warning banner in the impact panel; Submit stays enabled (image) |
| Hard block | Error stripe and inline error on the row, error banner with Request increase; Submit disabled with the reason under it (image) |
| Blocked parent | Parent frozen or set to zero: info or important banner; grid read only |
| Error | Save failed: error banner with the API detail; edits kept |
| Success | Snackbar "Allocation submitted for approval by Daniel Brooks" or "Allocation applied"; grid shows Pending approval tags |
| Conflict | Parent changed meanwhile (stale version): banner with Reload and keep my edits |

## Budget safety
Allocated vs available are separate bar segments; soft warning (warning container, can proceed) vs hard block (error container, action disabled with reason); budget currency with reporting equivalent at plan rate.

## Audit
Submit writes one audit entry per changed child with before and after values; drafts are not audited until submitted.

## Responsive
Tablet: impact panel moves under the grid. Mobile: read-only summary with a list of children; editing allocation is desktop and tablet only (shows a note).

## Accessibility
Grid is a keyboard-navigable `role="grid"`; errors are announced and linked to their cells; colors always paired with text tags.

## Related screens
023 budget hierarchy, 021 budget details, 024 allocate to child, 024a per-head driver allocation, 024b HR headcount import, 059 approval inbox.

## Navigation
Breadcrumb Home / Budgets / India Region / Allocate; leaving with unsaved edits asks to save as draft.

## Assumptions
Per-head allocation = rate x eligible headcount from the latest HR snapshot, prorated for joiners; contractors and interns excluded by eligibility rules; true-ups appear as new changes.

## Open questions
- Should reductions on per-head children be allowed directly, or only through a rate or eligibility change?
- Stitch render notes: the default shows a "Clone FY2025" button and cost-center codes that are illustrative only.
