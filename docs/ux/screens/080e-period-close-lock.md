# 080e Period close and lock

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 11 batch. Build phase P11. Finance > Period close (`/finance/close`, period detail `/finance/close/:periodId`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the finance screens 080c and 108. Planned Stitch states, to be generated in a later session:

| State                                | Planned image                                                      |
| ------------------------------------ | ------------------------------------------------------------------ |
| close checklist, one entity blocking | `design/stitch/080e-period-close-lock/default--desktop--light.png` |
| close confirmation (snapshot)        | `close-dialog--desktop--light.png`                                 |
| closed, lock available               | `closed--desktop--light.png`                                       |
| reopen request (two people)          | `reopen-dialog--desktop--light.png`                                |
| snapshots and late items             | `snapshots--desktop--light.png`                                    |

## Purpose

Close each month in a controlled way: see per legal entity what still blocks the close, soft-close for finance adjustments, close with an immutable as-of snapshot, lock once reporting is done, and handle anything that arrives late by posting it into the next open period with a flag, so the numbers in a board pack never move afterwards.

## Roles

Finance Controller (prepares the checklist, soft-closes, requests reopen); Finance Admin (closes, locks, approves reopen or unlock as the second person); Auditor and CEO (read).

## Entry points

012 close status card "Open period close"; 108 fiscal calendar "Close period" (P11 replaces 108's simple dialog with this screen); month-end checklist notifications; 080c after sign-off.

## Content and actions

Period list (left rail): FY2026 periods with status tags (Locked Jan-Aug, Closed Sep, Open Oct "Closing", Open Nov, Future Dec).

Period detail, October 2026 (status Open):

- Header: period, dates (1-31 Oct 2026), status tag, target close date (5 Nov, working day 3), actions by status: "Soft close" (Finance Controller), "Close period" (Finance Admin, `satImportantButton`, disabled with the written reason until hard checks pass), "Lock period" (after Closed), "Request reopen" (Closed or Locked).
- Checklist by legal entity (rows IN01, US01, UK01; columns are checks with a tick, warning or cross and a link):
  - Hard checks (must pass): GL tie-out signed off (080c); no unbalanced journals; nightly ledger check clean; audit chain verified.
  - Soft checks (pass or acknowledge with a reason): actuals imported for every source; unmatched actuals cleared or carried; accrual proposals reviewed (080d); recharges approved or scheduled (053a); post-spend exceptions reviewed (074a).
  - Sample: IN01 tie-out difference USD 48.10 above tolerance (cross), 2 unmatched lines USD 612.40 (warning, "Carry to November" or "Resolve"); US01 all ticks, Soft-closed; UK01 tie-out not started (cross).
- Acknowledge a soft check: dialog with reason code and typed reason ("2 card lines wait for receipts; they will post to November flagged as late"); recorded on the checklist.
- What closing does (info panel): "Postings dated in October are refused. Late items post to November with a late flag. An as-of snapshot of every budget's balances is taken per entity and cannot change."

Close dialog: summary of checks (all hard checks passed, 1 soft check acknowledged), snapshot preview counts (1,412 budgets, 3 entities), typed confirmation "CLOSE OCT 2026", Close.

Lock dialog (Closed periods): "Lock after reporting. A locked period can only be unlocked by two people." Lock.

Reopen or unlock: Finance Controller requests with reason code and typed reason; a different Finance Admin approves or declines; on approval the period returns to Open (from Closed) or Closed (from Locked). The original snapshot stays; re-closing takes a new snapshot version.

Tabs below the checklist: Snapshots (period, entity, version, taken at, by, totals for authorized, committed, actual, accrued; View opens as-of balances; "Compare with current" lists late items since), Late items (postings dated in a closed period that landed in the next open period: accounting date, original period, posted period, source, budget, amount, flag reason), History (status changes with who, when, reason).

## Data and permissions

Period status changes use the existing `changePeriodStatus` endpoint (soft close, close, lock, reopen, unlock; reason required to reopen or unlock) and the period machine in `libs/domain` (Open, Soft-closed, Closed, Locked). New P11 `close.ts` contract adds the checklist (per entity, derived from tie-out runs, journals, integrity checks, actuals, accruals, recharges and exceptions), acknowledgements, reopen requests with a second approver, and snapshots in `period_close_snapshots` (period, entity, balances, taken by, taken at; append-only). `period.manage` (Finance Admin) to close, lock and approve reopen or unlock; new action `period.prepare` (integrator adds; Finance Controller) to soft-close, acknowledge and request. The API refuses Close while a hard check fails (`PERIOD_CLOSE_BLOCKED`) and refuses a second approval by the requester (`SAME_PERSON_APPROVAL`). Soft-closed periods accept finance adjustments only (`acceptsPostings` with the soft-closed allowance).

## States

| State            | Behaviour                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Open, blocked    | as above; Close disabled with "2 hard checks fail: IN01 tie-out, UK01 tie-out"                                                    |
| Soft-closed      | info banner "Only finance adjustments (accruals, reclassifications) post to October"                                              |
| Ready            | all hard checks pass; success banner; Close enabled                                                                               |
| Close dialog     | as above                                                                                                                          |
| Closed           | neutral tag with lock icon; snapshot links; Lock enabled                                                                          |
| Locked           | neutral tag with lock icon "Locked"; only Request unlock                                                                          |
| Reopen requested | warning banner "Reopen requested by Priya Raman: reason. Waiting for a Finance Admin." with Approve or Decline for a different FA |
| Late items       | count badge on the tab; rows tagged "Late"                                                                                        |
| Loading / error  | `sat-ghost` checklist; error banner with Retry; a failed close leaves the period Open                                             |
| Forbidden        | `sat-403-error-state` for roles without finance access                                                                            |

## Budget safety and audit

Hard checks use the error tone and cannot be acknowledged; soft checks use the warning tone. Locked uses a neutral tag with a lock icon (the info tone stays reserved for frozen budgets, as in 108). Snapshots are append-only; corrections after close are reversals in the next open period, never edits. Every status change, acknowledgement, reopen request and approval is audited with the reason; the snapshot id is in the audit entry.

## Responsive and accessibility

Desktop and tablet; mobile read-only (period status and checklist). The checklist table has row headers per entity and text for every status; the typed confirmation field has a visible label and an exact-match hint.

## Satori components

`sat-header-bar`, `sat-action-bar`, `sat-splitter` (period rail and detail), `mat-table` with `satTableWithRowStates` (checklist, snapshots, late items), `sat-navigation-tabs`, `sat-status-tag` (period statuses, Late), `sat-banner`, `satImportantButton` (Close period), `sat-ghost`, `sat-403-error-state`; Angular Material dialog (acknowledge, close, lock, reopen with typed confirmation), select (reason code), snackbar.

## Related screens and navigation

108 fiscal calendar, 080a actuals import, 080b unmatched actuals, 080c GL tie-out, 080d accruals, 053a recharges, 074a exceptions, 012 finance controller dashboard, 16a board pack (snapshots), 087b year-end run, 088 audit log.

## Decisions taken

- Period status is company-wide (one fiscal calendar, as assumed in 108), while the checklist and snapshots are per legal entity; Close needs every entity's hard checks to pass. Recommended because postings are refused by period for the whole company.
- Hard checks (tie-out signed, balanced journals, clean ledger check, verified audit chain) cannot be overridden; soft checks can be acknowledged with a reason code and typed reason.
- Unmatched actuals do not block close: they are carried and post to the next open period with a late flag.
- Reopen and unlock always need two different people: the Finance Controller requests and a Finance Admin approves (matching 108's "FC plus FA").
- Re-closing a reopened period takes a new snapshot version and keeps the original for audit.
