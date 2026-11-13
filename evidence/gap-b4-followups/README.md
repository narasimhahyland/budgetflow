# Gap B4 follow-ups: reclaim deadline reminders and a year-end entry point

These follow up on [gap B4](../gap-b4-reclaim/README.md). The 086a spec asks for reminders 2 days and 1 day before the
response deadline, and that part of B4 was not built. This change adds them, plus an entry to reclaim campaigns from
the year-end page. It ran on the local stack `bf-gap-b4` with the deterministic seed and the pinned clock (2026-11-16).

## What was built

- **Domain:** `reclaimReminderDue` in `libs/domain/src/lib/fiscal/reclaim.ts` decides which reminder is due on a day.
  - Two days before the deadline, the 2-day reminder is due.
  - One day before, the 1-day reminder is due.
  - On and after the deadline, nothing is due.
  - A reminder already sent is never due again.
- **Data:** migration `0028_b4_reclaim_reminders` adds the `reclaim_reminders` table, with forced RLS and a unique index
  per notice and kind.
- **Worker:**
  - Queue `reclaim.reminders` sends the reminders due on a given day. It skips answered notices, completed campaigns,
    and notices whose pool has already been posted.
  - A nightly schedule (`RECLAIM_REMINDER_CRON`) also exists and is off on the local stack.
  - Owners hear through the existing in-app and channel delivery plus email.
- **API:**
  - `POST /api/reclaim/reminder-runs` queues a run for a day (finance, `reclaim.manage`; one audit entry).
  - `ReclaimNotice.remindersSent` (additive) lists the reminders already sent.
- **Web:**
  - The campaign page adds "reminded 2 days / 1 day before" to unanswered rows.
  - The year-end page offers "Reclaim before year end" to finance.

## Outcome table

| Scenario                            | Expected                                     | Actual                                    | Result |
| ----------------------------------- | -------------------------------------------- | ----------------------------------------- | ------ |
| Who may run reminders               | an owner gets 403                            | 403 `FORBIDDEN`                           | pass   |
| Two days before                     | the 2-day reminder for the unanswered notice | `remindersSent: ['two_days']`             | pass   |
| Same day again, then one day before | no duplicate; the 1-day reminder added       | `['two_days', 'one_day']`                 | pass   |
| On the deadline                     | nothing more                                 | 2 `reclaim_reminders` rows for the notice | pass   |
| Owner who answered                  | none                                         | 0 rows, `remindersSent: []`               | pass   |
| Owner notified                      | one notification per reminder                | 2 `Reminder:` notifications               | pass   |
| Year-end entry (journey)            | the link opens the reclaim campaigns page    | as expected                               | pass   |

The run output is in [`functional/targeted-runs.txt`](functional/targeted-runs.txt). The earlier B4 scenarios
(campaigns, floors, pools, escalation, burn rate) still pass in the same run. The new invariant is row 121 in
[`docs/testing/invariant-scenarios.md`](../../docs/testing/invariant-scenarios.md).

## Gates

[`gate-summary.txt`](gate-summary.txt) is `scripts/gate.sh all` on the branch with `main` merged in, including B2
part 2's migration 0024. It was run from a fresh database. Every mode passes, visual included. The reminders
migration was regenerated with drizzle-kit on top of main's journal and snapshot, and keeps the number 0028.
[`gate-summary-all-modes.txt`](gate-summary-all-modes.txt) is the first full run, before the merge: only the
expected `087b-year-end default` diff failed there, and the baselines were then updated.

Visual baselines updated: 087b year-end shows the "Reclaim before year end" action for finance (desktop, tablet and
mobile).

## Still open

- the Stitch images for 086a;
- an entry from the 086 unused report, which renders through the shared report frame;
- a burn-rate panel on the budget page.
