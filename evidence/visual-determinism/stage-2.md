# Stage 2 of the clock fix: one definition of today

Issue #86. Stage 1 (PR #89) pinned the two definitions behind the two drifting baselines and left
the API half-pinned. Stage 2 removes the other 31 copies of `new Date().toISOString().slice(0, 10)`
from `libs/api`, so every server-computed date reads `libs/api/core/src/lib/clock.ts`. Scope as
planned: [`stage-2-scope.md`](stage-2-scope.md).

## Decision on record: pinning test-time as-of dates is the point

Taken 2026-11-09. Under a pinned clock every server "today" — as-of dates on health, board pack,
outlook, budget views, rule simulation, the activity window, forecast cycle due states — becomes the
date of `freezeTime`. That is the fix, not a side effect: a narrower change would leave those dates
moving with the wall clock and the drift would return. In production nothing changes, because
`FIXED_NOW` is unset there.

**Correction to the earlier record.** PR #89 was described as narrow, and was not quite: it re-pointed
`reports.service.ts`, whose `todayUtc()` is passed to `reads.dataset(...)` (line 65), so the as-of
date of every report moved to the pinned date under test — not only the 086 countdown. Only six
states rendered differently, which is why it went unnoticed. The instruction to narrow the pin was
conditional on the 513 collapsing, which it did not, and is superseded by the decision above.

## What changed

| Shape                                      | Count | Treatment                                                         |
| ------------------------------------------ | ----- | ----------------------------------------------------------------- |
| `export const todayUtc` in eight modules   | 8     | Re-export of the core clock, so callers keep their import         |
| Module-local helpers (`todayIso`, `today`) | 6     | Deleted; call sites renamed to `todayUtc()`                       |
| Inline at the call site                    | 17    | `todayUtc()`; `core/actor.ts` imports its sibling, not the barrel |

Every site was read before it was changed; all want the same thing. A filename or an audit resource
id built from the date still uses real time in production, and two exports on one real day already
shared both, so pinning adds no collision.

`grep -rn "new Date().toISOString().slice(0, 10)" libs/api --include="*.ts"` now returns nothing —
**but that is a statement about one spelling, not about the class.** An earlier version of this page
said "zero copies remain", which was too strong: the grep matched only the literal `new Date()` form.
Widening it to `toISOString().slice(0, 10)` with any argument finds two more sites that take "today"
from the wall clock, and a third clock question that no grep for date strings can find:

