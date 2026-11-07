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

## Baselines

**No baseline was re-recorded to fix the red build.** The 16 failures are gone with the baselines
untouched, which is the proof that they were right all along: they encode the seeded state, and
they pass from a clean seed. Re-recording any of them would have frozen whichever variant the
clock happened to produce.

Eleven `080e` baselines were nevertheless stale against today's rendering, and would have sat
waiting for whoever next touched the screen. The headroom report put exact numbers on them — 59%
to 99% of their allowance — so ten were cleared here after comparing each image against the
current rendering:

| States                                                    | Differs in                                                                                                                                                                                                                       | Re-recorded |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| nine `080e` states, desktop and tablet                    | x 16–40 only: the navigation rail gained an item in `11ea17e`, pushing the rest down one slot. Page content pixel-identical either side.                                                                                         | yes         |
| `080e-period-close-break-glass request-dialog › mobile`   | x 88–339, inside the dialog: the warning banner's text re-rendered with lighter antialiasing under the box-sizing reset. Same sentence, same line breaks, same position; the page behind the dialog is identical at zero offset. | yes         |
| `080e-period-close-checklist acknowledge-dialog › mobile` | the page _behind_ the dialog, which is the same content shifted sideways by exactly 97px                                                                                                                                         | **no**      |

That last one is left on `main`'s bytes deliberately. The checklist table scrolls further right to
bring the acknowledge button into view on a phone, and the full-page shot keeps the offset — a
scroll position, not a rendering, and freezing one into a baseline is the mistake #70 was about.
The right fix is to pin the horizontal offset the way `scrollTop` pins the vertical one, which
means changing an action ten other states depend on, so it is its own piece of work. The headroom
report names it at 95% so it does not get lost.

## What was NOT done, and why

- **The box-sizing reset was not touched.** It is correct and these screens do not depend on it:
  the `080e` desktop and mobile baselines pre-date it (`44aa29f`) and still match today.
- **No local `box-sizing` / `width` / `padding` workaround was found to remove.** The close feature
  declares no `box-sizing` at all; `close.scss` and `dialogs.scss` carry only ordinary spacing, and
  `width: '560px'` in the page components is `MatDialog` configuration, not CSS. The desktop and
  mobile `080e` baselines matching today, unchanged since before the reset, is the direct evidence
  that nothing on these screens is over-correcting on top of it.

## Issue #74: `050-event-approval-workflow default › mobile`

Cheap to stabilise, so it was fixed here. The ticket reads it as the "Confirm funding" action
missing on first render; it is not. The page snapshot Playwright saved with the failure has every
action in the DOM, and the failing image is the baseline **shifted up by exactly 64 pixels with
zero differing pixels** at that offset.

What varies is the scroll position. The state clicks the Activity tab, which sits below the fold
on a phone, so Playwright scrolls the shell's content box to reach it and the full-page shot keeps
the offset. `scrollTop` — already in the spec for exactly this, and used by ten other states — now
runs as the state's last action. The three re-recorded baselines are also a better picture of the
screen: they start at the event title, status and action bar rather than halfway down.

Flaky once in two full runs before the change; 5 of 5 clean runs of the state after it, then clean
in both full verification runs below.

Only the mobile baseline moves for the scroll (259px). Re-recording picked up the same navigation
rail staleness as the `080e` set in the desktop and tablet ones: their whole difference against
`main` is x 16–40, y 174–622.

## Verification

Both runs: full `visual-light` project, no `-g` filter, each from a fresh stack and a fresh
deterministic seed, in the pinned image.

| Run | Result                            |
| --- | --------------------------------- |
| 1   | **629 passed**, 0 failed, 0 flaky |
| 2   | **629 passed**, 0 failed, 0 flaky |

Identical across both. `011a-ai-assistant-panel action-redirect › tablet` (issue #70) passes in
both. `scripts/gate.sh static --affected` passes — see `gate-static-summary.txt`.

## Near-threshold reporting

`npm run visual:headroom` runs the same visual project with the allowance set to zero, so
Playwright's own comparator reports an exact pixel count for every state that differs at all — not
only the ones that differ too much. The reporter divides each count by the real allowance and lists
anything using 70% or more of it, to the console and to `tmp/visual-headroom/report.md`.

It is informational by construction: a separate command, never part of `scripts/gate.sh`, exit code
discarded, gate allowance and threshold unchanged. States that match their baseline exactly pass
immediately and cost nothing, so the measurement only spends time where there is something to
measure.
