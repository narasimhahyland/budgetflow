# 080b Unmatched actuals queue

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P6.

## Design

| State                        | Image                                                              | Stitch screen                      |
| ---------------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| queue with match drawer open | `design/stitch/080b-unmatched-actuals/default--desktop--light.png` | `221d41069bea479495090b96e46d368f` |

## Purpose

Resolve spend lines that did not auto-match: pick the right commitment or budget, split across budgets, or mark as not budget-relevant, with the FX treatment explicit.

## Roles

Finance Controller, Finance Admin; budget owners for lines suggested to their budgets (scoped).

## Entry points

080a "Go to queue"; 080c difference link; owner notifications.

## Content and actions

Filters (period, entity, currency, owner) and search. Table: date, vendor, description, transaction amount, USD at plan rate, suggested match, confidence. Drawer "Match actual": transaction amount, budget USD at the locked plan rate, month-end value, FX effect (separate, never consumes budget); candidates (commitment with encumbered amount and difference; or charge to a budget directly); actions Match, Split across budgets, Not budget-relevant; audit note.

## Data and permissions

`actuals:match` on the target budget; owners only see lines suggested to their budgets. Matching is idempotent per line; reversals for corrections in an open period.

## States

| State                | Behaviour                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Empty (not exported) | "Nothing to match" success empty state                                                             |
| No suggestion        | drawer opens with budget search instead of candidates                                              |
| Over commitment      | warning when the actual exceeds the commitment; difference goes to the budget as additional actual |
| Bulk match           | `sat-selection-bar` for accepting high-confidence suggestions                                      |

## Budget safety and audit

Encumbered versus actual swatches; partial matches release the remaining commitment. One audit entry per match, split or exclusion.

## Responsive and accessibility

Tablet: drawer overlays the table. Mobile: list then full-screen match view. Confidence shown as number plus text.

## Related screens and navigation

080a, 080c, 051 commitments, 085a commitment hygiene.

## Assumptions and open questions

- Who may mark a line "not budget-relevant": finance only (assumed) or owners too?
