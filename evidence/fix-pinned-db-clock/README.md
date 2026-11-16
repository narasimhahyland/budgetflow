# Fix: API and worker database sessions are not pinned

On a pinned stack (`FIXED_NOW`, set by `scripts/stack.sh` from `freezeTime` in
`apps/web-e2e/visual/screens.json`, 2026-11-16T09:00Z) the API reasoned as of the pinned day, but
the rows it and the worker wrote carried the real date: `withTenant` never set `app.fixed_now`, so
column defaults (`app_now()`, migration 0020) were real `now()`, JavaScript stamps were real
`new Date()`, and the worker had no `FIXED_NOW` at all. One symptom: a reclaim notice answered
"on 12 Nov" while the app thought it was 16 Nov. Test stacks only; production never sets `FIXED_NOW`.

An earlier attempt (a0067df4) pinned only the database for the API and was reverted: an audit entry
stamped in JavaScript (real time) then looked days older than the AI suggestion it accepted
(database default, pinned), and accepting a suggestion requires `audit.occurredAt >= createdAt`.
So this fix moves both clocks together.

## What changed

- **One clock, two readings.** `libs/api/db/src/lib/pinned-clock.ts` (new) holds the pinned clock's
  state. `@bf/api/core` `clock.ts` reads it:
  - `nowUtc()`: unchanged. Exactly the pinned instant on every call (today, ages, countdowns,
    deadlines), so two requests agree on "now" to the millisecond.
  - `stampUtc()` (new): the instant to stamp a stored record with. Under `FIXED_NOW` it is the pinned
    instant moved on to the latest database clock reading, so a JavaScript stamp is never older than
    a row the database stamped before it, and stamps keep their order. Otherwise `new Date()`.
- **Database sessions** (`libs/api/db/src/lib/client.ts`): under `FIXED_NOW`, `createPool` opens every
  session with `-c app.fixed_now=<instant>`, the same mechanism the seed uses. API, worker and
  seed then share one database clock: the pinned instant plus one millisecond per stamp from the
  `app_clock_tick` sequence. `withTenant` / `withSubject` read that clock in the statement that sets
  the tenant, without taking a tick (`last_value`, not `nextval`), because read-only transactions
  (the ledger rebuild check) cannot advance a sequence. On the real clock the pool and the
  statement are exactly what they were.
- **Stamps**: 296 sites in `libs/api/**` and the worker's outbox drain that stored `new Date()` (decided,
  submitted, updated, published, audited at), or measured a window over such stamps with `Date.now()`,
  now use `stampUtc()`. They all moved with real time before, so nothing could rely on them
  being frozen.
