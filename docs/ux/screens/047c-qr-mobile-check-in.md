# 047c QR or mobile check-in

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Event details (046) tab "People", sub-tab Check-in (`/events/:eventId/people/check-in`); organizer check-in mode in the mobile app (`/m/events/:eventId/check-in`); attendee QR pass on the invitation page (47a) and the mobile app.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a, mobile variant of 59a) and the attendance list of 47e. Planned Stitch states, to be generated in a later session:

| State                   | Planned image                                                   |
| ----------------------- | --------------------------------------------------------------- |
| organizer scanning      | `design/stitch/047c-qr-mobile-check-in/scan--mobile--light.png` |
| checked in confirmation | `checked-in--mobile--light.png`                                 |
| attendee QR pass        | `pass--mobile--light.png`                                       |
| live counts (desktop)   | `default--desktop--light.png`                                   |
| offline queue           | `offline--mobile--light.png`                                    |

## Purpose

Record who actually came, quickly and reliably at the door, so per-head costs, the cost split and no-show figures follow real attendance: organizers scan attendee passes or search names on a phone, walk-ins are added on the spot, people can check themselves in with the event's poster code, and it keeps working on a weak venue connection.

## Roles

Event Organizers and co-organizers (check in others, add walk-ins); employees (show their pass, self check-in); contributing owners and finance see counts (47e, 54b).

## Entry points

046 People tab "Check-in"; mobile app event card "Start check-in" (on the event day); 47a invitation page and email "Your pass"; event poster QR code ("Check yourself in") printed from 046; native app (115a) for offline check-in.

## Content and actions

Organizer check-in mode (phone, sample Bengaluru Diwali celebration, 14 Nov 2026):

- Header: event name, "Checked in 42 of 58 going", walk-ins 3.
- Scan: camera view with a frame; on scan: green confirmation card "Kavya Shah checked in, 18:42" with Undo (10 seconds); repeated scan: "Already checked in at 18:42".
- Search: name or email; list of Going, Waitlist and Can't go people with Check in buttons.
- Walk-in: search the directory; not found: "Add a guest" (name, organisation; marked non-employee as in 047).
- Footer: "Print poster code", "End check-in".

Attendee pass (47a page and mobile app): event, date, venue, the person's name and a QR code; "Show at the door".

Self check-in: scanning the poster code opens `/check-in/:eventCode`, asks the person to sign in (SSO), confirms "You're checked in to Bengaluru Diwali celebration"; allowed from 2 hours before to 2 hours after the start.

Desktop live view (046): counts by status and by location (Bengaluru 37, Hyderabad 5), list with check-in time and who checked them in, export of the attendance list (CSV) for the organizer.

## Data and permissions

Check-ins update `event_participants` attendance (Attended, Walk-in) through the P9 attendance API used by 47e, with the check-in time, channel (scan, search, self) and the organizer who recorded it. Pass codes are opaque signed tokens per participant and event (no personal data inside); the poster code is per event and needs a signed-in person within the time window. Offline: the mobile app caches the attendee list for that event and queues check-ins with their time; they sync on reconnect with idempotency keys and duplicates are merged. `event.manage` scope (organizers and co-organizers) to check in others; self check-in only for oneself.

## States

| State          | Behaviour                                                                        |
| -------------- | -------------------------------------------------------------------------------- |
| Scanning       | camera frame; torch toggle; "Point at the attendee's pass"                       |
| Checked in     | success card with Undo                                                           |
| Already in     | info card with the earlier time                                                  |
| Not invited    | warning card "Arjun Das is not on the list" with "Add as walk-in"                |
| Wrong event    | error card "This pass is for Hyderabad townhall"                                 |
| Outside window | self check-in: "Check-in opens at 16:30"                                         |
| Offline        | banner "Offline: 6 check-ins waiting to sync"; scanning continues                |
| Synced         | snackbar "6 check-ins synced"; conflicts listed ("Checked in twice; kept 18:42") |
| Camera blocked | "Allow camera access, or use search" with search shown                           |
| Ended          | read-only list; "Final attendance is confirmed in Attendance (47e)"              |

## Budget safety and audit

Check-ins move no money: per-head recalculation and the cost split change only when the organizer confirms final attendance in 47e (P9 decision). Offline queueing is allowed for check-ins because they are evidence, not money decisions. Check-ins, undos and walk-ins are recorded with who and when; final attendance confirmation is audited in 47e.

## Responsive and accessibility

Phone first (412 px); tablet works as a door kiosk in landscape. Scan results are announced and shown with icon and text; search is always available as an alternative to the camera.

## Satori components

`sat-interactive-card` (result cards), `sat-status-tag` (Going, Attended, Walk-in), `sat-banner` (offline), `sat-empty-state`, `sat-ghost`, `satImportantButton` (Check in); Angular Material list, search field, dialog (add guest), snackbar; camera scanner in `apps/mobile` and a web fallback using the browser camera API.

## Related screens and navigation

047a invitations and RSVP, 47e attendance and per-head recalculation, 047 participants, 046 event details, 054a survey (sent to attendees), 054b scorecard, 115a native apps, 59a mobile app frame.

## Decisions taken

- Pass and poster codes are opaque tokens; self check-in needs sign-in and works only within 2 hours of the start, with no location tracking. Recommended so codes cannot be reused remotely without collecting location data.
- Check-ins work offline and sync later, because they record evidence, not money decisions.
- Attendance becomes final only when the organizer confirms it in 47e, so per-head costs move once.
- Walk-ins come from the directory; anyone else is added as a non-employee guest.
