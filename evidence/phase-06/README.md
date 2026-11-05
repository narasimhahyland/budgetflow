# p6-actuals — gate review

- Branch: `feat/p6-actuals`, rebased on main after Phase 4 (PR #21); Phase 5 merges before it. Gate run: `gate-summary.txt`.
- Scope: plan todo `p6-actuals` — actuals file import with auto-match, local-currency actuals (INR, EUR) at the locked plan rate with the currency triplet stored and the FX effect separate, partial matches, the unmatched queue, refunds, credit notes and reversals, actual-to-budget mapping rules, GL tie-out by entity, cost center, account and period with monthly sign-off, commitment hygiene, event reconciliation and close, accrual proposals with auto-reversal, prepaids. Screens 80a, 80b, 80c (proposed designs), 80d, 85a, 53, 54 (specs proposed in UX PR #14, no images yet).
- Result: passed — every gate mode is green; every P6 gate item is proven by API scenarios on seeded feeds and by journeys; visual QA has no blocking findings.

## Gates

| Gate                                    | Result                                                                   | Evidence                         |
| --------------------------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Secret scan, lint, styles, Satori check | PASS                                                                     | gate-summary.txt                 |
| Typecheck, build, OpenAPI drift, db     | PASS                                                                     | gate-summary.txt                 |
| Functional API scenarios                | PASS (223, 22 in `apps/api-e2e/src/actuals`)                             | functional/api-scenarios.txt     |
| Functional journeys                     | PASS (193 on desktop, tablet, mobile; mutating journeys on desktop only) | functional/journeys.txt          |
| Visual regression (pinned image)        | PASS (137; 24 Phase 4 baselines regenerated, see below)                  | gate-summary.txt                 |
| Visual QA loop (Phase 6 screens)        | No blocking findings after 3 iterations (54 captures each)               | visual-qa/report.md              |
| Ledger rebuild after every scenario     | clean, 0 flags                                                           | api/11-ledger-rebuild-check.json |
| CI on PR #16                            | PASS (all jobs, head 315f0cc)                                            | gate-summary.txt                 |

## Acceptance checklist (plan gate P6 and the brief)

| Criterion                                                                                            | Proven by                                                                                       | Roles                | Result |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------- | ------ |
| Auto-match rate measured on seeded feeds                                                             | `actuals/import-auto-match.spec.ts` (match rate 80% on its feed); seed ERP feed 6 of 9 (api/01) | FC, auditor          | PASS   |
| Partial match, unmatched queue, splits, not budget-relevant, matched once                            | `actuals/queue-matching.spec.ts`; journey `accounting/actuals.spec.ts`                          | FC                   | PASS   |
| Over tolerance -> over-budget request (DoA, no self-approval)                                        | `actuals/over-tolerance.spec.ts`                                                                | FC, FA, LM, employee | PASS   |
| Refunds, credit notes, source reversals (linked reversal journals)                                   | `actuals/refunds-reversals.spec.ts`                                                             | FC                   | PASS   |
| INR and EUR at the locked plan rate, triplet stored, FX effect separate                              | `actuals/fx-plan-rate.spec.ts`; drawer FX block (visual-qa)                                     | FC                   | PASS   |
| Commitment relief reuses the posted budget amount (no FX drift)                                      | `actuals/fx-plan-rate.spec.ts` (three INR invoices against a USD commitment)                    | FC                   | PASS   |
| Duplicate guard (within a file, across files, across sources)                                        | `actuals/import-auto-match.spec.ts`, `actuals/queue-matching.spec.ts`                           | FC                   | PASS   |
| Accrual proposals, approve, export, auto-reverse (actual and period)                                 | `actuals/accruals.spec.ts`                                                                      | FC                   | PASS   |
| Prepaid timing (consumed in the service period)                                                      | `actuals/prepaids-hygiene.spec.ts`                                                              | FC                   | PASS   |
| Commitment hygiene (aging, prompts, release, cancellation fee, deposit)                              | `actuals/prepaids-hygiene.spec.ts`; journey                                                     | FC                   | PASS   |
| GL tie-out by entity, cost center, account, period; monthly sign-off                                 | `actuals/tieout.spec.ts`; journey `accounting/tieout.spec.ts`                                   | FC, FA, auditor      | PASS   |
| Event close blocked with unmatched actuals (and recharge, open commitments); surplus per contributor | `actuals/event-close.spec.ts`; journey                                                          | FC, auditor          | PASS   |
| Ledger rebuild clean                                                                                 | `actuals/ledger-rebuild.spec.ts`, `ledger/rebuild-check.spec.ts`, api/11                        | FC                   | PASS   |
| Import, match and tie-out events in product analytics                                                | `actuals/import-auto-match.spec.ts`, `actuals/tieout.spec.ts`                                   | FC, FA               | PASS   |

## Invariant coverage

`docs/testing/invariant-scenarios.md`: rows 15 and 16 now passing; rows 8, 20 and 33 (owner alert thresholds) gained Phase 6 parts; new rows 34-38 (tolerance and over-budget approval, auto-match, accruals and prepaids, commitment hygiene, GL tie-out), all passing. Rows 29-33 are Phase 4's.

## Merge onto Phase 4 (2026-11-05)

- Rebased on main after PR #21; doc conflicts resolved keeping both sides (Phase 4 rows 6, 9, 10, 29-33 and the Phase 6 rows renumbered 34-38; ledger posting table with both phases' events). Migration `0005_actuals_accounting` follows `0004_budgets_planning`; the drizzle snapshot chain is intact.
- Actuals feed utilization through Phase 4's helpers: every match reads `BudgetViews.utilizations` before posting and calls `emitThresholds` after, so a direct charge (or excess over a commitment) that crosses 50/80/100% publishes `budget.threshold_crossed`; an actual matched within its commitment leaves utilization unchanged. Proven by `actuals/utilization-thresholds.spec.ts`; `db/threshold-events-from-actuals.txt` counts the events on budgets that received matched actuals after the full runs.
- Contract clashes fixed on the Phase 6 side: `TieOutQuery` (Phase 4 plan tie-out) vs the GL tie-out list query, now `GlTieOutQuery`; operation `closeEvent` (also defined by Phase 5) is now `closeReconciledEvent` at the unchanged path `/api/actuals/events/{eventId}/close`.
- Budgets are USD now: the accruals journey expects the seeded Hack Week accrual and Annual Day deposit in USD at the plan rate (USD 396.40, USD 720.72).
- Visual baselines: Phase 6 seeds commitments and actuals on Bengaluru Events, so 24 Phase 4 baselines (021, 025-029) were regenerated with `npm run e2e:update-snapshots` on a fresh seed, and the 028 wait moved to the USD 7,911.71 cut. The queue journey reverses and excludes its own charge so the baselines also hold when the visual gate runs after the journeys.
- A first API run lost 4 tests to a 15-minute host sleep (clock skew: expired tokens, TOTP, a server-time check); re-run green, and later runs use `caffeinate`.

## Seed (fictional apart from Hyland and office cities)

`libs/seed/src/lib/actuals.ts`: Bengaluru Annual Day 2026, Hyderabad Hack Week and New York Team Offsite with seven commitments (prefixes 77-79), a mapping rule, the November ERP feed (9 lines: 3 auto-matched, 3 partial, 3 to the queue including one over tolerance and a credit note) and card feed (one cross-source duplicate, one EUR line), a venue deposit matched as a prepaid, accrual proposals with one posted, and the India (one difference caused by an unmatched travel line) and US (tied) tie-outs for Nov 2026. `db/postings-summary.txt` lists the journals by command after the full gate.

## Deviations

- Commitments, events and earmarks in API scenarios come from a temporary fixture (`apps/api-e2e/src/actuals/support.ts`) that posts with the domain builders; to be switched to the Phase 5 commitment API before merging. The seed creates its commitments through `LedgerService` with the domain builder for the same reason.
- Over-budget requests are written to `requests` (kind `over_budget`) and decided by a Phase 6 endpoint (request.approve on the budget, DoA limit, approval hygiene) until Phase 5's approval routing exists.
- Batch posting runs each match as a dry run first instead of using savepoints: the Phase 1 guard that ledger lines are inserted in their journal's transaction compares the top-level transaction id.
- UI: the three undesigned screens and event close are extra tabs of the actuals area (no shared navigation change); Export is CSV only (XLSX and PDF with P10 reports); no "show entity currency" toggle on the tie-out; one primary post action on the import review.
- Visual QA used `visual-qa/screens.p6.json` with the capture tool; the shared `screens.json` is integrator-owned (entries proposed in the PR). The ux-reviewer hand-off was not run in this session.

## Follow-ups

- P5 merge: switch scenarios and seed to the commitment API; consume over funding lines; route over-budget requests through approvals; event close surplus by funding-line share; reconcile the two event close commands (`closeEvent` in Phase 5, `closeReconciledEvent` here) so one close enforces the reconciliation rules; renumber the migration after `0005_events_cofunding`.
- The import screen's `?file=` deep link searches only the latest 50 batches (`GET /api/actuals/imports`); after many imports without a reset the seeded batch is unreachable. Look the batch up server-side or paginate the history (P10 or P12).
- Phase 3 journey `finance-admin/finance-setup.spec.ts:115` failed once when the legal-entity select did not open (passed 3 of 3 on re-run).
- P10: XLSX and PDF exports, tie-out entity-currency view, auto-match rate on the product analytics dashboard.
- P11: period close reads tie-out sign-offs; scheduled accrual auto-reversal and prepaid recognition in the worker; reopening a signed-off tie-out.
- P12: GL balances and actuals from the ERP, card and expense connectors through `ImportsService`.
