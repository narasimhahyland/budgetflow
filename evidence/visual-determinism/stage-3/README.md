# Stage 3 of the clock fix: measurements so far

Status: **fix built and passing both functional suites; the cross-day acceptance run is still to do.**
Branch `fix/clock-stage-3`. Each `.tsv` is one zero-allowance visual run classified by
[`../rerecord/tools/railsplit.mjs`](../rerecord/tools/railsplit.mjs): one row per state that differs
from its baseline, with total, rail and content pixel counts.

| File                          | Run                                               |
| ----------------------------- | ------------------------------------------------- |
| `2026-11-09-main-run3.tsv`    | `main` (`b2141ae`), 9 Nov, quiet machine          |
| `2026-11-10-main-unfixed.tsv` | the same code, 10 Nov, its own worktree and stack |
| `2026-11-10-fixed-runA.tsv`   | this branch, 10 Nov                               |
| `2026-11-10-fixed-runA2.tsv`  | this branch, 10 Nov, a second time (noise)        |

- [`date-dependent-9-vs-10-nov.txt`](date-dependent-9-vs-10-nov.txt): 123 states, stable within each
  day on `main`, different between 9 and 10 November. This is the drift the fix must remove.
- [`noise-main-9-nov.txt`](noise-main-9-nov.txt) (87) and
  [`noise-fixed-A-vs-A2.txt`](noise-fixed-A-vs-A2.txt) (81): states that vary between same-day runs,
  so they cannot be judged by a cross-day comparison.

**Acceptance (still to run):** a run of this branch on a different real date (run B, 11 November).
Every state outside the noise sets must have the same numbers in A and B. Today cannot decide it: the
real date (10th) and the pinned date (16th) both have two-digit days, so a masked date that moved
from real to pinned renders at the same width either way.
