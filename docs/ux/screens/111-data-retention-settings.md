# 111 Data-retention settings

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Settings > Data retention (`/admin/retention`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the settings layout of 102. Planned Stitch states, to be generated in a later session:

| State                                | Planned image                                                           |
| ------------------------------------ | ----------------------------------------------------------------------- |
| retention by data category           | `design/stitch/111-data-retention-settings/default--desktop--light.png` |
| next run preview                     | `preview--desktop--light.png`                                           |
| legal hold                           | `legal-hold--desktop--light.png`                                        |
| shorten below default (confirmation) | `shorten-confirm--desktop--light.png`                                   |

## Purpose

Keep each kind of data exactly as long as it is needed: accounting records and the audit trail permanently, financial evidence for the statutory period, and personal or engagement data (attendee needs, photos, AI conversations, leavers' personal details) only as long as useful, with legal holds that pause deletion and a preview of what the next run will remove.

## Roles

Organization Admin and Finance Admin (edit within limits); Finance Controller (confirms any change that shortens a financial category); Auditor (read; places and releases legal holds with Finance Controller); Super Admin (job status only).

## Entry points

Settings > Data retention; 110 documents "Retention"; 054a gallery "Photos kept 12 months"; 047b attendee needs "Deleted 30 days after close"; 113a "Conversation history"; 114 system health "Retention job".

## Content and actions

Retention table (category, kept for, then, minimum, status):

- Ledger journals and lines: permanently; never deleted; locked ("Accounting records are append-only").
- Audit log and hash chain: permanently; locked.
- Requests, approvals, commitments, actuals: 8 years after the fiscal year closes; then archived read-only; minimum 7 years.
- Receipts, invoices and quotations: 8 years after the fiscal year closes; then deleted; minimum 7 years.
- Event records (budgets, costs, splits): 8 years; archived.
- Attendee needs (dietary, accessibility, travel): 30 days after the event closes; deleted; locked by the 047b decision.
- Survey responses (anonymous): 24 months; deleted.
- Event photos: 12 months after the event; deleted (1-36 months).
- AI conversations (11a): 30 days; deleted (7-90 days, set in 113a).
- AI query log: 13 months; deleted; minimum 13 months.
- Product analytics events: 25 months; deleted.
- Notifications: 12 months; deleted.
- People who left: personal details anonymised 90 days after deactivation; financial records keep a pseudonymous reference.
- Integration sync logs and webhook deliveries: 90 days; deleted.
- Export files and links: 7 days (091); deleted.

Next run preview (nightly 01:00 IST): "Tonight: 312 photos deleted (events before Nov 2025), 4 leavers anonymised, 1,920 notifications deleted. Nothing under legal hold is touched." Run history: date, items removed by category, status.

Legal holds: list (scope: person, event, budget or date range; reason; placed by; confirmed by; placed on; status). "Place a hold": scope picker, reason, confirmation by a second person (Auditor and Finance Controller); "Release" with reason.

## Data and permissions

New P14 `retention_policies` table (per the phase handoff) in `admin.ts`: category, period, action (delete, anonymise, archive), minimum, locked flag; legal holds with scope and two-person confirmation; a nightly worker job applies policies, skips held items and writes a run report. Ledger, journals and audit events are never deleted (append-only, enforced in the database); anonymisation replaces personal fields on the person record, so ledger lines and audit entries keep their references. `tenant.settings.manage` (Organization Admin) or `master_data.manage` (Finance Admin) to edit; a new `retention.confirm` action for Finance Controller and `legal_hold.manage` for Auditor (integrator adds).

## States

| State                | Behaviour                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Default              | table, preview, holds                                                                           |
| Edit period          | inline number and unit; Save                                                                    |
| Below minimum        | error "Receipts must be kept at least 7 years"; Save disabled                                   |
| Shorten confirm      | warning dialog with the items affected at the next run; "Needs Finance Controller confirmation" |
| Pending confirmation | warning tag on the row; old period stays in force                                               |
| Locked               | lock icon with the reason in text                                                               |
| Hold active          | info tag on affected categories "1 legal hold: Offsite 2026 (EVT-2026-0087)"                    |
| Run failed           | error banner "Last night's retention run failed; nothing was deleted" with the log link (114)   |
| Read only            | Auditor and others: no edit controls (Auditor keeps hold actions)                               |
| Loading / error      | `sat-ghost`; error banner with Retry                                                            |

## Budget safety and audit

Accounting records and the audit trail are never deleted, whatever the settings. Shortening a financial category needs a Finance Controller, and holds need two people. Every setting change, hold, release and nightly run is audited (runs as system entries with counts, never with the deleted content).

## Responsive and accessibility

Desktop and tablet; mobile read-only. Periods are written in words ("8 years after the fiscal year closes"); locked rows explain why in text.

## Satori components

`sat-header-bar`, `mat-table` with `satTableWithRowStates`, `sat-status-tag` (locked, hold, pending), `sat-banner`, `sat-rich-tooltip` (minimum explanation), `sat-ghost`, `sat-empty-state` (no holds); Angular Material form fields, select, dialog (shorten, place hold), snackbar.

## Related screens and navigation

110 documents, 113 audit and compliance, 113a AI settings, 047b attendee needs, 054a survey and gallery, 088 audit log, 091 exports, 103 users (deactivation), 114 system health.

## Decisions taken

- Ledger and audit records are kept permanently; personal data is removed from them by anonymising the person record, not by deleting entries. Recommended because the ledger is append-only and the audit chain must verify.
- Financial evidence is kept 8 years after the fiscal year closes by default, with a 7-year minimum; jurisdiction-specific periods need finance and legal sign-off.
- Shortening a financial category needs the Finance Controller's confirmation; legal holds need two people and pause every deletion in their scope.
- Leavers' personal details are anonymised 90 days after deactivation.
- Event photos default to 12 months (configurable 1-36), resolving the 54a placeholder.
