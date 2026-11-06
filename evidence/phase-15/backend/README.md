# Phase 15 — extended product features, backend half

Scope: what-if reallocation scenarios (031a), auto-drafted leadership summaries and variance
commentary (011b), outcome linkage (015c), participation rankings (122a), wellbeing and learning
wallets (120b), recognition awards (120a) and organizer recognition (122b). No Angular screens,
journeys or visual baselines — a frontend agent builds those.

Local stack: compose project `bf-p15` (API on 3250, Keycloak on 8330, Postgres on 5682), deterministic
seed, fake AI provider.

## Outcomes proved on the running product

| #   | Business outcome                                                                                                                                               | Proof                                                                                                                 | Result |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Modelling a reduction, a freeze and a set-to-zero across a tree leaves every bucket, every status and every pending request exactly as they were               | `functional/api-scenarios.txt` (scenarios 1-2), `db/scenarios.txt` (`ledger_lines_referencing_a_scenario = 0`)        | Pass   |
| 2   | A cut below the floor is reported with the same floor and maximum the real preview reports, and promotion is refused until it is fixed                         | `functional/api-scenarios.txt` (scenario 2, and scenario 10 comparing with `POST /api/budgets/{id}/controls/preview`) | Pass   |
| 3   | Promotion applies the real control commands — the budget is reduced and frozen, with one audit entry per action plus one for the promotion                     | `functional/api-scenarios.txt` (scenario 3), `db/scenarios.txt` (applied changes carry the reduction journal)         | Pass   |
| 4   | A promoter who cannot freeze a budget by hand cannot freeze it through a scenario, and nothing is applied                                                      | `functional/api-scenarios.txt` (scenario 4: 403 through the scenario and 403 by hand, buckets unchanged)              | Pass   |
| 5   | A scenario is invisible to anyone outside its author and collaborators until it is promoted                                                                    | `functional/api-scenarios.txt` (scenario 5: collaborator 200, uninvited CEO 404 and absent from the list)             | Pass   |
| 6   | A ledger write since the baseline blocks promotion until the author recalculates                                                                               | `functional/api-scenarios.txt` (scenario 6), `api/scenario-impact.json` (`stale: true` with the write count)          | Pass   |
| 7   | Every figure in a drafted summary is a reference to a read-model value with its source; the model writes only the words around them                            | `functional/api-scenarios.txt` (narratives 1)                                                                         | Pass   |
| 8   | A summary cannot be approved until its author has read every section, and an approved summary is immutable                                                     | `functional/api-scenarios.txt` (narratives 2)                                                                         | Pass   |
| 9   | An open-period draft is labelled and can never be approved                                                                                                     | `functional/api-scenarios.txt` (narratives 3)                                                                         | Pass   |
| 10  | An owner's variance commentary cannot be submitted while an `[Explain]` note stands in for a reason the data does not give                                     | `functional/api-scenarios.txt` (narratives 6-7)                                                                       | Pass   |
| 11  | Outcome figures carry their group size and are dropped below five responses or ten people; no response, person or employment record is returned                | `functional/api-scenarios.txt` (outcomes 1-3)                                                                         | Pass   |
| 12  | A region-scoped role sees pulse and eNPS but no retention cohorts                                                                                              | `functional/api-scenarios.txt` (outcomes 4)                                                                           | Pass   |
| 13  | The participation ranking contains no money field at all and ranks only groups of at least five                                                                | `functional/api-scenarios.txt` (outcomes 6-8)                                                                         | Pass   |
| 14  | A wallet claim pre-encumbers, approval encumbers, payment becomes an actual and a return releases it, to the minor unit                                        | `functional/api-scenarios.txt` (wallets 1-2), `db/wallet-claim-postings.txt`                                          | Pass   |
| 15  | An allowance larger than the budget behind it is still stopped by the budget, and a frozen programme budget refuses new claims while claims in flight complete | `functional/api-scenarios.txt` (wallets 4-5)                                                                          | Pass   |
| 16  | A monetary recognition award is a commitment on the Recognition budget; a thank-you note is not                                                                | `functional/api-scenarios.txt` (recognition 1, 5-6)                                                                   | Pass   |
| 17  | A peer award needs a second person, and neither the giver nor the recipient can be that person                                                                 | `functional/api-scenarios.txt` (recognition 7)                                                                        | Pass   |
| 18  | A manager cannot give beyond their quarterly allowance, and cannot give at all without one                                                                     | `functional/api-scenarios.txt` (recognition 9-10)                                                                     | Pass   |
| 19  | Every new table enforces tenant isolation                                                                                                                      | `db/rls.txt` (12 tables: RLS enabled, forced, `tenant_isolation` present)                                             | Pass   |

47 API scenarios, all passing. The full `apps/api-e2e` suite (554 scenarios) passes on the same stack,
which is how the one Phase 13 assertion that hard-coded the number of AI features was found and fixed.

## Files

- `functional/api-scenarios.txt` — the Phase 15 suite as it ran.
- `api/scenario-impact.json` — a scenario impact response for the seeded draft, showing the stale
  baseline, the per-change floors and the fairness rows.
- `db/rls.txt` — row level security state for all twelve new tables.
- `db/scenarios.txt` — scenarios and their changes with promotion state, and the count of ledger lines
  reachable from a change that was never applied (zero).
- `db/wallet-claim-postings.txt` — the ledger lines behind wallet claims: pre-encumbered on submit,
  pre-encumbered reversed and encumbered on approval, released on return.

## Visual baselines

This half adds no screen, but screen 113a (AI settings and query log) renders one row per AI feature
in its feature list and turn-on dialog, so adding `leadership_summary` and `variance_commentary`
moved six of its baselines. They were re-recorded with `npm run e2e:update-snapshots` in the pinned
Playwright image against a freshly reset seed, and the whole `visual-light` project then passed at
629 screenshots. No other screen moved.

One lesson worth leaving here: the first local visual run compared against the wrong stack, because
`scripts/visual/pw-docker.sh` forwards only `BASE_URL` and `BF_E2E_*` into the container, so the
ports came from `.env` (defaults) and the browser reached another worktree's stack on 4200. A
worktree that runs visual checks has to put its ports in `.env`, not only in the shell. The second
attempt then failed on budget dashboards because the API scenarios had already posted money into the
stack; the baselines are only meaningful after `scripts/stack.sh reset`.

## Known gaps

- Red-flag analytics (017b) is not built: it needs approval open and decision timestamps that
  `approval_tasks` does not record yet.
- The remaining Phase 15 screens — event planning copilot (045b), holiday overlay (043a), polls and
  idea board (044a), QR check-in (047c), remote participation (047d), withholding tax (080i) — are
  not in this half.
- Cost per attendee on the outcomes view is returned as null; it belongs to the ledger-backed event
  spending report (085) and is not recomputed here.
- Two deliberate deviations from the screen specs are described in
  `docs/architecture/phase-handoff.md` (a manager allowance is a cap rather than one commitment, and
  a paying programme needs budget authority rather than administration rights).
