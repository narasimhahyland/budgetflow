# 059c Notification channels and push settings

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 8 batch. Build phase P8. Review-added screen (catalog section H: push on the installable app, Slack and Teams delivery). User menu > Notification settings (`/me/notifications`); mobile app avatar > Notifications (`/m/settings/notifications`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the card layout of 124. Planned Stitch states, to be generated in a later session:

| State                               | Planned image                                                               |
| ----------------------------------- | --------------------------------------------------------------------------- |
| channels and matrix (desktop)       | `design/stitch/059c-notification-channels-push/default--desktop--light.png` |
| mobile, push being turned on        | `push-permission--mobile--light.png`                                        |
| push blocked by the browser         | `push-blocked--mobile--light.png`                                           |
| Slack not linked, Teams not offered | `chat-not-linked--desktop--light.png`                                       |

## Purpose

Let each person choose where BudgetFlow reaches them (in-app, email, push on their phone, Slack, Microsoft Teams), which optional notifications they want, how often their digest arrives and when to stay quiet, while required notifications (decisions and approvals that need them) always get through.

## Roles

All roles, own settings only. Company defaults and the list of required notifications come from 076 (notification and escalation policy) and 109 (notification settings, P14).

## Entry points

User menu "Notification settings" (000a); 124 Notifications card "Manage channels"; mobile app avatar menu; footer link "Manage notification settings" in every email and digest; 59a after installing the app ("Turn on push alerts?").

## Content and actions

Sample user Meera Iyer (Regional Manager India, timezone Asia/Kolkata).

- Channels card, one row per channel with state and action:
  - In-app: always on.
  - Email: meera.iyer@example.test (from the identity provider), on.
  - Push on this device: "Off" with "Turn on" (asks the browser for permission); device list below: "Pixel 8, Chrome, added 3 Nov 2026" with Remove.
  - Slack: "Linked as @meera.iyer" with Unlink; or "Connect Slack" (opens the account-linking flow of 61e).
  - Microsoft Teams: "Not linked" with "Connect Teams"; hidden when the company has not installed the Teams app (61e).
  - "Send a test notification" per enabled channel.
- Notification matrix: rows grouped by area, columns In-app, Email, Push, Slack, Teams (checkboxes).
  - Approvals: assigned to me (Required), escalated to me (Required), reminders before the SLA, decided on my request (Required).
  - Budgets I own: alert thresholds 50%, 80%, 100%; frozen, reduced or set to zero (Required for owners); allocation received; co-funding request received.
  - Events: invitations and RSVP reminders, event changed or cancelled, task assigned to me (46b).
  - Discussion: mentions of me, replies to my comments, activity on items I follow (60a).
  - Finance tasks: receipt needed, forecast commentary required (87a), sign-off ready (080c, 080e).
  - Required rows: In-app and Email checked and disabled with the tooltip "Required: you need this to act on time"; Push, Slack and Teams stay optional.
- Digest card: frequency (Daily at 08:30, Weekly on Monday at 08:30, Off), channel (Email, Slack, Teams), template name from 64a ("Approver daily digest"), toggle "Send non-urgent notifications in my digest instead of one by one", link "Preview my next digest".
- Quiet hours card: 20:00 to 08:00 local (company default from 076, can be extended, not shortened), weekend quiet toggle; note "Push, Slack and Teams wait until quiet hours end. Email still arrives."
- Privacy card: "Show amounts in push notifications" (off by default; lock screens show the request and person, not the amount).
- Footer: changes save per control with a snackbar; no global Save button.

## Data and permissions

New P8 data (`channels.ts` contract, `libs/api/channels`): notification preferences per user and notification type, push subscriptions per device (Web Push endpoint and keys, user agent family, created at), chat account links (61e). Own record only (`tenant.read`); nobody else can read or change another person's channels. Required types are defined by policy (076) and enforced by the API: a request to turn off a required in-app or email notification is rejected with `NOTIFICATION_REQUIRED`. Push uses the Web Push standard with VAPID keys held by the API (configuration reference only, never in the repository).

## States

| State              | Behaviour                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Default            | as above                                                                                                                |
| Push permission    | browser prompt; on accept the device appears in the list and a test push arrives                                        |
| Push blocked       | warning banner "Your browser blocks notifications from BudgetFlow" with steps for the current browser; Turn on disabled |
| Push not supported | info line "Install BudgetFlow to your home screen to get push on this phone" (iOS before install)                       |
| Chat not installed | Slack or Teams row shows "Your company has not connected Slack yet" (neutral), no action                                |
| Chat linked        | "Linked as @meera.iyer"; Unlink asks for confirmation and removes Slack from every row                                  |
| Test sent          | snackbar "Test sent to Slack"; failure shows the reason ("Slack account unlinked by the workspace admin")               |
| Saved              | snackbar "Saved"; the matrix updates in place                                                                           |
| Loading / error    | `sat-ghost` cards; error banner with Retry; a failed save reverts the control and explains                              |

## Budget safety and audit

No money moves here. Preference changes are product analytics events, not audit entries; linking or unlinking a chat account and adding or removing a push device are audited (they change who can act on approvals from outside the app).

## Responsive and accessibility

Desktop and tablet: matrix as a table with row and column headers. Mobile: the matrix becomes one card per area with a channel chip row per notification type. Checkboxes have names like "Push for Approvals assigned to me". Disabled required checkboxes explain why in visible text, not only a tooltip.

## Satori components

`sat-header-bar`, `satCardSurfaceContainerLowest` cards, `sat-status-tag` (Linked, Not linked, Required), `sat-banner` (push blocked, not supported), `sat-rich-tooltip` (Required explanation on desktop), `sat-ghost`; Angular Material slide toggles, checkboxes, select, time pickers (form fields), snackbar.

## Related screens and navigation

124 profile and preferences, 076 notification and escalation policy, 109 notification settings (P14), 59a mobile approvals, 61b, 61c, 61d chat surfaces, 61e chat app setup and linking, 64a digest templates, 123 notifications and tasks.

## Decisions taken

- Required notifications always reach In-app and Email; Push, Slack and Teams are optional extras. Recommended so nobody misses an approval because a phone or chat link changed.
- Lock-screen push hides amounts by default with a per-user opt-in.
- Quiet hours hold push, Slack and Teams but not email; users can extend the company quiet hours, not shorten them.
- One page for all channels (this screen) instead of channel settings spread across 124, Slack and the mobile app; 124 keeps a summary with a "Manage channels" link from P8.
- Non-urgent notifications can be bundled into the digest by a single toggle rather than a per-row "digest" column, to keep the matrix readable.
