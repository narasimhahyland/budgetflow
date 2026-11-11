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

## Acceptance: run A (10 November UTC) against run B (11 November UTC)

Same code (`1dea89f5`, which differs from run A's `390e988f` only in `evidence/`), each from a fresh
seed. Run B's log and Postgres both report 11 November.

|                                                           | States                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Differ between A and B                                    | 66                                                                                  |
| Of those, also moved between runs on one UTC date (noise) | 48                                                                                  |
| **Move only across the date change**                      | **18** ([`still-date-dependent-after-fix.txt`](still-date-dependent-after-fix.txt)) |
| Of the 123 that drifted on `main`, still moving           | **7**                                                                               |
| Of the 123, no longer moving                              | **116**                                                                             |

The noise set is the union of A against A2 and A against
[`2026-11-10-late-fixed-same-utc-date.tsv`](2026-11-10-late-fixed-same-utc-date.tsv): a run 14 hours
after A that turned out to be on the same UTC date. The stack works in UTC, so a run after midnight
local time but before midnight UTC is not a different date. That run is kept as noise data, not
counted as acceptance.

Of the 18, two had an identifiable wall-clock read behind them, both fixed in the commit that adds
this file:

- `066-rules-overview`: the week buckets' end dates read `Date.now()` while the window's start and the
  seeded evaluation times were pinned, so the week labels still moved.
- `092c-assistant-connector`: "calls in the last week" counted against `Date.now()`; seeded calls are
  pinned, so they would have dropped out of the window from 23 November.

The other 16 are small (most under 80 pixels) and have no wall-clock read found behind them. Two
same-day runs underestimate noise, so they are more likely noise than drift, but that is not proven.
A run on 12 November UTC against this commit settles both points.
