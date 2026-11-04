# 047e Attendance and per-head recalculation

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 9 batch. Build phase P9. Review-added screen (catalog section C: "per-head cost recalculated from RSVPs and attendance; split follows actual attendees"; plan P9: per-head limits checked on actual attendance). Event details (046) tab "People", sub-tab Attendance (`/events/:eventId/people/attendance`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the 046 frame and the split tables of 049. Planned Stitch states, to be generated in a later session:

| State                                       | Planned image                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| mark attendance                             | `design/stitch/047e-attendance-per-head-recalculation/default--desktop--light.png` |
| recalculation preview with soft warning     | `preview--desktop--light.png`                                                      |
| share above approved contribution (blocked) | `blocked--desktop--light.png`                                                      |
| apply new split confirmation                | `apply-dialog--desktop--light.png`                                                 |
| mark attendance on a phone                  | `attendance--mobile--light.png`                                                    |

## Purpose

Record who actually came, recalculate the cost per attendee from real attendance, check it against the per-head limit that applies, and move each location's and employing entity's share of the cost to follow the people who attended, so co-funders pay for their own attendees and no-show waste is visible.

## Roles

Event Organizer and co-organizers (mark attendance, apply the new split); contributing owners and the owning budget owner (see the preview, get notified, approve a larger share through 056a); Finance Controller (read; exceptions land in 074a).

## Entry points

046 People > Attendance; 46b task "Mark attendance" on the day; 47a banner "Expected attendance changed"; 053 reconciliation blocker "Attendance not final" (from P9); notification after the event "Mark attendance for Diwali celebration".

## Content and actions

Mark attendance (opens on the event's start day; sample Bengaluru Diwali celebration, EVT-2026-0112, 168 going):

- Toolbar: search, filter by location and RSVP; "Mark everyone going as attended" (bulk), "Add walk-in" (directory search, adds a participant with status Walk-in).
- Table: name, location, employing entity, cost center, RSVP, attendance (Attended, No-show, Walk-in, Not marked) as a three-way toggle per row.
- Counts strip: Attended 156, Walk-ins 3, No-shows 12, Not marked 0; "Attendance final" button (enabled when nobody is Not marked).

Recalculation (panel below the table, or the full preview after "Attendance final"):

- Headcount line: planned 220, going 168, attended 159 (156 plus 3 walk-ins).
- Cost line: event cost so far USD 8,740.00 (approved commitments and matched actuals); per head planned USD 40.91 (USD 9,000.00 cap / 220); per attendee actual USD 54.97; no-show cost USD 327.24 (12 no-shows x USD 27.27 catering per head from REQ-2026-0418, USD 6,000.00 for 220).
- Per-head limit check (rule R-31 v1, Festival events in Bengaluru, USD 50.00 per attendee, soft mode): warning banner "USD 54.97 per attendee is USD 4.97 above the limit. Finance will see an exception at reconciliation (074a)." In hard mode the banner is in the error tone and new commitments for the event are blocked with "Request an over-budget approval" (058).
- Cost split table, before (planned, by invited) and after (by attended), with the change:

| Share by location                                        | Planned (invited)  | After (attended)   | Change      |
| -------------------------------------------------------- | ------------------ | ------------------ | ----------- |
| Bengaluru Events (own funds)                             | 190 / USD 7,548.18 | 145 / USD 7,970.44 | +USD 422.26 |
| Hyderabad Events (IDBCR-2026-0058, earmark USD 1,200.00) | 30 / USD 1,191.82  | 14 / USD 769.56    | -USD 422.26 |
| Total                                                    | 220 / USD 8,740.00 | 159 / USD 8,740.00 | USD 0.00    |

- By employing entity: IN01 159 attendees (100%); "No intercompany change."
- Before the event the same panel works from RSVPs ("Based on 168 going"), clearly marked "Preview only: the split changes when attendance is final".
- Actions: "Apply new split" (`satImportantButton`) and "Keep planned split" (needs a reason).

Apply dialog: changes per funding line (Bengaluru Events +USD 422.26, Hyderabad Events -USD 422.26), effect on recharges (none), what happens ("Commitment funding lines are re-posted in Nov 2026; contributors are notified"), reason (prefilled "Actual attendance: 159"), confirmation checkbox, Apply.

## Data and permissions

Uses the existing `event_participants.attendance_status` (Attended, No-show, Walk-in; default unknown) and `event_cost_splits` (dimension, share weight, amount; largest remainder so parts sum to the whole), extended in the P9 `events.ts` contract with "attendance final" and recalculation preview and apply endpoints. `event.manage` to mark and apply. The API computes per-head figures, splits and limit checks (rules evaluator with the actual attendance fact); the browser only displays them. Applying re-posts commitment funding lines through the `libs/domain` posting builders as linked reversals and new postings in the open period, with an idempotency key and ordered locks on the affected budgets. A contributor's share may only grow up to their approved contribution; beyond that the API returns `SHARE_EXCEEDS_CONTRIBUTION` and the organizer must request more through 056a.

## States

| State                    | Behaviour                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not started              | info "Attendance opens on 14 Nov, the event's start day"; RSVP-based preview available                                                                                     |
| Marking                  | as above                                                                                                                                                                   |
| RSVP preview             | panel marked "Preview only"; no Apply                                                                                                                                      |
| Preview (final)          | as above with Apply                                                                                                                                                        |
| Over limit, soft         | warning banner as above; Apply allowed                                                                                                                                     |
| Over limit, hard         | error banner; Apply allowed (the split is about who pays) but new commitments stay blocked until 058 is approved                                                           |
| Share above contribution | error banner "Hyderabad Events' share would be USD 1,420.00, above its approved USD 1,200.00. Request USD 220.00 more." Apply disabled with that reason and a link to 056a |
| Apply dialog             | as above                                                                                                                                                                   |
| Applied                  | success banner "New split applied on 15 Nov by Rahul Verma"; table shows the current split                                                                                 |
| Locked                   | event Reconciling or Closed: read-only, "The split is locked once reconciliation starts"                                                                                   |
| Loading / error          | `sat-ghost` table; failed apply leaves the split unchanged and shows the API detail                                                                                        |

## Budget safety and audit

Planned and actual headcounts and per-head figures are labelled; the per-head limit check uses the soft-warning or hard-block treatment of the rule's mode. FX never enters the split (all USD at the locked plan rate). Applying a new split is a money movement: reversal and re-post, never an edit, with one audit entry carrying before and after shares, the attendance counts and the reason. "Keep planned split" is audited with its reason. Attendance marks are recorded in the event Activity tab.

## Responsive and accessibility

Marking works on a phone at the door: list of people with a large Attended toggle, search on top, counts sticky. The recalculation and apply steps are desktop and tablet. The three-way toggle is a radio group per person; the split table has row headers and a caption.

## Satori components

`sat-navigation-tabs` (People sub-tabs), `mat-table` with `satTableWithRowStates` and `sat-selection-bar`, `sat-status-tag` (attendance and RSVP), `sat-banner` (soft warning, hard block, preview only, locked), `sat-rich-tooltip` (how the split is computed), `satImportantButton` (Apply new split), `sat-ghost`; Angular Material button toggles, dialog (apply, keep with reason), autocomplete (walk-in), snackbar; `bf-money`.

## Related screens and navigation

047 participants, 047a invitations and RSVP, 049 cross-location cost split, 046a co-funding board, 051 commitments, 053 reconciliation, 054b ROI scorecard (no-show cost), 056a co-funding request, 058 over-budget request, 071 and 073 limits, 074a post-spend exceptions.

## Decisions taken

- RSVPs drive a preview only; the split changes when attendance is final and the organizer applies it. Recommended because RSVPs still move until the day, while postings should move once.
- A contributor's share can grow only up to their approved contribution; more needs a new co-funding request, so nobody's budget is charged beyond what its owner approved.
- An over-limit per attendee is a soft warning plus a finance exception in soft mode, and blocks new commitments in hard mode; the split itself can still be corrected.
- The split locks when reconciliation starts; later changes go through finance reclassification (074a).
- No-show cost uses the per-head catering or ticket cost recorded on the commitment, not the full per-head estimate.