- **Deliberately left on real time**: break-glass windows (`core/actor.ts`, `admin/break-glass.service.ts`);
  credential, API-key, token, invite, approval-link and download expiry; signed URLs
  (`documents/document-store.ts`); webhook and message retry schedules and signatures
  (`integrations/webhooks.service.ts`, `integrations/messages.service.ts`); system health
  (`admin/system-health.service.ts`, compared with pg-boss's real clock); the SMTP `Date` header;
  durations and latencies.
- **Worker**: `infra/compose.yaml` gives the worker `FIXED_NOW: ${BF_FIXED_NOW:-}`. This is consistent with
  the scheduled jobs: every sweep cron is `off` in compose, and pg-boss schedules on its own database
  `now()`, which `app.fixed_now` does not touch. The worker logs "Clock pinned" at startup, like the API.
- `scripts/stack.sh` comment updated (it described the "seed only" design).
- Two scenarios that measured against the real clock now measure against the API's clock
  (`support/clock`): `channels/chat-commands.spec.ts` "Last 24h" (deliveries are stamped on the pinned
  day) and `identity/analytics.spec.ts` "replaced by server time" (server time is the pinned clock).
  Same assertions, right reference clock.

## Functional outcomes

Stack `bf-jovial-shamir-fccacd` on ports 47xxx, `scripts/stack.sh up && reset`, deterministic seed,
clock pinned to 2026-11-16T09:00Z. Roles: finance admin (creates and freezes the budget, reads audit).

| Scenario                                                                                       | Expected                                                              | Actual                                                                                       | Result |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| Budget created by the API: `created_at` (database default, API session)                        | within an hour after the pinned instant                               | 09:00:0x on 16 Nov                                                                           | pass   |
| Freeze audit entry `occurredAt` (JavaScript, API), read via `/api/audit/events`                | within the hour, and no earlier than the budget's `created_at`        | as expected; every entry for the budget too                                                  | pass   |
| Freeze outbox message published by the worker (`published_at`, JavaScript)                     | within the hour, and no earlier than the API wrote it                 | as expected                                                                                  | pass   |
| Whole API suite on a fresh seed, then the database                                             | every audit and outbox stamp on 16 Nov, none published before created | 3,928 audit events 09:00:00.004 to 09:00:28.75; 3,175 outbox rows, 0 off-day, 0 out of order | pass   |
| AI suggestion acceptance (`audit.occurredAt >= suggestion.createdAt`)                          | accepted after the suggestion is applied                              | `ai/` scenarios pass                                                                         | pass   |
| Ledger rebuild check (read-only transaction) and every spec that failed on the first iteration | clean / drift detected as before                                      | 163 passed, 1 skipped (the live-model check)                                                 | pass   |

Proof: `apps/api-e2e/src/quality/pinned-clock.spec.ts` (invariant 137 in
`docs/testing/invariant-scenarios.md`). Every stamp must lie within an hour after the pinned instant,
not just on its calendar day, so the scenario fails on the old code on any real date (a real-clock
stamp today, 16 Nov, was 03:2x UTC, before the pinned instant).

Files: [`functional/targeted-api-scenarios.txt`](functional/targeted-api-scenarios.txt) (the new
scenario plus every spec that failed in the first iteration, and `ai/`),
[`functional/startup-log-excerpt.txt`](functional/startup-log-excerpt.txt) (API and worker both
report the pinned clock), [`db/stamps-after-run.txt`](db/stamps-after-run.txt) (stamps after the
whole API suite).

## Iterations

1. First full gate: 22 API scenarios and one visual state failed. Cause one: `withTenant` called
   `app_now()`, which takes a tick (`nextval`), and the rebuild check runs read-only, so every rebuild
   ended `failed`. Fixed by reading the clock without advancing it. Cause two: `nowUtc()` itself
   followed the database clock, so the API's "now" moved a few milliseconds between requests; tests
   that rightly expect one frozen "now" (snooze lasts exactly seven days, Navan's four-hour re-read
   window, the rules overview's week buckets in `066-rules-overview`) moved. Fixed by splitting:
   `nowUtc()` stays frozen, stamps use `stampUtc()`. Cause three: the two scenarios above measured
   against the real clock.
2. Second full gate: every mode passes. The scenario was then tightened (the hour window), so
   `static` and `functional-api` were run again: pass.

## Gates

- `scripts/gate.sh` (all modes): every step passed ([`gate-summary.txt`](gate-summary.txt)): lint,
  typecheck, build, functional-api, functional-e2e, visual (1,049 passed).
- After tightening the scenario: `scripts/gate.sh static functional-api` passed
  ([`gate-summary-rerun.txt`](gate-summary-rerun.txt)).
- Visual baselines: none changed. The one state that moved in iteration 1 (`066-rules-overview`) was
  caused by the advancing `nowUtc()`, which was reverted; no baseline was updated.

## Risks

- Production is unchanged by construction: without `FIXED_NOW`, `pinnedInstant()` is null, the pool has
  no `options`, `withTenant` runs its previous statement, and `stampUtc()` / `nowUtc()` are
  `new Date()`. `FIXED_NOW` must still never be set in a deployment (documented in `clock.ts`).
- On a pinned stack, stamps run up to a few seconds after the frozen "now" (the seed already did
  this). A window over stored stamps uses `stampUtc()`, so it agrees with them.
- New stamp sites must pick `stampUtc()` (stored stamp) or `nowUtc()` ("now" for reasoning); a plain
  `new Date()` is real time again on a pinned stack.
