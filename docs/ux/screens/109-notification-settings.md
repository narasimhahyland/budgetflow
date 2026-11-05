# 109 Notification settings (company defaults)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Settings > Notifications (`/admin/notifications`). Company defaults; each person adjusts within them in 59c; SLA reminders and escalations are set in 076; digest content in 64a.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the channel matrix of 59c. Planned Stitch states, to be generated in a later session:

| State                        | Planned image                                                         |
| ---------------------------- | --------------------------------------------------------------------- |
| defaults matrix              | `design/stitch/109-notification-settings/default--desktop--light.png` |
| quiet hours and sender       | `quiet-hours--desktop--light.png`                                     |
| delivery health              | `delivery--desktop--light.png`                                        |
| change defaults confirmation | `confirm--desktop--light.png`                                         |

## Purpose

Set, once for the whole company, which notifications exist, which are required, which channels they use by default for each role group, when BudgetFlow stays quiet and how messages are signed, and check that email, push and chat deliveries are actually arriving.

## Roles

Organization Admin (edit); Finance Admin (read; requests changes to finance notifications); Super Admin (delivery health only); Auditor (read).

## Entry points

Settings > Notifications; 59c "Company defaults" link (admins); 076 "Channels and quiet hours"; 64a "Delivery"; 114 system health "Email delivery".

## Content and actions

Tabs: Defaults, Quiet hours and sender, Delivery.

Defaults matrix: rows are notification types grouped by audience; columns In-app, Email, Push, Slack, Teams; each cell Default on or off; Required rows locked on for In-app and Email (lock icon, "Required"). Samples:

- Approvers: Approval needed (required), Escalated to you (required), Delegation started or ended (required), Approval due soon (on: In-app, Push).
- Requesters: Request decided (required), Changes requested (required), Receipt needed (on: In-app, Email, Push).
- Owners: Threshold reached 50/80/100% (on: In-app, Email; Slack if linked), Budget frozen, reduced or set to zero (required), Co-funding request received (required), Spending outlook nudge (on: In-app; 16b), Forecast commentary due (required during a cycle).
- Organizers and employees: Event invitation (on: In-app, Email), RSVP reminder (on: Email, Push), Survey invitation (on: Email).
- Finance: Unmatched actuals older than 30 days (on: In-app), Tie-out difference (required for Finance Controller), Integration failure (on: In-app, Email).
- Row menu: audience (role groups), "Allow people to turn off" (for optional rows), preview message.

Quiet hours and sender: company quiet hours 20:00-08:00 in each person's office timezone and weekends (on); held channels: Push, Slack, Teams (email is never held); urgent exception: "Escalated to you" ignores quiet hours (on); sender name "BudgetFlow at Hyland", reply-to address "budgetflow-noreply" with the note "Replies are not read"; footer text from branding (102b).

Delivery (last 24 hours and 7 days): email sent 1,240, bounced 3 (list with address domain and reason), push sent 410, failed 6 (expired devices removed), Slack 220, Teams 0 (not enabled), digest runs (64a) with status; "Send a test notification to me" per channel.

## Data and permissions

New P14 `admin.ts` notification defaults (type, audience, channel defaults, required flag, allow opt-out) and quiet-hours settings in `tenant_settings.settings`; delivery figures from the P8 `notifications` table and worker job results. `tenant.settings.manage` (Organization Admin) to change; `tenant.read` to view; Super Admin reads delivery health only. Defaults apply to people who have not changed that row in 59c; personal choices are never overwritten. Required types cannot be turned off for In-app and Email by anyone.

## States

| State               | Behaviour                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Defaults            | matrix as above                                                                                                          |
| Unsaved             | "Unsaved changes" bar with Save and Discard                                                                              |
| Confirm             | "This changes the default for 1,180 people who haven't customised it. 52 people with their own choice are not affected." |
| Channel unavailable | Teams column disabled with "Microsoft Teams app is off (105)"                                                            |
| Bounce spike        | warning banner "Email bounces above 2% in the last hour" with the bounce list                                            |
| Read only           | non-admins see the matrix without controls                                                                               |
| Validation          | "Quiet hours need a start and an end time", "Enter a sender name"                                                        |
| Loading / error     | `sat-ghost`; error banner with Retry                                                                                     |

## Budget safety and audit

Notifications about controls (freeze, reduce, set to zero), decisions and escalations are required and cannot be silenced, so nobody misses a change that affects their money or a decision waiting for them. Default changes are audited with old and new values and the number of people affected.

## Responsive and accessibility

Desktop and tablet; mobile read-only. The matrix is a table with row and column headers; locked cells say "Required" in text.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `mat-table`, `sat-status-tag` (delivery status), `sat-banner`, `sat-ghost`, `sat-rich-tooltip` (required explanation); Angular Material checkboxes, time pickers (form fields), select, dialog (confirm), snackbar.

## Related screens and navigation

059c personal notification channels, 076 notification and SLA policy, 064a digest templates, 061e chat apps, 102b branding, 105 feature flags, 114 system health, 123 notifications and tasks.

## Decisions taken

- Required notifications (decisions waiting, controls on your budgets, escalations) always reach In-app and Email, matching 59c. Recommended so a changed phone or chat link never hides an approval.
- Changing a company default affects only people who have not customised that row; personal choices are never overwritten.
- Quiet hours follow each person's office timezone and hold push and chat, never email; escalations ignore quiet hours.
- Replies to BudgetFlow emails are not read, and the footer says so.
