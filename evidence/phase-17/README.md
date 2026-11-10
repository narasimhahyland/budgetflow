# Phase 17 — quality pass

Branch `feat/p17-quality`, against `main` at `b2141ae`. **In progress.**

The plan defines Phase 17 as a functional quality pass: every feature traced to a passing functional
check, agent-driven exploratory checks, responsive and visual regression, performance, migration and
data-integrity checks. The plan also lists accessibility; **accessibility is not in this phase**, by
the user's decision that `AGENTS.md` governs ("Deferred: dark theme … and accessibility checks").
Visual regression hygiene (handoff 2.2) is being done in a separate session and is not repeated here.

| Item                                              | State                                                                                                                  | Evidence                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Every built screen reached by a functional check  | Done — 112 of 112 routed components; five new journeys                                                                 | [`traceability.md`](traceability.md)     |
| Migration: empty database to current              | Done — RLS enabled and forced on every tenant table                                                                    | `apps/api-e2e/src/db/migrations.spec.ts` |
| Migration: previous release with data to current  | Done — 0018 to 0019, 157 tables, 1,942 rows survive                                                                    | same                                     |
| Performance baseline on the seed                  | Done — all 2xx, p50 9–21 ms, p97.5 14–31 ms                                                                            | [`perf/`](perf/)                         |
| Performance on a large dataset                    | Not started — needs a generator that works through the API                                                             | [`perf/README.md`](perf/README.md)       |
| Isolated Testcontainers runs (`API_E2E_ISOLATED`) | Not started — the mode is named in the docs, but nothing implements it                                                 | —                                        |
| Exploratory checks in the browser                 | Not started                                                                                                            | —                                        |
| Data integrity                                    | Covered by existing API scenarios (ledger rebuild equals cached balances, audit chain verification); to be mapped here | `docs/testing/invariant-scenarios.md`    |

## Design note for the large-dataset run

An imported actual becomes a ledger posting only once it is matched, by a mapping rule or by hand;
unmatched lines wait in the queue and post nothing. So a generator that only uploads CSV files would
grow the queue, not the ledger. The intended approach is to create mapping rules that auto-match the
generated lines, so each import posts ledger lines with their audit entries through the same commands
a person's actions use — keeping balances, the rebuild check and the hash chain consistent.
