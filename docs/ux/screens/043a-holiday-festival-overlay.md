# 043a Holiday and festival overlay calendar

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Overlay layers on the budget calendar (032) and the events dashboard calendar (043); holiday calendars managed in Settings > Holiday calendars (`/admin/holidays`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the calendar of 032. Planned Stitch states, to be generated in a later session:

| State                                  | Planned image                                                             |
| -------------------------------------- | ------------------------------------------------------------------------- |
| calendar with holiday and spend layers | `design/stitch/043a-holiday-festival-overlay/default--desktop--light.png` |
| clash warning when creating an event   | `clash--desktop--light.png`                                               |
| holiday calendars admin                | `admin--desktop--light.png`                                               |
| mobile agenda                          | `default--mobile--light.png`                                              |

## Purpose

Show local holidays, festivals and last year's spending peaks on the budget and event calendars per office, so organizers plan around office closures and owners phase money for the months when spending really happens (Diwali in India, Thanksgiving in the United States, year-end everywhere).

## Roles

Event Organizers, Location and Regional Managers, owners (view layers for their locations); Organization Admin (manages holiday calendars); Finance Admin (reads; uses seasonal phasing in 32a).

## Entry points

032 budget calendar and 043 events calendar "Layers"; 045 create event (date step clash check); 32a period phasing "Seasonal from holidays and last year"; Settings > Holiday calendars.

## Content and actions

Layers (toggle chips): Holidays (office closed), Festivals and observances (office open), Planned events, Spend last year (weekly heat strip), Fiscal periods, Commitment freeze date (87b).

Calendar (month or quarter view) with a location filter (Bengaluru, Hyderabad, Westlake, London; several at once, each a lane). Samples for November-December 2026:

- Bengaluru and Hyderabad: Diwali (office closed, dates from the company holiday calendar); Diwali celebrations planned (EVT-2026-0112).
- Westlake: Thanksgiving, Thu 26 Nov and Fri 27 Nov (office closed).
- London: Christmas Day 25 Dec, Boxing Day (substitute) Mon 28 Dec (office closed).
- All offices: commitment freeze date 15 Dec (87b) as a line.
- Spend last year strip: Bengaluru peak in the Diwali weeks (USD 4,900.00), Westlake peak in Thanksgiving week (USD 4,400.00).

Day detail (click): holidays per location, events, last year's spend that week, "Plan an event on this day" (045 prefilled).

Clash check in 045: soft warning "Hyderabad office is closed on this date (Diwali). 18 of your invitees are in Hyderabad." with "Pick another date" and "Keep this date".

Holiday calendars admin: one calendar per office (name, location, year), entries (date, name, Closed or Observance), Import (ICS or CSV), "Copy from last year" (moves fixed-date holidays, flags movable ones to confirm), Publish per year.

## Data and permissions

New P15 holiday calendar data (office, year, entries, status) in the events or admin contract; spend heat strip from ledger actuals by week and location (`report.read` scope; employees and organizers without budget read see holidays and events only). Calendars are maintained by the Organization Admin (`tenant.settings.manage`) from the company's own office holiday lists, imported or typed, not from a public holiday service. The 32a seasonal phasing option reads last year's monthly actuals and closed days.

## States

| State           | Behaviour                                                                                |
| --------------- | ---------------------------------------------------------------------------------------- |
| Default         | layers on, one or more location lanes                                                    |
| Clash warning   | soft warning in 045; the organizer can keep the date                                     |
| No calendar     | info banner "No holiday calendar for Westlake 2027 yet" (admins see "Add calendar")      |
| Draft calendar  | admins see a "Draft" tag; others see the last published year                             |
| Import errors   | rows listed ("Line 4: date missing"); valid rows imported after confirmation             |
| No spend data   | spend strip hidden for roles without budget read; "No spend last year" for new locations |
| Loading / error | `sat-ghost` calendar; error banner with Retry                                            |

## Budget safety and audit

The spend layer is last year's actuals in USD, labelled as such and never mixed with this year's plan or forecast. Clash warnings never block. Calendar publishing and imports are audited.

## Responsive and accessibility

Mobile: agenda list by day with location tags. Holidays are text with an icon ("Office closed"), not colour only; the heat strip has a table alternative (000b).

## Satori components

`satInteractiveTag` (layers, locations), `sat-banner` (clash, no calendar), `sat-status-tag` (Closed, Observance, Draft), `sat-upload-area` (import), `sat-ghost`; Angular Material datepicker and calendar, dialog (day detail, entry editor), snackbar.

## Related screens and navigation

032 budget calendar, 043 events dashboard, 045 create event, 32a period phasing, 87b year-end run, 097 calendar integration, 044a polls (date options).

## Decisions taken

- Holiday calendars are the company's own office lists, maintained by the Organization Admin, not a public holiday feed. Recommended because company closures differ from public holidays.
- Clashes with an office closure at any participating location are soft warnings with the number of affected invitees.
- Last year's spend appears as a weekly heat strip for roles that can read budgets, to support seasonal phasing.
- Movable festivals are not copied automatically to a new year; the admin confirms their dates.
