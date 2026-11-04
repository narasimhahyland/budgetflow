# 011 Executive dashboard

Status: proposed - awaiting user review. Light theme only. Satori variant of the original Stitch screen `e3133442e4ae4fd5a157b55941377892` (unchanged).

## Design
| State | Image | Stitch screen |
| --- | --- | --- |
| default | `design/stitch/011-executive-dashboard/default--desktop--light.png` | `8e3e69d7a1894ea68503b203dd1141e0` |
| loading | `loading--desktop--light.png` | `bce1d3f39e9c4ab4ab39513becea969f` |
| empty (new fiscal year) | `empty--desktop--light.png` | `83786f7e8b3c45d1899b5d33d0389311` |
| partial error (actuals feed delayed) | `error--desktop--light.png` | `413ee59e2b1644d8bc7af92ecd5de3d1` |

## Purpose
Give the CEO and executives one view of the budget position for the selected scope and fiscal year: how much is allocated, committed, spent and still available, where the exceptions are, what waits for approval, and the year-end forecast.

## Roles
- Primary: CEO / Executive.
- Secondary: Finance Controller, Finance Admin, Read-only Analyst (read only), Department Head (own subtree).

## Entry points
Home for executive roles; sidebar Home; links from notifications.

## Content and actions
- Header bar: title, scope and "as of" timestamp; Export (PDF/CSV) and Share.
- Filter chips: period (FY YTD, quarter, month), scope (organization unit), currency (reporting USD or budget currency). Reset filters.
- KPI cards: Total budget, Allocated (% of total), Committed (encumbered + pre-encumbered), Actual spend, Available; the Available card states the FX effect separately ("FX effect +USD 420.00 shown separately").
- Budget vs actual by region: budget, committed and actual bars per region with a dashed year-end forecast marker; "View as table".
- Regions table: region, owner, budget currency, budget (budget currency plus reporting equivalent for non-USD), allocated, committed, actual, available, utilization, status tag. Row opens the region in the budget hierarchy (023).
- Alerts and exceptions: soft warning (Bengaluru Events at 80%), frozen (Hyderabad Events, info with lock), set to zero (Europe Wellbeing, important), hard block (allocation blocked). Each opens the related budget or request.
- Pending approvals: count, overdue count, top items, "Open approval inbox" (059).
- Forecast: year-end projected spend vs budget with a dashed sparkline.

## Data
Aggregates per scope and period from the API (never computed in the browser): total, allocated, committed (pre-encumbered + encumbered), actual, accrued, available, forecast, FX effect, alerts, pending approvals. Amounts in integer minor units with currency codes; reporting equivalents at the locked plan rate.

## Permissions
Visible to executive and finance roles for their scope; Department Head sees own subtree. Export follows the same scope. No financial actions are taken from this screen.

## States
| State | Behaviour |
| --- | --- |
| Loading | `sat-ghost` skeletons inside each card; titles and frames stay |
| Empty | new fiscal year with no budgets: KPIs at USD 0.00 and one card "No budgets for FY2027 yet" with Create budget, Roll forward FY2026, Import budget plan |
| Error (partial) | error banner explains which source failed ("Actuals from the ERP feed are delayed since 09:40") with Retry; affected KPI shows "Unavailable"; unaffected figures stay |
| Error (total) | `sat-500-error-state` with Retry |
| Forbidden | `sat-403-error-state` |
| Success | Export or Share shows a snackbar; export runs as a job when large |

## Audit
Read-only screen; exports are recorded as audit entries (who exported what scope and period).

## Responsive
Tablet: KPI cards wrap to two rows; side column moves below the chart. Mobile: KPIs as a horizontal scroller, chart replaced by the table view, alerts and approvals as stacked cards.

## Accessibility
Every chart has a table alternative; KPI deltas are text, not color only; alert cards have icon + title + detail; reading order follows visual order.

## Related screens
Budget hierarchy (023), Budget health (013), Alerts and exceptions (017), Pending approvals (018), Approval inbox (059), Forecast and variance (016), GL tie-out.

## Assumptions and open questions
- India budgets: budget currency INR with USD reporting (as drawn), or USD budgets for India? Affects lakh/crore display.
- Should "Available" be total minus committed minus actual, or unallocated at this level? Designed as total minus committed minus actual (incl. children); needs confirmation against the ledger definition.
- Known render issue: at 1280px the Regions table clips the Committed, Actual, Available and Status columns in the Stitch image; the build must fit all columns at 1440 or drop Owner below 1280.
