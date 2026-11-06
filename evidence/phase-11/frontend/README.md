# Phase 11 frontend — period close, rollover policies and the year-end run

Screens built against the merged Phase 11 backend (`libs/api/close`, contract `libs/contracts/src/lib/domains/close.ts`).
Branch `feat/p11-close-ui`. Stack: isolated Compose project `bf-p11-ui` (web 4340, API 3140,
Keycloak 8220, Postgres 5572) with the deterministic seed; the shared `bf-demo` stack was untouched.

## Screens delivered

| Screen                       | Route                               | States covered                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 80e Period close (list)      | `/finance/close`                    | loading, empty, error, forbidden, default; one fiscal year at a time (defaults to today's)                                                                                                        |
| 80e Period close (checklist) | `/finance/close/:periodId`          | loading, error, blocked, ready, soft-closed, closed, locked, reopen requested, acknowledge dialog, close dialog, lock dialog, snapshots tab (with empty state), late items tab (with empty state) |
| 80e Break glass              | same route, closed or locked period | break-glass panel, request dialog, pending banner, second-person decision dialog                                                                                                                  |
| 87c Rollover policies        | `/finance/rollover-policies`        | loading, empty, error, default, assign-with-reason success and failure                                                                                                                            |
| 87b Year-end (list)          | `/finance/year-end`                 | loading, empty, error, default, set up a run                                                                                                                                                      |
| 87b Year-end run             | `/finance/year-end/:runId`          | loading, error, draft, dry run, not-ready with reasons, carry decision dialog, execute dialog, completed, failed                                                                                  |

Not built: screens 87 (forecast and variance) and 16a (board pack) — see "Gaps" below.

## Outcome table

| Scenario                                           | Expected                                                                            | Actual                                                                                                                                     | Result |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Finance admin opens Nov 2026                       | Close is refused and the screen names every failing check                           | `Nov 2026 cannot close yet.` lists all 10 checks across HYL-DE and HYL-US; `Close period` disabled                                         | Pass   |
| Hard check cannot be waved through                 | No accept action on a hard check                                                    | Hard rows read "Cannot be accepted" and offer no button; only soft rows do                                                                 | Pass   |
| Controller accepts a soft check                    | Row records who accepted it and why; the close is still refused                     | Row shows "Accepted by …", success notice, blocked banner unchanged                                                                        | Pass   |
| Accruals and prepaids at close                     | Accrual, prepaid and commitment-accrual checks appear with their counts and amounts | `Accrual proposals reviewed` 1 / USD 2,000.00, `Prepaids recognized through the period end`, `Commitments past their service date accrued` | Pass   |
| Closed period shows no ordinary reopen             | Only the break-glass panel, outside the action bar                                  | No `Close period`; error-toned panel with the consequences written out                                                                     | Pass   |
| Requester approves their own reopen                | Server refuses and the UI says so; the period does not move                         | Dialog shows "A reopen needs two different people: ask another Finance Admin to decide."; period stays Closed                              | Pass   |
| A second person approves                           | Period moves and the screen shows the new state                                     | Finance admin approves; Sep 2026 returns to Open with its checklist                                                                        | Pass   |
| Someone without ledger access                      | Told plainly, not a blank page                                                      | `sat-403-error-state`: "You do not have access to this page"                                                                               | Pass   |
| Year-end dry run                                   | Says nothing was posted and fills the per-budget outcome                            | "Dry run: nothing has been posted"; 10 budgets with policy, carry, lapse, sweep target, commitments                                        | Pass   |
| Year-end execution before the target year is ready | Execute stays disabled with the reason and a way to fix it                          | "6 budget(s) that carry have no counterpart in the target year; roll the tree forward first" plus a link to the roll-forward               | Pass   |
| Analyst opens a run                                | Reads it, cannot run or execute                                                     | No dry-run or execute buttons                                                                                                              | Pass   |
| Rollover policies                                  | Every mode with what it does at year end                                            | LAPSE, CARRY-25 (25% cap), CARRY-FULL, CARRY-APPROVAL, LAPSE-CORP with plain-English outcomes                                              | Pass   |
| Assign a policy with a reason                      | Audited change confirmed on screen                                                  | "Hyderabad Events now follows CARRY-25"                                                                                                    | Pass   |

## Checks and gates

- `scripts/gate.sh static --affected`: all green — `gate/static-gate-summary.txt`.
- Journeys (`apps/web-e2e/src/close/`), desktop, tablet and mobile: 39 passed, 8 skipped
  (mutating journeys run once, on desktop) — `gate/journeys.txt`. Run three times after the last
  fix with no flakes.
- Visual baselines: 33 new PNGs in `apps/web-e2e/src/__screenshots__/visual-light/`, generated and
  compared in the pinned Playwright image. Only the new screens were generated.

## Findings fixed during visual QA

- The checklist and rollover tables scrolled the whole document sideways at 412 px: an absolutely
  positioned screen-reader label escaped the table's scroll container. Fixed with
  `position: relative` on `.bf-table-scroll` (the same fix `libs/web/features/accounting` carries).
- Status tags and the "Accept with a reason" button wrapped out of their shapes on a tablet. Fixed
  by keeping the tag label and the action button on one line and letting the table scroll instead.
- `satRowState` logged a warning on every row because the rows have no primary action. The
  row-state directives were dropped from both tables; the console is clean.

## Gaps — screens 87 and 16a are still not buildable

Both were deferred from Phase 10 because they read `forecast_snapshots`. That table exists, but
nothing exposes it:

- **87 forecast and variance** needs a `forecast-variance` entry in `REPORT_IDS` and a builder in
  `libs/api/reports` joining `forecast_snapshots` with ledger balances. `REPORT_IDS` still holds the
  nine Phase 10 reports; the only forecast in `libs/api/reports` is the run-rate figure the unused
  and expired report computes itself.
- **16a board pack** needs the pack endpoints its spec names (pages rendered from
  `period_close_snapshots`, the FX bridge, generation as a background job into `DocumentStore`).
  `reports.ts` has no pack schema or endpoint.
- **87a forecast cycle** (the screen owners submit through) has no cycle records in `close.ts`
  either, so there is no way to produce an accepted forecast for 87 to report on.

No contract was invented for these; `docs/architecture/phase-handoff.md` records the state.

## Other gaps worth a follow-up

- `ClosePeriodSummary` carries no fiscal calendar or legal entity, so an unfiltered period list
  repeats each month once per calendar. The screen works around it by always asking for one fiscal
  year; a calendar reference on the summary would let the list say which entities a period covers.
- 87c's assignment rules and budget-override tabs, and the policy editor, need endpoints that do not
  exist (`close.ts` offers only `listRolloverPolicies` and `assignRolloverPolicy`), and no read
  returns a budget's current policy outside a year-end dry run.

## Files

- `screens/` — desktop, tablet and mobile captures of the delivered states.
- `gate/static-gate-summary.txt`, `gate/journeys.txt`.
