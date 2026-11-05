# 087a Forecast cycle with variance commentary

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 11 batch. Build phase P11. Finance > Forecast cycles (`/finance/forecast-cycles`, cycle `/finance/forecast-cycles/:cycleId`); owners reach their submission at `/forecast/:cycleId`.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the report frame of 079 and the forecast visuals of 016. Planned Stitch states, to be generated in a later session:

| State                                     | Planned image                                                   |
| ----------------------------------------- | --------------------------------------------------------------- |
| cycle monitor (Finance Admin)             | `design/stitch/087a-forecast-cycle/default--desktop--light.png` |
| new cycle dialog                          | `new-cycle--desktop--light.png`                                 |
| owner submission with commentary required | `owner-submit--desktop--light.png`                              |
| owner submission on a phone               | `owner-submit--mobile--light.png`                               |
| cycle closed (snapshot locked)            | `closed--desktop--light.png`                                    |

## Purpose

Run the monthly or quarterly reforecast as a short, tracked cycle: finance opens it with a due date and a variance threshold, each owner picks a forecast method (run-rate, committed plus pipeline, or their own figure) for their budgets and events, explains variances above the threshold, and finance accepts or asks for more, ending with an immutable forecast snapshot that reports and the board pack use.

## Roles

Finance Admin (opens, monitors, accepts, closes cycles); budget owners (Department Head, Regional Manager, Location Manager, Budget Owner) submit for budgets they own; event organizers submit forecast at completion for their open events when included; Finance Controller and CEO read.

## Entry points

Finance > Forecast cycles; task "Add forecast for October reforecast" in 123 and the owner weekly digest; notifications (email, Slack, Teams) with due-date reminders; 016 and 087 "Open forecast cycle".

## Content and actions

Cycles list (Finance Admin): name, as of, due, scope, status (Open, Closed), progress (64 of 72 submitted), variances needing commentary, "New cycle".

New cycle dialog: name ("October reforecast"); as-of date (31 Oct 2026, the last closed or soft-closed period end); due date (12 Nov 2026); scope (all active budgets, or chosen subtrees); default method per budget type (Operating: run-rate; Event budgets: committed plus pipeline); variance threshold (at least 10% and at least USD 1,000.00); include open events (forecast at completion); reminders (3 days and 1 day before due). Start cycle.

Cycle monitor:

- Progress by region (stacked bar): submitted, commentary required, accepted, not started, overdue.
- Budgets table: budget, owner, authorized, actual to date, committed, forecast, method, variance and %, status tag (Draft, Submitted, Commentary required, Accepted, Superseded), commentary excerpt; row actions Accept, "Ask for commentary" (note to the owner), Open submission.
- Bulk: "Accept all submitted within threshold" (selection bar).
- Footer: "Close cycle" (dialog: "8 budgets not submitted will use the system run-rate forecast, marked System. The snapshot cannot change afterwards."), typed confirmation.

Owner submission (sample Sophie Laurent, Europe Region, October reforecast):

- Header: cycle, as of 31 Oct, due 12 Nov, "3 budgets, 1 event".
- One card per budget, Europe Region first:
  - Facts: authorized USD 30,000.00; actual to date USD 9,450.00; committed USD 6,900.00; pending USD 800.00; planned events not yet committed USD 2,400.00.
  - Methods side by side (radio cards): Run-rate USD 21,100.00 ("last three months' average for the remaining two months, plus committed"); Committed plus pipeline USD 24,900.00 (actual + committed + pending + planned events + run-rate for routine spend); "My own figure" (amount field).
  - Selected: Committed plus pipeline, USD 24,900.00; variance USD 5,100.00 under (17.0%), above the threshold.
  - Commentary (required, 20 to 1,000 characters): "Wellbeing paused after the set-to-zero on 21 Oct; Q4 London events moved to January."
- Event card: Europe winter social (EVT-2026-0122): funded USD 4,000.00, committed USD 2,600.00, actual USD 0.00, forecast at completion USD 3,700.00 (committed plus remaining estimate), surplus expected USD 300.00.
- Footer: Save draft, Submit forecast.

## Data and permissions

Uses `forecast_snapshots` (budget or event, method `run_rate`, `committed_pipeline` or `owner_input`, as-of date, amount, currency, `variance_bps`, commentary, status with the forecast machine: draft, submitted, commentary required, accepted, superseded) plus new P11 `close.ts` cycle records (name, as of, due, scope, threshold, defaults, status). System method amounts are computed by the API from the ledger, pending requests and planned events. New actions (integrator adds): `forecast.submit` (owners at owned scope), `forecast.manage` (Finance Admin at tenant scope). The API rejects a submission above the threshold without commentary (`FORECAST_COMMENTARY_REQUIRED`). Closing a cycle accepts remaining submissions as they are, writes system run-rate snapshots for missing budgets and supersedes the previous cycle's snapshots.

## States

| State                | Behaviour                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| No cycles            | empty state "No forecast cycles yet" with "New cycle"                                           |
| Monitor              | as above                                                                                        |
| Owner draft          | as above; autosaves drafts                                                                      |
| Commentary required  | commentary field in the error tone "Explain the USD 5,100.00 (17.0%) variance"; Submit disabled |
| Asked for commentary | owner sees a warning banner with the Finance Admin's note; status Commentary required           |
| Submitted            | owner card read-only with "Submitted 6 Nov"; Edit until accepted or due                         |
| Accepted             | success tag; owner cannot edit                                                                  |
| Overdue              | warning tag "Overdue"; daily reminder                                                           |
| Closed               | read-only snapshot; banner "Closed on 13 Nov; used by reports and the board pack"               |
| Loading / error      | `sat-ghost` cards; failed submit keeps entries                                                  |

## Budget safety and audit

Forecast figures are dashed or hatched (forecast, not actual); actual and committed keep their swatches; FX never enters forecasts (USD at the locked plan rate). Forecasts never move money. Submissions, commentary, acceptance, requests for commentary and cycle close are audited; snapshots are immutable once the cycle closes.

## Responsive and accessibility

Owner submission works on a phone (one budget card at a time with method radios and commentary); the monitor is desktop and tablet. Method cards are a radio group with amounts in their labels; commentary length and requirement are announced.

## Satori components

`sat-header-bar`, `mat-table` with `satTableWithRowStates` and `sat-selection-bar`, `sat-status-tag` (forecast statuses), `sat-interactive-card` (method radio cards), `sat-banner`, `sat-rich-tooltip` (method explanations), `satImportantButton` (Submit forecast, Close cycle), `sat-empty-state`, `sat-ghost`; Angular Material dialog (new cycle, close with typed confirmation), radio group, form fields, datepicker, snackbar; stacked progress bar from `libs/web/ui/charts`.

## Related screens and navigation

016 forecast view, 087 forecast report, 086 unused and expired, 87b year-end run, 16a board pack, 080e period close, 046 event details (forecast at completion), 123 tasks, 64a digests, 11b auto-drafted summaries (P15).

## Decisions taken

- Owners choose a method per budget from system-computed run-rate and committed-plus-pipeline figures, or enter their own; recommended because a computed starting point makes the cycle a five-minute task.
- Commentary is required when the variance is at least 10% and at least USD 1,000.00 (cycle setting), and finance can ask for more on any line.
- Closing a cycle fills missing budgets with system run-rate forecasts marked "System" rather than leaving gaps in reports.
- Event forecast at completion is part of the cycle for open events, so event budgets and their contributors' forecasts agree.
