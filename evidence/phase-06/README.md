# p6-actuals — gate review

- Branch: `feat/p6-actuals` (rebased on `main` at Phase 5 merge `ed8c919`). Gate run: `gate-summary.txt`.
- Scope: plan todo `p6-actuals` — actuals file import with auto-match, local-currency actuals (INR, EUR) at the locked plan rate with the currency triplet stored and the FX effect separate, partial matches, the unmatched queue, refunds, credit notes and reversals, actual-to-budget mapping rules, GL tie-out by entity, cost center, account and period with monthly sign-off, commitment hygiene, event reconciliation and close, accrual proposals with auto-reversal, prepaids. Screens 80a, 80b, 80c (proposed designs), 80d, 85a, 53, 54 (specs proposed in UX PR #14, no images yet).
- Result: passed — every gate mode is green; every P6 gate item is proven by API scenarios on seeded feeds and by journeys; visual QA has no blocking findings.

## Gates

| Gate                                    | Result                                                                   | Evidence                         |
| --------------------------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Secret scan, lint, styles, Satori check | PASS                                                                     | gate-summary.txt                 |
| Typecheck, build, OpenAPI drift, db     | PASS                                                                     | gate-summary.txt                 |
| Functional API scenarios                | PASS (193, 20 new in `apps/api-e2e/src/actuals`)                         | functional/api-scenarios.txt     |
| Functional journeys                     | PASS (172 on desktop, tablet, mobile; mutating journeys on desktop only) | functional/journeys.txt          |
| Visual regression (pinned image)        | PASS (47 baselines, unchanged)                                           | gate-summary.txt                 |
| Visual QA loop (Phase 6 screens)        | No blocking findings after 3 iterations (54 captures each)               | visual-qa/report.md              |
| Ledger rebuild after every scenario     | clean, 0 flags                                                           | api/11-ledger-rebuild-check.json |

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

`docs/testing/invariant-scenarios.md`: rows 15 and 16 now passing; rows 8 and 20 gained Phase 6 parts; new rows 29-33 (tolerance and over-budget approval, auto-match, accruals and prepaids, commitment hygiene, GL tie-out), all passing.

## Seed (fictional apart from Hyland and office cities)

`libs/seed/src/lib/actuals.ts`: Bengaluru Annual Day 2026, Hyderabad Hack Week and New York Team Offsite with seven commitments (prefixes 77-79), a mapping rule, the November ERP feed (9 lines: 3 auto-matched, 3 partial, 3 to the queue including one over tolerance and a credit note) and card feed (one cross-source duplicate, one EUR line), a venue deposit matched as a prepaid, accrual proposals with one posted, and the India (one difference caused by an unmatched travel line) and US (tied) tie-outs for Nov 2026. `db/postings-summary.txt` lists the journals by command after the full gate.

## Deviations

- API scenarios build events, earmarks and commitments through the Phase 5 HTTP API (`apps/api-e2e/src/actuals/support.ts` and `apps/api-e2e/src/support/p5.ts`). The deterministic seed still posts fixed commitments through `LedgerService` so visual baselines and import feeds stay stable without re-running the full event lifecycle on every stack reset.
- Over-budget requests are stored in `requests` (kind `over_budget`) and decided through Phase 6 queue endpoints that enforce `request.approve`, delegation-of-authority limits and approval hygiene (not the generic approvals task inbox).
- Event close is one user-facing action: accounting and events both call Phase 5 `POST /api/events/{id}/close`; Phase 6 registers unmatched-actual and unaccrued-commitment checks on `EventCloseChecks` before Phase 5 releases commitments and returns surplus.
- Batch posting runs each match as a dry run first instead of using savepoints: the Phase 1 guard that ledger lines are inserted in their journal's transaction compares the top-level transaction id.
- UI: the three undesigned screens and event close are extra tabs of the actuals area (no shared navigation change); Export is CSV only (XLSX and PDF with P10 reports); no "show entity currency" toggle on the tie-out; one primary post action on the import review.
- Visual QA used `visual-qa/screens.p6.json` with the capture tool; the shared `screens.json` is integrator-owned (entries proposed in the PR). The ux-reviewer hand-off was not run in this session.

## Follow-ups

- P10: XLSX and PDF exports, tie-out entity-currency view, auto-match rate on the product analytics dashboard.
- P11: period close reads tie-out sign-offs; scheduled accrual auto-reversal and prepaid recognition in the worker; reopening a signed-off tie-out.
- P12: GL balances and actuals from the ERP, card and expense connectors through `ImportsService`.
