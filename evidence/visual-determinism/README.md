# Issue #86: the server and the browser now agree about "now"

Stage 1 of the clock work. What the change is and why it was needed is in
[`086-root-cause.md`](086-root-cause.md); what is deliberately left for a second pull request is in
[`stage-2-scope.md`](stage-2-scope.md). This file is the proof.

Branch `fix/086-calendar-drift`, measured on 2026-11-08 against this checkout's Compose stack with
the deterministic seed.

## Outcome table

| Outcome                                                 | How it was proven                                                                                              | Result                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| The API's "now" follows `FIXED_NOW`, not the wall clock | Restarted the stack with the value set four ways and read both figures back through the API                    | Pass — table below                                     |
| `FIXED_NOW` unset leaves the product on real time       | Same, with `BF_FIXED_NOW=real` (Compose passes an empty string)                                                | Pass — 2 overdue, 53 days, no warning                  |
| An unset value does not stop the API booting            | `BF_FIXED_NOW=real` restart; previously died with `Invalid configuration: FIXED_NOW: Invalid ISO datetime`     | Pass — fixed in this branch                            |
| A pinned stack says so in its own logs                  | `docker logs` after restart, and `scripts/stack.sh urls`                                                       | Pass — `Clock pinned: now is 2026-11-16T09:00:00.000Z` |
| The browser and the server read one value               | `scripts/stack.sh` derives `FIXED_NOW` from `freezeTime` in `apps/web-e2e/visual/screens.json`; no second copy | Pass — by construction                                 |
| The two drifting states render the corrected figures    | Opened all six regenerated images; before and after kept in `baseline-review/`                                 | Pass — `046b` 1→4 overdue, `086` 54→45 days            |
| Nothing else in the suite moves                         | Zero-allowance run with the clock pinned and again with it real, reports diffed state by state                 | Pass — exactly 6 states change                         |
| The whole visual project is green                       | Full `visual-light` run, 788 tests, no grep                                                                    | Pass — `visual-run.txt`                                |
| Static gates pass                                       | `scripts/gate.sh static --affected`                                                                            | Pass — `gate-summary.txt`, 8 of 8                      |

## The clock is the only thing that moves the figures

Same seed, same data, only `FIXED_NOW` differs.

| Clock                         | `046b` `overdueTasks`      | `086` `daysLeft` | Startup warning |
| ----------------------------- | -------------------------- | ---------------- | --------------- |
| real time (2026-11-08)        | 2 (10-30, 11-06)           | 53               | none            |
| pinned `2026-11-16T09:00:00Z` | 4 (10-30, 11-06, 11-13 ×2) | 45               | logged          |
| pinned `2026-11-13T09:00:00Z` | 2                          | 48               | logged          |
| pinned `2026-11-14T09:00:00Z` | 4                          | 47               | logged          |

The 13th and 14th bracket the next turnover, which is how the fuse was dated: the flag is
`dueDate < today`, so a task goes overdue the **day after** its due date. That is why the answer is
14 November and not the 13th, and why the task due 10 November never turns over at all — it is
seeded `done`.

## Scope of the change, measured rather than asserted

A zero-allowance run (`npm run visual:headroom`) with the clock pinned and again with it real
returned **the same totals both ways — 275 states exact, 513 differing, ~199 at 70% or more of
allowance**. Diffing the two reports state by state, exactly six rows change their pixel count, and
they are the two screens at three viewports:

| State                                   | Real clock | Pinned |
| --------------------------------------- | ---------- | ------ |
| `046b-checklist-tasks-agenda` › mobile  | 446        | 3979   |
| `046b-checklist-tasks-agenda` › tablet  | 992        | 1851   |
| `046b-checklist-tasks-agenda` › desktop | 1892       | 2710   |
| `086-unused-expired` › desktop          | 1840       | 2346   |
| `086-unused-expired` › tablet           | 1364       | 1819   |
| `086-unused-expired` › mobile           | 48         | 114    |

So re-pointing `reports.service.ts` does **not** move any other report's rendering, which was the
risk worth checking before merging: `today` is threaded into `reads.dataset(...)`, and had it shifted
every report's as-of date this table would be far longer.

The 513 differing states are **not** caused by this change — the figure is identical with the clock
off. They are the navigation rail: expected and actual are pixel-identical in the content area and
differ only in the rail, which now carries 65 entries. Recorded in `docs/handoff.md` section 2.2.

## The baselines, and why they moved

Recorded with `--update-snapshots=all` behind a `--grep` limited to these two screens, with the
clock pinned and on a freshly reseeded stack. Exactly six files change; the 38 deliberately
held-back stale-rail baselines are untouched.

`--update-snapshots=all` matters. The bare flag rewrites only states that **breach** their
allowance, which here was two of the six — it would have left the other four wrong-but-green. Anyone
fixing a drift class with the bare flag fixes the red states and leaves the quietly wrong ones in
place, which is one of the ways 513 accumulated.

Each image was opened and read, because a green diff proves nothing when the baseline itself is the
defect:

- **`046b` default** — "1 of 11 tasks done · 1 overdue" becomes "4 overdue", with Overdue chips on
  the tasks due 30 Oct, 6 Nov and both due 13 Nov. The task due 10 Nov stays ticked, labelled
  "Invitations sent to 9 people", with no chip. Nothing else on the page changes.
- **`086` default** — "Days left in the fiscal year" 54 becomes 45 and the `Days left` column
  follows on all 11 rows. Every money figure, the row count and the reconciliation line are
  unchanged.

The old `046b` baseline showed **1** overdue, so it was already two days of drift stale before this
branch existed — it was recorded when only the 30 October task had turned over.

These six also pick up the current 65-entry rail, so they now differ from the ~507 states still
carrying an older one. Those are the stale ones, not these.

## What this does not do

Stage 1 leaves the system **half-pinned**: the event plan and the reports read `FIXED_NOW`, the
other 31 copies of the `today` one-liner still read real time. That is fine for this issue and wrong
as an end state. [`stage-2-scope.md`](stage-2-scope.md) lists every remaining site, the three API
scenarios that currently agree with the real clock only because their services were left alone, and
the 87 SQL `now()` calls that are a second way for the system to disagree with itself.

## Files

| File                 | What it holds                                                             |
| -------------------- | ------------------------------------------------------------------------- |
| `086-root-cause.md`  | The mechanism, traced to file and line, and the turnover calendar         |
| `stage-2-scope.md`   | The 31 remaining sites and what else belongs in the follow-up             |
| `headroom-before.md` | The 7 November zero-allowance reading, recovered from an abandoned branch |
| `gate-summary.txt`   | `scripts/gate.sh static --affected`, 8 of 8                               |
| `visual-run.txt`     | The full `visual-light` run, 788 tests                                    |
| `baseline-review/`   | Before and after for the two desktop states, to be read side by side      |
