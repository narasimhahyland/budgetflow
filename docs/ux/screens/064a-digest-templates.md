# 064a Role-based digest templates

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 8 batch. Build phase P8. Admin > Notifications > Digests (`/admin/digests`, editor `/admin/digests/:templateId`); the digest itself is delivered by email, Slack and Teams.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the 640 px email frame of 061a for the email preview. Planned Stitch states, to be generated in a later session:

| State                                   | Planned image                                                     |
| --------------------------------------- | ----------------------------------------------------------------- |
| template list                           | `design/stitch/064a-digest-templates/default--desktop--light.png` |
| editor with email preview               | `editor--desktop--light.png`                                      |
| editor with Slack preview               | `preview-slack--desktop--light.png`                               |
| owner weekly digest email (as received) | `digest-email--mobile--light.png`                                 |

## Purpose

Replace a stream of single notifications with one useful summary per role: approvers see what waits for them each morning, owners see their budget position weekly, finance sees the queues that block close, executives see the company picture. Admins decide what each digest contains; people decide whether and where they receive it (59c).

## Roles

Finance Admin and Organization Admin (create, edit, publish templates); Finance Controller and Auditor (read). Every user receives the digests their roles qualify for and can change frequency, channel or turn them off in 59c.

## Entry points

Admin > Notifications > Digests; 076 notification policy "Digests" link; 59c "Preview my next digest"; footer of every digest "Manage notification settings".

## Content and actions

Template list (table): name, audience roles, frequency and send time (recipient's local time), channels allowed, recipients (count), last sent, status tag (Published, Draft changes, Off). Default templates:

| Template                | Audience                   | When           | Sections                                                                                                                                          |
| ----------------------- | -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approver daily digest   | anyone with approval tasks | weekdays 08:30 | waiting for you (count, oldest, due today), escalated to you, delegations starting or ending                                                      |
| Owner weekly digest     | BO, DH, RM, LM             | Monday 08:30   | budget position (available, utilization, change since last week), thresholds crossed, pending requests, unused budget days left, receipts missing |
| Organizer weekly digest | EO and co-organizers       | Monday 08:30   | upcoming events with RSVP counts, open tasks (46b), quotes awaiting selection (51a), receipts missing                                             |
| Finance weekly digest   | FC, FA                     | Monday 08:00   | unmatched actuals by age, open exceptions, accruals to review, tie-out status, recharges awaiting tax approval, sync errors                       |
| Executive weekly digest | CEO                        | Monday 08:00   | company-wide Available, utilization by region, controls applied (freeze, reduce, set to zero), approval cycle time, forecast against authorized   |

Editor:

- Left: name; audience roles (multi-select); frequency (Daily weekdays, Weekly with day); send time; channels allowed (Email, Slack, Teams); intro line (plain text, 300 characters); sections as a reorderable list with a toggle and options per section (for example "Show up to 5 items"); "Skip sending when there is nothing to report" (on).
- Right: live preview with tabs Email, Slack, Teams; "Preview as" person picker (sample Anand Kumar) that renders his real scoped figures; "Send test to me".
- Footer: Discard, Publish (new version; applies from the next send).

Owner weekly digest as received (sample for Anand Kumar, Monday 9 Nov 2026): header with BudgetFlow and "Hyland"; "Your budgets this week"; Bengaluru Events available USD 7,450.00 of USD 10,000.00, 25.5% used (up 4.1 points); "Passed 80%" none; "Waiting on others: REQ-2026-0433 Team lunch USD 180.00, with you"; "Unused: Bengaluru Wellbeing has USD 2,300.00 left and 52 days in FY2026"; "2 receipts missing"; button "Open BudgetFlow"; footer settings link.

## Data and permissions

New P8 data (`digests` per the phase handoff, `channels.ts` contract): templates with immutable published versions (sections, options, audience, schedule, channels). `tenant.settings.manage` or `notification.manage` (new action, integrator adds) to edit; `tenant.read` to view. The worker renders each digest per recipient at send time in the recipient's timezone, using that person's `PolicyService` scope, so two people on the same template see different figures; sends are idempotent per recipient and period. Figures come from the same read models as dashboards (011, 017, 018); nothing is computed in the template.

## States

| State             | Behaviour                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------ |
| List              | as above                                                                                   |
| Editor            | as above with the email preview                                                            |
| Slack/Teams tab   | preview rendered as Block Kit or Adaptive Card content                                     |
| Validation        | "Choose at least one section" and "Choose at least one channel"; Publish disabled          |
| Nothing to report | preview shows "This person would not get a digest this week (nothing to report)"           |
| Test sent         | snackbar "Test sent to your email"; failures show the channel's error                      |
| Publish dialog    | summary of changes and "Applies from Monday 9 Nov, 08:30 local"                            |
| Off               | template kept, no sends; recipients see it as unavailable in 59c                           |
| Read-only         | Finance Controller, Auditor: editor fields disabled                                        |
| Loading / error   | `sat-ghost` table and preview; preview error "Could not render for Anand Kumar" with Retry |

## Budget safety and audit

Digests show the same labelled figures as the app: company-wide Available only in the executive digest, "Available under this budget's rules" in owner digests; pending stays separate from committed and actual. Template publishes and changes are audited; individual digest sends are delivery logs, not audit entries.

## Responsive and accessibility

Admin pages: desktop and tablet; mobile read-only list. Digest emails: one 640 px column reflowing to the phone width, plain-text alternative part, tables with header cells, buttons at least 44 px high.

## Satori components

`sat-header-bar`, `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `satDragDropList` and `satDragDropItem` (section order), `sat-navigation-tabs` (preview channel tabs), `sat-splitter` (editor and preview), `sat-ghost`, `sat-empty-state`; Angular Material form fields, select, slide toggles, time picker, dialog (publish), snackbar. Digest emails use the 061a email template, not Satori components.

## Related screens and navigation

076 notification and escalation policy, 59c notification channels, 061b/61c/61d chat surfaces, 123 notifications and tasks, 011 executive dashboard, 017 alerts, 018 pending approvals, 109 notification settings (P14).

## Decisions taken

- Five default templates (approver daily, owner, organizer, finance and executive weekly) cover every role group; admins can add more.
- Digests skip sending when there is nothing to report, so an empty digest never trains people to ignore it.
- Each digest is rendered per recipient with that person's scope at send time, never as one shared document.
- Template changes are versioned and apply from the next scheduled send, never to a digest already rendered.
