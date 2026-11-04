# 012 Finance controller dashboard

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Home for Finance Controller and Finance Admin (`/home/finance`), also Insights > Dashboards > Finance.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the dashboard layout of 011. Planned Stitch states, to be generated in a later session:

| State                             | Planned image                                                                |
| --------------------------------- | ---------------------------------------------------------------------------- |
| month-end in progress             | `design/stitch/012-finance-controller-dashboard/default--desktop--light.png` |
| all clear (period ready to close) | `all-clear--desktop--light.png`                                              |
| ledger drift detected             | `drift--desktop--light.png`                                                  |
| mobile                            | `default--mobile--light.png`                                                 |

## Purpose

Give the controller one page that says whether the numbers can be trusted and whether the month can close: close status per legal entity, every queue that blocks close with its size and age, the nightly ledger integrity result, feed freshness and the FX effect, each with a link to the screen that clears it.

## Roles

Finance Controller (primary), Finance Admin; Auditor and CEO read.

## Entry points

Sign-in home for Finance Controller and Finance Admin; sidebar Home; finance weekly digest (64a); notifications about drift or failed feeds.

## Content and actions

Header bar: "Finance overview", period chip (October 2026, closing), "As of 4 Nov 2026, 09:40 IST", Export (CSV, XLSX, PDF).

Close status card (October 2026), one row per legal entity with a status per step (tick, warning or cross, each a link):

| Entity | Actuals imported | Unmatched cleared        | GL tie-out signed                      | Accruals reviewed | Recharges posted        | Period      |
| ------ | ---------------- | ------------------------ | -------------------------------------- | ----------------- | ----------------------- | ----------- |
| IN01   | yes, 2 Nov       | 2 lines, USD 612.40 open | difference USD 48.10 (above tolerance) | 3 proposed        | 1 awaiting tax approval | Open        |
| US01   | yes, 1 Nov       | cleared                  | signed by Marco Bianchi                | done              | done                    | Soft-closed |
| UK01   | yes, 2 Nov       | 1 line, USD 86.40 open   | not started                            | 2 proposed        | none needed             | Open        |

Action "Open period close" (80e).

Queue tiles (count, amount, oldest; each opens its queue):

- Unmatched actuals: 14 lines, USD 3,180.40, oldest 23 days (080b).
- Post-spend exceptions: 7 open, 2 above USD 500.00 need you (074a).
- Accrual proposals: 5, USD 4,420.00 (080d).
- Recharges awaiting tax approval: 2, USD 4,600.00 (053a).
- Stale commitments: 9, USD 5,630.00 past service end (085a).
- Approvals escalated to you: 2 (063).

Integrity card: "Nightly ledger check 4 Nov 02:00: clean. Cached balances equal the rebuild for 1,412 budgets." Audit chain: "Verified to entry 18,417." Link "Run check now" (`requestLedgerCheck`).

Feeds card: last import per source (File upload 2 Nov 16:20; Card feed 4 Nov 06:00; Expense feed 3 Nov 22:10) with a warning when a feed is older than its expected interval.

FX card: FX effect year to date -USD 214.60 (favourable) by currency: INR -USD 182.30, GBP -USD 44.70, EUR +USD 12.40; note "Not part of spend or available."

## Data and permissions

Read model from `reports.ts` combining fiscal period status (`changePeriodStatus` data, 108), tie-out runs (`gl_tieout_runs`, statuses draft, reconciled, exceptions, signed off), actuals match status, accruals, recharges (statuses incl. pending tax approval), commitments aging, integrity check runs and flags (`requestLedgerCheck`, `getLedgerCheck`, `integrity_flags`), audit verification (`verifyAuditChain`) and actual sources. Visible with `report.read` at tenant scope plus `integrity.read`; actions inside the tiles use their own permissions.

## States

| State          | Behaviour                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default        | as above                                                                                                                                                            |
| All clear      | close card all ticks; success banner "October is ready to close" with "Open period close"                                                                           |
| Drift detected | error banner "Ledger check found 2 budgets whose cached balance differs from the rebuild" with a link to the integrity flags; Export of the dashboard still allowed |
| Feed delayed   | warning on the feed row and on affected tiles ("Card feed is 30 hours late")                                                                                        |
| Loading        | `sat-ghost` in each card                                                                                                                                            |
| Error          | partial: the failed card shows "Unavailable" with Retry; total: `sat-500-error-state`                                                                               |
| Forbidden      | `sat-403-error-state`                                                                                                                                               |

## Budget safety and audit

Ticks, warnings and crosses are icons with words; drift and chain failures use the error tone and are never hidden. FX effect is its own card and never added to actual. Read-only page; exports are audited; "Run check now" is audited by the integrity module.

## Responsive and accessibility

Tablet: close card scrolls horizontally with the entity column pinned; tiles two per row. Mobile: tiles first as a list, close status as one card per entity. Every status has text; tiles are links with count and name in the accessible name.

## Satori components

`sat-header-bar`, `sat-interactive-card` (tiles), `satCardSurfaceContainerLowest`, `mat-table` (close status), `sat-status-tag`, `sat-banner`, `sat-ghost`, `sat-500-error-state`, `sat-403-error-state`; Export menu from 000; `bf-money`.

## Related screens and navigation

80e period close (P11), 080a, 080b, 080c, 080d, 085a, 053a, 074a, 063, 108 fiscal calendar, 017a exceptions dashboard, 16a board pack, 088 audit log.

## Decisions taken

- The controller's home is organised around closing the month (status per entity and blocking queues), not around budget totals, which stay on 011. Recommended because the controller's daily question is "what stops the close?".
- The nightly ledger check result and the audit chain status are always on this page, so integrity problems are seen the morning they happen.
- Feeds show freshness against an expected interval per source, so a silent feed failure is visible.
