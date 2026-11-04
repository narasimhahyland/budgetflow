# 119 View request status

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 5 employee batch. Build phase P5. Employee shell; the employee view of a request (060 is the approver and finance view).

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/119-request-status/default--desktop--light.png` (waiting for approval), `changes-requested--desktop--light.png`, `rejected--desktop--light.png`, `approved--desktop--light.png` (receipt due).

## Purpose

Tell the requester in plain words where their request is, who has it, what happens next and what they need to do (nothing, change it, upload a receipt), with the amounts they asked for and were given.

## Roles

The requester (any role for their own requests).

## Entry points

My requests (055) row; 115 "View details"; notifications and emails about decisions; 117 and 118 confirmations.

## Content and actions

Sample: REQ-2026-0145 "Team lunch Q4", Kavya Shah, Team lunch (Bengaluru Events), INR 4,800.00 = USD 57.49.

- Header: request id and title, status tag (Pending approval, warning), submitted 2 Nov 2026. Actions by state: Withdraw (pending), Edit and resubmit (changes requested), Upload receipt (approved), Copy as new request (rejected).
- "Where it is" stepper: Submitted (done, 2 Nov) -> Manager approval (current: "Waiting on Anand Kumar since 2 Nov; usually 1 day") -> Approved -> Receipt -> Done. Steps that do not apply are hidden.
- Summary card: amount (INR and USD at the plan rate), budget, category, people, date needed, why.
- Attachments list with "Add file".
- Activity: plain-English timeline ("You submitted the request", "Anand Kumar was asked to approve", reminders) and comments with "Add a comment".

## Data and permissions

Request with route, status, activity and documents from the requests API (`GET /api/requests/{id}`); withdraw releases the pre-encumbrance; resubmit goes back through routing. Requesters see only their own requests; approver identities are shown, internal rule versions are not.

## States

| State                 | Behaviour                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Pending approval      | as above; Withdraw asks for confirmation                                                                          |
| Changes requested     | warning banner with the approver's comment ("Please split the snacks into a separate request"); Edit and resubmit |
| Partially approved    | success banner "Approved USD 40.00 of USD 57.49" with the approver's reason; receipt step for the approved amount |
| Rejected              | important banner with reason code and text; Copy as new request                                                   |
| Approved              | success banner; task "Upload your receipt by 2 Dec 2026" with Upload receipt (121)                                |
| Withdrawn             | neutral banner "You withdrew this request on 3 Nov"                                                               |
| Not found / forbidden | `sat-404-error-state` or `sat-403-error-state`                                                                    |

## Budget safety and audit

Pending (warning) versus approved (success) versus rejected (important) tags with icons; requested versus approved amounts side by side on partial approvals. Withdraw and resubmit are audited.

## Responsive and accessibility

Mobile: stepper becomes a vertical list; actions in a sticky bottom bar. The current step is announced as "Current step: Manager approval".

## Related screens and navigation

055 my requests, 060 request details, 064 request history, 117, 121, 115.

## Assumptions and open questions

- Show the approver's typical response time ("usually 1 day")? Assumed yes, computed from the last 90 days.
