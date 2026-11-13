# 011a AI assistant panel (plain-language questions)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 13 batch. Build phase P13. "Ask BudgetFlow" side panel opened from the app header on every screen; full page `/ask` (and `/m/ask` in the mobile app). This spec also defines the shared AI output pattern used by 16b, 17c, 22d, 61f, 69a, 80f, 121a and the Phase 15 drafting screens (11b, 45b).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a). Planned Stitch states, to be generated in a later session:

| State                                 | Planned image                                                       |
| ------------------------------------- | ------------------------------------------------------------------- |
| panel open, suggested questions       | `design/stitch/011a-ai-assistant-panel/default--desktop--light.png` |
| answer with figures and sources       | `answer--desktop--light.png`                                        |
| action request redirected to a screen | `action-redirect--desktop--light.png`                               |
| out-of-scope question refused         | `refused--desktop--light.png`                                       |
| AI unavailable                        | `unavailable--desktop--light.png`                                   |
| mobile full page                      | `answer--mobile--light.png`                                         |

## Purpose

Answer the budget questions people otherwise send to finance ("How much is left?", "What's committed but not spent?", "Where is my request?", "Which budgets will lapse?") in plain language, from BudgetFlow's own figures, limited to what the asker may see, with every figure traceable to its record and no ability to approve, move money or change anything.

## Roles

Every signed-in role, always within its own scope (`PolicyService`): owners about budgets they own or co-own and their subtrees; finance, CEO and analysts company-wide; organizers about their events; employees about their own requests and the budgets they may request from. Super Admin gets no tenant financial data without a break-glass grant. The assistant is hidden when the Organization Admin turns it off (113a).

## Entry points

App header button "Ask BudgetFlow" (Material Icons `auto_awesome`, shortcut Ctrl J); global search "Ask BudgetFlow about ..." when a search finds no record; "Ask about this budget" on 021, "Ask about this event" on 046 and "Ask about this report" on 079 reports (each opens the panel with a context chip); 115 employee home "Ask a question"; Slack and Teams (61f).

## Content and actions

Panel (right side, 400 px, resizable to 600 px):

- Header: "Ask BudgetFlow", AI tag, menu (Conversation history, New conversation, How answers work), Close.
- Intro line: "Answers use only the budgets, requests and events you can see. BudgetFlow AI explains and suggests; it can't approve, move money or change settings."
- Context chip when opened from a record: "About: Bengaluru Events" (removable).
- Suggested questions by role, as chips:
  - Owners: "How much is left in my budgets?", "What's committed but not spent yet?", "Which of my budgets are above 80%?".
  - Finance: "Which budgets are forecast to overspend this quarter?", "Unmatched actuals older than 30 days by legal entity".
  - Employees: "How much can I still request for team lunches?", "Where is REQ-2026-0433?".
- Question box (multiline, 500 characters, Enter to send, Shift Enter for a new line) with Send; Stop while an answer is being prepared.

Answer card (sample: Anand Kumar, Location Manager Bengaluru, asks "How much is left in Bengaluru Events and what's coming up?"):

- Text: "Bengaluru Events has USD 7,450.00 available under its rules, of USD 10,000.00 authorized. USD 1,550.00 is committed, USD 1,000.00 is spent and USD 450.00 is waiting for approval. The Bengaluru Diwali celebration on 14 Nov has USD 1,200.00 left of its USD 9,000.00 cap."
- Figures table (rendered by BudgetFlow, not by the model): Authorized, Pending, Committed, Actual, Available under this budget's rules, each with `bf-money` and the as-of time "Ledger figures as of 10:42 IST".
- Sources (3): Budget Bengaluru Events (021), Event EVT-2026-0112 (046), 2 pending requests (055 filtered); each a link.
- Footer: "AI-generated. Check the figures before you act.", Helpful, Not helpful (optional reason), Copy, Report a problem.
- Follow-up chips: "Show the pending requests", "Compare with last quarter".

Action requests: "Approve REQ-2026-0418" gets "I can't approve requests. Open the request to decide." with "Open REQ-2026-0418" (060). "Move USD 500 from Bengaluru Events to Hyderabad Events" gets "I can't move money. You can start a transfer and check it before you submit." with "Start a transfer" (025, prefilled with both budgets and the amount; the person reviews and submits through the normal checks).

Conversation history (menu): the asker's own conversations of the last 30 days, newest first, with Delete.

Shared AI output pattern (every AI surface uses these rules):

1. Label: a neutral `sat-tag` "AI" with the `auto_awesome` icon and the words "AI answer" or "AI suggestion".
2. Sources: count and expandable list of the records used, each a link; only records the viewer may read.
3. Why: one or two plain sentences with the key facts behind the output.
4. Confidence in words (High, Medium, Low), never a bare score.
5. Actions: Use or Accept opens the normal command (dialog or form) prefilled; nothing is saved from the AI output directly. Edit, Dismiss (optional reason), Helpful or Not helpful.
6. Unavailable: "AI suggestions are unavailable right now. Everything else works as usual." The underlying task never waits for AI.
7. Turned off (113a): the AI element is not rendered at all; no empty placeholders.
8. Audit: when a suggestion leads to a saved change, that change's audit entry records the suggestion id, model id and model version. Showing, dismissing and rating suggestions are logged in the AI query log (113a), not the audit log.

