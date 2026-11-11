# 091 Export and scheduled reports

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Reports > Scheduled and exports (`/reports/schedules`, `/reports/exports`); the schedule dialog opens from every report and dashboard. The original Stitch project has a PDF-style screen for 91; this spec replaces it with the Export-only decision (no Share).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the report frame of 079. Planned Stitch states, to be generated in a later session:

| State                            | Planned image                                                            |
| -------------------------------- | ------------------------------------------------------------------------ |
| schedules list                   | `design/stitch/091-export-scheduled-reports/default--desktop--light.png` |
| schedule dialog                  | `schedule-dialog--desktop--light.png`                                    |
| recipient without access warning | `recipient-warning--desktop--light.png`                                  |
| exports list                     | `exports--desktop--light.png`                                            |

## Purpose

Deliver reports to people who will not open a report page (by email, or as a summary in a Slack or Teams channel) on a schedule, and keep track of every export, while never sending figures to someone who could not see them in BudgetFlow.

## Roles

Finance Admin, Finance Controller, Auditor, Read-only Analyst, CEO (schedule any report in their scope); budget owners (schedule reports of their subtree). Recipients receive deliveries; they manage their own opt-out from the email footer.

## Entry points

"Schedule delivery" on any report (079 frame) and dashboard (011-018b); 079 "Scheduled reports"; delivery footers "Manage this schedule"; 123 notification "Your export is ready".

## Content and actions

Tabs: Schedules, Exports.

Schedules table: name, report and saved view, format, frequency, delivery (email recipients count, channels), owner, next run, last run tag (Delivered, Partly delivered, Failed), Active toggle; row menu Run now, Edit, Pause, History, Delete. Samples:

- "India utilization, weekly": Utilization (082), India Region; PDF; Mondays 08:00 IST; email 4 recipients and Slack #india-leads; owner Meera Iyer; last run Delivered.
- "Monthly board pack": Board and FP&A pack (16a); PDF and XLSX; monthly, after the period closes (80e); email Olivia Grant, Marco Bianchi, Priya Raman; owner Marco Bianchi.
- "Open exceptions, daily": Exceptions (17a); CSV; weekdays 07:30; email Priya Raman, Hannah Cole.

Schedule dialog:

- Report and filters (read-only summary of the current view, with "Change filters" returning to the report).
- Name; format (PDF, XLSX, CSV; several allowed); frequency (Daily weekdays, Weekly on a day, Monthly on a day, Monthly after period close); time and timezone (default the owner's).
- Delivery: Email recipients (people and groups from the Hyland directory; no external addresses); Slack channel and Teams channel (only channels allowed in 61e); message (optional).
- Access check (live): "Runs with Meera Iyer's access. Each email recipient gets the attachment only if they can see the same data in BudgetFlow." Recipients without access are listed with a warning tag "Will be skipped" and the reason ("Kavya Shah cannot see India Region").
- Channel note: "Channels receive headline figures and a link, never a file."
- Buttons: Cancel, Save schedule.

Exports tab: report, format, rows, requested by, requested at, status (Queued, Running, Ready, Failed, Expired), size, Download (the file is kept 7 days; each download link is signed when asked for and lasts five minutes).

## Data and permissions

New P10 data (`report_schedules` per the phase handoff, `reports.ts` contract): schedules (report id, saved filters, formats, cadence, timezone, after-close flag, recipients, channels, message, owner, active) and export jobs (report, filters, format, rows, status, document id in `DocumentStore`, expiry). Running a schedule renders the report with the owner's `PolicyService` scope; before attaching it to an email the worker checks each recipient's `report.read` scope covers the same data and skips those who do not (the owner is notified). Channel posts contain a short summary and a link that requires sign-in. If the owner loses access or leaves, the schedule pauses and Finance Admin is notified. New action `report.schedule` (integrator adds; owners at owned scope, finance roles at tenant scope).

## States

| State               | Behaviour                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Schedules           | as above                                                                                 |
| Dialog              | as above                                                                                 |
| Validation          | "Add at least one recipient or channel"; "Choose a format"                               |
| Recipient warning   | warning tags as above; Save allowed (skipped people are reported after each run)         |
| Channel not allowed | channel select lists only allowed channels with "Ask an Integration Admin to allow more" |
| Partly delivered    | history shows who was skipped and why                                                    |
| Paused              | owner lost access: info banner "Paused because Meera Iyer no longer owns India Region"   |
| Failed run          | error tag with the reason and Retry                                                      |
| Exports             | as above                                                                                 |
| Empty               | "No schedules yet. Open a report and choose Schedule delivery."                          |
| Loading / error     | `sat-ghost` table; error banner with Retry                                               |

## Budget safety and audit

Schedules never widen access: attachments only reach people who could see the same figures, and channels get summaries only. Creating, changing, pausing and deleting schedules, every run (who received what) and every export download are audited.

## Responsive and accessibility

Desktop and tablet; mobile lists schedules with Pause and Run now. The dialog groups delivery options with fieldset legends; warning tags are text.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `mat-table` with `satTableWithRowStates`, `sat-status-tag` (Delivered, Partly delivered, Failed, Paused, Will be skipped), `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material dialog, chips autocomplete (recipients), select, time field, slide toggle, snackbar.

## Related screens and navigation

079 reports and every report, 011-018b dashboards, 16a board pack, 61e allowed channels, 61d channel post format, 80e period close (after-close schedules), 123 notifications, 088 audit log.

## Decisions taken

- Email attachments go only to recipients who can see the same data in BudgetFlow; others are skipped and the owner is told. Recommended so scheduled delivery never becomes a way around permissions.
- Slack and Teams channel posts carry headline figures and a sign-in link, never a file, because channel membership cannot be checked against BudgetFlow access.
- Recipients are limited to the Hyland directory; no external email addresses.
- Monthly packs can run "after period close" instead of on a fixed date, so they always use closed numbers.
- Export links expire after 7 days.
