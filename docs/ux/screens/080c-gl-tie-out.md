# 080c GL tie-out and monthly sign-off

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P6.

## Design

| State                                            | Image                                                       | Stitch screen                      |
| ------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------- |
| one difference above tolerance, sign-off blocked | `design/stitch/080c-gl-tie-out/default--desktop--light.png` | `46e46ef7925049a580e5b430cf3243f6` |

## Purpose

Prove BudgetFlow actuals equal the general ledger by entity, cost center, account and period, explain differences, and sign off the month.

## Roles

Finance Controller (prepares), Finance Admin (reviews and signs off), Auditor (reads).

## Entry points

Finance > GL tie-out; month-end checklist; 080a after posting.

## Content and actions

Export menu (CSV, XLSX, PDF). Filters: period, entity, tolerance, "Show entity currency" toggle. Entity chips (differences or tied). Table: GL account, cost center, general ledger, BudgetFlow actuals, difference, status (tied or difference with a link to the cause), total row. Sign-off card: checklist (files imported, unmatched queue cleared, differences within tolerance), prepared by, reviewer, "Sign off Oct 2026" (disabled with the reason until checks pass or an explanation is added), "Add explanation".

## Data and permissions

`gl:tie-out` (FC), `gl:sign-off` (FA, not the preparer); GL balances come from the ERP feed; amounts in USD at the plan rate with the entity-currency view optional.

## States

| State                     | Behaviour                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------- |
| All tied (not exported)   | success chips; sign-off enabled                                                        |
| Signed off (not exported) | read-only with signer, time and lock icon; reopening needs FA and is audited           |
| Explanation added         | difference row shows the explanation; sign-off enabled with "signed with explanations" |
| Loading / error           | skeleton table; error banner with retry                                                |

## Budget safety and audit

Differences use the warning tone; above-tolerance checks use the error tone and block sign-off. Sign-off and explanations are audited; sign-off locks the tie-out for the period.

## Responsive and accessibility

Desktop and tablet; mobile read-only. Table has a caption with period and entity.

## Related screens and navigation

080a, 080b, 108 fiscal calendar, 080e period close (P11), 088.

## Assumptions and open questions

- Tolerance per entity or per account? Designed per entity.
