# Fix 080e-period-close visual failures (issue #73)

## What was actually wrong

Not a layout regression, not stale baselines, and not a flake in the usual sense: a scheduled
background job changing the data the screen renders, part way through the suite.

`080e` is the only screen group whose content reads `integrity_check_runs`. Both
`ledger_check_clean` and `audit_chain_verified` in `libs/api/close/src/lib/period-close-checks.ts`
take the tenant's latest `ledger_rebuild` row:

```
.where(eq(integrityCheckRuns.kind, 'ledger_rebuild'))
.orderBy(desc(integrityCheckRuns.requestedAt))
.limit(1)
```

With no row they fail — "No ledger rebuild check has run yet" and "No check has verified the audit
chain yet" — and the period shows **10** blocking checks. That is the seeded state every 080e
baseline encodes. As soon as one row exists, three things change at once: the banner says **8**
checks, "Audit chain verified" turns green with a running count of audit entries (80 locally, 81 in
CI — the count drifts with how many audit entries exist when the rebuild runs), and "Nightly ledger
check clean" reports the seeded open integrity flag instead.

The worker registers that rebuild on a wall clock: `NIGHTLY_LEDGER_CHECK_CRON`, default
`0 2 * * *` UTC (`apps/worker/src/app/jobs.service.ts`). A stack that is alive across 02:00 UTC
gets a rebuild row mid-suite.

## Why it looked deterministic to one agent and nondeterministic to another

Both were right about what they saw. Inside one run it is perfectly deterministic — once the
schedule has fired, every attempt sees the same row, which is why both attempts produced a
byte-identical actual. Across runs it depends only on the clock.

| CI run      | commit  | visual step (UTC)   | crosses 02:00 | result             |
| ----------- | ------- | ------------------- | ------------- | ------------------ |
| 42326322339 | 3a88cf9 | 01:53:01 → 02:04:21 | yes           | 16 × `080e` failed |
| 42330544230 | 5d129ae | 02:42:34 → 02:55:23 | no            | green              |

Same baselines, same screens, opposite outcome.

Which 8 of the 24 `080e` states kept passing is itself the proof: `080e-period-close` (the period
list) and its `forbidden` state never render the checklist, and the two dialogs at mobile cover the
page behind them. Every state that shows the blocking banner or the checklist failed.

## Local reproduction

Stack `bf-fix080e` (ports 4480/3280/8360/5712/8305/9280), deterministic seed, pinned Playwright
image.

| Condition                                     | Result                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Fresh seed, `integrity_check_runs` = 0        | 24 of 24 `080e` states pass (repeated — see `080e-repeat-runs.txt`)                           |
| After one `POST /api/integrity/ledger-checks` | 17 of 24 fail, with the CI diff: banner 10 → 8 checks, `Audit chain verified` Failed → Passed |

`080e-blocked-desktop-expected-vs-actual.md` has the two renderings side by side.

## The fix

`off` now means "do not register this schedule", and the local Compose stack sets it for all four
wall-clock sweeps (nightly ledger rebuild, SLA sweep, report sweep, retention sweep). A suite
freezes the browser clock and asserts exact rendered state, so nothing should fire under it.

Nothing is lost. Every scenario that needs this work already drives it through its API — the close
scenarios call `/api/integrity/ledger-checks` (`apps/api-e2e/src/close/support.ts`),
`workflows-authority.spec.ts` posts `/api/approvals/sla-sweep`, retention posts
`/api/admin/retention/runs`, and the report schedule scenario uses "run now" — which is the only
way to time it.

## What was NOT done, and why

- **No baseline was re-recorded.** The baselines are right: they encode the seeded state, and they
  pass from a clean seed. Re-recording would have frozen whichever variant the clock produced.
- **The box-sizing reset was not touched.** It is correct and these screens do not depend on it:
  the `080e` desktop and mobile baselines pre-date it (`44aa29f`) and still match today.
- **No local `box-sizing` / `width` / `padding` workaround was found to remove.** The close feature
  declares no `box-sizing` at all; `close.scss` and `dialogs.scss` carry only ordinary spacing, and
  `width: '560px'` in the page components is `MatDialog` configuration, not CSS. The desktop and
  mobile `080e` baselines matching today, unchanged since before the reset, is the direct evidence
  that nothing on these screens is over-correcting on top of it.

## Near-threshold reporting

`npm run visual:headroom` runs the same visual project with the allowance set to zero, so
Playwright's own comparator reports an exact pixel count for every state that differs at all — not
only the ones that differ too much. The reporter divides each count by the real allowance and lists
anything using 70% or more of it, to the console and to `tmp/visual-headroom/report.md`.

It is informational by construction: a separate command, never part of `scripts/gate.sh`, exit code
discarded, gate allowance and threshold unchanged. States that match their baseline exactly pass
immediately and cost nothing, so the measurement only spends time where there is something to
measure.
