# 061a Actionable approval email

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P5 (sent by the worker through Mailpit locally).

## Design

| State                   | Image                                                                      | Stitch screen                      |
| ----------------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| email in a reading pane | `design/stitch/061a-actionable-approval-email/default--desktop--light.png` | `b6f2af8727d44e13bd908a22a110ced0` |

## Purpose

Let an approver decide simple requests from email with the same facts as the app: amount, requester, budget impact and soft warnings, and one-click Approve or Reject that goes through the same approval API.

## Roles

Approvers at the current step.

## Entry points

Sent when a request reaches the approver's step; reminders before the SLA.

## Content and actions

Header strip with BudgetFlow and "Hyland". Greeting and why you are the approver (DoA limit). Summary card (request, amount, requester, charge to, needed by, justification). Budget impact (available before and after, bar, soft warning). Buttons: "Approve USD 6,000.00", "Reject"; link for approve part, request changes or details (060). Expiry and single-use note; footer with notification settings.

## Data and permissions

Buttons carry signed, single-use tokens that expire (72 hours) and are bound to the approver and the request version; the landing page re-checks DoA and budget and may ask the user to sign in (Keycloak). Reject from email asks for a reason code on the landing page.

## States

| State                                        | Behaviour                                                   |
| -------------------------------------------- | ----------------------------------------------------------- |
| Decision recorded (landing, not exported)    | "Approved USD 6,000.00 for REQ-2026-0418" with link to 060  |
| Link expired or used (landing, not exported) | explains and links to 060                                   |
| Request changed since email                  | landing shows the new amount and asks to confirm in the app |

## Budget safety and audit

Same audit entry as a decision in the app, with channel "email". Soft warnings shown in email are recomputed on the landing page.

## Responsive and accessibility

Single 640px column that reflows to 100% on phones; buttons at least 44px high; plain-text alternative part with the same links.

## Related screens and navigation

059, 060, 061, 109 notification settings.

## Assumptions and open questions

- Stitch invented email-client chrome (archive, signature badges) around the message; only the 640px message body is the design.
- Should Reject be allowed from email at all, or only Approve? Designed with both; Reject requires a reason on the landing page.
