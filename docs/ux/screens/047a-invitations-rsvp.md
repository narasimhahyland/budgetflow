# 047a Invitations and RSVP

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 9 batch. Build phase P9. Event details (046) tab "People", sub-tab Invitations (`/events/:eventId/people/invitations`); employee invitation page `/invitations/:invitationId`; invitation email with a calendar invite.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the 046 page frame and the 061a email frame for the invitation email. Planned Stitch states, to be generated in a later session:

| State                                 | Planned image                                                     |
| ------------------------------------- | ----------------------------------------------------------------- |
| RSVP tracker                          | `design/stitch/047a-invitations-rsvp/default--desktop--light.png` |
| invitation composer                   | `composer--desktop--light.png`                                    |
| capacity full, waitlist in use        | `waitlist--desktop--light.png`                                    |
| employee invitation page              | `invitation--mobile--light.png`                                   |
| invitation email with calendar invite | `invitation-email--mobile--light.png`                             |

## Purpose

Replace headcount guesses from forms and polls with real responses: invite participants, collect Going or Can't go before a deadline, manage capacity with a waitlist, send reminders and calendar invites, and feed expected attendance into the per-head estimate and cost split (47e).

## Roles

Event Organizer and co-organizers (compose, send, remind, close RSVPs, manage the waitlist); invited employees (respond, add to calendar, give needs); contributing owners and Finance Controller (read the counts).

## Entry points

046 People > Invitations; 46b task "Send invitations"; 043 attention "RSVPs close tomorrow"; employees: invitation email, push or chat notification, 115 "Your invitations", 123.

## Content and actions

Composer (shown until the first send; later "Invite more people"):

- Audience: all participants from 047 (220: Bengaluru 190, Hyderabad 30 joining in person) with filters by location and team; "Add people" from the directory adds them as participants too.
- Message (prefilled from the template, plain text with the event name, date and agenda link), RSVP deadline (10 Nov 2026), capacity (200, the venue limit), waitlist (on, "Promote automatically when a place opens"), reminders (3 days before the deadline to people who have not answered; 1 day before the event to people going).
- "Attach a calendar invite" (on): the email carries a calendar file with the event time, place and RSVP links.
- Preview of the email; Send invitations (`satImportantButton`).

Tracker (sample Bengaluru Diwali celebration, EVT-2026-0112):

- Capacity bar: 168 going of 200 places; counts Going 168, Can't go 14, Waitlisted 0, No response 38 (220 invited); deadline "Closes 10 Nov, 23:59 IST".
- By location: Bengaluru 190 invited, 152 going; Hyderabad 30 invited, 16 going.
- Info banner when attendance changes the estimate: "Expected attendance changed from 220 planned to 168 going. Review the per-head estimate and cost split." -> 47e.
- Table: name, location, employing entity, RSVP tag (Going, Can't go, Waitlisted, No response), responded at, needs submitted (icon, link to 47b), reminders sent; selection bar "Send reminder", "Remove invitation".
- Header actions: Send reminder to everyone without a response, Invite more people, Close RSVPs (or Reopen), Export (CSV, XLSX, PDF).

Employee invitation page (sample Kavya Shah, phone):

- Event name, date and time in her timezone (14 Nov 2026, 18:00-21:30 IST), place (Bengaluru office, Atrium), organizer, short message, agenda items marked visible (46b).
- "Will you attend?" Going / Can't go (large buttons); after Going: "Tell us about dietary or accessibility needs" (opens 47b) and "Add to calendar" (calendar file download).
- Response can change until the deadline; the page shows "You're going" with Change response.

Invitation email: 640 px email with the event card, Going and Can't go buttons (signed single-use links that open the invitation page with the choice preselected), "Add to calendar" and the attached calendar invite.

## Data and permissions

P9 extends `event_participants` (existing columns `rsvp_status`, default `invited`, and `attendance_status`) with responded at and waitlist position, and adds invitations (event, message, deadline, capacity, waitlist settings, reminder schedule, sent by, sent at) in the `events.ts` contract. `event.manage` for organizers and co-organizers; an employee can read and answer only their own invitation. Capacity is enforced by the API: a Going response beyond capacity becomes Waitlisted; when a place opens the first waitlisted person is promoted (if automatic) and notified. Email RSVP links are signed, bound to the invitation and expire at the deadline. Calendar invites are standard iCalendar requests sent from the BudgetFlow mailbox; updates and cancellations send a new version. Responses given inside Outlook or Google Calendar are not read until the calendar integration (097, P12).

## States

| State             | Behaviour                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Not sent          | composer as above; tracker hidden                                                                                  |
| Tracker           | as above                                                                                                           |
| Capacity full     | warning banner "All 200 places are taken. New Going answers join the waitlist (6 waiting)." Waitlist table section |
| Deadline passed   | info banner "RSVPs closed on 10 Nov"; Reopen RSVPs with a new deadline                                             |
| Employee going    | "You're going" with Change response, needs and calendar links                                                      |
| Employee waitlist | "You're on the waitlist (position 3). We'll tell you if a place opens."                                            |
| Link expired      | invitation page "RSVPs for this event are closed. Contact Rahul Verma." (no answer buttons)                        |
| Event cancelled   | invitation page and email show Cancelled; calendar cancellation sent                                               |
| Validation        | composer: "Set a deadline before the event", "Capacity must be at least 1"                                         |
| Loading / error   | `sat-ghost` table; failed send keeps the composer open with the error                                              |
| Success           | snackbar "Invitations sent to 220 people"; reminder sends show counts                                              |

## Budget safety and audit

RSVPs never post money. They change the expected attendance that 47e uses to propose a new per-head estimate and split, which the organizer confirms there. Sends, reminders, deadline changes, capacity changes and waitlist promotions are recorded in the event's Activity tab; individual employee responses are personal data shown to organizers, not audit entries.

## Responsive and accessibility

Organizer views: desktop and tablet; mobile shows counts, the capacity bar and Send reminder. Employee page and email: phone-first, buttons at least 48 px, plain-text email part. The capacity bar has a text equivalent; RSVP tags use icon and words.

## Satori components

`sat-navigation-tabs` (People sub-tabs: Participants, Invitations, Needs, Attendance), `sat-banner`, `sat-status-tag` (RSVP states), `mat-table` with `satTableWithRowStates` and `sat-selection-bar`, `satImportantButton` (Send invitations), `sat-empty-state`, `sat-ghost`; Angular Material side sheet (composer), form fields, datepicker, slide toggles, progress bar, button toggles (Going, Can't go), snackbar; Export menu from 000.

## Related screens and navigation

046 event details, 047 participants, 47b attendee needs, 47e attendance and per-head recalculation, 46b checklist and agenda, 043 events dashboard, 115 employee dashboard, 123 notifications, 097 calendar integration (P12, two-way RSVP sync).

## Decisions taken

- RSVP choices are Going and Can't go only, with no Maybe. Recommended because Maybe answers make the headcount, and the per-head cost, unusable.
- Invitations go to people in the employee directory; external guests are added by the organizer as non-employee participants without self-service RSVP.
- The waitlist promotes automatically by default, and the organizer can switch to manual promotion.
- In P9 calendar invites are one-way (sent from the BudgetFlow mailbox, RSVP through the links); two-way sync with Outlook and Google arrives in P12 (097).
- No plus-ones for employee events.
