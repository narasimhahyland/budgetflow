# Phase 17 — quality pass

Branch `feat/p17-quality`, against `main` at `b2141ae`. **Every item done or deferred**; exploratory findings are listed for follow-up.

The plan defines Phase 17 as a functional quality pass: every feature traced to a passing functional
check, agent-driven exploratory checks, responsive and visual regression, performance, migration and
data-integrity checks. The plan also lists accessibility; **accessibility is not in this phase**, by
the user's decision that `AGENTS.md` governs ("Deferred: dark theme … and accessibility checks").
Visual regression hygiene (handoff 2.2) is being done in a separate session and is not repeated here.

| Item                                              | State                                                                                                      | Evidence                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Every built screen reached by a functional check  | Done — 112 of 112 routed components; five new journeys                                                     | [`traceability.md`](traceability.md)     |
| Migration: empty database to current              | Done — RLS enabled and forced on every tenant table                                                        | `apps/api-e2e/src/db/migrations.spec.ts` |
| Migration: previous release with data to current  | Done — 0018 to 0019, 157 tables, 1,942 rows survive                                                        | same                                     |
| Performance baseline on the seed                  | Done — all 2xx, p50 9–21 ms, p97.5 14–31 ms                                                                | [`perf/`](perf/)                         |
| Performance on a large dataset                    | Done — 20,136 ledger lines, all 2xx; dashboard and budget-vs-actual 3–4x slower, the rest flat             | [`perf/README.md`](perf/README.md)       |
| Isolated Testcontainers runs (`API_E2E_ISOLATED`) | **Deferred** (user decision, 10 Nov 2026) — see below                                                      | —                                        |
| Exploratory checks in the browser                 | Done — 6 charters; controls held; 7 findings (F7 medium: approval panel overstates company-wide available) | [`exploratory/`](exploratory/)           |
| Data integrity                                    | Done — 77 integrity scenarios pass; rebuild check clean and audit chain valid on 20,130 lines              | [`integrity/`](integrity/)               |

## Design note for the large-dataset run

An imported actual becomes a ledger posting only once it is matched, by a mapping rule or by hand;
unmatched lines wait in the queue and post nothing. So a generator that only uploads CSV files would
grow the queue, not the ledger. The intended approach is to create mapping rules that auto-match the
generated lines, so each import posts ledger lines with their audit entries through the same commands
a person's actions use — keeping balances, the rebuild check and the hash chain consistent.

## Deferred: isolated Testcontainers runs

`API_E2E_ISOLATED=1` would give each Playwright worker its own Postgres 16 container and API
instance, so API scenarios could run in parallel. It is described in the functional testing rule and
in the harness template (`docs/ai-harness/templates/api-e2e/playwright.config.ts`), but
`apps/api-e2e` does not implement it: scenarios run on one worker against the Compose stack.

Deferred by the user's decision on 10 Nov 2026. What that leaves:

- API scenarios stay serial on the shared stack (`workers: 1`), so they are slower but not less
  thorough: every suite still starts from the deterministic seed (`scripts/gate.sh` reseeds between
  suites).
- The migration checks, which need throwaway databases, already use Testcontainers
  (`apps/api-e2e/src/db/migrations.spec.ts`), so that part of the rule holds.
- Picking it up later means a per-worker fixture that starts a container, applies migrations and the
  seed, and boots an API against it, plus a change to `apps/api-e2e/playwright.config.ts`.