## Data and permissions

New P13 `ai.ts` contract and `libs/api/ai` (`AiProvider`, offline recorded provider in functional runs and CI, Amazon Bedrock in the product): `POST /api/ai/ask` with question, optional context (resource type and id) and conversation id; response with answer text, structured figures, source references, refusal kind (out of scope, action, unreliable), suggestion id, model id and version. Facts are collected only through read services that call `PolicyService.can` for the asker (`budget.read`, `ledger.read`, `report.read`, request and event reads); tenant RLS applies underneath. The model receives the minimum facts (budget and event names, amounts, dates, statuses); people's names only when the question needs them; never emails or secrets. Figures shown come from the structured response; an answer whose text contains a number not present in the retrieved facts is discarded. Model output is parsed against a zod schema; anything invalid is discarded. Every call writes an `ai_query_log` row (actor, feature `ask`, channel, fact ids, model, latency, outcome) with no question text. Conversations are stored per person for 30 days, readable only by that person.

## States

| State            | Behaviour                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Default          | intro, context chip, suggested questions                                                                                                   |
| Preparing        | "Looking at your budgets..." with `sat-ghost` lines and Stop                                                                               |
| Answer           | answer card as above                                                                                                                       |
| Action redirect  | "I can't approve requests" or "I can't move money" with a link to the screen, prefilled where the screen supports it                       |
| Out of scope     | "I can only answer about budgets you can see. I found nothing you have access to called 'Europe Region'." (no confirmation that it exists) |
| No data          | "I couldn't find team lunch spending in Q3 in the budgets you can see." with a link to 080 budget versus actual                            |
| Unreliable       | "I couldn't produce a reliable answer. Try asking about one budget or one period." (answer discarded by the figure check)                  |
| Unavailable      | info banner from the shared pattern; question box disabled with the reason                                                                 |
| Rate limited     | "You've asked 50 questions in the last hour. You can ask again at 11:30."                                                                  |
| Turned off       | header button hidden; deep links to `/ask` show "Ask BudgetFlow is turned off for Hyland"                                                  |
| Report a problem | dialog: what was wrong (Wrong figure, Missing data, Not my scope, Other), note, "Include my question and the answer" (on)                  |
| Error            | inline error card with Retry                                                                                                               |

## Budget safety and audit

A single budget is always described with "Available under this budget's rules"; the company-wide Available appears only for roles that see the executive dashboard (011) and is named as such, with the same tooltip. Pending, committed and actual are named separately, and FX effects are never described as spend. Asking writes no audit entry (it changes nothing) but always a query-log row; a prefilled form submitted after an answer is audited by that form with the suggestion id.

## Responsive and accessibility

Desktop: side panel next to the content (content reflows, nothing is covered). Tablet (834): panel overlays the content. Mobile (412): full page `/m/ask` from the avatar menu and from 59b. The answer is announced once when complete (not word by word); the question box keeps focus after sending; sources are a list of links with the record type in the accessible name; Ctrl J and Esc are listed in Help and shortcuts.

## Satori components

`satTonalIconButton` (header trigger), `sat-tag` (AI label), `satInlineChip` (suggested questions, context chip, follow-ups), `sat-banner`, `sat-rich-tooltip` (Available definitions), `sat-ghost`, `sat-empty-state`; Angular Material side sheet, form field (textarea), menu, dialog (report a problem), snackbar. Custom `bf-ai-answer` and `bf-ai-sources` in `libs/web/ui` (no Satori equivalent), built on `--mat-sys-*` tokens; `bf-money`.

## Related screens and navigation

061f Ask BudgetFlow in Slack and Teams, 113a AI settings and query log, 069a policy assistant, 16b spending outlook, 021 budget details, 046 event details, 060 request details, 025 transfer, 079 reports, 59b mobile balance, 000a shell.

## Decisions taken

- Figures in answers come from BudgetFlow's own calculations and are rendered as data; answers whose text contains a number not found in the retrieved facts are discarded. Recommended so a wrong number never appears under an AI label.
- The assistant never acts. For action requests it links to the right screen, prefilled where possible, and the person submits through the normal policy, delegation-of-authority and audit path.
- Out-of-scope questions get one neutral refusal that neither confirms nor denies that the record exists.
- Conversation history is private to the asker and kept 30 days; the AI query log keeps metadata only, without question text. "Report a problem" shares the text only with the asker's consent.
- One panel on every screen (plus a mobile page) instead of a separate AI section in the navigation, so questions start from the record people are looking at.
- A per-person limit of 50 questions an hour (setting in 113a) protects cost and the model provider without affecting normal use.
