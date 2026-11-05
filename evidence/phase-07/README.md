# Phase 7 — rules engine, approval workflows, delegation hygiene and notifications

Branch `feat/p7-rules-workflows`. Local stack on the +70 port offset
(`COMPOSE_PROJECT_NAME=bf-p7-rules-workflows`), deterministic seed, Keycloak tokens per role.

## What is proven

| Outcome                                                                                          | Proven by                                                                    | Result  |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------- |
| The strictest matching rule decides, and every matching rule is listed with it                   | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| Simulation and backtesting change nothing                                                        | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| A draft contradicting an active rule cannot be published (409 `RULE_CONFLICT`)                   | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| An active version is immutable; editing opens a new draft                                        | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| Retiring stops a rule matching and cannot be repeated                                            | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| Publishing is idempotent                                                                         | `api-e2e/src/rules/rules-engine.spec.ts`                                     | passing |
| Routing names its steps; testing a route creates no approval task                                | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| Delegation hygiene: self, over 30 days, above your own limit, revoked twice                      | `api-e2e/src/rules/workflows-authority.spec.ts`, `approvals/hygiene.spec.ts` | passing |
| An approval-limit change needs two people; the submitter is refused                              | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| A version starting later never leaves today without a matrix in force                            | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| Overdue approvals escalate by authority and are audited                                          | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| A post-spend exception is settled once, with the decision audited                                | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| Rules administration is refused without `rules.read` / `rules.manage`                            | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| Finance reads the overview and opens the conflicting draft                                       | `web-e2e/src/rules/rules.spec.ts`                                            | passing |
| Finance tests a request and sees which rule decided it                                           | `web-e2e/src/rules/rules.spec.ts`                                            | passing |
| Finance settles a post-spend exception                                                           | `web-e2e/src/rules/rules.spec.ts`                                            | passing |
| The CEO approves the approval-limit change Finance submitted                                     | `web-e2e/src/rules/rules.spec.ts`                                            | passing |
| Every policy section renders with no stored codes in the copy                                    | `web-e2e/src/rules/rules.spec.ts`                                            | passing |
| The approval history is real: no rule is inferred, and an approver sees only their own decisions | `api-e2e/src/rules/workflows-authority.spec.ts`                              | passing |
| An auditor reads every decision and narrows it to the rejections                                 | `web-e2e/src/rules/rules.spec.ts`                                            | passing |
| A requester accepts an approver's counter-offer in one step                                      | `web-e2e/src/spend/requests.spec.ts`                                         | passing |
| A resubmission needs a real change and a note, and lists what changed                            | `web-e2e/src/spend/requests.spec.ts`                                         | passing |

Invariant rows 39–43 in `docs/testing/invariant-scenarios.md` map these to their scenarios; rows 11
and 12 moved from `planned (P5)` to `passing` and now also name the Phase 7 scenarios.

## Gate runs

`gate/` holds the logs and summary of the final full `scripts/gate.sh` run (lint, typecheck, build,
openapi, db, functional-api, functional-e2e, visual) — every mode passing:

```
PASS secrets 1s / lint 4s / styles 1s / satori 21s / typecheck 3s / build 1s
PASS openapi 1s / db 1s / stack 42s / functional-api 84s / functional-e2e 77s
PASS reseed 39s / visual 80s
```

Earlier runs surfaced four real problems, all fixed and re-verified:

1. `functional-e2e` — `shell/role-navigation.spec.ts` asserts the exact navigation per role. Moving
   the rules section from `doa.manage` to `rules.read` correctly shows it to the CEO, the Finance
   Controller and auditors, and screen 090 adds an Insights entry for everyone with `audit.read`,
   so the expectations were updated.
2. `visual` — the approval-limits and post-spend-exception screens show data the journeys change,
   so their baselines were recaptured against the state the gate reseeds to.
3. `visual` — two capture states (`061-approval-decision approve-part` and `069-rule-simulation
blocked-outcome`) clicked a control below the fold, which scrolls the shell's content box; the
   full-page shot then kept that offset and matched the baseline only when the click happened not
   to scroll. Visual states can now opt into a scroll reset before capture, and only those two use
   it, so no other baseline moved.
4. `functional-e2e` — a host with many cores starved the single local stack (one API, one Postgres,
   one Keycloak) and timed journeys out on a different unrelated screen each run; the same specs
   passed seven times out of seven in isolation. `BF_E2E_WORKERS` now caps the fan-out when a
   machine needs it and changes nothing when unset. The final run used `BF_E2E_WORKERS=4`.

## Screenshots

`screenshots/` holds the desktop captures from the two review passes over every screen
(`fixed-*` are the second pass). Both passes reported zero console errors and zero failed network
requests. The first pass found the policy settings pages rendering blank (the component input was
named `section`, which the router filled from the shell's route data instead of the route
parameter) plus seven copy and data defects; the second pass confirmed all of them fixed and found
a further set of copy and data inconsistencies, also fixed.

Screens 065 and 090 were built last and reviewed the same way (`065-counter-offer-desktop.png`,
`090-approval-history-desktop.png`, both captured in the pinned Playwright image). That review
found the approval history inferring a rule version it had no record of, a median time of
"0 min" over an empty result, a dead "Escalated" option in the decision filter, and an empty-state
sentence whose advice did not clear the filter that caused it; all were fixed. On 065 it found a
negative amount passing validation and invalid input silently reading as "nothing changed".

## Scope notes

- Screen 090 ships without rule versions per decision: routing does not consult the rules engine
  yet, so nothing records which rule versions shaped a route. The service used to infer `R-12 v3`
  from the amount; that guess is gone rather than shown as evidence. Export, sorting, a decision
  drawer, a date-range filter and filters in the address are listed as open in the screen spec.
- Migrations `0008_p7_rules_workflows.sql` and `0009_p7_policy_configs.sql` are new here. The
  sibling Wave 3 branches each add their own `0008_*`; the integrator renumbers on merge rather
  than any branch renumbering the others.
