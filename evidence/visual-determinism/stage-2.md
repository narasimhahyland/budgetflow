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

`grep -rn "new Date().toISOString().slice(0, 10)" libs/api --include="*.ts"` now returns nothing.

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
