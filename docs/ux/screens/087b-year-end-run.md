# 087b Year-end run

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 11 batch. Build phase P11. Finance > Year-end (`/finance/year-end`, run `/finance/year-end/:runId`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the wizard and table language of 080e and 023a. Planned Stitch states, to be generated in a later session:

| State                          | Planned image                                                 |
| ------------------------------ | ------------------------------------------------------------- |
| setup (freeze date and checks) | `design/stitch/087b-year-end-run/default--desktop--light.png` |
| dry-run results                | `dry-run--desktop--light.png`                                 |
| carry approvals pending        | `approvals--desktop--light.png`                               |
| execute confirmation           | `execute-dialog--desktop--light.png`                          |
| completed with journals        | `completed--desktop--light.png`                               |

## Purpose

Run the fiscal year-end as one controlled, repeatable process: set the date after which no new commitments are made, see in a dry run exactly what each budget will carry, lapse or sweep under its rollover policy, collect the approvals carry-overs need, carry open commitments into the new year, then execute and get the journals and a result report, with burn-rate alerts beforehand so the year-end spike is visible early.

## Roles

Finance Admin (sets up, runs dry runs, executes); Finance Controller (reviews, approves carry-with-approval items above the owner level); budget owners (request or confirm carries for their budgets, see the outcome); CEO and Auditor (read).

## Entry points

Finance > Year-end; 086 "Lapsed and at risk"; 108 fiscal calendar "Year-end"; 080e when December closes; notifications to owners "Year-end: confirm what carries over from Bengaluru Events".

## Content and actions

Stepper: 1 Setup, 2 Dry run, 3 Approvals, 4 Execute, 5 Results.

1 Setup (sample FY2026 to FY2027):

- Commitment freeze date: 15 Dec 2026 ("After this date new commitments need Finance Admin approval; existing ones continue").
- Readiness checks: FY2027 fiscal year and periods exist (108); FY2027 plan rates locked (107); FY2027 budgets rolled forward (023a) or planned; December 2026 closed (080e) before execute (dry runs allowed earlier); rollover policies assigned to every budget (87c).
- Burn-rate alerts: budgets spending faster than 150% of their monthly average in the last 30 days (list with owners), and budgets forecast to lapse more than 20% (from 086); "Notify owners" sends the alerts.

2 Dry run (any number of times, no postings): table per budget with available at year end (as of the dry run), rollover policy, carries over, lapses, sweeps to (parent or corporate), open commitments to carry (count and amount), approval needed. Samples (USD):

| Budget                 | Available | Policy                    | Carries            | Lapses   | Sweeps to    | Open commitments carried | Approval                                     |
| ---------------------- | --------- | ------------------------- | ------------------ | -------- | ------------ | ------------------------ | -------------------------------------------- |
| India Wellbeing        | 4,200.00  | Lapse, sweep to parent    | 0.00               | 4,200.00 | India Region | 0                        | -                                            |
| Hyderabad Events       | 900.00    | Carry capped at 10%       | 800.00             | 100.00   | India Region | 1, USD 1,250.00          | -                                            |
| London Team Activities | 2,600.00  | Carry with approval       | 2,600.00 requested | 0.00     | -            | 2, USD 3,100.00          | Sophie Laurent's request, Finance Controller |
| US Wellbeing           | 3,000.00  | Lapse, sweep to corporate | 0.00               | 3,000.00 | Corporate    | 0                        | -                                            |

- Totals: carries USD 3,400.00; lapses USD 7,300.00; open commitments carried 3, USD 4,350.00.
- Carried commitments move to FY2027 with status Carried forward and their encumbrance re-posted in the new year at the original USD amount (the FY2026 plan rate stays with the commitment); any difference when actuals arrive is FX effect, reported separately.
- Download dry-run results (CSV, XLSX, PDF).

3 Approvals: carry-with-approval items with owner request, reason, amount, decision (Approve full, Approve part, Decline) by the Finance Controller; owners are notified.

4 Execute (only when December is closed and approvals are decided): dialog with totals, effect ("Lapsed money returns to the sweep targets; carried amounts become FY2027 authorized; open commitments re-post in FY2027"), typed confirmation "RUN YEAR END FY2026", Execute.

5 Results: status Completed; journals created (lapse, carry, sweep, commitment carry) with links; per-budget outcome table; "Notify owners" sends each owner their outcome; Export.

## Data and permissions

Uses `year_end_runs` (fiscal year, status draft, dry run, running, completed, failed, dry-run flag, commitment freeze date, summary) and rollover policies (87c). The run executes in the worker with idempotency and ordered locks per budget, posting through the `libs/domain` builders: lapse and sweep as reductions with a destination, carry as FY2027 authorized, commitment carry as release in FY2026 and re-post in FY2027 (status Carried forward). New action `yearend.run` (integrator adds; Finance Admin); carry approvals use `forecast.manage` or a dedicated `yearend.approve` (Finance Controller). A failed run stops at the failed budget and can resume; already posted budgets are skipped by idempotency keys.

## States

| State             | Behaviour                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Setup             | as above; readiness checks with ticks or crosses and links                                               |
| Not ready         | Execute step disabled with the reasons ("December 2026 is not closed")                                   |
| Dry run           | as above; banner "Dry run: nothing has been posted"                                                      |
| Approvals pending | step 4 disabled with "2 carry requests wait for the Finance Controller"                                  |
| Execute dialog    | as above                                                                                                 |
| Running           | progress (budgets processed, journals posted); page can be left                                          |
| Completed         | success banner with totals and journal links                                                             |
| Failed            | error banner "Stopped at London Team Activities: period FY2027 Jan is not open" with Resume after fixing |
| Loading / error   | `sat-ghost`; error banner with Retry                                                                     |

## Budget safety and audit

Dry runs post nothing and say so. Lapses and sweeps are reductions with a destination and reason ("Year-end FY2026, policy LAPSE-PARENT"), never edits; carried commitments keep their history. Every step (setup, dry runs, approvals, execute, resume) and every journal is audited; the result report links each budget to its journals.

## Responsive and accessibility

Desktop and tablet; mobile read-only (status and results). The stepper is an ordered list announcing the current step; tables have captions; the typed confirmation has an exact-match hint.

## Satori components

`sat-header-bar`, `mat-table` with `satTableWithRowStates`, `sat-status-tag` (run status, policy), `sat-banner` (dry run, not ready, failed), `satImportantButton` (Execute), `sat-rich-tooltip` (policy outcome explanations), `sat-ghost`; Angular Material stepper, dialog (execute with typed confirmation), datepicker, progress bar, snackbar; Export menu from 000; `bf-money`.

## Related screens and navigation

87c rollover policies, 086 unused and expired, 86a reclaim and redistribute, 080e period close, 108 fiscal calendar, 107 exchange rates (plan rate lock), 023a roll forward, 051 and 085a commitments, 088 audit log.

## Decisions taken

- Year-end is a guided run with unlimited dry runs before one execute, and execution needs December closed. Recommended so finance sees every budget's outcome before anything posts.
- After the commitment freeze date new commitments need Finance Admin approval rather than being blocked outright, so genuine late needs can still proceed.
- Open commitments carry into the new year by default (released in the old year and re-posted in the new), keeping their history; owners can release them instead before execution.
- Carry-with-approval requests are decided by the Finance Controller, with partial approval allowed.
- A failed run resumes from where it stopped; idempotency keys prevent double postings.
