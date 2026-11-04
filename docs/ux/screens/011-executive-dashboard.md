# 011 Executive dashboard

Status: proposed - awaiting user review. Start screen 3 (todo `ux-s03-exec-dashboard`). Satori variant of the original Stitch screen `e3133442e4ae4fd5a157b55941377892` (left untouched); first variant `5309ed70c36b4ea484d22fd4fb91ef5b`, then `apply_design_system` with the BudgetFlow Satori asset produced the default below.

| State | Image | Stitch screen |
| --- | --- | --- |
| Default | `design/stitch/011-executive-dashboard/default--desktop--light.png` | `be92f0b4721f4632a3e01098b0f8b9e6` |
| Loading | `design/stitch/011-executive-dashboard/loading--desktop--light.png` | `bce1d3f39e9c4ab4ab39513becea969f` |
| Empty (new fiscal year) | `design/stitch/011-executive-dashboard/empty--desktop--light.png` | `83786f7e8b3c45d1899b5d33d0389311` |
| Partial error (actuals feed delayed) | `design/stitch/011-executive-dashboard/error--desktop--light.png` | `413ee59e2b1644d8bc7af92ecd5de3d1` |

## Purpose
Give the CEO and executives a one-page view of the fiscal year: how much is budgeted, allocated, committed, spent and still available, where the exceptions are, what is waiting for approval, and where the year will land.

## Roles
Primary: CEO/Executive. Secondary: Finance Controller, Finance Admin, Read-only Analyst (read only), Department Head (scoped to their subtree).

## Entry points
Home for executive roles; sidebar Home; links from notifications and the weekly digest.

## Layout and data
- Header bar: title, scope and "as of" timestamp, Export (PDF/CSV) and Share.
- Filter chips: period (FY2026 YTD), scope (All units or a subtree), currency (USD reporting). Saved filters.
- KPI cards: Total budget, Allocated, Committed (pre-encumbered + encumbered), Actual spend, Available. Available carries a separate FX-effect note.
- Budget vs actual by region: grouped bars for budget, committed and actual with a dashed year-end forecast marker; "View as table".
- Regions table: owner, budget currency, budget (budget currency plus reporting equivalent), allocated, committed, actual, utilization, status tag.
- Alerts and exceptions: threshold warning, frozen (lock, info), set to zero (important), hard block (error).
- Pending approvals: count, overdue count, top items with amount and age, "Open approval inbox".
- Forecast: year-end spend vs budget with variance and a dashed forecast line.

## Main actions
Change period, scope and currency; drill into a region (opens 023 hierarchy at that node); open an alert's source; open the approval inbox; export; share a read-only link to users who already have access.

## Permissions
Read requires `budget:read` on the selected scope. Amounts outside the user's scope are excluded from totals (not masked). Export follows the same scope. Share never grants access.

## States
| State | Treatment |
| --- | --- |
| Loading | `sat-ghost` skeletons inside every card; frames and titles stay (loading image) |
| Empty | New fiscal year with no budgets: zero KPIs and an empty state with Create budget, Roll forward FY2026, Import budget plan (empty image) |
| Partial error | Error banner explaining which source failed and since when, with Retry; the affected KPI shows "Unavailable"; chart hides actual bars with "Actuals unavailable" (error image) |
| Full error | `sat-500-error-state` in the content slot with Retry |
| Forbidden | `sat-403-error-state` (see shell) |
| Success | Export ready snackbar with Download |

## Budget-safety notes
Committed and actual are separate KPIs and separate bar series; forecast is dashed; budget currency and reporting currency are shown together (Europe EUR 25,000.00 / USD 27,000.00); the FX effect is a separate line on Available.

## Audit behaviour
Read-only screen; nothing is audited except exports (who, when, scope, format), which go to the audit log.

## Responsive behaviour
Tablet: KPI cards wrap to 3 + 2; right column moves below the chart. Mobile: KPIs become a horizontal scroll of cards; chart switches to the table view by default; regions table becomes cards.

## Accessibility
Each chart has a table alternative and a text summary ("India 53% used"); alert tones carry icons and text; KPI deltas are announced with direction words, not only arrows.

## Related screens
013 budget health overview, 016 forecast and variance, 017 alerts and exceptions, 018 pending approvals, 023 budget hierarchy, 059 approval inbox, 080 budget vs actual report.

## Navigation
Breadcrumb Home / Executive dashboard. Drill-downs keep the selected period and currency.

## Data-model assumptions
Committed = pre-encumbered + encumbered; Available = budget - allocated out - held - committed - actual - accrued at the budget's control basis; the dashboard reads cached balances that equal the nightly rebuild.

## Open questions
- Should Available on the executive view use the control basis of each budget or one company-wide basis?
- Is Share needed at all (export may be enough)?
- Stitch artifacts to ignore: "Live System Sync" tag next to the title; the sidebar logo renders its icon name as text in the default image; one pending approval sample ("Cloud compute capacity burst") is outside the employee-experience domain.
