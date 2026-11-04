# 046b Checklist, tasks and agenda

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 9 batch. Build phase P9. Event details (046), new tab "Plan" with sub-tabs Checklist and Agenda (`/events/:eventId/plan`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) inside the 046 page frame. Planned Stitch states, to be generated in a later session:

| State                                   | Planned image                                                           |
| --------------------------------------- | ----------------------------------------------------------------------- |
| checklist with an overdue task          | `design/stitch/046b-checklist-tasks-agenda/default--desktop--light.png` |
| task drawer                             | `task-drawer--desktop--light.png`                                       |
| agenda editor                           | `agenda--desktop--light.png`                                            |
| empty plan (apply a template checklist) | `empty--desktop--light.png`                                             |
| employee view of the agenda (mobile)    | `agenda--mobile--light.png`                                             |

## Purpose

Replace the side spreadsheet and chat thread with one shared plan per event: what has to happen before, on and after the day, who owns each task and by when, and the agenda attendees see, with the money-related steps (choose a quote, upload receipts, send the survey) linked to where they are done.

## Roles

Event Organizer and co-organizers (edit, assign, complete); task assignees (complete their own tasks, comment); contributing owners and Finance Controller (read); invited employees see the agenda only (on their invitation, 47a).

## Entry points

046 tab "Plan"; 043 attention item "Book the photographer is overdue"; 123 task; reminder email or chat message for an assigned task; template checklist applied in 045 or 45a.

## Content and actions

Checklist sub-tab (sample Bengaluru Diwali celebration, EVT-2026-0112, 14 Nov 2026, organizer Rahul Verma, co-organizer Kavya Shah):

- Progress line: "11 of 16 tasks done; 1 overdue"; filters: assignee, status (Open, Done), section.
- Sections Before, On the day, After; each task row: checkbox, title, assignee avatar, due date, link chip for system tasks, comment count.
  - Before: "Confirm venue booking" (done, Rahul); "Choose caterer" (done; linked "Quote selected: Spice Route Caterers" -> 51a); "Send invitations" (done -> 47a); "Book the photographer" (Kavya, due 7 Nov, overdue tag); "Order decorations" (done; linked PO-2026-0233 -> 051); "Share dietary counts with the caterer" (due 12 Nov -> 47b export).
  - On the day: "Set up registration desk"; "Mark attendance" (-> 47e).
  - After: "Upload receipts within 7 days" (-> 121); "Send survey" (automatic on 15 Nov -> 54a); "Start reconciliation" (-> 053).
- "Add task" inline row; drag to reorder within a section.
- System tasks (linked chips) complete themselves when the linked work is done and cannot be ticked by hand.

Task drawer: title, description, assignee (organizer or co-organizers, or anyone invited as a helper), due date, reminder (1 day before, on the day), section, link (optional, to a quote, commitment or document), comments (60a thread scoped to the task), history.

Agenda sub-tab: timeline of items (time, title, location or room, host, notes), "Visible to invitees" toggle per item, "Add item", drag to reorder. Sample: 18:00 Welcome and lamp lighting (Atrium); 18:30 Rangoli contest; 19:15 Dinner (Cafeteria, vegetarian and non-vegetarian counters); 20:30 Awards.

## Data and permissions

New P9 data (`event_checklists` per the phase handoff, `events.ts` extension): checklist tasks (event, section, title, assignee, due date, reminder, status, linked item type and id, system or manual, order) and agenda items (event, start, end, title, location, host, notes, visible to invitees). `event.manage` for organizers and co-organizers; assignees may complete and comment on their own tasks; read for anyone with `event.read`. Reminders go through the person's channels (59c) and appear as 123 tasks. System tasks are driven by the linked item's state from the API.

## States

| State           | Behaviour                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Default         | as above                                                                                                                 |
| Overdue         | task row with a warning tag "Overdue"; assignee and organizer get one reminder per day                                   |
| Task drawer     | as above                                                                                                                 |
| Empty           | `sat-empty-state` "No plan yet" with "Use the Diwali celebration checklist" (from the event's template) and "Add a task" |
| System task     | checkbox disabled with tooltip "Completes when the quote is selected"                                                    |
| Agenda          | as above; employee view shows only items marked visible                                                                  |
| Read-only       | contributors and finance: no checkboxes, no Add buttons                                                                  |
| Event closed    | plan read-only, kept for the next clone (45a)                                                                            |
| Loading / error | `sat-ghost` rows; failed tick reverts with a snackbar                                                                    |

## Budget safety and audit

The plan never moves money; money steps link to the screens that do (51a, 051, 121, 053) with their own checks. Task creation, assignment, due-date changes and completion are recorded in the event's Activity tab; they are not financial audit entries, except that linked money actions are audited where they happen.

## Responsive and accessibility

Tablet: drawer overlays. Mobile: sections collapse; each task is a card with a large checkbox; agenda is a vertical timeline. Checkboxes are named with the task title; drag-and-drop has keyboard alternatives (Move up, Move down in the row menu).

## Satori components

`sat-navigation-tabs` (Checklist, Agenda inside the 046 "Plan" tab), `satDragDropList` and `satDragDropItem` (task and agenda order), `sat-status-tag` (Overdue, Done), `satInlineChip` (linked item chips), `sat-empty-state`, `sat-ghost`; Angular Material checkbox, side sheet (task drawer), datepicker, time fields, select, slide toggle, snackbar.

## Related screens and navigation

046 event details, 043 events dashboard, 45a templates (checklist and agenda defaults), 47a invitations (agenda shown to invitees), 47b needs export, 47e attendance, 51a quotes, 051 commitments, 121 upload receipt, 54a survey, 053 reconciliation, 60a comments, 123 tasks.

## Decisions taken

- Checklist and agenda live in one "Plan" tab of event details rather than separate pages. Recommended because organizers plan both together.
- System tasks linked to money or evidence steps complete automatically and cannot be ticked by hand.
- Assignees can be the organizer, co-organizers or invited helpers; helpers see only their own tasks and the agenda, not the event's money.
- Only agenda items marked "Visible to invitees" appear on invitations.
