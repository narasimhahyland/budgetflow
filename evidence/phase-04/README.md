# p4-budgets — gate review

- Commit: see `gate-summary.txt` (full gate on branch `feat/p4-budgets`, rebased on main after Phase 3 and the UX design PRs), reviewed 2026-11-05
- Scope: plan todo `p4-budgets` — budget hierarchy and allocation (dialog, grid with paste from Excel, per-head driver with true-ups and program templates), controls (freeze, reduce, set to zero with impact preview, destination, floor, cascade and reason codes), transfers, increase requests, contingency reserve with release approval, control basis, mode and tolerance, limits, owner alert thresholds, period phasing, plan versions with spreadsheet import and the root tie-out, roll forward and clone, budget versions and history, concurrency and idempotency; the India and Europe seed budgets moved to USD. Screens 19-32a and 89 (21 screens) in the lazy-loaded `libs/web/features/budgets`.
- Result: passed with follow-ups — every gate mode is green, every P4 gate item is proven by API scenarios and journeys, visual QA has no blocking findings, and design deviations are documented.

## Gates

| Gate                                             | Result                                                                      | Evidence                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| Secret scan                                      | PASS                                                                        | gate-summary.txt                                     |
| Lint (ESLint + satori-lint)                      | PASS                                                                        | gate-summary.txt                                     |
| Typecheck                                        | PASS                                                                        | gate-summary.txt                                     |
| Styles (stylelint)                               | PASS                                                                        | gate-summary.txt                                     |
| Build (OpenAPI drift, migration check)           | PASS (web bundle warning 2.17 MB over the 1.5 MB budget; see follow-ups)    | gate-summary.txt                                     |
| Satori design system check (sdsc)                | PASS                                                                        | gate-summary.txt                                     |
| Functional API scenarios                         | PASS (201 scenarios; 42 budget scenarios)                                   | gate-summary.txt, functional/api-scenarios.txt       |
| Functional journeys                              | PASS (173 on desktop, tablet, mobile; 26 mutating ones run on desktop only) | gate-summary.txt, functional/journeys.txt            |
| Visual regression (pinned image)                 | PASS (137 baselines; 30 new Phase 4 states, navigation baselines refreshed) | gate-summary.txt                                     |
| Migration chain linear (`0004_budgets_planning`) | PASS                                                                        | `libs/api/db/migrations/meta/_journal.json`, db gate |

## Acceptance checklist

| Criterion (plan phase gate P4)                           | Proven by                                                                        | Role(s)              | Result | Evidence                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------- | ------ | ------------------------------------------------------------ |
| Over-allocation rejected                                 | api-e2e `budgets/over-allocation`, `per-head-grid`; web-e2e allocation workspace | FA, RM, CEO          | PASS   | functional/README.md                                         |
| Parallel allocations never exceed the parent             | api-e2e `budgets/concurrent-allocation`, `per-head-grid` (parallel grids)        | CEO, FA              | PASS   | functional/README.md                                         |
| Idempotent retries                                       | api-e2e `budgets/idempotency`, `controls` (replayed set to zero)                 | CEO, FA              | PASS   | functional/README.md                                         |
| Freeze and zero block new requests; commitments complete | api-e2e `budgets/controls`; web-e2e finance admin controls journey               | FA, RM, owner        | PASS   | api/freeze-result.json, api/allocate-from-frozen-budget.json |
| Per-head math and true-ups                               | api-e2e `budgets/per-head-grid`; web-e2e per-head journey                        | FA                   | PASS   | functional/README.md                                         |
| Plan-version tie-out                                     | api-e2e `budgets/planning`; web-e2e plan import journey                          | FA                   | PASS   | api/plan-tie-out.json                                        |
| Ledger rebuild equals cached balances                    | api-e2e `budgets/planning` (after every Phase 4 posting)                         | FA                   | PASS   | api/ledger-rebuild-check.json                                |
| Scope                                                    | api-e2e `budgets/planning`, `transfers-requests`, `scope/*`; web-e2e RM, DH, CEO | RM, DH, LM, CEO, AUD | PASS   | functional/README.md                                         |

