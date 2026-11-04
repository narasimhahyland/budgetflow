# 097 Calendar integration

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Admin > Integrations > Calendar (`/integrations/outlook`, `/integrations/google-calendar`), in the connector frame of 092.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the connector frame of 092. Planned Stitch states, to be generated in a later session:

| State                      | Planned image                                                        |
| -------------------------- | -------------------------------------------------------------------- |
| Outlook overview (mock)    | `design/stitch/097-calendar-integration/default--desktop--light.png` |
| response mapping and rules | `rules--desktop--light.png`                                          |
| admin consent required     | `consent--desktop--light.png`                                        |

## Purpose

Send event invitations as real calendar events from a shared BudgetFlow calendar and read people's calendar responses back into RSVPs (47a), so attendees answer where they already manage their time and organizers see one headcount.

## Roles

Integration Admin (connect, settings); Organization Admin (read); event organizers see the effect in 47a ("Synced with Outlook").

## Entry points

092 calendar tiles; 47a composer "Send as calendar event"; sync errors in 100.

## Content and actions

Connectors: Microsoft Outlook (Microsoft Graph) and Google Calendar.

Overview (sample Outlook, Mock): sending calendar: shared mailbox `events@example.test`; 3 events with synced invitations; responses synced in the last 24 hours: 214 (Accepted 168, Declined 14, Tentative 32); change notifications active (renew in 2 days).

Rules (Sync tab):

- Accepted becomes Going; Declined becomes Can't go; Tentative stays No response and the person gets one reminder "Please choose Going or Can't go" (BudgetFlow has no Maybe, 47a).
- Capacity: an Accepted response beyond capacity becomes Waitlisted and the person receives an updated invitation saying so.
- Last answer wins across channels (calendar, invitation page, email link); the RSVP history shows each answer with its channel.
- Event changes in BudgetFlow (time, place, cancellation) update or cancel the calendar event; changes made directly in the calendar are not read back (BudgetFlow stays the source of the event).
- Organizer as sender: off by default (would need each organizer's consent); the shared calendar sends on their behalf with "Organized by Rahul Verma" in the event.

Connection: tenant or domain, shared mailbox or calendar, admin consent status, scopes requested (send and read events of the shared calendar only).

## Data and permissions

Calendar events and responses map to invitations and `event_participants.rsvp_status` through the P9 invitation API; sync uses provider change notifications plus a 15-minute catch-up; runs record in `sync_runs`. `integration.manage` to configure. Only the shared calendar is accessed; BudgetFlow never reads personal calendars or free-busy data.

## States

| State                | Behaviour                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Not connected        | 47a falls back to email invitations with a calendar file (P9 behaviour)                          |
| Consent required     | warning banner with "Grant consent" for the provider's admin                                     |
| Overview             | as above                                                                                         |
| Notification expired | warning "Change notifications expired; responses sync every 15 minutes until renewed" with Renew |
| Loading / error      | `sat-ghost`; provider errors go to 100                                                           |

## Budget safety and audit

Responses change attendance expectations only; money changes happen in 47e when attendance is final. Connection and rule changes are audited; individual responses are recorded in the invitation history, not the audit log.

## Responsive and accessibility

Desktop and tablet; mobile read-only overview. Rules are written as sentences, not only arrows.

## Satori components

Connector frame from 092; `mat-table`, `sat-status-tag`, `sat-banner`, `sat-ghost`; Angular Material slide toggles, form fields, snackbar.

## Related screens and navigation

047a invitations and RSVP, 47e attendance, 046 event details, 092 hub, 099 sync status, 100 errors.

## Decisions taken

- Invitations are sent from one shared BudgetFlow calendar, not from each organizer's personal calendar. Recommended so only one admin consent is needed and personal calendars are never accessed.
- Tentative calendar answers count as no response and trigger one reminder, because BudgetFlow RSVPs have no Maybe.
- The last answer from any channel wins, and the history shows all of them.
- BudgetFlow stays the source of event details; edits made in the calendar are not read back.
