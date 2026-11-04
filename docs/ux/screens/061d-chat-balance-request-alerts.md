# 061d Slack and Teams: balance check, quick request and alerts

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 8 batch. Build phase P8. Review-added screen (catalog section H: Slack and Teams apps "balance check, quick request, alerts"). Slack App Home, `/budgetflow` command, modals and direct messages; Teams personal app tab, bot messages and dialogs (`apps/chat`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Images show only the message, modal or tab content on a neutral background. Planned Stitch states, to be generated in a later session:

| State                                 | Planned image                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| Slack App Home                        | `design/stitch/061d-chat-balance-request-alerts/app-home--desktop--light.png` |
| balance reply                         | `balance-reply--desktop--light.png`                                           |
| quick request modal                   | `quick-request--desktop--light.png`                                           |
| quick request blocked (frozen budget) | `request-blocked--desktop--light.png`                                         |
| alert message (80% threshold)         | `alert--desktop--light.png`                                                   |
| Teams personal tab                    | `teams-tab--desktop--light.png`                                               |

## Purpose

Answer "how much is left?" and raise a small request without leaving Slack or Teams, and push the alerts owners care about (thresholds, freezes, escalations, decisions) to where they will see them, while every rule, limit and control works exactly as in the web app.

## Roles

Budget owners and managers (balance of budgets they own or co-own, alerts), employees and organizers (budgets they can request from, quick request, decisions on their requests), approvers (waiting list linking to 061b and 061c). All with a linked account (61e).

## Entry points

Slack: `/budgetflow balance [budget]`, `/budgetflow request`, the App Home tab, message shortcuts "New BudgetFlow request". Teams: the BudgetFlow personal app tab, bot messages "balance" and "new request". Alerts arrive as direct messages.

## Content and actions

Balance reply (private, only the asker sees it), sample Anand Kumar:

- "Your budgets, in USD, as of 10:42 IST":
  - Bengaluru Events: available USD 7,450.00 of USD 10,000.00 (25.5% used), Active.
  - Bengaluru Diwali celebration (EVT-2026-0112): available USD 1,200.00 of the USD 9,000.00 cap.
  - Bengaluru Wellbeing: Frozen since 2 Nov, new requests paused.
- Buttons: "Open in BudgetFlow", "New request". `/budgetflow balance Bengaluru Events` returns one budget with authorized, pending, committed, actual and available lines. Ambiguous names return "Did you mean" buttons.

App Home (Slack) and personal tab (Teams), same sections:

- Waiting for you: approvals with amount and due time, each opening its approval card (061b or 061c).
- My budgets: the balance lines above.
- My requests: last five with status tags in text (Pending with Meera Iyer, Approved, Changes requested).
- Buttons: "New request", "Notification settings" (59c), "Open BudgetFlow".

Quick request modal:

- Budget (select, only budgets the person can request from); amount and currency (USD default; INR, EUR or GBP show the USD equivalent at the FY2026 plan rate below the field); category; "What is it for?"; needed by (date); event (optional select); justification (multiline).
- On Submit the API evaluates rules: soft warnings replace the modal with a confirmation view ("This uses 85% of Bengaluru Events. Submit anyway?" with Submit and Back); hard blocks show an error view with the reason and no Submit.
- Success: private message "REQ-2026-0433 Team lunch, USD 180.00, submitted. Routed to Anand Kumar." with "Open in BudgetFlow" and "Add a receipt or document in BudgetFlow".

Alerts (direct messages, each with "Open in BudgetFlow" and "Manage notifications"):

- Threshold: "Bengaluru Events passed 80%: USD 8,050.00 of USD 10,000.00 committed or spent."
- Control: "Bengaluru Wellbeing was frozen by Meera Iyer. New requests are paused; existing commitments continue. Reason: budget review."
- Set to zero: "Europe Wellbeing was set to zero. 2 pending requests were returned to their requesters."
- Escalated to you: "REQ-2026-0455 escalated to you: above Sophie Laurent's limit." (opens 061b or 061c).
- Decision on my request: "Approved: REQ-2026-0433, USD 180.00, by Anand Kumar."
- Co-funding request received, receipt needed, forecast commentary due (87a).

Scheduled report post (configured in 091, posted to a channel): title, scope and period, three to five headline figures, "Open report in BudgetFlow"; no file attached.

## Data and permissions

All reads and writes call the same APIs as the web app through `apps/chat` with the linked person's identity: budget balance summaries (`getBudget`, P4), available budgets (116, P5), request creation and rule evaluation (056, 117, P5) with an idempotency key from the Slack view submission or Teams activity id, and notification preferences (59c). `PolicyService` scope applies to every reply: a person never sees a budget in chat they cannot see in the app. Replies to commands are private (ephemeral in Slack, personal chat in Teams). Channel report posts contain only figures the schedule owner chose for a channel audience and are subject to 091's rules.

## States

| State          | Behaviour                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Balance reply  | as above                                                                                            |
| No budgets     | "You don't own or use any budgets yet." with "Open BudgetFlow"                                      |
| Ambiguous name | "Did you mean" with up to five budget buttons                                                       |
| Quick request  | modal as above; required fields marked                                                              |
| Validation     | field errors "Enter an amount above zero", "Choose a budget"                                        |
| Soft warning   | confirmation view with the warning text and Submit or Back                                          |
| Hard block     | error view "Bengaluru Wellbeing is frozen: new requests are paused" and the rule reason; only Close |
| Submitted      | private message as above                                                                            |
| Alert          | as above; respects quiet hours and channel choices (59c)                                            |
| Not linked     | "Connect your BudgetFlow account" with Connect (61e)                                                |
| Service down   | "BudgetFlow is not responding. Nothing was submitted." with "Open BudgetFlow"                       |

## Budget safety and audit

Chat shows "Available under this budget's rules" (labelled), never the company-wide figure. Requests from chat pass the same rules, limits, freeze and zero controls as the web form, and can never skip approval. Request creation writes the same audit entry as the web app with channel "slack" or "teams"; balance lookups are product analytics events only.

## Responsive and accessibility

Slack Block Kit and Teams Adaptive Cards render on desktop and mobile clients; lines stay short. Status is written as words ("Frozen", "Pending with Meera Iyer"), never colour or emoji alone; every message has a plain-text fallback.

## Satori components

None inside Slack or Teams. Links land on Satori screens (021, 060, 117, 59c, 61e).

## Related screens and navigation

061b Slack approval card, 061c Teams approval card, 61e chat app setup and linking, 59b mobile balance, 116 available budgets, 117 submit spending request, 056 create budget request, 59c notification channels, 091 export and scheduled reports, 11a AI assistant (P13, adds plain-language questions in chat).

## Decisions taken

- Chat replies about balances are always private to the asker, never posted in a channel.
- Quick requests from chat cannot carry attachments; the confirmation links to the app to add receipts or documents. Recommended because file handling and verification (121) live in one place.
- Quick request covers spending requests only; additional-fund, over-budget and co-funding requests stay in the app, where their impact previews fit.
- Alerts default to: thresholds and controls for owners, decisions for requesters, escalations for approvers; everything else is opt-in in 59c.
- Scheduled report posts in channels carry headline figures and a link, never a file.
