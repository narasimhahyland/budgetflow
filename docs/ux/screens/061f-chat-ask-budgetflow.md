# 061f Ask BudgetFlow in Slack and Teams

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 13 batch. Build phase P13. Review-added screen (catalog section J: "plain-language questions in the app, Slack and Teams, limited to the asker's budgets"; 11a covers the app). Slack `/budgetflow ask`, direct messages to the BudgetFlow app and the App Home; Teams personal chat with the BudgetFlow bot (`apps/chat`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Images show only the message content on a neutral background, as in 061b-061d. Planned Stitch states, to be generated in a later session:

| State                                  | Planned image                                                             |
| -------------------------------------- | ------------------------------------------------------------------------- |
| Slack answer (private)                 | `design/stitch/061f-chat-ask-budgetflow/slack-answer--desktop--light.png` |
| Teams answer in personal chat          | `teams-answer--desktop--light.png`                                        |
| mention in a channel, private redirect | `channel-redirect--desktop--light.png`                                    |
| action request redirected to the app   | `action-redirect--desktop--light.png`                                     |
| refused (out of scope)                 | `refused--desktop--light.png`                                             |

## Purpose

Let people ask the same plain-language budget questions as in the app (11a) where they already work, with private answers that obey exactly the same scope, show their sources and link back to BudgetFlow for anything that needs a decision.

## Roles

Every person with a linked chat account (61e), within their own BudgetFlow scope. The Integration Admin controls whether the chat question feature is available (61e app settings) together with the AI feature switch (113a).

## Entry points

Slack: `/budgetflow ask <question>`, a direct message to the BudgetFlow app, App Home button "Ask a question", a mention of @BudgetFlow in a channel (answered privately). Teams: a message in the personal chat with the BudgetFlow bot, the personal tab button "Ask a question"; a mention in a channel or group chat gets a pointer to the personal chat.

## Content and actions

Answer message (private: ephemeral in Slack, personal chat in Teams), sample Meera Iyer, Regional Manager India: "Which India budgets are above 80%?"

- Text: "Two of your India budgets are above 80% committed or spent:"
- Lines (rendered from BudgetFlow figures):
  - "Bengaluru Events: 80.5% (USD 8,050.00 of USD 10,000.00); USD 1,950.00 available under its rules."
  - "Hyderabad Wellbeing: 84.0% (USD 2,520.00 of USD 3,000.00); USD 480.00 available under its rules."
- Context line: "AI-generated from BudgetFlow figures as of 10:42 IST. Sources: Bengaluru Events, Hyderabad Wellbeing."
- Buttons: "Open in BudgetFlow" (opens 011a with the same question and answer), Helpful, Not helpful.
- Answers longer than eight lines or with tables over five rows end with "See the full answer in BudgetFlow".

Mention in a channel (Slack): the channel sees nothing; the asker gets an ephemeral note "I answer budget questions privately. Here is your answer:" followed by the answer. Teams channel or group chat: a short reply visible to the group "I answer budget questions in a personal chat." with "Open personal chat"; the question is not answered in the group.

Action requests ("approve REQ-2026-0418", "freeze Bengaluru Wellbeing"): "I can't approve requests or change budgets. Open it in BudgetFlow to decide." with "Open REQ-2026-0418" or, for approvals already waiting, "Show the approval card" (061b, 061c).

## Data and permissions

`apps/chat` calls the same `POST /api/ai/ask` as 11a with the linked person's identity and channel `slack` or `teams`; scope, minimum facts, figure check, zod parsing and the `ai_query_log` row are identical. Message text and buttons carry no data the person could not see in the app. BudgetFlow does not store the chat conversation beyond the query-log metadata; Slack and Teams keep the messages under the company's own chat retention, which the Integration Admin is told about when turning the feature on (61e).

## States

| State           | Behaviour                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Answer          | private answer as above                                                                                                   |
| Long answer     | first eight lines and "See the full answer in BudgetFlow"                                                                 |
| Channel mention | private redirect (Slack) or pointer to the personal chat (Teams); no answer in the channel                                |
| Action request  | refusal with a link to the record or approval card                                                                        |
| Out of scope    | "I can only answer about budgets you can see." (same neutral wording as 11a)                                              |
| No data         | "I couldn't find that in the budgets you can see." with "Open BudgetFlow"                                                 |
| Not linked      | "Connect your BudgetFlow account to ask questions" with Connect (61e)                                                     |
| Turned off      | `/budgetflow ask` replies "Questions are turned off for Hyland. You can still check balances with `/budgetflow balance`." |
| Unavailable     | "BudgetFlow AI is unavailable right now. Try `/budgetflow balance` or open BudgetFlow."                                   |
| Rate limited    | "You've asked 50 questions in the last hour. You can ask again at 11:30." (shared limit with 11a)                         |

## Budget safety and audit

Chat answers describe a single budget with "Available under this budget's rules", never the company-wide figure, as in 061d. Asking changes nothing and writes no audit entry; the query log records channel, outcome and records used. Nothing in a chat answer can approve, request or change money; buttons only open BudgetFlow.

## Responsive and accessibility

Block Kit and Adaptive Cards render on desktop and mobile chat clients; every message has a plain-text fallback; statuses and percentages are written in words and numbers, never colour or emoji alone.

## Satori components

None inside Slack or Teams. Links land on Satori screens (011a, 021, 060).

## Related screens and navigation

011a AI assistant panel, 061d chat balance and alerts, 061b Slack approval card, 061c Teams approval card, 061e chat app setup and linking, 113a AI settings and query log, 059c notification channels.

## Decisions taken

- Answers are always private to the asker; a mention in a channel never produces an answer the channel can see. Recommended because channel membership cannot be checked against each budget's scope.
- Chat answers are capped at eight lines with a link to the full answer, so tables and long lists stay in BudgetFlow where they are readable.
- The chat question feature needs both the AI switch (113a) and the chat app (61e) to be on; turning either off removes it.
- `/budgetflow balance` (061d) stays available when AI is off or unavailable, so the most common question always has a non-AI answer.