## Invariant coverage

Rows 6, 9 and 10 of `docs/testing/invariant-scenarios.md` gained their Phase 4 parts (root tie-out with savings, the new reduction floor and destinations, freeze and zero with the outbox event); rows 29-33 are new (per-head driver, transfers, increase and release requests, allocation grid, owner alert thresholds). All map to passing scenarios.

## Outbox event contract for Phase 5

`budget.control_changed` (one per budget, cascades included) carries `eventId`, `tenantId`, `budgetId`, `budgetName`, `action` (`frozen`, `unfrozen`, `reduced`, `set_to_zero`, `restored`), `pendingRequestPolicy` (`hold`, `release`, `keep`, `cancel`), `previousStatus`, `status`, `reasonCode`, `reason`, `cascadeFromBudgetId`, `journalId`, `authorizedBeforeMinor`, `authorizedAfterMinor`, `currency`, `actorPersonId`, `occurredAt`. Sample: `api/outbox-budget-control-changed.json`. Also published: `budget.threshold_crossed` and `budget.change_requested`. Full table: `docs/architecture/phase-handoff.md`. Phase 4 never changes requests itself.

## Visual QA

| Item                                          | Result                                                                 | Evidence                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| Screens x states captured                     | 21 screens, 30 states at desktop, tablet, mobile x light               | visual-qa/report.md                      |
| Loop iterations                               | 3 fix iterations plus a final capture; stop reason: no blocking issues | visual-qa/report.md                      |
| Blocking findings in final iteration          | 0 (3 layout-shift warnings on tablet)                                  | visual-qa/report.json                    |
| Console errors / failed requests              | 0 / 0                                                                  | visual-qa/report.json                    |
| Horizontal overflow / interpolation leftovers | none / none                                                            | visual-qa/report.json                    |
| Design parity vs approved Stitch screens      | all 30 states inspected; deviations documented, none blocking          | visual-qa/design-parity/design-parity.md |

## Reviews

| Reviewer                  | Verdict                                                           | Blockers fixed | Remaining               |
| ------------------------- | ----------------------------------------------------------------- | -------------- | ----------------------- |
| ux-reviewer               | not run (this phase ran as a subagent without spawning reviewers) | —              | run with visual-qa/     |
| domain-invariant-reviewer | not run (same reason)                                             | —              | run on the Phase 4 diff |
| security review           | not run; no auth, secrets, uploads, CI or infra changes           | —              | optional                |

## Known issues and follow-ups

- Phase 5: consume `budget.control_changed` (cancel pending requests on set to zero, hold on freeze, release on unfreeze or restore); post real commitments through `PlanningService.spendCheckInTx` and call `BudgetViews.emitThresholds` after commitment postings; reseed after rebasing (seed budgets are USD now); renumber migrations after `0004_budgets_planning`.
- Phase 6: actuals feed utilization and the threshold events through the same helpers; the commitments and actuals tabs of budget details are yours.
- Phase 7: delegation-of-authority and step-up checks in the allocation workspace governance panel; freeze-until-date.
- Phase 10: executive dashboard (company-wide Available is already served by `GET /api/budgets/summary`); bundle size (2.17 MB: Satori icons register statically and the contracts barrel pulls zod into the main chunk).
- Phase 11: audit-trail panel on budget details.
- The allocation grid only raises amounts; lowering uses Reduce. Plan lines are edited by import or copy.
- Tablet layout shift on the per-head and hierarchy pages (0.17-0.18, warning only).
- An untracked scratch file `apps/web/src/app/satori-icons.ts` sits in the worktree from an abandoned bundle experiment; the guard hook blocked removing it and it is not committed.

## Not in this pack

Earlier capture iterations, full design-parity diffs, traces and raw logs: `tmp/evidence/phase-04/`, `tmp/gate/`, `dist/.playwright/` (local only).
