# 045a Event templates, recurring events, clone

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 9 batch. Build phase P9. Events > Templates (`/events/templates`, editor `/events/templates/:templateId`); recurrence step inside 045; Clone dialog from 046 and 043.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the wizard of 045. Planned Stitch states, to be generated in a later session:

| State                         | Planned image                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------- |
| template library              | `design/stitch/045a-event-templates-recurring-clone/default--desktop--light.png` |
| template editor               | `editor--desktop--light.png`                                                     |
| recurring series with preview | `recurring--desktop--light.png`                                                  |
| clone dialog                  | `clone-dialog--desktop--light.png`                                               |

## Purpose

Stop organizers rebuilding the same event every quarter: start from a template that already carries the budget per head, checklist, agenda, invitation, survey and preferred vendors; repeat an event on a schedule; or clone last time's event with dates shifted, without ever copying money.

## Roles

Event Organizers and Location Managers (use templates, save personal templates, create series, clone); Finance Admin and Organization Admin (publish company templates); contributing owners read.

## Entry points

043 "Create event > From a template" or "Clone an event"; 045 first step "Start from a template"; 046 overflow "Clone" and "Make recurring"; Events > Templates.

## Content and actions

Template library: tabs Company templates, My templates. Cards: name, category tag, event type, typical duration, estimate per attendee, what is included (icons with counts: 12 checklist tasks, agenda, invitation, 3 survey questions, 2 preferred vendors), "Use template", overflow (Edit, Duplicate, Archive). Company samples:

- Diwali celebration: festival, one evening, USD 40.00 per attendee estimate, checklist 14 tasks, survey, preferred vendors Spice Route Caterers and Festive Lights Co.
- Quarterly team lunch: team activity, 2 hours, uses the location's per-head limit (073), checklist 4 tasks.
- Team offsite: 2 days, USD 300.00 per attendee, checklist 22 tasks, agenda skeleton, travel needs enabled (47b).
- Townhall: half day, catering and AV, checklist 9 tasks.
- Wellbeing week: five sessions, per-session estimates.

Template editor (sections in one page with an outline on the left):

- Details: name, category, event type, default duration, location type (office, venue, remote).
- Budget defaults: estimate per attendee in USD (or "use the location limit"), tolerance %, cost split rule (by attendee location and employing entity, as 049).
- Checklist: tasks with relative due dates ("14 days before"), owner role (Organizer, Co-organizer), section (Before, On the day, After); see 46b.
- Agenda skeleton: items with relative times.
- Invitation and RSVP: message text, RSVP deadline (days before), capacity rule, waitlist on or off, reminder schedule (47a).
- Attendee needs to collect (47b) and survey questions (54a).
- Preferred vendors (from the vendor master, 106c and 073a; blocked vendors cannot be added).
- Footer: Save as draft, Publish (company templates) or Save (personal).

Recurring series (step "Schedule" in 045, or "Make recurring" on a Draft or Approved event):

- Repeat: Monthly, Quarterly, Yearly or Custom dates; first date; ends after N occurrences or on a date (at most 12 months ahead).
- Preview table: occurrence date, fiscal period, event code (one per occurrence, for example EVT-2026-0131 for 18 Dec 2026), estimate, status "Will be created as Draft".
- Budget check line (info, no reservation): "4 occurrences need USD 2,880.00 in total; Hyderabad Events has USD 2,100.00 available under its rules today. Each occurrence is funded when it is submitted."
- Actions: Create series; for an existing series "Edit future occurrences" or "Edit only this one".

Clone dialog: source (Offsite 2026, EVT-2026-0087); new name ("Offsite 2027"); new start date with "Shift all dates by 364 days"; what to copy (checkboxes): details and locations (on), checklist with dates shifted and statuses reset (on), agenda (on), invitation text (on), survey (on), vendor shortlist without quotes (on), estimate (on), participants as the invite list (off), documents (off). Fixed note: "Funding, contributions, commitments and actuals are never copied." Buttons: Cancel, "Create draft event".

## Data and permissions

New P9 data (`events.ts` extension): event templates (scope company or personal, owner, version, contents), event series (rule, first date, end, template), and on events the template and series references. `event.manage` to use templates, create series and clone; publishing company templates needs `master_data.manage` (Finance Admin) or `org.manage` (Organization Admin). Each occurrence is a normal event: own code, own approval and funding through 045, 048 and 056a; no pre-encumbrance exists until it is submitted. Occurrence dates that fall in a Closed or Locked fiscal period are rejected (`EVENT_DATE_IN_CLOSED_PERIOD`).

## States

| State              | Behaviour                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Library            | as above                                                                                               |
| My templates empty | "Save any event as a template from its overflow menu"                                                  |
| Editor             | as above; unsaved-changes bar                                                                          |
| Validation         | "Add a name", "Estimate must be above zero", "Blocked vendor Party Palace Rentals can't be preferred"  |
| Recurring preview  | as above                                                                                               |
| Occurrence blocked | row in error tone "Falls in a closed period (Jan 2026)"; Create series disabled until removed or moved |
| Budget note        | info tone when the series exceeds today's available; never blocks                                      |
| Clone dialog       | as above                                                                                               |
| Success            | snackbar "Draft event Offsite 2027 created" and 046 opens on the new event                             |
| Archived template  | hidden from the library; existing events keep their link                                               |
| Loading / error    | `sat-ghost` cards; error banner with Retry                                                             |

## Budget safety and audit

Templates and series never reserve or move money; the budget line in the series preview is information with the "Available under this budget's rules" label. Cloning never copies funding, contributions, commitments or actuals. Template publish, archive and series creation are audited; each created event has its own audit trail from creation.

## Responsive and accessibility

Desktop and tablet for editing; mobile shows the library and "Use template" only. Template cards are links with their name first; checkbox lists in the clone dialog are grouped with a legend.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `sat-interactive-card` (templates), `sat-category-tag`, `sat-status-tag`, `sat-banner`, `satDragDropList` (checklist and agenda order in the editor), `sat-empty-state`, `sat-ghost`; Angular Material stepper (inside 045), form fields, datepicker, button toggles (repeat), checkboxes, dialog (clone), snackbar.

## Related screens and navigation

043 events dashboard, 045 create event, 046 event details, 46b checklist and agenda, 47a invitations, 47b attendee needs, 54a survey, 020b program templates (budget-side templates), 073 location policy (per-head limits), 106c vendor master.

## Decisions taken

- Each occurrence of a recurring series is its own event with its own code, approval and funding; the series reserves nothing. Recommended so a cut or freeze mid-year affects future occurrences naturally.
- Series are created as Drafts up to 12 months ahead, no further.
- Company templates are published by Finance Admin or Organization Admin; any organizer can keep personal templates.
- Clone copies plans (checklist, agenda, invitation, survey, vendor shortlist, estimate) and never money; the invite list is opt-in because teams change.
