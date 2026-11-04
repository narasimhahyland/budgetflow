# 107 Exchange rates (currency and exchange-rate settings, with 107a plan-rate lock)

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P3.

## Design

| State                               | Image                                                          | Stitch screen                      |
| ----------------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| FY2026 rates with locked plan rates | `design/stitch/107-exchange-rates/default--desktop--light.png` | `7b8ac4dc4ad1465fa2f4d75e733f8245` |

## Purpose

Maintain the rates that convert local-currency transactions to USD budgets and reports, with plan rates locked for the fiscal year and FX effect kept out of budget consumption.

## Roles

Finance Admin (edit), Finance Controller (approve plan-rate changes, read), Auditor (read).

## Entry points

Settings > Finance > Exchange rates; 108 fiscal calendar link; 080a FX note.

## Content and actions

Read-only row: reporting currency USD (fixed, lock), budget currency USD. Rate types tiles: plan (locked), month-end, monthly average, spot (reference). Table "Rates per 1 USD - FY2026": currency, plan rate (lock icon), month-end, average, source, updated. Governance banner on locked plan rates. FX effect example card. Actions: Import rates, Add month-end rates.

## Data and permissions

`fx:manage` (FA); plan rate changes need FA plus FC approval and never restate posted journals; rates stored with 4+ decimals and effective dates.

## States

| State                         | Behaviour                                                          |
| ----------------------------- | ------------------------------------------------------------------ |
| Missing month-end rate        | warning on the month column; FX effect report shows "rate missing" |
| Unlock request (not exported) | dialog with reason code and second approver                        |
| Import validation             | per-row errors (unknown currency, non-positive rate)               |

## Budget safety and audit

There is no currency switcher: USD for budgets and reporting is fixed. Every rate change is audited with old and new values.

## Responsive and accessibility

Tables scroll horizontally on tablet; mobile read-only. Rates use tabular numerals.

## Related screens and navigation

108, 080a, 080c, 102a legal entities.

## Assumptions and open questions

- Stitch added helper copy on rate tiles and a "CC-9900" variance reserve line; those are not decisions. FX effect posting target is open.

## Implementation

Built in Phase 3 at `/finance/rates`. Deviations from this design: `evidence/phase-03/visual-qa/design-parity/design-parity.md`.