| Site                                 | What it compares                                                | Treatment                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channels.service.ts` `deriveTasks`  | a task's `dueAt` against `Date.now()` for overdue and due-today | **Left on real time.** `dueAt` is itself `Date.now()` + 48 hours at routing, so real against real is stable; pinning only one side would make every seeded task overdue |
| `user-admin.service.ts` deactivation | sets a leaver's end date to yesterday                           | **Re-pointed.** The end date is compared with `todayUtc` elsewhere, which is now pinned                                                                                 |

The rule is the one 2.2 step 1 settled for the seed: a date follows whichever clock it is compared
against. Instant-level `Date.now()` comparisons — SLA timers, security expiry, ages — are not covered
by this change and are deliberately left on real time where their other side is real time too.

## What the money paths did — the risk that did not materialise

Two of the copies feed the **accounting date** of allocations and intercompany postings. Pinning dates
those journals 16 November, and the seed places closed and locked periods in November 2026, so a
closed-period rejection (`BF002`) was the expected failure. It did not happen: 16 November falls in an
open period for the entities those paths post to. No startup check was added — a closed-period
rejection is loud and specific, and a boot-time per-entity check would need database access during
startup for a dev-only guard. **Constraint for whoever changes `freezeTime`: it must fall in an open
accounting period for the seeded entities, or postings will be refused.**

## Scenarios

`apps/api-e2e/src/support/clock.ts` resolves the same instant the stack is on, from `freezeTime` in
`screens.json` — the file `scripts/stack.sh` derives `FIXED_NOW` from, so there is still one source.
The test process does not inherit the stack's environment, which is why it reads the file.

- `approvals/hygiene.spec.ts` — **needed it.** It created a delegation valid today-to-today on the
  real clock, which is not in force on the API's today, so two scenarios failed looking like a broken
  delegation-of-authority rule.
- `extended/wallets.spec.ts`, `extended/recognition.spec.ts` — passed either way, because 9 and
  16 November fall in one quarter and the claim date is never checked against today. Re-pointed so
  they stop passing by coincidence of the calendar.

## Baselines this moves: two screens, both time bombs on the real clock

The full visual suite failed 14 states on two screens, each with identical pixel counts on both
attempts — deterministic, not flaky. Both were inspected by eye, and both are the as-of decision
working as intended. More usefully, **both would have gone red on their own on the real clock within
days**, on screens nobody had flagged:

| Screen                          | What moved                                                                                                                                                                                                     | Would have broken on its own |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `087a-forecast-cycles`          | The October reforecast is due 12 Nov 2026. On the pinned 16 Nov it is overdue, so the page gains "11 lines are overdue" and shifts down                                                                        | 13 November                  |
| `122-personal-activity-history` | A seeded entry dated 2026-11-10 enters the default window (to = today): 6 entries with `to=2026-11-09`, 7 with `to=2026-11-16`, measured through `GET /api/me/activity`. Its longer text re-widens the columns | 10 November                  |

`122`'s old baseline also carried the stale navigation rail, part of the 513 in
[`../../docs/handoff.md`](../../docs/handoff.md) section 2.2, so recording it corrects that too.

Recorded with `--update-snapshots=all` scoped to these two screens, so states of theirs that differ
within their allowance are corrected rather than left wrong-but-green. Every other baseline is left for
the single project-wide re-record in 2.2 step 2.

## Checks

| Check                                  | Result                                        |
| -------------------------------------- | --------------------------------------------- |
| `scripts/gate.sh functional-api`       | PASS                                          |
| `scripts/gate.sh functional-e2e`       | PASS                                          |
| Typecheck and lint, 17 touched modules | PASS, 0 errors                                |
| Full visual suite before recording     | 14 failed, 774 passed — the two screens above |

## Revocation would have kept access once real time passed `freezeTime`

`user-admin.service.ts` ends a revoked role grant on "yesterday", because `valid_to` is inclusive.
It took yesterday from the wall clock, while `ActorResolver` compares `valid_to` with the pinned
`todayUtc`. From the real date of 17 November, real yesterday is on or after the pinned 16 November,
so a revoked role would stay in force under test. The existing revocation scenario would stay green
through it, because it asserts only `revoked: true`, not that the role stopped applying.

Proven on one build with the stack pinned to 5 November, which reproduces the condition today:

| `valid_to` on the revoked grant         | Active roles                |
| --------------------------------------- | --------------------------- |
| `2026-11-04` (fixed code: pinned − 1)   | `employee`                  |
| `2026-11-08` (old code: real yesterday) | `employee, event-organizer` |
| restored to `2026-11-04`                | `employee`                  |

## The CI-only failure of `123`, and the seed race behind it

After the baselines above were recorded, CI failed `123-notifications-tasks default › tablet` by 4215
pixels on both attempts while the same commit passed every state locally, twice. CI's own images
(the run's `visual-report` artifact) split the difference into the stale rail and one row: REQ-00004
was "Delivered via in-app, email" in CI and "in-app, email, slack, push" locally.

A channel delivery decides its channels from the database at the moment the job runs — slack only if
the install and the person's chat link exist, push only if a subscription does. The seed writes
requests before those channel rows, and the worker ran alongside it, so how many requests were
delivered before the channel rows landed depended on the speed of the machine. CI's settle step
reported "settled after 2s", correctly: every job had finished, against a seed that had not.

`scripts/stack.sh` now stops the worker while the seed runs and starts it, waiting for healthy,
afterwards. After a reseed every seeded request notification is delivered on in-app, email, slack and
push. This is the other half of the race the settle step was written for: settle covers fan-out
that has not finished; this covers fan-out that finished too early. `123` was re-recorded as
collateral on 7 November (#69), which would have frozen whichever interleaving that machine produced.

Verified with `scripts/gate.sh functional-api functional-e2e visual`, all PASS. The visual run had one
flaky state, `090-approval-history default › desktop`: a readiness timeout whose saved screenshot is a
single colour, passing on retry — issue #82's blank render, a different state each run, unrelated.
