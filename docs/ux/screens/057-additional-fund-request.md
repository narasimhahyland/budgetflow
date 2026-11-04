# 057 Create additional-fund request

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P5.

## Design

| State                  | Image                                                                   | Stitch screen                      |
| ---------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| form with soft warning | `design/stitch/057-additional-fund-request/default--desktop--light.png` | `12ef391e70294f8a85f08e3ea7c62796` |

## Purpose

Ask for more money for an event or budget, with the budget impact and the approval route (by delegation of authority) visible before submitting.

## Roles

Requesters (Event Organizer, owners, employees with request rights). Approvers see the result in 060.

## Entry points

046 "Request additional funds", 024 blocked state "Request an increase", 055 "New request", 115 employee dashboard.

## Content and actions

Left form: what it is for (event chip), amount (USD), needed by, category, charge to (home budget or split across contributing budgets), justification, attachments (`sat-upload-area`). Right sticky card: budget impact (available under this budget's rules, this request, available after approval, bar), soft warning line, "Who approves" route (requester skipped as approver, Regional Manager by DoA, Finance Controller only above threshold). Footer: Cancel, Save draft, Submit request.

## Data and permissions

`request:create` on the target budget; route preview from the rules engine (simulation, no side effects); attachments to MinIO through the DocumentStore.

## States

| State                     | Behaviour                                                               |
| ------------------------- | ----------------------------------------------------------------------- |
| Validation                | amount, category, needed-by and justification required                  |
| Soft warning              | as designed (can submit)                                                |
| Hard block (not exported) | budget frozen or set to zero: error banner, Submit disabled with reason |
| Draft saved               | snackbar; listed in 055 Drafts                                          |
| Submitted                 | snackbar and redirect to 055 with the new row highlighted               |

## Budget safety and audit

Submitting pre-encumbers the amount (pending), shown in warning tone until approved. One audit entry on submit; approvers notified (in app and 061a email).

## Responsive and accessibility

Mobile: impact card collapses into a summary bar above the sticky footer. Route is an ordered list; skipped steps say why.

## Related screens and navigation

046, 055, 059, 060, 061, 061a.

## Assumptions and open questions

- "Split across contributing budgets" creates one request per budget or one request with lines? Assumed one request with lines.
- Stitch wrote "Authorized ceiling" helper text under the amount; treat as the event cap and funded amount.
