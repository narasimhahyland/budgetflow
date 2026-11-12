# Gap B4: reclaim campaigns and burn-rate alerts

Package B4 of [`docs/gap-closure-plan.md`](../../docs/gap-closure-plan.md). It covers the 086a reclaim-and-redistribute
campaigns, built from [the spec](../../docs/ux/screens/086a-reclaim-redistribute.md) under decision D2, and burn-rate
alerts. The work ran on the local stack `bf-gap-b4` with the deterministic seed and the pinned clock (2026-11-16).

## What was built

- **Domain** (`libs/domain`): `fiscal/reclaim.ts` decides who is a candidate (run-rate forecast unused above
  the share and the amount, fewer days left than the limit, not frozen, not set to zero, no pending carry).
  It checks an owner's answer against the floor as it stands at the moment of the answer, and splits a pool
  into deterministic legs. `reports/burn-rate.ts` computes the amount phased to date (current period pro rata)
  and the 110% and 125% levels in integer arithmetic.
- **Posting**: `ControlsService.reclaimInTx` posts each source's legs through the existing hierarchy move, as
  reductions with a destination. It uses the same `validateReduction` floor and confirmed-preview check as a reduce.
- **API** (`libs/api/close`): campaigns, notices, escalation, pool preview and pool execution, and burn-rate runs and
  alerts. One audit entry is written per command. Every mutation carries an idempotency key. Execution takes ordered
  locks over every chain involved and refuses with 409 `VERSION_CONFLICT` if an owner answered while the locks were
  being taken. Once a pool has been posted, its notices are closed.
- **Worker**: queue `budgets.burn_rate_sweep` runs requested checks. A nightly schedule (`BURN_RATE_SWEEP_CRON`) also
  exists and is switched off on the local stack. A run that is no longer queued does nothing, and alerts are unique
  per budget, period and level.
- **Notifications**: owners receive the existing in-app and channel delivery (`channel.deliver`) plus email.
  Notifications now link to `/reclaim/:noticeId`.
- **Web** (`libs/web/features/close`):
  - campaigns list and campaign page;
  - new-campaign dialog with a candidate preview;
  - redistribution panel per legal entity and a confirm dialog with the floor check;
  - phone-first owner notice;
  - Finance navigation entry "Reclaim campaigns".
- **Data**: migration `0026_b4_reclaim_burn` creates five tables, all with forced RLS. The seed adds the "Year-end
  reclaim" reason code and the Q4 FY2026 campaign: one part release, one full release, one kept budget and one overdue notice.

## Outcome table (API scenarios and journeys)

| Scenario                                                                           | Expected                                                                                                                                                                                                                                 | Actual      | Result |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| Preview writes nothing; a budget forecast over its amount is not a candidate       | candidates with floor 3,000.00 and at most 7,000.00 for A; owner gets 403                                                                                                                                                                | as expected | pass   |
| Start a campaign                                                                   | one notice per candidate, one `reclaim.campaign_started`, authorized unchanged                                                                                                                                                           | as expected | pass   |
| Who may answer                                                                     | another owner gets 404; finance gets 403 on an owner's notice                                                                                                                                                                            | as expected | pass   |
| Floor at the boundary after a USD 500.00 commitment                                | release all is 409 with "At most USD 6,500.00 can be reclaimed"; 650,001 is 409; 650,000 is accepted                                                                                                                                     | as expected | pass   |
| Idempotent answer                                                                  | a replay returns the first answer; one `reclaim.responded`; a second answer is 409 `RECLAIM_NOTICE_ANSWERED`                                                                                                                             | as expected | pass   |
| Keep                                                                               | without a plan is 422 `REASON_REQUIRED`; with one, status is kept and released is 0                                                                                                                                                      | as expected | pass   |
| Cross-entity target                                                                | 422 `TRANSFER_INVALID`                                                                                                                                                                                                                   | as expected | pass   |
| Redistribute the HYL-US pool                                                       | the CEO gets 403; a stale floor is 422 `IMPACT_PREVIEW_REQUIRED` and posts nothing; execution moves A to exactly its floor (3,500.00), the target +1,000.00, the parent's allocated out down by the remainder, the kept budget untouched | as expected | pass   |
| Pool idempotency                                                                   | a replay returns the same execution; a new key is 409 `RECLAIM_POOL_EXECUTED`; one `reclaim.pool_executed`                                                                                                                               | as expected | pass   |
| Late answer after the pool posted                                                  | 409 `RECLAIM_POOL_EXECUTED`                                                                                                                                                                                                              | as expected | pass   |
| Ledger rebuild after execution                                                     | clean                                                                                                                                                                                                                                    | clean       | pass   |
| Escalation before the deadline                                                     | 409 `RECLAIM_NOT_OVERDUE`                                                                                                                                                                                                                | as expected | pass   |
| Escalation after the deadline (seeded New York notice)                             | an owner gets 403; finance escalates to the CEO; one `reclaim.escalated`; the owner can no longer answer; the CEO releases part as `parent_owner`; no money moves                                                                        | as expected | pass   |
| Commitment between release and execution                                           | the preview is blocked ("At most USD 6,999.99"); execution is 409 `REDUCTION_BELOW_FLOOR`; nothing posted; no execution audit                                                                                                            | as expected | pass   |
| Burn rate at the thresholds                                                        | 109.9999% gives no alert; exactly 110% is "ahead" (11,000 bps); just under 125% stays ahead; exactly 125% is "well ahead"                                                                                                                | as expected | pass   |
| Burn-rate idempotency                                                              | reruns add no alerts; the same request key gives the same run; the owner gets two `budget.burn_rate` notifications; another owner sees none; an owner gets 403 when requesting a run                                                     | as expected | pass   |
| Journey: finance reads the answers, the owner releases part, finance redistributes | tags and reasons shown; a too-high amount shows the API's sentence; the owner releases 1,600.00; the confirm stays disabled until a reason is typed; the pool posts                                                                      | as expected | pass   |

