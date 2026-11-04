# 060a Comments, mentions, follow and watch

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 8 batch. Build phase P8. A shared "Discussion" panel and "Follow" control on budget details (021), request details (060) and event details (046), plus the "Following" page (`/me/following`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a); the panel sits on the existing 021, 046 and 060 layouts. Planned Stitch states, to be generated in a later session:

| State                                         | Planned image                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| discussion panel open on event details        | `design/stitch/060a-comments-mentions-follow/default--desktop--light.png` |
| mention picker with a person who lacks access | `mention-picker--desktop--light.png`                                      |
| follow menu open                              | `follow-menu--desktop--light.png`                                         |
| following page                                | `following--desktop--light.png`                                           |
| discussion on mobile (full screen)            | `discussion--mobile--light.png`                                           |

## Purpose

Keep the conversation about a budget, request or event next to the numbers, so approvers see the context at decision time, organizers stop coordinating in side chats, and stakeholders can follow a budget or event without being asked to approve anything.

## Roles

Anyone who can read the item can comment, mention and follow it: owners and co-owners, requesters, approvers, organizers and co-organizers, contributing owners, Finance Controller, Finance Admin. Auditors and Analysts read the discussion but cannot comment.

## Entry points

"Discussion (4)" button and "Follow" control in the header bar of 021, 046 and 060; mention notifications in 123, email, push, Slack and Teams ("Rahul Verma mentioned you on Bengaluru Diwali celebration"); 59a approval detail "View all" comments; "Following" in the user menu.

## Content and actions

Discussion panel (side sheet, 400 px) on Bengaluru Diwali celebration (EVT-2026-0112):

- Header: "Discussion", item name, comment count, close.
- Thread, oldest first, replies one level deep:
  - Rahul Verma (Event Organizer), 3 Nov 10:12: "Caterer quote came in at INR 5,01,000.00 for 220 people. @Anand Kumar can we fund it from Bengaluru Events?"
  - Anand Kumar (Location Manager), 3 Nov 11:05, reply: "Yes, submit it. @Meera Iyer it is above my USD 5,000.00 step, so it will reach you."
  - System entry (neutral, not a comment): "REQ-2026-0418 submitted for USD 6,000.00", linking to 060.
  - Meera Iyer, 4 Nov 09:30: "Approved. Please send the headcount after RSVPs close."
- Composer: multiline field "Write a comment. Type @ to mention someone.", Comment button; formatting limited to line breaks and links.
- Mention picker: people who can see this item, with role and office; people without access are listed greyed with "Can't see this event" and cannot be selected.
- Own comments: Edit (within 15 minutes), Delete (leaves "Comment removed by Rahul Verma, 3 Nov 10:20").

Follow control (header bar): "Follow" button with a bell icon; once following it shows "Following" with a menu: "All activity", "Money and decisions only" (allocations, controls, approvals, commitments, status changes), "Unfollow". Owners, organizers, requesters and current approvers follow automatically and see "Following (owner)".

Following page: table of followed items (type icon, name, status tag, last activity with time, notification level, Unfollow); filters by type (Budgets, Events, Requests); search.

## Data and permissions

New P8 data (`channels.ts` contract, `libs/api/channels`): comments (item type and id, author, body, parent comment, created, edited, removed), mentions (comment, mentioned person, notified), follows (person, item type and id, level, automatic or manual). The API checks `PolicyService.can(<item>.read)` for reading and commenting, and checks every mentioned person's read access before saving; a mention of someone without access is rejected with `MENTION_NO_ACCESS`. Mentions notify through the person's channels (59c). Comments are never edited after 15 minutes and never hard-deleted: removal hides the text in the thread while the audit log keeps it.

## States

| State             | Behaviour                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Default           | as above                                                                                                    |
| Empty             | "No comments yet. Start the discussion or mention someone who should know."                                 |
| Mention picker    | as above; keyboard navigation with arrows and Enter                                                         |
| No-access mention | picker row disabled with "Can't see this event"; pasting a name shows an inline error after posting attempt |
| Edit window over  | Edit hidden; tooltip "Comments can be edited for 15 minutes"                                                |
| Removed           | tombstone line; replies stay                                                                                |
| Read-only role    | composer replaced by "Auditors can read the discussion" (Auditor, Analyst)                                  |
| Item closed       | event Closed or request decided: commenting stays open for 30 days, then the thread becomes read-only       |
| Following page    | as above; empty state "You are not following anything yet"                                                  |
| Loading / error   | `sat-ghost` lines; failed post keeps the text in the composer with Retry                                    |
| Success           | new comment appears with "Sent"; mentioned people get a notification within a minute                        |

## Budget safety and audit

Comments never change money or decisions: decision reasons stay on the decision (061) and appear in the thread only as system entries. Comment create, edit and remove are audited with the original text; follow and unfollow are product analytics only. A comment cannot approve, reject or request changes, even when it says so.

## Responsive and accessibility

Tablet: side sheet overlays the page. Mobile: Discussion opens full screen with the composer pinned above the keyboard. The thread is a list with each comment's author and time read first; mentions are links with the person's name; the picker is a combobox with announced results.

## Satori components

`sat-header-bar` (Discussion button and Follow control), `sat-split-button` (Following with its menu), `sat-status-tag` (item status on the Following page), `satInlineChip` (mention chips), `sat-empty-state`, `sat-ghost`, `mat-table` with `satTableWithRowStates` (Following page); Angular Material side sheet, autocomplete (mention picker), menu, form field, snackbar.

## Related screens and navigation

021 budget details, 046 event details, 060 request details, 059 and 59a approval detail, 123 notifications and tasks, 59c notification channels, 088 audit log. The panel deep-links with `?discussion=open#comment-<id>` so notifications land on the comment.

## Decisions taken

- People without read access cannot be mentioned, and mentioning never grants access. Recommended because sharing budget details through a comment would bypass `PolicyService`.
- Comments are editable for 15 minutes, never hard-deleted, and kept in full in the audit log.
- No attachments in comments: documents go to 052 or 121 so evidence stays in one place; comments can link them.
- Owners, organizers, requesters and current approvers follow automatically; anyone with read access can follow manually at two levels (all activity, or money and decisions only).
- Comments stay open 30 days after an event closes or a request is decided, for late questions, then lock.
