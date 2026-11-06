# Phase 12 — a fanned-out webhook delivery left two rows, one of them never resolved

## What was wrong

`WebhooksService.fanOutFromOutbox` inserted a row at `attempt 0` with status `pending` for every
subscribed endpoint, and `deliverDue` then called `deliver()`, which **inserted a second row** at
`attempt 1` carrying the outcome. Nothing ever went back to the first row. Worse, `deliverDue`
clears `next_retry_at` to claim a row before sending, and the due query is
`status in ('pending','failed') and next_retry_at <= now()`, so the orphan could never be selected
again either: it stayed `pending` forever.

Every delivered event therefore left a queued delivery beside the one that said it was sent. An
operator reading screen 101 to diagnose an integration saw phantom deliveries that would never
complete, and `successRateBps` (succeeded ÷ all rows in the last 7 days) was halved by rows that
were not attempts at all.

## Which fix, and why

Two shapes were possible: resolve the pending row on completion, or make the queued row the
delivery. The code already pointed at the second.

- The queued row is a durable queue entry, not a note that a delivery is coming: it holds the
  tenant, endpoint, event id, event type and the redacted payload, and `deliverDue` re-reads all of
  that from it to send. It is the delivery record already.
- `webhook_deliveries` is unique on `(endpoint_id, event_id, attempt)`, so one row per
  `(endpoint, event)` whose `attempt` counts the tries fits the existing constraint without change.
- The retry and dead-letter paths do **not** depend on two rows. What they depend on is that the
  live row is the one with a non-null `next_retry_at`; `deliverDue` claims by clearing it and the
  outcome sets the next one. Updating in place preserves that exactly — it only stops a second row
  appearing. `MAX_RETRY_ATTEMPTS` / `exhausted` still key off `attempt`, which now increments on the
  row instead of across rows.

So `deliverDue` hands the queued row's id to `deliver()`, and `deliver()` writes the attempt onto
that row. A delivery is one row moving `pending` → `succeeded` / `failed` / `exhausted`. A test ping
and an operator redelivery have no queued row and still insert their own, which is right: a
redelivery is a new operator action and the log should keep the original beside it.

**No migration.** Every column the lifecycle needs already exists, and the unique index already
allows it.

### A second way a row could stay pending

`deliverDue` claimed a row, then called `deliver()`, and if `deliver()` threw before sending — a
removed endpoint, an endpoint with no signing secret — it logged a warning and moved on, leaving the
claimed row `pending` with `next_retry_at` null. Same phantom, different path. The catch now records
the attempt against the row (`failed`, or `exhausted` at the retry limit) with the reason.

## Scenarios

`apps/api-e2e/src/integrations/outbound-webhooks.spec.ts` — "the delivery log holds one row per
event". Both create the budget tree first and register the endpoint after it, so the freeze is the
only event the endpoint is entitled to (invariant 67); the subject is the budget the scenario froze,
never "the first row".

| Scenario                                                     | Expected                                                                                    | Actual                          | Result |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------- | ------ |
| A delivered event leaves exactly one row in a terminal state | log is `['succeeded']`, status code 200, `attempt > 0`, no error, `nextRetryAt` null        | `['succeeded']`, 200, attempt 1 | pass   |
| The row is the event the endpoint was entitled to            | `payload.budgetId` is the budget this scenario froze                                        | that budget                     | pass   |
| A refused delivery leaves exactly one row, failed            | log is `['failed']`, status code 401, error contains `401`, `nextRetryAt` set for the retry | `['failed']`, 401, retry queued | pass   |
| Backlog scenario (67) tightened to count rows, not subjects  | log is exactly one row, for the budget frozen after registration                            | one row, that budget            | pass   |
| Full `src/integrations` suite                                | 63 passed (61 on `main` + 2)                                                                | 63 passed                       | pass   |
| `scripts/gate.sh static --affected`                          | all pass                                                                                    | 8/8 pass                        | pass   |

The refused delivery points at a path the mock has no route for, which answers 401 every time. An
earlier version armed a failure on the shared receiver and was not deterministic across repeated
runs: a delivery left failing by an earlier run retries against the same path every minute and spent
the armed failure before this scenario's delivery arrived (observed on run 3 of 3). Nothing is armed
now, so the scenario shares no state with any other.

## The scenarios are not vacuous

No assertion is guarded. Each ends in one `toEqual` over the whole status list, so a row too many
fails it; a log that never settles returns the last snapshot the poll saw and fails on that same
assertion rather than on a timeout with nothing to read.

Proven by reverting the fix — `d.id` removed from the `deliver()` call in `deliverDue`, api and
worker rebuilt and restarted, stack reseeded:

