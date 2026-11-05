# 122b Organizer recognition

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Review-added screen (catalog section I: "organizer recognition: events organized on profile, thank-you notes"; plan Phase 15). "Organizer" section on the employee profile (039) and on My activity (122); "Say thanks" on completed events (046) and in the post-event survey (54a).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the profile layout of 039. Planned Stitch states, to be generated in a later session:

| State                             | Planned image                                                          |
| --------------------------------- | ---------------------------------------------------------------------- |
| organizer section on a profile    | `design/stitch/122b-organizer-recognition/default--desktop--light.png` |
| say thanks after an event         | `say-thanks--mobile--light.png`                                        |
| organizer's own view with privacy | `own-view--desktop--light.png`                                         |
| manager quarterly note            | `manager-note--desktop--light.png`                                     |

## Purpose

Give volunteer organizers the credit that keeps them organising: their events and the people they reached on their profile, thank-you notes from attendees and owners, and a quarterly note to their manager, so organising is seen as real work and organizers do not burn out unnoticed.

## Roles

Event Organizers and co-organizers (receive; control visibility); attendees and contributing owners (say thanks); the organizer's manager (receives the quarterly note when the organizer allows it); colleagues (see the public part of the profile).

## Entry points

039 employee profile "Organizer" section; 122 My activity "As organizer"; 046 completed event "Say thanks to the organizers"; 54a survey last step "Leave a thank-you note"; 122a badges; 120a "Nominate for an award".

## Content and actions

Organizer section (sample Rahul Verma, profile view by a colleague):

- Summary: "Organised 7 events in FY2026, reaching 612 colleagues; average feedback 4.5 of 5."
- Events list: event, date, attendees, feedback (completed and closed events only), link to 046.
- Badges (from 122a), unless hidden.
- Thank-you notes (latest 5, with "See all"): "Thank you for the Diwali celebration, my family loved it." Kavya Shah, 16 Nov; "Ran a smooth offsite on a tight budget." Daniel Brooks, 6 Nov.
- Action for colleagues: "Say thanks"; for managers and peers: "Nominate for a recognition award" (120a).

Say thanks (after an event, from 046 or the survey): choose organizers (one or more), note (required, 10-300 characters), "Show on their profile" (on by default; the organizer can still hide it), Send.

Organizer's own view (privacy controls): show my organizer section to colleagues (on), show thank-you notes publicly (on), send a quarterly summary to my manager (on), hide individual notes or badges.

Manager quarterly note (email and in-app for the manager): "Rahul Verma organised 3 events this quarter for 412 colleagues (feedback 4.6) and received 18 thank-you notes." with "Say thanks" and "Nominate for an award".

## Data and permissions

New P15 thank-you notes (from, to, event, text, visibility, hidden flag) in the events contract; organizer statistics computed from events where the person is organizer or co-organizer (P5 `event_co_organizers`), attendance (47e) and survey pulse (54a, only events with at least 5 responses). Profile visibility follows the organizer's settings; the manager comes from reporting lines (P3). Notes are moderated by the recipient (hide) and by Organization Admin (remove for inappropriate content). No money is attached to thanks.

## States

| State           | Behaviour                                                                               |
| --------------- | --------------------------------------------------------------------------------------- |
| Profile section | as above                                                                                |
| Own view        | privacy toggles and hidden items visible only to the organizer                          |
| Say thanks      | form; success snackbar "Thanks sent to Rahul Verma"                                     |
| Few responses   | feedback shown as "Not enough responses" for events under 5 survey responses            |
| Hidden section  | colleagues see no organizer section; the organizer sees "Hidden from colleagues"        |
| No events yet   | section not shown on others' profiles; own view shows "Organise your first event" (045) |
| Removed note    | note removed by an admin; author notified with the reason                               |
| Loading / error | `sat-ghost`; error banner with Retry                                                    |

## Budget safety and audit

Recognition here moves no money; monetary recognition goes through 120a with its budget checks. Notes and visibility changes are recorded in the person's activity; admin removals are audited.

## Responsive and accessibility

Mobile first for "Say thanks". Notes are a list with author and date in text; statistics are sentences with numbers.

## Satori components

`sat-interactive-card` (summary, notes), `sat-avatar`, `sat-status-tag` (badges), `sat-empty-state`, `sat-ghost`; Angular Material list, slide toggles (privacy), form field (note), dialog, snackbar.

## Related screens and navigation

039 employee profile, 122 my activity, 122a gamified participation, 120a recognition awards, 046 event details, 054a survey, 047e attendance, 045 create event.

## Decisions taken

- Organizers control what colleagues see: their organizer section, thank-you notes and the quarterly note to their manager can each be turned off. Recommended so recognition never feels like monitoring.
- Thank-you notes carry no money; monetary recognition stays in 120a with its controls.
- Feedback averages count only events with at least 5 survey responses, matching the survey privacy rule.
- Managers get a quarterly summary by default, because recognition from the manager is what prevents burnout.
