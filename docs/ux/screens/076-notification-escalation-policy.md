# 076 Notification and escalation policy (SLA)

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch B. Build phase P7. Rules and policies > Notifications and SLA.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/076-notification-escalation-policy/default--desktop--light.png`.

## Purpose

Set how long each approval step may wait, when reminders go out, where an item escalates when time runs out, and which events notify whom by which channel, so approvals keep moving without spamming people.

## Roles

Finance Admin, Organization Admin (edit); Finance Controller and Auditor (read).

## Entry points

066 tabs and KPI "Approvals past SLA"; 063 escalation banners ("SLA: 1 business day").

## Content and actions

- SLA table by step type: budget owner 2 business days; parent owner 2; Finance Controller 1; CEO 3; tax approver 2; giving director (056a) 3. Columns: reminder at (50% and 1 hour before due), escalate to (next authority by DoA, or a named group), what the original approver keeps (can still decide until the escalation approver acts).
- Business calendar: working days per location (Bengaluru and Hyderabad Mon-Fri with India holidays; Westlake US holidays; London UK holidays) and quiet hours (no reminders 20:00-08:00 local).
- Notification matrix: events (request submitted, decision made, escalated, delegation started or ended, budget frozen, set to zero, threshold 50/80/100%, exception raised) by audience (requester, approver, owner, finance) and channel (in-app, email; Slack and Teams arrive in Phase 8, shown as "Coming in Phase 8" disabled).
- Digest: daily approver digest at 08:30 local (on); weekly owner digest (Phase 8, disabled).

Footer: Publish (versioned like rules).

## Data and permissions

SLA timers run in the worker and are idempotent; escalation uses the DoA matrix (070a) and the route (070). Users can mute optional notifications in 109/124, never required ones (decisions, escalations to them). `rule:edit`, `rule:publish`.

## States

| State      | Behaviour                                                         |
| ---------- | ----------------------------------------------------------------- |
| Default    | as above                                                          |
| Validation | SLA at least 1 business hour; reminder before due                 |
| Unsaved    | changes bar; publish dialog: open items keep their current timers |

## Budget safety and audit

Escalation never bypasses DoA or hygiene; reminders and escalations are audited in the request history (064). Policy versions are audited.

## Responsive and accessibility

Tablet: matrix scrolls with the event column pinned. Mobile: read-only. Matrix checkboxes have row and column labels.

## Related screens and navigation

059, 062, 063, 064, 070, 070a, 109 notification settings, 124 profile and preferences.

## Assumptions and open questions

- Business-day SLAs follow the approver's location calendar (assumed), not the requester's.
