# 086 Unused and expired budget report

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Reports > Unused and expired (`/reports/unused-expired`), in the shared report frame of 079.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the report frame of 079. Planned Stitch states, to be generated in a later session:

| State                      | Planned image                                                         |
| -------------------------- | --------------------------------------------------------------------- |
| unused, at risk of lapsing | `design/stitch/086-unused-expired-report/default--desktop--light.png` |
| expired allotments         | `expired-allotments--desktop--light.png`                              |
| lapsed last year           | `lapsed--desktop--light.png`                                          |
| mobile                     | `default--mobile--light.png`                                          |

## Purpose

Show early which budgets will end the year with money unused, how much of it would lapse under each budget's rollover policy, which monthly allotments already expired, and what lapsed last year, so owners can plan spend or release money in time and finance can reclaim and redistribute it (86a) instead of watching a year-end spike.

## Roles

Finance Admin, Finance Controller, CEO, Auditor, Read-only Analyst (all budgets); budget owners scoped to their subtree.

## Entry points

079 catalog; 017 alert "Unused budget at risk"; owner weekly digest (64a) "Unused" section; 087b year-end run "See unused budgets"; scheduled delivery (091).

## Content and actions

Frame from 079 (filters FY2026, scope, category, rollover policy; Save view, Schedule delivery, Export CSV, XLSX, PDF). Tabs: Unused, Expired allotments, Lapsed last year, Expired commitments.

Unused tab (as of 4 Nov 2026, 57 days left in FY2026; amounts USD):

| Budget                 | Owner          | Available under its rules | Forecast unused at 31 Dec | Rollover policy           | Carries over               | At risk of lapsing    |
| ---------------------- | -------------- | ------------------------- | ------------------------- | ------------------------- | -------------------------- | --------------------- |
| India Wellbeing        | Meera Iyer     | 6,950.00                  | 4,200.00                  | Lapse, sweep to parent    | 0.00                       | 4,200.00              |
| US Wellbeing           | Jordan Lee     | 4,100.00                  | 3,000.00                  | Lapse, sweep to corporate | 0.00                       | 3,000.00              |
| London Team Activities | Sophie Laurent | 5,200.00                  | 2,600.00                  | Carry with approval       | up to 2,600.00 if approved | 0.00 (needs approval) |
| Hyderabad Events       | Suresh Menon   | 2,000.00                  | 900.00                    | Carry capped at 10%       | 800.00                     | 100.00                |

- KPI strip: available company-wide USD 34,850.00; forecast unused USD 14,600.00; at risk of lapsing USD 7,300.00; needs carry approval USD 2,600.00.
- Forecast unused comes from the latest accepted forecast (87a) or the run-rate method when none exists (labelled "Run-rate").
- Extra weekly spend that would avoid the lapse as a secondary line (India Wellbeing: "USD 525.00 more a week for the remaining 8 weeks").
- Row actions: Open budget (021); for Finance Admin "Add to reclaim campaign" (86a, P11).

Expired allotments tab: budgets whose monthly allotment expired unused because "Unused allotment rolls into the next period" is off (032a): budget, period, allotment, used, expired. Sample: India Wellbeing, Sep 2026, allotment USD 1,000.00, used USD 420.00, expired USD 580.00.

Lapsed last year tab (FY2025, after the year-end run): budget, available at year end, carried, lapsed, swept to (parent or corporate), journal link.

Expired commitments tab: commitments that reached Expired past their service period, amount released, budget, released on.

## Data and permissions

`reports.ts` unused endpoint combining available (ledger, per budget's control basis), forecast (`forecast_snapshots`, method and status), rollover policy (`rollover_policies`: mode lapse, carry full, carry capped with cap, carry with approval; sweep to parent or corporate) and period allotments (032a). Scope by `report.read`. The report only reads; reclaim and year-end actions live in 86a and 87b.

## States

| State           | Behaviour                                                       |
| --------------- | --------------------------------------------------------------- |
| Unused          | as above                                                        |
| No forecast     | "Run-rate" label in the forecast column and an info tooltip     |
| Nothing at risk | success empty state "No budget is at risk of lapsing in FY2026" |
| Before Q4       | info banner "Forecasts are less reliable before October"        |
| Other tabs      | as above; empty states per tab                                  |
| Loading / error | shared frame states (079)                                       |

## Budget safety and audit

"Available under its rules" is labelled as the per-budget figure; forecast values are hatched (forecast, not actual). The report never moves money. Exports and schedules are audited.

## Responsive and accessibility

Tablet: Owner and Carries over move behind "Columns". Mobile: one card per budget with available, at risk and policy. "At risk" is written, not only coloured.

## Satori components

Shared report frame from 079; `sat-navigation-tabs`, `mat-table` with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag` (policy), `sat-banner`, `sat-rich-tooltip` (policy and forecast method explanations), `sat-empty-state`; `bf-money`.

## Related screens and navigation

86a reclaim and redistribute (P11), 87a forecast cycle (P11), 87b year-end run (P11), 87c rollover policies (P11), 032a period phasing, 017 alerts, 021 budget details, 079 reports.

## Decisions taken

- "At risk of lapsing" is forecast unused minus what the rollover policy would carry; amounts that need a carry approval are shown separately, not counted as lapsing.
- Forecast unused uses the latest accepted forecast and falls back to run-rate, always labelled.
- The report only reads; actions (reclaim, year-end) happen in their own screens with their own approvals.
