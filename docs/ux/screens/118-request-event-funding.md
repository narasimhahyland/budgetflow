# 118 Request event funding

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 5 employee batch. Build phase P5. Employee shell; opened from "Request funds" when the request is for a team event.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Build from this spec; it is a short employee version of the 045 event wizard and 057 additional-fund request. Planned exports: `design/stitch/118-request-event-funding/default--desktop--light.png`, `validation--desktop--light.png`.

## Purpose

Let an employee or event organizer propose a small team event and ask for its funding in one step, with the per-person limit and approval route visible, without the full organizer wizard.

## Roles

Employee, Event Organizer. Approvers see the result in 059/060.

## Entry points

116 and 115 "Request funds" -> "For a team event"; 044 event list "Request event funding" for employees.

## Content and actions

One page with three sections and a check panel.

- Event: name ("Bengaluru team pottery workshop"), date (21 Nov 2026), location (Bengaluru office or venue), people (12 from my team; picker with names or a count), description.
- Cost estimate: lines with category, description and amount in INR or USD (venue INR 18,000.00; materials INR 9,600.00; snacks INR 4,800.00); total INR 32,400.00 = USD 388.02 at the FY2026 plan rate; "USD 32.34 per person".
- Funding: budget "Bengaluru Events" (select from requestable budgets); "Event code is created when approved".
- Check panel: per-person limit for team events in Bengaluru (USD 40.00 per person): within the limit; "Who approves": Anand Kumar (Location Manager); "Over USD 500.00 also needs Meera Iyer"; budget is not frozen.
- Footer: Cancel, Save draft, "Submit for USD 388.02".

## Data and permissions

Creates a draft event (`eventMachine` draft) and a funding request against the chosen budget in one call; the route preview uses the same endpoint as 117. The event gets an event code and legal entity from the budget on approval. Employees may organize events only where policy allows (`event:create` for EO and employees with the organizer flag).

## States

| State        | Behaviour                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Default      | as above                                                                                                                   |
| Validation   | missing date, people or cost lines: field errors and an error summary at the top with links to the fields                  |
| Soft warning | per person above the limit: warning container; justification required                                                      |
| Blocked      | budget paused or the estimate above what the budget allows for one event: error container; Submit disabled with the reason |
| Submitted    | confirmation "Request REQ-2026-0152 for Bengaluru team pottery workshop sent to Anand Kumar" with "View status"            |

## Budget safety and audit

Estimate in transaction currency and USD; per-person cost shown against the planned attendance; pending until approved. Audit entries for event creation and request submission.

## Responsive and accessibility

Mobile: sections stack, cost lines as cards, check panel as a summary above the sticky footer. Error summary receives focus on submit.

## Related screens and navigation

116, 117, 119, 045 create event (organizer wizard), 046 event details, 057 additional-fund request.

## Assumptions and open questions

- Per-person limit for team events by location (USD 40.00 in Bengaluru) is a fictional placeholder until the Phase 7 location policy (073) defines it.
