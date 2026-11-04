# 117 Submit spending request

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 5 employee batch. Build phase P5. Employee shell, sidebar "Request funds".

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Build from this spec with the 056 request form pattern simplified for employees. Planned exports: `design/stitch/117-submit-spending-request/default--desktop--light.png`, `warning--desktop--light.png` (over the per-person limit), `blocked--desktop--light.png` (budget paused), `submitted--desktop--light.png`.

## Purpose

Let an employee ask for money from a budget they may use, see before submitting whether it fits their limit and who will approve, and attach a quote or receipt.

## Roles

Employee; any role requesting for themselves.

## Entry points

115 and 116 "Request funds"; 116 card "Request"; 119 "Resubmit".

## Content and actions

Single-column form with a live check panel on the right (desktop).

- Form: budget (select, prefilled "Team lunch (Bengaluru Events)"), what it is for (category select: Team meal), amount with currency (INR 4,800.00; shows "= USD 57.49 at the FY2026 plan rate"), date needed, people (6), merchant (optional), why (text, required), attachments (`sat-upload-field`: quote or receipt, optional at request time).
- Check panel:
  - "Your limit": USD 143.71 left this quarter, USD 86.22 after this request; bar with this request in the pending (warning, hatched) segment.
  - "Per person": USD 9.58 each for 6 people (limit USD 9.58): "Within the limit" success tag.
  - "Who approves": "Anand Kumar (Location Manager)", "Usually within 1 day".
  - Rule line: "Team meals: up to USD 9.58 per person, receipts within 30 days".
- Footer: Cancel, Save draft, "Submit request for USD 57.49".

## Data and permissions

`GET /api/requests/route-preview` (budget, amount, currency, spend type) returns route and budget impact without side effects; submit creates a spending request (`requestMachine` draft -> submitted -> pending approval) and pre-encumbers the USD amount at the locked plan rate. Idempotency key on submit. Employees request only from requestable budgets.

## States

| State        | Behaviour                                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default      | as above                                                                                                                                                                           |
| Soft warning | over the per-person limit (USD 11.20 each): warning container "Above the per-person limit; your manager may ask for changes"; justification becomes required; Submit stays enabled |
| Blocked      | budget frozen or set to zero, or amount above what is left: error container with the reason; Submit disabled with the reason written next to it                                    |
| Validation   | amount above zero, reason required, file type and size (PDF, PNG, JPEG up to 10 MB)                                                                                                |
| Submitted    | confirmation card "REQ-2026-0151 sent to Anand Kumar" with "View status" (119) and "Upload receipt later" (121)                                                                    |
| Error        | error banner with Retry; the draft is kept                                                                                                                                         |

## Budget safety and audit

Pending (warning, hatched) versus left (success) in the limit bar; transaction currency next to USD with the plan rate; soft warning versus hard block follow the design-system rules. One audit entry on submit with the route and rule versions.

## Responsive and accessibility

Mobile: check panel collapses into a summary above the footer ("Fits your limit. Anand Kumar approves."); sticky footer. Live check results are announced politely (`aria-live`).

## Related screens and navigation

116, 119, 121, 056 (finance and owner request form), 060 request details.

## Assumptions and open questions

- Should employees see the rule text, or only "within limit / above limit"? Designed with the rule line.
