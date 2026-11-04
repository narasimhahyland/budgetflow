# 056 Create budget request

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 2. Build phase P5.

## Design

| State                | Image                                                                 | Stitch screen                      |
| -------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| default (new budget) | `design/stitch/056-create-budget-request/default--desktop--light.png` | `d20e12164da04ff79eb5683c8814575a` |

## Purpose

One entry point for every kind of request ("What do you need?"), and the form for asking for a new budget under an existing parent.

## Roles

All requesters; approvers are resolved by the routing rules and DoA.

## Entry points

055 My requests "New request"; 115 employee dashboard "Request funds"; global "New request".

## Content and actions

Five option cards: Spend from a budget (117), More money for an event (057), Help from another director's budget (056a co-funding request), More than is available (058), A new budget (this form). Budget request form: name, parent (with available), amount (USD), category, period, owner, legal entity, cost center, justification. Side cards: "What happens next" (approver with DoA limit, Draft budget becomes Active on approval, amount pending on the parent) and a parent impact preview. Footer: Cancel, Save draft, Submit request.

## Data and permissions

`request:create`. The requested amount pre-encumbers the parent while pending (counted in its Available). Route from rules and DoA (P5 router).

## States

Validation (required fields; amount above parent available is blocked with a link to 058). Parent frozen or set to zero: option disabled with the reason. Submitted: snackbar and redirect to 060 request details.

## Budget safety and audit

Pending amounts are shown as pending, never as available. Submission and each decision are audited.

## Responsive and accessibility

Mobile: option cards as a vertical radio list; form single column. Option cards are radios with descriptions.

## Related screens and navigation

055, 056a, 057, 058, 060, 117.

## Assumptions and open questions

- Known render issue: Stitch drew a sidebar with invented items, a "Hyland Tenant" label and a "Reporting (USD)" chip; the shell is 000a (no tenant label, no currency chip).