The run output is in [`functional/targeted-runs.txt`](functional/targeted-runs.txt). The roles used are finance-admin,
CEO, budget-owner, department-head, location-manager and auditor (audit reads). The invariant map rows are 116-120 in
[`docs/testing/invariant-scenarios.md`](../../docs/testing/invariant-scenarios.md).

## Gates

[`gate-summary.txt`](gate-summary.txt) is the `scripts/gate.sh all --evidence` output for this change.

## Visual QA

The 086a baselines are new: 7 states × 3 viewports (`apps/web-e2e/src/__screenshots__/visual-light/086a-*`). The
states are campaign, list, new-campaign criteria, candidate preview, confirm dialog, owner notice and answered notice.
There is no Stitch image (the spec records that the quota ran out), so the screens were judged against the spec and
the budget-safety rules. Inspected screens are in [`visual-qa/screens/`](visual-qa/screens/).

The independent `ux-reviewer` pass found three blocking issues, all fixed and re-captured:

1. **Tablet clipped the Released column.** The owner now sits under the budget name. Below 1000 px the forecast
   column is hidden; the proposal stays, and the forecast also appears on each notice. The escalate button no
   longer wraps.
2. **The "redistribute" baseline was identical to the default.** The seed has no budget with a need in an entity
   that released money. The state was dropped from the baselines. The step with a suggested target, its need and
   the remainder to parents is evidenced from a scenario-built campaign on the stack:
   [`redistribute-with-targets--desktop.png`](visual-qa/screens/redistribute-with-targets--desktop.png). The confirm
   dialog blocked by a floor change is evidenced too:
   [`confirm-blocked-by-floor--desktop.png`](visual-qa/screens/confirm-blocked-by-floor--desktop.png).
3. **Pending requests were invisible on the owner notice.** The notice now lists them as "not part of the floor"
   and says that releasing more than is available sends them back to their requesters. This is an additive
   contract field, `ReclaimNotice.pendingRequests`.

Non-blocking fixes:

- due dates are formatted;
- the floor lines are labelled "authorized";
- the reason-code label is shown without its code;
- "Nothing reclaimed" is stated on kept notices;
- the answered notice shows the released amount, who answered and when;
- the criteria step is captured;
- a note explains that a parent's forecast covers only money it has not allocated.

A date bug found while doing this was fixed on these screens. Date-only fields were formatted with the `'UTC'`
timezone, and Angular parses `YYYY-MM-DD` as local midnight, so a browser west of UTC showed the day before.
The same pattern appears in 33 other feature files; that is a follow-up.

## Decisions and follow-ups

- Starting a campaign also sends its notices (there is no Draft step). Escalation goes to the nearest ancestor
  owner who is not the budget's owner, as in the spec's Sophie → Daniel example.
- A pool is one legal entity and currency. Targets must share the entity, currency, fiscal year and tree. The
  remainder goes back to each source's parent, as the existing reduce does; that parent can be in another entity.
- Follow-ups:
  - Stitch images for 086a;
  - an entry point from the 086 unused report and the year-end setup;
  - a burn-rate panel on the budget page (today alerts reach owners only as notifications);
  - reminders 2 days and 1 day before the deadline (not built);
  - the date-only `'UTC'` formatting in 33 other feature files.