```
# with the fix
  ✓ a delivered event leaves exactly one row, in a terminal state (2.9s)
  ✓ a delivery the receiver rejects leaves one row, failed, with the reason (3.8s)
  2 passed                                   # and again on two further runs

# with the fix reverted
  ✘ a delivered event leaves exactly one row, in a terminal state (27.8s)
      Error: the delivered event is one row that reached a terminal state
        Array [
          "succeeded",
      +   "pending",        <- the queued row nothing resolved
        ]
  ✘ a delivery the receiver rejects leaves one row, failed, with the reason (25.4s)
      Error: the refused event is one row recorded as failed
        Array [
          "failed",
      +   "pending",
        ]
  2 failed
```

## On the running stack

After the full `src/integrations` suite, `webhook_deliveries` across the tenant:

```
status   |attempt|rows
failed   |1      |1
failed   |2      |1
succeeded|1      |42
succeeded|2      |1

stale_pending|total_rows|distinct_events
0            |45        |44
```

No `pending` row survives. `attempt 2 / succeeded` is a delivery that failed once and succeeded on
its retry **on the same row** — the lifecycle working. The one row beyond the 44 distinct
`(endpoint, event)` pairs is the redelivery scenario, where an operator asked for a second attempt
and the log correctly keeps both.

## The seed and the visual baselines are untouched

`scripts/stack.sh reset` then counting: `all_delivery_rows 0, pending_rows 0` — identical to `main`,
because all four seeded `budget.*` events predate the seeded endpoint (invariant 67) so the fan-out
correctly gives it nothing. `scripts/gate.sh` reseeds before the visual run (`reseed-visual`), so the
`101-webhooks` baselines are captured on exactly this state. The fix changes no screen, no seed and
no baseline.

## Defect 2 — the channel delivery job resolves installations at delivery time: deferred

`ChannelsService.deliverChannelJob` reads `chat_installations` when the job runs, so a Slack or Teams
workspace connected while a message is queued carries that message. Assessed and deliberately not
changed.

**It is reachable.** `installedAt` on `chat_installations` plus the outbox row's `created_at` would
close it without a migration, as they did for webhooks — the only missing piece is a queue
timestamp on the job, which the drain already holds as `m.createdAt` and could pass alongside
`tenantId`. `ChannelDeliverJob.createdAtIso` is not it: only two producers set it and it carries the
notification's own timestamp.

**But the same watermark that is right for webhooks is wrong here, and the asymmetry is the whole
point.** For webhooks it prevented disclosure: the endpoint owner is a third party who was never
authorised to see the history before their endpoint existed. The channel job has no third party. It
is addressed to one `recipientPersonId`, and a chat copy is only written when that person holds
their own `chat_account_links` row for the provider; the card is rendered with that person's own
policy scope. So the watermark would not withhold anything from anyone who should not have it — it
would withhold an approval card from the approver it belongs to, which is the worse failure. Under
the one case where a real backlog can build (the worker having been down), suppressing the catch-up
is plainly wrong: those cards are the approver's to act on.

What is left without it is a notification roughly a drain interval old (`OUTBOX_POLL_MS` 1s, chat
poll 0.5s) arriving in a workspace connected moments ago, to the person it was written for. In
normal operation even that needs a disconnect followed by a reconnect, because
`ensureDefaultInstallationsTx` creates the tenant's installations already `connected` with a
backdated `installed_at`.

**Follow-up, if the product ever wants it:** suppress only the _stale_ part of a catch-up — a
threshold on the message's age at delivery (say, do not post to chat anything older than a few
minutes), rather than a watermark on the installation. That keeps a current card flowing to its
approver and drops genuinely old ones, and it needs no schema change either. No migration was
taken: `0015` remains free.

## Also considered: seeding delivery rows for the demo

Not done. The seeded endpoint's empty delivery log is correct (its events predate it), and screen
101 showing its empty state is a true state worth having a baseline for. Inserting rows directly
would be deterministic, but it changes the seed and forces the `101-webhooks` baselines to be
regenerated while other agents are mid-wave on UI phases — a shared-surface change whose only
benefit is a richer demo. Recorded as a follow-up: insert fixed-id `webhook_deliveries` rows in
`apps/api/src/seed/integrations.ts` with fixed timestamps and statuses, never via the fan-out, then
regenerate `101-webhooks` with that reason and prove three clean `scripts/stack.sh reset` runs.

## Commands

```
scripts/gate.sh static --affected
npx playwright test --config apps/api-e2e/playwright.config.ts src/integrations
npx playwright test --config apps/api-e2e/playwright.config.ts \
  src/integrations/outbound-webhooks.spec.ts --grep "delivery log holds one row"   # x3
scripts/stack.sh up && scripts/stack.sh reset
evidence/phase-12/delivery-one-row/functional/delivery-rows.sh
```

Stack on shifted ports (compose project `bf-p12-fix`: api 3170, postgres 5602, keycloak 8250, web
4370, mocks 4170) so the `bf-demo` stack on the default ports was left running throughout.
