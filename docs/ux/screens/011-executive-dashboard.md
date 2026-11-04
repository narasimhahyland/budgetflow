# 011 Executive dashboard

Status: proposed - awaiting user review. Light theme only. Satori variant of the original Stitch screen `e3133442e4ae4fd5a157b55941377892` (unchanged).

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share. Regions table moved to full width; Available KPI is company-wide (tooltip with the definition); chart labels and bar values no longer clip. The Stitch export still clips the Utilization bars at the card edge; the implementation must show every column.

## Design

| State                                | Image                                                               | Stitch screen                      |
| ------------------------------------ | ------------------------------------------------------------------- | ---------------------------------- |
| default                              | `design/stitch/011-executive-dashboard/default--desktop--light.png` | `e6dd17e8d173435abfa67c15f0b23078` |
| loading                              | `loading--desktop--light.png`                                       | `11233aed9295496cb44c90f31ed4710c` |
| empty (new fiscal year)              | `empty--desktop--light.png`                                         | `1e99ca37015b4ae7be654a517dd43037` |
| partial error (actuals feed delayed) | `error--desktop--light.png`                                         | `ed9a737d65164d2d81d9b1dcbbcd6664` |

## Purpose

Give the CEO and executives one view of the budget position for the selected scope and fiscal year: how much is allocated, committed, spent and still available, where the exceptions are, what waits for approval, and the year-end forecast.

## Roles

- Primary: CEO / Executive.
- Secondary: Finance Controller, Finance Admin, Read-only Analyst (read only), Department Head (own subtree).

## Entry points

Home for executive roles; sidebar Home; links from notifications.

## Content and actions

- Header bar: title, scope and "as of" timestamp; Export menu (CSV, XLSX, PDF); no Share action. Scheduled delivery lives in reports (091).
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

| State           | Behaviour                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading         | `sat-ghost` skeletons inside each card; titles and frames stay                                                                                                        |
| Empty           | new fiscal year with no budgets: KPIs at USD 0.00 and one card "No budgets for FY2027 yet" with Create budget, Roll forward FY2026, Import budget plan                |
| Error (partial) | error banner explains which source failed ("Actuals from the ERP feed are delayed since 09:40") with Retry; affected KPI shows "Unavailable"; unaffected figures stay |
| Error (total)   | `sat-500-error-state` with Retry                                                                                                                                      |
| Forbidden       | `sat-403-error-state`                                                                                                                                                 |
| Success         | Export shows a snackbar; export runs as a job when large                                                                                                              |

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
- Decided 2026-11-04: Available = Authorized - pending requests (pre-encumbered) - approved commitments (encumbered) - actual, company-wide, child allocations counted once; budget drill-downs show "Available under this budget's rules" with a tooltip explaining any difference.
- Known render issue: the revised Stitch image shows every value column but clips the Utilization bars at the card edge (two attempts); the build must fit all columns at 1440 and drop Owner below 1280.
