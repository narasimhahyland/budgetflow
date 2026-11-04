# 050 Event approval workflow

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 2. Build phase P5. "Approvals" tab of 046.

## Design

| State   | Image                                                                   | Stitch screen                      |
| ------- | ----------------------------------------------------------------------- | ---------------------------------- |
| default | `design/stitch/050-event-approval-workflow/default--desktop--light.png` | `5d22b19a68084457938783072e75b1dd` |

## Purpose

Show where the event is in its lifecycle, who approved what within their delegation of authority, which co-funding requests are pending, and why the route looks the way it does.

## Roles

Organizer, co-organizers, approvers on the chain, funding owners; auditors read.

## Entry points

046 tab Approvals; notifications about the event's approvals.

## Content and actions

Lifecycle stepper (Draft, Submitted, Approved, Funding, Committed, In progress, Completed, Reconciling, Closed). "Approval chain": each step with role, approver, decision and date, DoA check; co-funding steps per Inter-Director Budget Contribution Request with requested and approved amounts; Send reminder on pending steps (organizer only, rate-limited). "Why this route?": matched rules in plain English plus approval hygiene lines (no self-approval, approvers are not attendees). "What happens next".

## Data and permissions

Chain and explanations from the approval instance and the rules decision record (rule versions and facts). Read-only except reminders.

## States

Rejected step: important-tone step with reason and a "Resubmit" link (065, P7). Escalated or delegated step: tag on the step (062/063, P7). Loading skeleton.

## Budget safety and audit

Every decision shown links to its audit entry. Removing an approver from the attendee list (hygiene) is itself audited.

## Responsive and accessibility

Mobile: stepper becomes "Step 4 of 9 - Funding"; chain stacks. Steps are an ordered list with status text.

## Related screens and navigation

046, 046a, 056a, 059, 060, 061.

## Assumptions and open questions

- Thresholds in the sample (regional manager above USD 10,000.00; finance controller for cross-entity attendees) are seed rules, editable in P7.
