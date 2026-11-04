# 080b Unmatched actuals queue

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P6.

## Design

| State                             | Image                                                              | Stitch screen                                      |
| --------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| queue with match drawer open      | `design/stitch/080b-unmatched-actuals/default--desktop--light.png` | `221d41069bea479495090b96e46d368f`                 |
| mapping rules tab (Phase 6 batch) | planned `mapping-rules--desktop--light.png`                        | not generated yet (Stitch daily limit, 2026-11-05) |

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

## Mapping rules (state added in the Phase 6 batch)

The "Mapping rules" tab of Actuals and matching (route `/finance/actuals/rules` in the Phase 6 build). Actual-to-budget mapping rules send recurring spend to the right budget or event when reference and event-code matching find nothing.

- Header: "Mapping rules", text "Rules run in priority order after reference and event-code matching. The first rule that fits proposes the match.", actions "Re-run on queue" (outlined) and "Add rule" (filled).
- Table in priority order (drag handle and number): priority, rule name, conditions as chips, target (budget or event code), lines matched in the last 30 days, active toggle, last changed by and date.
  - 1, "Hyderabad cab rides", Entity IN01 + Merchant contains "City Cabs" + Cost center CC-2200 -> Hyderabad Events, 41 lines, active.
  - 2, "Offsite 2026 card spend", Card program "Team events" + Memo contains "OFFSITE26" -> event EVT-2026-0087, 18 lines, active.
  - 3, "London team lunches", Entity UK01 + GL 6420 Staff welfare -> London Team Activities, 9 lines, active.
  - 4, "Old wellbeing vendor", Vendor Calmwave -> Europe Wellbeing, 0 lines, inactive (neutral tag "Inactive").
- Drawer "Add mapping rule": name, priority, conditions (at least one of legal entity, cost center, GL account, event code, vendor, card program, merchant contains, memo contains), target (a budget or an event, exactly one), "Test against the queue" result ("Would match 7 of 38 queued lines" with a preview list), Save rule, Cancel.
- Validation: "A rule needs at least one condition"; "A rule targets either a budget or an event"; overlapping rule warning (soft, warning container): "Rule 1 already matches 5 of these lines; this rule runs after it".
- Rules are deactivated, never deleted; edits and priority changes are audited and apply to future imports, and to queued lines after "Re-run on queue".

Data and permissions: list, create and update mapping rules (`MappingRule`: name, priority, active, match conditions, target budget or event); `actuals:rules` for Finance Admin and Finance Controller; owners read rules that target their budgets. Lines matched by a rule show "Mapping rule: <name>" as their rule in 080a and 080b.

## Budget safety and audit

Encumbered versus actual swatches; partial matches release the remaining commitment. One audit entry per match, split or exclusion.

## Responsive and accessibility

Tablet: drawer overlays the table. Mobile: list then full-screen match view. Confidence shown as number plus text.

## Related screens and navigation

080a, 080c, 051 commitments, 085a commitment hygiene.

## Assumptions and open questions

- Who may mark a line "not budget-relevant": finance only (assumed) or owners too?
