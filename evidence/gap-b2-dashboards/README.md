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

## Part 2 — 018 pending approvals, 018a approval performance, 018b product analytics, 088a evidence pack

| Claim                                                                                                  | Proof                                                                             |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Figures equal the approval, ledger, analytics and audit rows; nudge window; pack manifest and download | `part-2/functional/README.md`, `apps/api-e2e/src/dashboards/dashboards-2.spec.ts` |
| Role scope per read and command; operator refused                                                      | same spec; `apps/api-e2e/src/scope/operator-isolation.spec.ts`                    |
| Pages as the roles that use them                                                                       | `apps/web-e2e/src/reports/dashboards-2.spec.ts`                                   |
| No blocking visual findings; 33 new baselines                                                          | `visual-qa/report.md` (part 2 section)                                            |
| Invariants mapped                                                                                      | `docs/testing/invariant-scenarios.md` rows 113–115                                |
| Gate                                                                                                   | `part-2/gate-summary.txt`                                                         |
| API responses (no tokens)                                                                              | `part-2/api/`                                                                     |

Shared surfaces: migration **0024** `evidence_packs` (regenerated on top of B3's 0023), new action `evidence.generate` in `libs/domain` policy and
`docs/architecture/authorization.md`, contracts (additive), worker queue `reports.evidence-pack`.
