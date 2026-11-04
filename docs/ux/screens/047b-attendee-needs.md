# 047b Attendee needs (dietary, accessibility, travel, photo consent)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 9 batch. Build phase P9. Event details (046) tab "People", sub-tab Needs (`/events/:eventId/people/needs`); employee form `/invitations/:invitationId/needs`.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the 047a invitation page for the employee form. Planned Stitch states, to be generated in a later session:

| State                          | Planned image                                                   |
| ------------------------------ | --------------------------------------------------------------- |
| organizer summary              | `design/stitch/047b-attendee-needs/default--desktop--light.png` |
| employee needs form            | `form--mobile--light.png`                                       |
| share with caterer dialog      | `caterer-export--desktop--light.png`                            |
| contributor view (counts only) | `counts-only--desktop--light.png`                               |

## Purpose

Collect dietary, allergy, accessibility, travel and photo-consent needs from attendees once, give organizers the counts and the few personal details they must act on, and keep that personal information private and short-lived instead of in spreadsheets.

## Roles

Invited employees (give and change their own needs); Event Organizer and co-organizers (see individual answers, export for suppliers, remind); contributing owners, Location Managers and Finance Controller (counts only).

## Entry points

47a invitation page after "Going"; invitation email "Tell us about your needs"; 046 People > Needs; 46b task "Share dietary counts with the caterer"; reminder notification "Add your dietary needs for Diwali celebration".

## Content and actions

Employee form (sample Kavya Shah, phone):

- Privacy note at the top: "Only the organizers of this event see your answers. They are deleted 30 days after the event closes."
- Dietary preference (one): No preference, Vegetarian, Vegan, Jain, Halal, Kosher, Other (text).
- Allergies (any): Nuts, Gluten, Dairy, Shellfish, Eggs, Other (text); "Severe: needs separate preparation" toggle.
- Accessibility (any): Step-free access, Hearing loop, Seating near an exit, Other (text).
- Travel (only when the event collects it, for example the Team offsite template): "I need travel from another city", from city, arrival date and time, "I need a hotel night".
- Photos: "You may include me in event photos" or "Please don't include me in photos".
- "Use these answers for my future events" (off by default).
- Save; Cancel.

Organizer summary (sample Bengaluru Diwali celebration, 168 going):

- Answered: 145 of 168 going; "Remind 23 people" button.
- Dietary: Vegetarian 74, No preference 41, Jain 12, Vegan 9, Halal 7, Other 2.
- Allergies: Nuts 4 (1 severe), Gluten 3, Dairy 2.
- Accessibility: Step-free access 2, Seating near an exit 1.
- Travel: not collected for this event (the offsite shows "16 travelling from Hyderabad, 16 hotel nights" with "Add travel cost" -> 051 add commitment with category Travel).
- Photos: 131 yes, 14 no; link "Gallery uses this" (54a).
- Detail table (organizers and co-organizers only): name, location, dietary, allergies with severity, accessibility, travel, photo consent; filter "Has allergies or accessibility needs".
- "Share with caterer" opens a dialog: content "Counts only" (default) or "Counts and the allergy list with first names and severity" (needs the checkbox "Needed for food safety"); format PDF or CSV; Download.

## Data and permissions

Answers live in the existing `event_participants.needs` field (structured: dietary, allergies with severity, accessibility, travel, photo consent) through the P9 `events.ts` extension. The API returns individual answers only to the event's organizer and co-organizers (`event.manage` on that event) and to the person themselves; everyone else with `event.read` receives aggregated counts. "Use for future events" copies the dietary and accessibility answers to the person's profile preferences, never travel. A worker job deletes needs 30 days after the event closes and keeps only the counts.

## States

| State             | Behaviour                                                                           |
| ----------------- | ----------------------------------------------------------------------------------- |
| Employee form     | as above; prefilled when "Use for future events" was on                             |
| Saved             | "Thanks, Rahul will plan for this." with Edit until the RSVP deadline               |
| Organizer summary | as above                                                                            |
| Counts only       | contributors and finance: summary cards without the detail table or export          |
| Caterer export    | dialog as above; the allergy option needs the checkbox                              |
| No answers yet    | `sat-empty-state` "No needs submitted yet" with "Remind people who are going"       |
| Deleted           | info banner "Individual answers were deleted on 5 Dec as planned. Counts are kept." |
| Validation        | "Describe the other dietary need" when Other is chosen with an empty text           |
| Loading / error   | `sat-ghost` cards; failed save keeps the form with the error                        |

## Budget safety and audit

No money moves here; travel needs only prompt the organizer to add a travel commitment through 051, which follows the normal checks. Exports that include names are audited (who, which event, which content) because they disclose personal data; viewing counts is not audited.

## Responsive and accessibility

Employee form: phone-first, one question per group with fieldset legends; toggles have visible labels. Organizer summary: cards wrap on tablet; detail table scrolls with the name pinned. Counts are text, not only charts.

## Satori components

`sat-navigation-tabs` (People sub-tabs), `satCardSurfaceContainerLowest` (count cards), `sat-banner` (privacy, deleted), `mat-table` with `satTableWithRowStates`, `sat-status-tag` (Severe), `sat-empty-state`, `sat-ghost`; Angular Material radio group, checkboxes, slide toggles, form fields, datepicker, dialog (caterer export), snackbar.

## Related screens and navigation

047a invitations and RSVP, 047 participants, 46b checklist (supplier task), 051 commitments (travel cost), 54a gallery (photo consent), 124 profile and preferences (saved answers), 046 event details.

## Decisions taken

- Individual answers are visible only to the event's organizers and the person; contributors and finance see counts. Recommended because dietary and accessibility answers can reveal health or religion.
- Individual answers are deleted 30 days after the event closes; counts are kept for planning and the ROI scorecard.
- Supplier exports default to counts only; names with allergies need an explicit food-safety confirmation and are audited.
- Reuse of answers for future events is opt-in and never includes travel.
