# 054a Post-event survey and photo gallery

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 9 batch. Build phase P9. Event details (046) new tab "Feedback" with sub-tabs Survey and Gallery (`/events/:eventId/feedback`); employee survey page `/surveys/:surveyId`.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the 046 frame. Planned Stitch states, to be generated in a later session:

| State                             | Planned image                                                         |
| --------------------------------- | --------------------------------------------------------------------- |
| survey results                    | `design/stitch/054a-survey-photo-gallery/default--desktop--light.png` |
| survey setup                      | `survey-setup--desktop--light.png`                                    |
| employee survey                   | `survey--mobile--light.png`                                           |
| gallery with upload dialog        | `gallery-upload--desktop--light.png`                                  |
| too few responses to show results | `too-few--desktop--light.png`                                         |

## Purpose

Capture whether an event worked, with a short pulse survey sent automatically after it, and keep the event's photos in one private place that respects who agreed to be photographed, so organizers and budget owners have evidence of engagement, not only of spend.

## Roles

Event Organizer and co-organizers (set up the survey, read results, moderate the gallery); attendees (answer the survey, view and add photos, ask to remove photos of themselves); owning and contributing owners, Finance Admin and CEO (read survey results and the scorecard, 54b); Finance Controller (read results).

## Entry points

046 tab "Feedback"; 46b system task "Send survey"; survey email, push or chat message the day after the event; 043 attention "Survey results are ready"; 54b scorecard "Feedback" section.

## Content and actions

Survey setup (prefilled from the event template):

- Questions (up to 5; types rating 1-5, yes or no, single choice, short text): "How would you rate the event?" (rating); "Would you attend a similar event again?" (yes or no); "What should we change next time?" (short text, optional).
- Audience: people marked Attended (47e); people who were Going if attendance is not final.
- Timing: sends the day after the event ends at 10:00 local; closes after 7 days; one reminder after 3 days.
- Anonymous (on, locked once sent): results never show who answered what; results appear only after 5 responses.
- Preview; Save. Status line "Scheduled for 25 Oct, 10:00 IST".

Survey results (sample Offsite 2026, EVT-2026-0087):

- Response rate 41 of 68 attendees (60%); average rating 4.4 of 5; would attend again 93% (38 of 41).
- Rating distribution bar (5: 22, 4: 14, 3: 4, 2: 1, 1: 0) with "View as table".
- Comments (anonymous, newest first, organizer can hide offensive ones with a reason): "More time for the team games", "Vegetarian options ran out at lunch".
- By location only where each group has 5 or more responses (Bengaluru 33, Hyderabad 8).
- Export (CSV, XLSX, PDF), aggregated results and comments without identities.

Employee survey page (phone): event name and date, the questions, Submit; "Thanks for your feedback" with "See the event photos".

Gallery:

- Grid of photos with uploader and date; filter "Mine".
- Upload dialog: `sat-upload-area` (JPEG, PNG or HEIC, up to 10 MB each, 20 at a time); notice in the warning tone: "14 people at this event asked not to be in photos. Only upload photos of people who agreed."; checkbox "I checked these photos against the photo preferences"; Upload.
- Photo viewer: full size, Download, "Remove me from this photo" (any participant: hides it at once and asks the organizer to review), organizer actions Hide or Restore.
- Moderation queue for organizers: removal requests and hidden photos.

## Data and permissions

New P9 data (`event_surveys` per the phase handoff, `events.ts` extension): surveys (event, questions, audience, schedule, anonymous, status Draft, Scheduled, Open, Closed), responses (survey, answers, submitted; for anonymous surveys a one-time response token per participant prevents double answers and the API never returns respondent identity), gallery photos (event, document id in `DocumentStore`, uploader, status Visible, Hidden, Removal requested). Survey setup and moderation need `event.manage`; answering needs being in the audience; results need `event.read`; the gallery is visible only to the event's participants, organizers and contributing owners. Photo preferences come from 47b. Photos are deleted 12 months after the event.

## States

| State             | Behaviour                                                               |
| ----------------- | ----------------------------------------------------------------------- |
| Setup             | as above                                                                |
| Scheduled         | info line with the send time; questions still editable                  |
| Open              | live response count; results hidden until 5 responses                   |
| Too few responses | "Results appear after 5 responses (3 so far)"; no partial results       |
| Results           | as above                                                                |
| Closed            | results final; feeds 54b                                                |
| Employee answered | "You've answered this survey" when reopening the link                   |
| Gallery empty     | `sat-empty-state` "No photos yet" with Upload photos                    |
| Upload            | dialog as above; Upload disabled until the checkbox is ticked           |
| Removal requested | photo hidden for everyone except organizers, tagged "Removal requested" |
| Loading / error   | `sat-ghost` results and grid; failed uploads listed with Retry          |

## Budget safety and audit

No money moves here. Survey setup, sending, hiding comments, photo hides, restores and removal requests are recorded in the event Activity tab; individual answers are never audited or attributed when the survey is anonymous.

## Responsive and accessibility

Survey page: phone-first, rating as a radio group with labels 1 to 5, not stars alone. Results: chart with a table alternative. Gallery: responsive grid; every photo has the uploader's caption or "Event photo, 23 Oct" as alternative text; the viewer works with arrow keys and Esc.

## Satori components

`sat-navigation-tabs` (Feedback sub-tabs), `satCardSurfaceContainerLowest` (result cards), `sat-banner` (photo notice, too few responses), `sat-upload-area`, `sat-status-tag` (survey status, Removal requested), `sat-empty-state`, `sat-ghost`; Angular Material radio group, form fields, slide toggle, dialog (upload, viewer), checkbox, snackbar; distribution chart from `libs/web/ui/charts` with "View as table"; Export menu from 000.

## Related screens and navigation

046 event details, 47b attendee needs (photo preferences), 47e attendance (survey audience), 46b checklist, 54b ROI scorecard, 043 events dashboard, 15b participation and reach (P10), 111 data-retention settings (P14).

## Decisions taken

- Surveys are anonymous by default and show results only after 5 responses. Recommended so people answer honestly and small groups cannot be identified.
- The survey goes to people marked Attended, not everyone invited, so no-shows do not rate an event they missed.
- The gallery is private to the event's participants, organizers and contributing owners; there is no link to share photos outside BudgetFlow.
- Any participant can hide a photo of themselves immediately with "Remove me"; the organizer reviews afterwards.
- Photos are kept 12 months after the event, until data-retention settings (111, P14) make this configurable.
