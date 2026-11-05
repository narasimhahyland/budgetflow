# Phase 7 — rules engine, approval workflows, delegation hygiene and notifications

Branch `feat/p7-rules-workflows`. Local stack on the +70 port offset
(`COMPOSE_PROJECT_NAME=bf-p7-rules-workflows`), deterministic seed, Keycloak tokens per role.

## What is proven

| Outcome                                                                        | Proven by                                                                    | Result  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------- |
| The strictest matching rule decides, and every matching rule is listed with it | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| Simulation and backtesting change nothing                                      | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| A draft contradicting an active rule cannot be published (409 `RULE_CONFLICT`) | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| An active version is immutable; editing opens a new draft                      | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| Retiring stops a rule matching and cannot be repeated                          | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| Publishing is idempotent                                                       | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| Routing names its steps; testing a route creates no approval task              | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| Delegation hygiene: self, over 30 days, above your own limit, revoked twice    | `api-e2e/src/rules/workflows-authority.spec.ts`, `approvals/hygiene.spec.ts` | passing |
| An approval-limit change needs two people; the submitter is refused            | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| A version starting later never leaves today without a matrix in force          | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| Overdue approvals escalate by authority and are audited                        | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| A post-spend exception is settled once, with the decision audited              | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| Rules administration is refused without `rules.read` / `rules.manage`          | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| Finance reads the overview and opens the conflicting draft                     | `web-e2e/src/rules/rules.spec.ts`                                            | passing |
| Finance tests a request and sees which rule decided it                         | `web-e2e/src/rules/rules.spec.ts`                                            | passing |
| Finance settles a post-spend exception                                         | `web-e2e/src/rules/rules.spec.ts`                                            | passing |
| The CEO approves the approval-limit change Finance submitted                   | `web-e2e/src/rules/rules.spec.ts`                                            | passing |
| Every policy section renders with no stored codes in the copy                  | `web-e2e/src/rules/rules.spec.ts`                                            | passing |

Invariant rows 39–43 in `docs/testing/invariant-scenarios.md` map these to their scenarios; rows 11
and 12 moved from `planned (P5)` to `passing` and now also name the Phase 7 scenarios.

## Gate runs

- `gate/` — logs from the full `scripts/gate.sh` run (lint, typecheck, build, functional-api,
  functional-e2e, visual) on commit `c69ef88`.
- `gate/static-run/` — `scripts/gate.sh static` after the fixes that run found.

The full run surfaced two real problems, both fixed and re-verified:

1. `functional-e2e` — `shell/role-navigation.spec.ts` asserts the exact navigation per role. Moving
   the rules section from `doa.manage` to `rules.read` correctly shows it to the CEO, the Finance
   Controller and auditors, so the expectation was updated. Re-run targeted: 56 passed.
2. `visual` — the approval-limits and post-spend-exception screens show data the journeys change,
   so their baselines were recaptured against the state the gate reseeds to. Re-run targeted:
   20 passed.

## Screenshots

`screenshots/` holds the desktop captures from the two review passes over every screen
(`fixed-*` are the second pass). Both passes reported zero console errors and zero failed network
requests. The first pass found the policy settings pages rendering blank (the component input was
named `section`, which the router filled from the shell's route data instead of the route
parameter) plus seven copy and data defects; the second pass confirmed all of them fixed and found
a further set of copy and data inconsistencies, also fixed.

## Known flake, not introduced here

The visual suite mutates data as it captures (the `061-approval-decision approve-part` state
actually approves) and the app scrolls an inner container rather than the document, so a capture
taken while that scroll settles differs. Across repeated local runs a different pre-existing screen
failed each time (`021`, `046a`, `056a`, `061`), including before any Phase 7 baseline was touched.
Resetting inner scroll before every capture fixes it but changes 23 existing baselines from earlier
phases, so it is left as a follow-up rather than bundled into this phase.
