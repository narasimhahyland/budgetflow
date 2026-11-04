# 061b Slack approval card

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 8 batch. Build phase P8. Direct message from the BudgetFlow Slack app (`apps/chat`), built with Slack Block Kit.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). The images will show only the Slack message and modal content on a neutral background, not Slack's own window chrome. Planned Stitch states, to be generated in a later session:

| State                              | Planned image                                                        |
| ---------------------------------- | -------------------------------------------------------------------- |
| approval card waiting              | `design/stitch/061b-slack-approval-card/default--desktop--light.png` |
| card after approval (updated)      | `approved--desktop--light.png`                                       |
| reject modal                       | `reject-modal--desktop--light.png`                                   |
| above my limit (no Approve button) | `outside-doa--desktop--light.png`                                    |
| account not linked                 | `not-linked--desktop--light.png`                                     |

## Purpose

Let approvers decide simple requests where they already work, with the same facts as the web app (amount, requester, budget impact after approval, rule reason, their limit) and the same approval API, so occasional approvers stop holding up events.

## Roles

Approvers at the current step (owners, managers, Finance Controller, CEO) and their delegates, once their Slack account is linked to BudgetFlow (61e).

## Entry points

Sent as a direct message from the BudgetFlow app when a request reaches the approver's step; reminders as thread replies before the SLA; the Slack App Home "Waiting for you" list (61d).

## Content and actions

Card for REQ-2026-0418 (sample approver Meera Iyer):

- Header block: "Approval needed: REQ-2026-0418".
- Fields: "Diwali celebration catering"; Amount USD 6,000.00 (INR 5,01,000.00 at the FY2026 plan rate); Requester Rahul Verma; Charge to Bengaluru Events; Event Bengaluru Diwali celebration, 14 Nov 2026; Needed by 10 Nov 2026.
- Budget impact (context block): "Available under this budget's rules: USD 7,450.00 now, USD 1,450.00 after approval." Second line with the warning emoji: "Crosses the 80% alert threshold of Bengaluru Events."
- Why you (context block): "Routed by rule R-12 v3 (amount above USD 5,000.00). Your limit: USD 10,000.00 for Events in IN01. Due today 18:00 IST."
- Actions: "Approve USD 6,000.00" (primary style), "Reject" (danger style), "Open in BudgetFlow" (link to 060); overflow menu "Approve part or request changes" (link to 061).
- Reject modal: title "Reject REQ-2026-0418"; reason code (select from the reason-code taxonomy, 106b); "Reason for Rahul" (multiline, required); buttons Reject and Cancel; note "Rahul is notified with your reason."
- After a decision the card updates in place: header "Approved by you, 10:42 IST, from Slack", amount and budget after approval, "Open in BudgetFlow"; buttons removed. Reminder thread replies stop.

## Data and permissions

Slack sends signed requests to `apps/chat`; the signature (signing secret) and timestamp are verified before anything else. The Slack user is mapped to a BudgetFlow person through the account link (61e); unlinked users get the "Connect your account" card. Every button press calls the same approval decision API as 061 with channel `slack` and an idempotency key built from the task id and version, after a fresh check of `PolicyService.can(request.approve)`, the approver's DoA limit for spend type, amount and entity, approval hygiene and the current budget. The card shows figures returned by the API at send time and replaces them with fresh figures whenever the request or budget changes (the API pushes an update through the outbox). Only the assigned approver or an active delegate can act; anyone else who presses a button gets a private reply "Only Meera Iyer or her delegate can decide this."

## States

| State              | Behaviour                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Waiting            | as above                                                                                                                              |
| Approved           | card updated in place as above                                                                                                        |
| Rejected           | card updated: "Rejected by you, 10:44 IST. Reason sent to Rahul." with the reason code                                                |
| Reject modal error | Slack modal shows field errors "Choose a reason code" and "Tell Rahul why"                                                            |
| Above my limit     | no Approve button; context line "USD 12,500.00 is above your USD 10,000.00 limit"; buttons "Escalate in BudgetFlow", Reject           |
| Hard block         | budget frozen or set to zero after sending: card updated with "New approvals are paused: Bengaluru Events is frozen"; Approve removed |
| Request changed    | card updated "This request changed to USD 6,400.00. Review the new figures." with the new impact; buttons kept                        |
| Decided elsewhere  | "Decided by Anand Kumar (delegate) in BudgetFlow at 10:40"; buttons removed                                                           |
| Not linked         | card "Connect your BudgetFlow account to decide from Slack" with Connect (opens 61e linking) and "Open in BudgetFlow"                 |
| Failure            | private message "Nothing was approved: the approval service is unavailable. Try again or open BudgetFlow."; card unchanged            |
| Reminder           | thread reply "Due in 1 hour" (respects quiet hours, 59c)                                                                              |

## Budget safety and audit

The decision is the same API call as the web app, so DoA limits, hygiene and hard blocks apply identically; the card never offers a button the API would refuse. Soft warnings are text plus emoji, never colour alone. Each decision writes the same audit entry as 061 with channel "slack" and the Slack user id; card sends and updates are logged as notification deliveries, not audit entries.

## Responsive and accessibility

Block Kit renders on Slack desktop and mobile; fields stay short enough to wrap cleanly at phone width. Buttons carry text, not emoji only; amounts always include the currency code. A plain-text fallback (`text` field) repeats the request, amount and link for screen readers and notifications.

## Satori components

None inside Slack (Block Kit renders the card). Links land on Satori screens (060, 061) and the account-link page in 61e.

## Related screens and navigation

061 approval decision, 060 request details, 061a actionable approval email, 061c Teams approval card, 61d Slack balance, quick request and alerts, 61e chat app setup and linking, 59c notification channels, 090 approval history (channel filter).

## Decisions taken

- Approval cards go only to the approver's direct messages, never to channels. Recommended because request amounts and justifications are not for a whole channel.
- Slack offers Approve and Reject (reject needs a reason code and a reason in a modal); partial approval and request changes open the app, matching the email decision of 2026-11-05.
- Cards update in place after any decision, change or control (freeze, set to zero) so a stale button is never pressed.
- Reminders are thread replies to the original card, not new messages, to keep the approver's direct messages tidy.
