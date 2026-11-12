# Functional check — gap B2 part 1 (012, 017, 017a)

Stack: own worktree stack `bf-gap-b2` (deterministic seed, clock pinned to 2026-11-16T09:00Z).
Roles: finance-controller, finance-admin, auditor, ceo, regional-manager, location-manager, employee;
platform operator through the existing sweep.

Commands:

```bash
npx playwright test -c apps/api-e2e/playwright.config.ts src/dashboards src/scope/operator-isolation.spec.ts src/reports/health.spec.ts src/close
npx playwright test -c apps/web-e2e/playwright.config.ts src/reports/dashboards.spec.ts
```

| Scenario                           | Expected                                                                                     | Actual                                                                                       | Result |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| 012 close status                   | equals `GET /api/close/periods/{id}` entities for each closing period; one row per entity    | equal for P10 FY2026 (HYL-UK) and Oct 2026 (HYL-DE, HYL-US, HYL-IN)                          | pass   |
| 012 queue tiles                    | equal the queue rows under RLS                                                               | unmatched 4, post-spend 5 / USD 1,026.46, accruals 2 / USD 2,252.97, stale 3 / USD 56,060.00 | pass   |
| 012 FX effect                      | actuals' FX of FY2026 by currency; never in spend                                            | EUR -USD 53.76, INR -USD 39.57, total -USD 93.33                                             | pass   |
| 012 Run check now                  | queues a ledger check; card reports it clean with chain verified                             | clean, budgets checked > 0, chain valid, 0 open flags                                        | pass   |
| 012 scope                          | auditor with integrity, CEO without, owners and employee 403                                 | as expected                                                                                  | pass   |
| 017 thresholds                     | 85% spend raises the 80% warning with the exact sentence                                     | "… passed 80%: USD 8,500.00 of USD 10,000.00 committed or spent."                            | pass   |
| 017 acknowledge                    | moves to Acknowledged for that person only; budget unchanged                                 | other finance reader still sees it open                                                      | pass   |
| 017 worsening                      | 100% in hard mode raises a hard block first, not snoozable; old alert resolved               | hard block first; snooze 422 `VALIDATION_FAILED`; 80% alert in Resolved                      | pass   |
| 017 snooze                         | idempotent replay, 7 days, one analytics event                                               | `Idempotent-Replayed: true`, 7 days, 1 event                                                 | pass   |
| 017 controls                       | frozen information/info; set to zero information/important                                   | as expected                                                                                  | pass   |
| 017 scope                          | regional manager's alerts all in their subtree; employee 403                                 | as expected                                                                                  | pass   |
| 017a by type                       | counts, money at stake and age bands equal the rows; drill lists the open items oldest first | post-spend 5 / USD 1,026.46, duplicates 1                                                    | pass   |
| 017a scope                         | CEO without the four integrity types; auditor with all; owners and employee 403              | as expected                                                                                  | pass   |
| Operator sweep                     | every parameter-free GET refuses the operator                                                | still green with the three new reads                                                         | pass   |
| Journeys (desktop, tablet, mobile) | the pages show the API's figures; roles refused see the 403 / forbidden page                 | 30 passed, 2 skipped (the acknowledge journey mutates, so it runs on desktop only)           | pass   |

API responses (no tokens): `../api/`. Invariant map rows 103–105 in `docs/testing/invariant-scenarios.md`.

Defect found and fixed while building: `AnalyticsService.track` stored the database's real clock, not
the pinned application clock, so an acknowledgement could appear days apart from the "now" every other
figure used. `track` now takes the command's time.
