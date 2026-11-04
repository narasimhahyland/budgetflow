# 065 Rejected request and resubmission

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Requester view; reached from 119 and 055.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/065-rejected-request-resubmission/default--desktop--light.png` (changes requested with a counter-offer), `rejected--desktop--light.png`, `resubmit--desktop--light.png` (edit with changes compared).

## Purpose

When an approver rejects, requests changes or counter-offers, show the requester exactly what was said and what to change, let them accept a counter-offer in one step or edit and resubmit, and keep every version comparable.

## Roles

Requesters (all roles for their own requests). Approvers see the versions in 060 and 064.

## Entry points

119 request status; 055 my requests ("Changes requested", "Rejected"); decision notifications and emails.

## Content and actions

Changes requested with counter-offer (default; sample REQ-2026-0102 "Conference ticket", Kavya Shah, Learning stipend, INR 18,000.00 = USD 215.57):

- Banner (warning): "Anand Kumar requested changes on 4 Nov: 'Book the early-bird ticket; I can approve USD 150.00.'"
- Counter-offer card: requested USD 215.57, offered USD 150.00 (INR 12,525.00); actions "Accept USD 150.00" (filled) and "Edit request" (outlined); note "Accepting approves the request at USD 150.00 without another review."
- Version list: v1 submitted 2 Nov (USD 215.57), changes requested 4 Nov.

Rejected (state): important banner with reason code ("RC-11 Use another budget") and text; "Copy as new request" and "Ask a question" (comment to the approver); no resubmit on a final rejection.

Resubmit (state): the request form (117 layout) with changed fields highlighted and a "What changed" panel comparing v1 and v2 (amount USD 215.57 -> USD 160.00; ticket type; new attachment), required "Note to the approver", Submit v2. The route preview shows the same approver unless the amount crosses a threshold.

## Data and permissions

`requestMachine`: pending_approval -> changes_requested -> submitted (resubmit); counter-offers are a partial approval proposal that the requester accepts (approved at the offered amount) or answers with a resubmission. Each version keeps its own pre-encumbrance movements (release then pre-encumber). Only the requester can resubmit or accept.

## States

| State                 | Behaviour                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Changes requested     | banner and Edit request; no counter-offer card when the approver did not offer an amount   |
| Counter-offer         | as above                                                                                   |
| Rejected              | final; Copy as new request                                                                 |
| Resubmit validation   | note required; at least one field must change                                              |
| Counter-offer expired | offers expire after 7 days (assumed): "This offer expired on 11 Nov"; Edit request only    |
| Success               | snackbars "Accepted USD 150.00; REQ-2026-0102 approved" or "Version 2 sent to Anand Kumar" |

## Budget safety and audit

Requested versus offered versus approved amounts sit side by side; accepting releases the difference from pre-encumbered. Every version, offer, acceptance and resubmission is audited and visible in 064.

## Responsive and accessibility

Mobile: counter-offer card first with full-width buttons; "What changed" becomes a list of "before / after" pairs. Changes are marked with text ("Changed"), not colour alone.

## Related screens and navigation

119, 055, 060, 061 (where approvers make the offer), 064 request history, 117.

## Assumptions and open questions

- Should accepting a counter-offer need no further review (as designed) when the offer came from the final approver?
