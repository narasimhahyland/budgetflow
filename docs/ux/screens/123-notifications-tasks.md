# 123 Notifications and tasks

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 8 batch. Build phase P8. Notifications page (`/notifications`, tabs as `?tab=tasks|mentions|following`); the 000a bell panel links here; the mobile app's Alerts tab (59a) shows the same list.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the notifications panel of 000a. Planned Stitch states, to be generated in a later session:

| State                        | Planned image                                                       |
| ---------------------------- | ------------------------------------------------------------------- |
| all notifications            | `design/stitch/123-notifications-tasks/default--desktop--light.png` |
| tasks tab with overdue items | `tasks--desktop--light.png`                                         |
| empty (all caught up)        | `empty--desktop--light.png`                                         |
| mobile Alerts tab            | `alerts--mobile--light.png`                                         |

## Purpose

One place to see everything BudgetFlow has told you and everything it is waiting on you to do, so nothing that needs a person (an approval, a receipt, a commentary, an RSVP, a sign-off) gets lost between email, chat and the app.

## Roles

All roles, own notifications and tasks only. Employees and organizers mostly see receipts, RSVPs and decisions; owners see thresholds, controls and requests; finance sees queue and sign-off tasks.

## Entry points

000a bell panel "See all"; sidebar Notifications for Employee; 59a Alerts tab; digests (64a) "See all in BudgetFlow"; email and chat notifications deep-link to the related item and mark the notification read.

## Content and actions

Header bar: title, "Mark all as read", "Notification settings" (59c).

Tabs: All (unread count), Tasks (open count), Mentions, Following.

Filter chips: type (Approvals, Budgets, Events, Requests, Finance, Discussion), Unread only, period (Last 7 days, Last 30 days, Last 90 days).

All tab (sample Anand Kumar), grouped Today, Yesterday, Earlier:

- Approvals: "REQ-2026-0433 Team lunch, USD 180.00, waits for you" with Review (opens 061).
- Budgets: "Bengaluru Events passed 80% of USD 10,000.00" (warning icon); "Bengaluru Wellbeing was frozen by Meera Iyer" (lock icon, info tone).
- Requests: "REQ-2026-0418 approved by Meera Iyer" (success icon).
- Discussion: "Rahul Verma mentioned you on Bengaluru Diwali celebration" (opens 060a at the comment).
- Events: "Diwali celebration: 182 of 220 RSVPs are in" (47a).
- Each row: type icon, title, one-line detail, related item link, time in the user's timezone, unread dot; row menu Mark as read or unread.

Tasks tab: actionable items with due dates, sorted by due date; the task closes itself when the work is done.

| Task                                                  | Due            | Action               |
| ----------------------------------------------------- | -------------- | -------------------- |
| Approve REQ-2026-0433 Team lunch, USD 180.00          | Today 18:00    | Review (061)         |
| Upload receipt for REQ-2026-0145                      | 30 Nov         | Upload (121 or 59b)  |
| Add forecast commentary for Bengaluru Events          | 12 Nov         | Open forecast (87a)  |
| Book the photographer (Diwali celebration)            | 8 Nov, overdue | Open checklist (46b) |
| Respond to the reclaim notice for Bengaluru Wellbeing | 13 Nov         | Respond (86a)        |

Mentions tab: mentions of me, newest first, with the comment excerpt. Following tab: activity on items I follow (60a), with a link to the Following page.

Bulk: row checkboxes with a selection bar "Mark as read", "Mark as unread".

## Data and permissions

New P8 data (`notifications` per the phase handoff, `channels.ts` contract): notifications (recipient, type, item, title, detail, created, read at, channels delivered) and tasks derived from open work items (approval tasks, receipt requirements, forecast submissions, checklist tasks, sign-offs, reclaim notices). Own records only (`tenant.read`). Tasks are computed from the underlying item's state, so they cannot be dismissed or marked done by hand; they close when the approval, upload or submission happens on any channel. Notifications older than 90 days are archived and no longer listed (the audit log keeps every money event regardless).

## States

| State          | Behaviour                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Default        | as above                                                                                          |
| Tasks          | as above; overdue tasks carry a warning tag "Overdue"                                             |
| Empty          | `sat-empty-state` "You're all caught up" with "Notification settings"                             |
| Filtered empty | "Nothing matches these filters" with Clear filters                                                |
| Bulk selection | selection bar with counts                                                                         |
| Item gone      | related item deleted or out of scope: the row reads "No longer available" and its link is removed |
| Loading        | `sat-ghost` rows                                                                                  |
| Error          | `sat-500-error-state` with Retry; a failed mark-as-read reverts the dot and shows a snackbar      |

## Budget safety and audit

Icons and tones follow the budget-safety rules: frozen (info with lock), set to zero (important), soft warning (warning), approved (success); every row also says it in words. Reading or marking notifications is not audited; the underlying money events are.

## Responsive and accessibility

Tablet: filters collapse into a "Filters" button. Mobile (59a Alerts tab): tabs as a segmented control, rows as cards with the action button full width. The list is a feed with each item announced as "unread" or "read"; the unread count is announced when it changes.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `satInteractiveTag` (filters), `mat-table` with `satTableWithRowStates`, `satRowPrimaryAction` and `sat-selection-bar`, `sat-status-tag` (Overdue, Due today), `sat-empty-state`, `sat-ghost`, `sat-500-error-state`; Angular Material menu, checkbox, snackbar.

## Related screens and navigation

000a notifications panel, 59a mobile Alerts tab, 59c notification channels, 60a comments and follow, 061 decision, 121 upload receipt, 46b checklist, 47a RSVP, 87a forecast cycle, 86a reclaim, 080c tie-out sign-off, 64a digests.

## Decisions taken

- Tasks are derived from system state and close themselves; nobody can tick an approval or receipt task done by hand. Recommended so the task list never disagrees with reality.
- Notifications are listed for 90 days, then archived; the audit log remains the permanent record of money events.
- Opening a notification from any channel (email, Slack, Teams, push) marks it read in the app.
- One page with four tabs (All, Tasks, Mentions, Following) instead of separate pages for tasks and mentions.
