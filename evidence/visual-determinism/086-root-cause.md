# Issue #86 traced: the server and the browser disagree about "now"

Investigation only — no fix in this commit. Every claim below names the file and line it came from,
read at `origin/main` `42eb3dd`.

## The mechanism

`apps/web-e2e/visual/screens.json` sets `freezeTime` to `2026-11-16T09:00:00Z`, applied with
`page.clock.setFixedTime`. That freezes the **browser** clock. Nothing freezes the API, so every
figure the server computes from its own clock keeps moving while the baseline stands still.

Seeded dates are not the problem — they are fixed literals and deterministic. The drift is entirely
in the comparison against a moving `now()`.

### `046b-checklist-tasks-agenda`

Checklist due dates are seeded as **offsets from the event start**, not as absolute dates:

- `libs/seed/src/lib/events.ts:64` — the Diwali event starts `2026-11-20T05:00:00.000Z`
- `libs/seed/src/lib/events-depth.ts:97-107` — tasks carry `relativeDueDays`
- `libs/api/events/src/lib/depth/templates.service.ts:534` — resolved as `shiftDay(startsAt, n)`

So the due dates are fixed, and the Overdue flag is a comparison against the real date:

- `libs/api/events/src/lib/depth/event-plan.service.ts:23` — `const todayIso = () => new Date().toISOString().slice(0, 10)`
- `libs/api/events/src/lib/depth/event-plan.service.ts:47` — `overdue: t.status !== 'done' && t.dueDate !== null && t.dueDate < today`
- `libs/api/events/src/lib/depth/event-plan.service.ts:121` — `overdueTasks: views.filter((t) => t.overdue).length`

Resolving the offsets against the `2026-11-20` start gives the turnover calendar. The flag is
`dueDate < today`, so a task goes overdue the **day after** its due date, and a task already `done`
never does — which the seed's system tasks are, because they tick themselves when the linked work
happens. Both details move the answer, so the table below is read from the running API
(`GET /api/events/.../plan` as `event.organizer`) rather than worked out on paper:

| Offset | Due date   | Task                                          | Seeded status | Goes overdue   |
| ------ | ---------- | --------------------------------------------- | ------------- | -------------- |
| `-21`  | 2026-10-30 | Confirm the venue booking                     | open          | fired, 10-31   |
| `-14`  | 2026-11-06 | Choose a caterer                              | open          | fired, 11-07   |
| `-10`  | 2026-11-10 | Send invitations                              | **done**      | **never**      |
| `-7`   | 2026-11-13 | Book the photographer; Order decorations      | open          | **2026-11-14** |
| `-2`   | 2026-11-18 | Share the dietary counts with the caterer     | open          | 2026-11-19     |
| `0`    | 2026-11-20 | Set up the registration desk; Mark attendance | open, done    | 2026-11-21     |

The `-14` turnover on 7 November is the one that already fired and was re-recorded as collateral by
PR #69.

**The next turnover is 14 November, and it moves the count by two at once** — the two `-7` tasks
share a due date. Measured by pinning the clock either side of it:

| Clock pinned to | `overdueTasks` |
| --------------- | -------------- |
| `2026-11-13`    | 2              |
| `2026-11-14`    | **4**          |

The 10 November date this note first carried was wrong: that task is seeded `done`, so it cannot go
overdue at all.

### `086-unused-expired`

The fiscal-year countdown is computed in TypeScript from a `today` string threaded in as a parameter:

- `libs/api/reports/src/lib/reports.service.ts:24` — `const todayUtc = () => new Date().toISOString().slice(0, 10)`
- `libs/api/reports/src/lib/report-reads.service.ts:159-162` — `const now = Date.parse(...)`, then
  `daysLeft = Math.max(Math.round((end - now) / day), 0)`
- `libs/api/reports/src/lib/report-builders.ts:677` — surfaced as the metric "Days left in the fiscal year"

`daysLeft` therefore falls by one every real day, and `elapsedBps` (line 168) moves with it, so the
progress figure drifts too.

## How close it is

From `headroom-before.md` in this folder, a zero-allowance run of the whole suite:

- `046b-checklist-tasks-agenda default › tablet` — **1697 of 1855 pixels, 91% of its allowance**

Two more Overdue rows are worth well over the 158 pixels left. The 14 November turnover is expected
to take it red, on `main` and on every open branch at once, with no code change involved.

## Why re-recording is the wrong fix

