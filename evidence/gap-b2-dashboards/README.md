# Gap package B2 — dashboards

`docs/gap-closure-plan.md` package B2, split in two pull requests as the plan suggests.

## Part 1 — 012 finance controller, 017 alerts, 017a exceptions

Built from the written specs (decision D2) with the shared Satori components; no Stitch design.

| Claim                                                                                                      | Proof                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Each figure equals its source (period-close checklist, queue rows under RLS, ledger postings, actuals' FX) | `part-1/functional/README.md`, `apps/api-e2e/src/dashboards/dashboards.spec.ts`          |
| Role scope per read; operator refused                                                                      | same spec (scope tests); `apps/api-e2e/src/scope/operator-isolation.spec.ts` still green |
| Pages show the API's numbers as the roles that use them                                                    | `apps/web-e2e/src/reports/dashboards.spec.ts`                                            |
| No blocking visual findings; 27 new baselines                                                              | `visual-qa/report.md`                                                                    |
| Invariants mapped                                                                                          | `docs/testing/invariant-scenarios.md` rows 103–105                                       |
| Gate                                                                                                       | `part-1/gate-summary.txt`                                                                |
| API responses (no tokens)                                                                                  | `part-1/api/`                                                                            |

Gate result (`part-1/gate-summary.txt`): every step passed except `visual`, with 968 passed, 1 flaky
and 2 failed. The two failures are `101-api-keys` `default` and `create-form` on desktop, a screen
this package does not touch. The seeded API key's expiry is computed from the real clock when the
seed runs (`expiresInDays: 90` in `libs/seed/src/lib/integrations.ts`, issued through
`ApiKeysService` with `Date.now()`), so the masked expiry date and its column width change with the
day the stack is seeded. Recorded as a follow-up; fixing it needs the seed to run on the pinned
clock (`scripts/stack.sh` passes `BF_FIXED_NOW` to the database session, not to the seed process).

## Part 2 — 018, 018a, 018b, 088a

Planned in the second pull request.
