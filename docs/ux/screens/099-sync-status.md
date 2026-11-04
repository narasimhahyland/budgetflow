# 099 Data synchronization status

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Admin > Integrations > Sync status (`/integrations/sync`, run detail `/integrations/sync/:runId`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the hub of 092. Planned Stitch states, to be generated in a later session:

| State                       | Planned image                                               |
| --------------------------- | ----------------------------------------------------------- |
| sync runs across connectors | `design/stitch/099-sync-status/default--desktop--light.png` |
| run detail                  | `run-detail--desktop--light.png`                            |
| schedule timeline           | `schedule--desktop--light.png`                              |

## Purpose

Show every synchronization run in and out of BudgetFlow (what ran, when, how long, how many records moved, what failed) and what is scheduled next, so an Integration Admin can confirm data is flowing and finance can trust that today's actuals and headcount are current.

## Roles

Integration Admin (run now, pause schedules); Finance Admin and Auditor (read).

## Entry points

092 header "Sync status"; connector Logs tab; 012 feeds card; failure notifications.

## Content and actions

Header bar: title, "Run now" (pick connector and object), Export (CSV, XLSX, PDF). Filter chips: connector, direction (Inbound, Outbound), object, status (Succeeded, Partly succeeded, Failed, Running), period.

Summary: runs in the last 24 hours 96; succeeded 92; partly succeeded 3; failed 1; records in 1,940; records out 61.

Runs table: started, connector, object (GL lines, transactions, expense lines, workers, event codes, card limits, calendar responses, plan import, exports), direction, mode tag (Mock, Sandbox, Live), duration, records read, applied, skipped as duplicates, failed, status tag; row opens the run detail. Samples:

- 10:00 Ramp, transactions, Inbound, Mock, 4 s, 58 read, 58 applied to the actuals review, 0 failed, Succeeded.
- 09:30 ERPNext, GL lines, Inbound, Mock, 11 s, 412 read, 412 applied, Succeeded.
- 08:00 Concur, expense lines, Inbound, Mock, 7 s, 126 read, 120 applied, 6 held as possible duplicates, Partly succeeded.
- 07:45 Adaptive Planning, actuals export, Outbound, Live, 2 s, 0 sent, Failed ("401 Unauthorized") with a link to 100.
- 07:12 SCIM, users, Inbound, 1 operation, Succeeded.

Run detail: timeline (queued, started, pages fetched, applied, finished), counts, warnings, the import batch or export id it created (links to 080a, 94b), errors with links to 100, cursor or watermark used for incremental sync, idempotency key.

Schedule view: next 24 hours per connector as a timeline (Ramp hourly, Concur every 2 hours, ERPNext daily 06:00, HR file 02:00), Pause and Resume per schedule.

## Data and permissions

Reads `sync_runs` (connector, object, direction, mode, timings, counts, status, cursor, error summary) and schedules from `integration_connections`. `integration.read` to view; `integration.manage` to run now and pause. Runs are idempotent per connector, object and window; "Run now" never duplicates records already applied (source references are unique).

## States

| State            | Behaviour                                             |
| ---------------- | ----------------------------------------------------- |
| Default          | as above                                              |
| Running          | row with a progress indicator; detail updates live    |
| Partly succeeded | warning tag; detail lists held or failed records      |
| Failed           | error tag with the reason and link to 100             |
| Paused schedule  | neutral tag "Paused by Nadia Farouk"                  |
| Empty            | "No sync runs yet. Connect a system in Integrations." |
| Loading / error  | `sat-ghost`; error banner with Retry                  |

## Budget safety and audit

Inbound runs only feed review paths (actuals review, vendor review, org imports); held duplicates are counted separately. "Run now" and pause or resume are audited; runs themselves are operational logs.

## Responsive and accessibility

Desktop and tablet; mobile shows the summary and failed runs. Status tags use icon and text; the timeline has a list alternative.

## Satori components

`sat-header-bar`, `satInteractiveTag` (filters), `mat-table` with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag`, `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material side sheet (run detail), dialog (run now), menu, snackbar; timeline from `libs/web/ui/charts` with a list alternative; Export menu from 000.

## Related screens and navigation

092 hub, 093-098 connectors, 094a, 094b, 99a duplicates, 99b pushes, 100 errors and retry, 080a actuals import, 012 finance controller dashboard.

## Decisions taken

- One runs table for every connector and direction, with the schedule as a second view. Recommended so "is data flowing?" has one answer.
- Records held as possible duplicates count separately from failures, so a partly succeeded run is not mistaken for broken.
- "Run now" is safe to press repeatedly: runs are idempotent by window and source reference.