Re-recording resets the figure to that day's value and the next turnover repeats it. It has already
happened twice for these two states (#84, then while merging `main` into #80) and twice more for
`055-my-requests` and `123-notifications-tasks` (#69). Each pass makes the baseline describe the day
it was recorded rather than the product.

## There is no single definition of "today"

The one-liner `new Date().toISOString().slice(0, 10)` is copy-pasted **56 times** across the
repository. There is no clock abstraction anywhere in `libs/api` or `libs/domain`
(`grep -rn "ClockService\|provideClock\|TimeService"` returns nothing). The copies are:

| Where                     | Count | Shape                                                    |
| ------------------------- | ----- | -------------------------------------------------------- |
| `libs/api/*` exported     | 8     | `export const todayUtc` in 8 different modules           |
| `libs/api/*` module-local | 5     | `todayUtc` / `todayIso` / `today` as file consts         |
| `libs/api/*` inline       | ~19   | written out at the call site                             |
| `libs/web/features/*`     | 12    | `export const todayIso` in each feature's `api.ts`       |
| other                     | 12    | inline in web pages, `libs/api/core/src/lib/actor.ts:57` |

The two definitions that drive #86 are `event-plan.service.ts:23` and `reports.service.ts:24`.

Separately there are **87** SQL `now()` calls in `libs/api`. Neither of these two states goes through
one, but other drifting states may.

## The precedent that already exists

This repository has already solved the same class of problem the same way. All four wall-clock sweeps
are switched off by default through the Compose env allow-list
(`infra/compose.yaml:186-189`):

```yaml
NIGHTLY_LEDGER_CHECK_CRON: ${BF_NIGHTLY_LEDGER_CHECK_CRON:-off}
SLA_SWEEP_CRON: ${BF_SLA_SWEEP_CRON:-off}
REPORT_SWEEP_CRON: ${BF_REPORT_SWEEP_CRON:-off}
RETENTION_SWEEP_CRON: ${BF_RETENTION_SWEEP_CRON:-off}
```

That was the fix for "background jobs mutate data mid-screenshot". Pinning the clock the server reads
is the same mechanism applied to the same kind of nondeterminism.

`infra/compose.yaml` passes an explicit allow-list per service, not a `BF_*` pass-through, so a clock
override needs a line added to the `api` service's `environment:` block — which is why it is being
asked about rather than done.

## Masking, assessed

Masking was the first suggestion on #86. Neither state has a usable handle today:

- `046b` — the Overdue chip (`libs/web/features/events/src/lib/event-plan.page.ts:164`) and the
  "N overdue" count (line 122) carry no `data-testid`.
- `086` — the countdown is a generic numeric metric rendered by the shared report frame
  (`libs/web/features/reports/src/lib/report-frame.ts`), which emits no per-key `data-testid`. This
  is the "handle that does not exist" the handoff records.

So masking needs component changes in both places as well, it masks figures the two screens exist to
show, and it has to be repeated for each new drifting figure. It is not the cheaper option.

---

## Stage 1 verified against the running stack

Measured on 2026-11-08 on this checkout's stack, by restarting it with `BF_FIXED_NOW` set each way
and reading the two figures back through the API. Same seed, same data, only the clock differs.

| Clock                         | `046b` `overdueTasks`      | `086` `daysLeft` | Startup warning |
| ----------------------------- | -------------------------- | ---------------- | --------------- |
| real time (2026-11-08)        | 2 (10-30, 11-06)           | 53               | none            |
| pinned `2026-11-16T09:00:00Z` | 4 (10-30, 11-06, 11-13 ×2) | 45               | logged          |
| pinned `2026-11-13T09:00:00Z` | 2                          | 48               | logged          |
| pinned `2026-11-14T09:00:00Z` | 4                          | 47               | logged          |

Both figures now follow `FIXED_NOW` and nothing else, and `FIXED_NOW` comes from `freezeTime` in
`screens.json` — the same constant the browser clock is set from. The figures are therefore the same
on every future run, which is the property the baseline needs.

`stack.sh urls` reports which clock the stack is on, and the API logs
`Clock pinned: now is 2026-11-16T09:00:00.000Z` at startup.

### Two defects found while verifying, both fixed here

1. **An empty `FIXED_NOW` stopped the API from booting.** Compose passes
   `FIXED_NOW: ${BF_FIXED_NOW:-}`, which is an empty string when the variable is unset, and
   `z.iso.datetime().optional()` accepts `undefined` but not `''`. Any stack driven through Compose
   without `stack.sh` setting a value would have failed startup with
   `Invalid configuration: FIXED_NOW: Invalid ISO datetime`. The schema now treats empty as unset.
   This was only caught by running the real-clock case; the pinned path always sets a value and hid
   it.
2. **The pin warning never appeared.** The clock resolves lazily on first use, so a stack that had
   not yet served a date logged nothing. `apps/api/src/main.ts` now resolves it at startup.

### What this stage does not cover

Stage 1 re-points only the two definitions that drive #86, so the system is **half-pinned**: the
event plan and the reports read the frozen clock while every other copy of the one-liner still reads
real time. That is fine for this issue and wrong as an end state.

Consequences to carry into Stage 2:

- `generatedAt` on the report run is still real time
  (`libs/api/reports/src/lib/reports.service.ts`). It does not reach a baseline because
  `report.page.ts` renders it inside `data-testid="relative-time"`, which the global mask covers.
- Three API scenarios compute dates from the real clock —
  `apps/api-e2e/src/extended/wallets.spec.ts`, `apps/api-e2e/src/approvals/hygiene.spec.ts`,
  `apps/api-e2e/src/extended/recognition.spec.ts`. They still agree with the services they exercise
  only because those services were not re-pointed. They will need the pinned clock when Stage 2
  lands.
- The worker is not given `FIXED_NOW`. Its wall-clock sweeps are `off` by default, so nothing in a
  test run depends on its clock today.

### Expected baseline movement

Pinning does not preserve today's picture; it corrects the picture to the frozen date and then holds
it. So some baselines move once, deliberately: `046b` from 2 Overdue rows to 4, and `086` from 53
days left to 45. Those are recorded with this reason, after looking at the images, not re-recorded
silently — and after the move they stop depending on the date the run happened.
