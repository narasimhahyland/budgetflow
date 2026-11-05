# 117a Hand-off of approved spend to a prefilled expense

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Action on approved requests in 119 view request status and 120 approved allocations ("Create expense"), with a status panel on the request; mobile in 59b.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the layouts of 119 and 120. Planned Stitch states, to be generated in a later session:

| State                                     | Planned image                                                    |
| ----------------------------------------- | ---------------------------------------------------------------- |
| approved request with Create expense      | `design/stitch/117a-expense-handoff/default--desktop--light.png` |
| hand-off confirmation                     | `confirm--desktop--light.png`                                    |
| expense created, status synced            | `created--desktop--light.png`                                    |
| expense tool not connected (copy details) | `copy-details--mobile--light.png`                                |

## Purpose

Save employees and organizers from typing the same spend twice: once a request is approved, one action creates a draft expense in the company's expense tool with the event code, cost center, category, amount and request id already filled, and BudgetFlow then shows whether the expense was submitted, approved and paid.

## Roles

Employees and event organizers (for their own approved requests); approvers and owners see the status on the request.

## Entry points

119 approved request "Create expense"; 120 approved allocations row action; 59b mobile approved request; approval notification "Approved: REQ-2026-0145. Create your expense."

## Content and actions

Approved request (sample Kavya Shah, REQ-2026-0145 Team lunch Q4, approved USD 57.49): panel "Expense" with "Create expense in Concur" (`satImportantButton`) and the line "We'll fill in the event code, cost center and amount for you."

Confirmation dialog:

- Expense tool: Concur (from 095 settings).
- Fields sent: request REQ-2026-0145; expense type "Meals - team" (from the category mapping); amount INR 4,800.00 (USD 57.49 at the FY2026 plan rate) with "Use the receipt amount instead" if a receipt is attached (INR 4,560.00); date; cost center CC-BLR-210; event code if any; merchant if known; receipt attached (on, if uploaded in 121).
- Note: "A draft is created for you in Concur. You submit it there."
- Buttons: Cancel, Create draft expense.

After creation: status panel "Draft created in Concur, 4 Nov 11:20" with "Open in Concur"; later states synced from the tool: Submitted, Approved, Paid (with dates); amount differences shown: "Claimed INR 4,560.00, USD 2.88 less than approved".

Not connected: "Copy details" card with the same fields and a Copy all button, plus "Download receipt".

## Data and permissions

Uses the 095 expense connector to create a draft expense with the employee's linked identity in the expense tool; status updates come back with the expense lines (source `expense`) and link to the request. Only the requester (or the organizer for event requests) can create the hand-off, once per request (`EXPENSE_HANDOFF_EXISTS` on a second attempt, with "Open in Concur"). The expense line later enters the actuals review (080a) and matches the request's commitment by request id, with the card or receipt duplicates handled by 99a.

## States

| State                       | Behaviour                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Ready                       | as above                                                                                                   |
| Confirm                     | dialog as above                                                                                            |
| Created                     | status panel with Open in the tool                                                                         |
| Submitted / Approved / Paid | status tags updated from the tool                                                                          |
| Above approved              | soft warning "Claim is USD 6.20 more than approved. Your approver will be asked to accept the difference." |
| Not connected               | copy-details card                                                                                          |
| Request not approved        | action hidden; "Available after approval"                                                                  |
| Tool error                  | error banner "Concur did not accept the draft: expense type is inactive" with Copy details                 |
| Loading                     | `sat-ghost` panel                                                                                          |

## Budget safety and audit

The hand-off moves no money; the commitment stays encumbered until the expense line is matched (080a, 080b), and any difference against the approved amount follows the receipt rules of 121. Creating the hand-off is audited on the request; status updates are recorded in the request history.

## Responsive and accessibility

Works on desktop and phone (59b); the dialog becomes a full-screen sheet on mobile. Fields sent are listed as text so people can check them before creating.

## Satori components

`satImportantButton` (Create expense), `satCardSurfaceContainerLowest` (status panel), `sat-status-tag` (Draft created, Submitted, Approved, Paid), `sat-banner`, `sat-ghost`; Angular Material dialog, slide toggle (attach receipt), snackbar; `bf-money`.

## Related screens and navigation

119 view request status, 120 approved allocations, 121 upload receipt, 59b mobile receipts, 095 expense integration, 080a actuals import, 99a duplicates.

## Decisions taken

- BudgetFlow creates a draft expense that the employee submits in their own tool; it never submits on their behalf. Recommended so the employee stays responsible for the claim.
- One hand-off per request; a second attempt opens the existing draft.
- When no expense tool is connected, the same details are offered to copy, so the feature still saves typing.
