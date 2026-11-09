# AI conversation history is purged, not hidden

Decision taken 2026-11-09, built the same day. Every claim below points at a file in this folder or
at a command whose output is in it.

## What was wrong

`conversationHistoryDays` (default 30, range 7–90) was enforced as a **read-side SQL filter** in
`libs/api/ai/src/lib/features/ask.service.ts` — `lastAskedAt > now() - make_interval(...)` — and
nothing ever deleted a row. Phase 14's twelve retention categories did not cover the AI area at all,
so no sweep picked it up either. The question and answer text was therefore kept indefinitely while
screen `113a` presented a retention window. The text was hidden, not purged.

## What it does now

AI conversation history is the **thirteenth retention category**, `ai_conversations`, rather than a
sweep of its own.

| Piece                | Where                                                |
| -------------------- | ---------------------------------------------------- |
| Category definition  | `libs/domain/src/lib/admin/retention.ts`             |
| Handler that deletes | `libs/api/admin/src/lib/retention-engine.ts`         |
| Period read by both  | `RetentionService.effectivePeriodDays`               |
| Read path            | `libs/api/ai/src/lib/features/ask.service.ts`        |
| Scenario             | `apps/api-e2e/src/ai/conversation-retention.spec.ts` |
| Invariant            | row 95 in `docs/testing/invariant-scenarios.md`      |

Defaults: `delete`, anchored on the record date, 30 days, with a 7-day floor carried over from
`113a`'s old 7–90 range, `provisional` sign-off like every other category, unlocked.

### Why it sits inside the retention sweep

Three properties came free, and the third is the one that decided it:

1. the append-only run report, with a per-category line;
2. the existing `POST /api/admin/retention/runs` driver, which a scenario can time — the wall-clock
   sweeps are `off` by default in Compose, so a test must drive the work rather than wait for a cron;
3. **legal holds**, applied by `RetentionService` between finding the records and touching them, and
   matched on the asker's person. A purge of its own would have had to reimplement that, and missing
   it would delete records a hold covers. That is a compliance defect, not a missing feature.

### One number governs both ends

`RetentionService.effectivePeriodDays` is now public, and the AI read path asks for the
`ai_conversations` period instead of keeping its own copy. So the list cannot promise history the
purge has already removed. The same edit replaced a SQL `now()` with the API's clock, so the window
holds still under a pinned clock.

The window runs from the conversation's **last question**, not from each turn, so a thread someone is
still using is never half-deleted. Deleting the conversation takes its turns with it through the
existing `ai_conversation_turns.conversation_id` cascade.

## Proof

`scenario-run.txt` — three tests, all passing. They read `ai_conversations` and
`ai_conversation_turns` **straight from the database**, past any response filter, so "gone" means
gone rather than filtered out of a payload. All of it in the Initech Sandbox tenant, on conversations
the scenario inserts and removes itself, restoring the period and releasing its hold afterwards.

| Outcome asserted                                                             | How                                                                           |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| The category ships as a provisional default that deletes                     | `action` is `delete`, `signoffStatus` is `provisional`, `locked` is false     |
| A conversation past the window is deleted, with its turns                    | last question 10 days ago; 0 rows in both tables after an apply run           |
| A conversation inside the window keeps its text, so the cutoff is a boundary | last question 2 days ago; still 1 row in both tables after the same run       |
| A preview removes nothing                                                    | `appliedCount` is 0 and the rows are still there                              |
| A legal hold on the asker beats the purge, and the run names the hold        | person-scoped hold; row survives; `skippedHoldCount` ≥ 1 and `holdIds` has it |

`gate-summary.txt` — `scripts/gate.sh static --affected` (8 steps) and
`scripts/gate.sh functional-api`, all PASS. The full API suite ran because this change touches a
shared retention list and the AI conversation read path, not only the new scenario.

## What this change deliberately does not do

- **`conversationHistoryDays` is left in the AI settings contract and on `113a`, and is now read by
  nothing.** Removing it from the contract and the screen is a follow-up. It was left because the
  decision on record was to make the purge real, not to change what `113a` offers.
- **No contract change was needed.** `CategoryKey` in `libs/contracts` is a free-form snake_case
  string rather than an enum, so a new retention category is a domain-and-seed change only.
- **No migration.** The category is a seeded `retention_policies` row, built from
  `RETENTION_CATALOG`, so an existing database picks it up on the next reseed and not before.
- **The twelve retention periods are now thirteen.** The 2026-11-09 decision to ship the twelve as
  provisional still holds for those twelve; this one ships provisional on the same footing.

## Two corrections made while building this

Recorded because both were caught late rather than by design:

1. **Invariant row 95 was first written as `passing` before the scenario had ever run.** It was
   changed to `not yet run` and only flipped to `passing` after the run in `scenario-run.txt`.
2. **The first apply run failed 403, correctly.** Applying is fenced: it repeats a named preview,
   types `DELETE`, and needs `retention.confirm`, which the Finance Controller has and the
   administrator does not — the existing retention scenario asserts that 403 on purpose. The
   scenario now uses the preview id, the typed word and the right role.
