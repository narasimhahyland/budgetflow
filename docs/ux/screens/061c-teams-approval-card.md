# 061c Microsoft Teams approval card

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 8 batch. Build phase P8. Personal chat message from the BudgetFlow Teams app (`apps/chat`), built as an Adaptive Card with Universal Actions.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). The images will show only the Adaptive Card on a neutral background, not the Teams window. Planned Stitch states, to be generated in a later session:

| State                             | Planned image                                                        |
| --------------------------------- | -------------------------------------------------------------------- |
| approval card waiting             | `design/stitch/061c-teams-approval-card/default--desktop--light.png` |
| reject input shown in the card    | `reject--desktop--light.png`                                         |
| card after approval (refreshed)   | `approved--desktop--light.png`                                       |
| read-only view for a non-approver | `read-only--desktop--light.png`                                      |

## Purpose

Give Teams-first approvers the same one-step decision as Slack (061b) and email (061a): the facts they need, the budget after approval, and Approve or Reject through the same approval API.

## Roles

Approvers at the current step and their delegates, once their Teams account is linked (61e). Others who see a forwarded card see a read-only view.

## Entry points

Sent to the approver's personal chat with the BudgetFlow bot when a request reaches their step; reminders as replies; the BudgetFlow personal app tab "Waiting for you" (61d).

## Content and actions

Card for REQ-2026-0418 (sample approver Meera Iyer):

- Header: BudgetFlow logo, "Approval needed", "REQ-2026-0418".
- FactSet: Request "Diwali celebration catering"; Amount USD 6,000.00 (INR 5,01,000.00 at the FY2026 plan rate); Requester Rahul Verma; Charge to Bengaluru Events; Event Bengaluru Diwali celebration, 14 Nov 2026; Needed by 10 Nov 2026.
- Budget impact container (emphasis style): "Available under this budget's rules: USD 7,450.00 now, USD 1,450.00 after approval"; warning text "Crosses the 80% alert threshold".
- Why you: "Rule R-12 v3 (amount above USD 5,000.00). Your limit: USD 10,000.00 for Events in IN01. Due today 18:00 IST."
- Actions: "Approve USD 6,000.00" (positive style), "Reject" (destructive style; reveals an inline reason code choice set and a required "Reason for Rahul" text input with Submit rejection), "Open in BudgetFlow" (opens 060 in the browser or the Teams personal tab).
- After a decision the card refreshes for everyone who sees it: "Approved by Meera Iyer, 10:42 IST, from Teams" with the budget after approval; actions removed.

## Data and permissions

Teams calls the bot endpoint with a signed token from the Microsoft identity platform; `apps/chat` validates it, maps the Teams user (Microsoft Entra object id) to the BudgetFlow person through the account link (61e) and calls the same approval decision API as 061 with channel `teams` and an idempotency key from the task id and version. Universal Actions refresh the card per viewer: the assigned approver or active delegate sees the actions; everyone else sees the read-only view without buttons. DoA limit, hygiene and the current budget are re-checked on every action. Changes to the request or budget push a card refresh through the outbox.

## States

| State             | Behaviour                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Waiting           | as above                                                                                                      |
| Reject input      | reason code and reason required; card shows "Choose a reason code" and "Tell Rahul why" if empty              |
| Approved/Rejected | refreshed card with decision, person, time, channel; actions removed                                          |
| Read-only         | non-approver view: facts and status only, "Only Meera Iyer or her delegate can decide this"                   |
| Above my limit    | no Approve action; "USD 12,500.00 is above your USD 10,000.00 limit" with "Escalate in BudgetFlow" and Reject |
| Hard block        | "New approvals are paused: Bengaluru Events is frozen"; Approve removed                                       |
| Request changed   | refreshed with the new amount and impact and the line "Changed since it was sent"                             |
| Not linked        | card "Connect your BudgetFlow account to decide from Teams" with Connect (61e)                                |
| Failure           | inline error text in the card "Nothing was approved: try again or open BudgetFlow"; inputs kept               |

## Budget safety and audit

Same API and checks as the web app; the card never shows an action the API would refuse. Each decision writes the same audit entry as 061 with channel "teams" and the Entra object id; sends and refreshes are notification deliveries, not audit entries.

## Responsive and accessibility

Adaptive Card schema 1.5 renders on Teams desktop, web and mobile; FactSet wraps at phone width. Every action has a text title; the fallback text repeats the request, amount and link. Colour styles (positive, destructive, warning text) always come with words.

## Satori components

None inside Teams (Adaptive Card). Links land on Satori screens (060, 061) and the account-link page in 61e.

## Related screens and navigation

061b Slack approval card (same content), 061a email, 061 decision, 060 details, 61d Teams balance, quick request and alerts, 61e chat app setup, 59c notification channels, 090 approval history.

## Decisions taken

- Approval cards go only to the approver's personal chat with the bot, never to team channels (same rule as Slack).
- Reject is handled inside the card with inline inputs instead of a task module dialog, so it works the same on Teams mobile.
- Forwarded or shared cards refresh into a read-only view for anyone who is not the approver or delegate.
- Content and wording match the Slack card line for line, so approvers moving between tools see the same facts.
