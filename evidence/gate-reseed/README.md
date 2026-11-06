# Gate reseed between functional-api and functional-e2e

Base `origin/main` 054c9bb. Verified on an isolated stack (compose project `bf-gate-reseed`, ports
shifted so the `bf-demo` stack and the active worktrees were untouched).

## Root cause

`scripts/gate.sh` ran `functional-api` and `functional-e2e` back to back against one stack with no
reseed, and CI's `functional` job runs exactly that command, so both behaved the same way. The API
scenarios legitimately mutate seeded state, so journeys read data that had already moved. The
resulting failures looked like flakes but were real subject-selection bugs; the product was correct.

## The seeded state the API scenarios move

Probed through the API as the CEO and as Finance, before and after `nx run api-e2e:functional-api`
on the same stack with no reseed.

| Subject                          | Deterministic seed                                | After `functional-api`                                |
| -------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| Delegation-of-authority versions | `v2:awaiting_approval`, `v1:active`               | `v3:scheduled`, `v2:scheduled`, `v1:active`           |
| CEO actions on the DoA screen    | `view`, `approve`                                 | `view`, `new_draft` — no approval is offered          |
| Post-spend exceptions            | 4 open, 1 explained, 0 resolved                   | 2 open, 1 explained, 2 resolved                       |
| First open exception             | `ACT-00318` / R-26 / Aarav Nair                   | resolved by the API scenario                          |
| Budget health rows               | 11 budgets, 10 rows, worst "United States Region" | 482 budgets, 200 rows, worst "P5 budget-owner c53e74" |

`apps/api-e2e/src/rules/workflows-authority.spec.ts` already carried a comment about working around
this ("an earlier run may already have approved that one"), which is the same problem seen from the
API side.

## Outcomes

| Scenario                                                           | Expected                                         | Actual                                                                | Result |
| ------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------- | ------ |
| `rules` and `reports` journeys on the deterministic seed           | pass                                             | 32 passed                                                             | PASS   |
| Same journeys against state left by `functional-api`, no reseed    | fail at subject selection, not a wrong assertion | 2 failed (`toContainText` element not found)                          | PASS   |
| `scripts/gate.sh functional` (the command CI runs) with the reseed | green, with a reseed step between suites         | all steps PASS, `reseed-e2e` 41s                                      | PASS   |
| `scripts/gate.sh static --affected`                                | green                                            | secrets, lint, styles, satori, typecheck, build, openapi, db all PASS | PASS   |
| `scripts/validate-harness.sh`                                      | green                                            | visual self-test 22/22, secret scan clean, OK                         | PASS   |

The middle row is the point: the hardened journeys fail loudly against moved data instead of
asserting the wrong thing, and they pass from the seed the gate now guarantees.

## Added gate time

One `scripts/stack.sh reset`, measured at 41s, on any run that does both functional suites. It is
only taken when `functional-api` also ran, so `scripts/gate.sh functional-e2e` on its own is
unchanged (the stack was just reset). A full `scripts/gate.sh` now takes two reseeds: the new one
before the journeys and the one that already ran before the visual step.

`scripts/gate.sh functional` end to end: stack 46s, functional-api 132s, reseed-e2e 41s,
functional-e2e 172s. See `gate-summary.txt`.

## CI parity

No workflow change was needed. `.github/workflows/ci.yml` runs `bash scripts/gate.sh functional` in
one job on one stack, so the fix in the script applies identically to local runs and CI: a local
`scripts/gate.sh functional` pass predicts a CI `functional` pass.
