# 080f Transaction matching review (AI)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 13 batch. Build phase P13. Finance > Actuals and matching > AI suggestions (`/finance/actuals/suggestions`); suggestion chips also appear in the 080b match drawer.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the queue and match drawer of 080b and the AI output pattern of 11a. Planned Stitch states, to be generated in a later session:

| State                                  | Planned image                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| suggestions queue                      | `design/stitch/080f-transaction-matching-review/default--desktop--light.png` |
| suggestion detail with evidence        | `detail--desktop--light.png`                                                 |
| bulk accept High suggestions (confirm) | `bulk-accept--desktop--light.png`                                            |
| empty                                  | `empty--desktop--light.png`                                                  |

## Purpose

Match the spend lines that reference, event-code and mapping-rule matching could not place, by suggesting the most likely request, commitment, event or budget from merchant, memo, date, card holder, attendees and amount, so finance confirms in seconds instead of searching, and the share of actuals matched (a product KPI) rises without any line being matched by a model alone.

## Roles

Finance Admin and Finance Controller (all lines); budget owners for suggestions that point to their budgets, when they hold the 080b match permission on that budget; Auditor (read, including rejected suggestions).

## Entry points

Finance > Actuals and matching tab "AI suggestions (24)"; 080a import summary "24 lines have AI suggestions"; 080b drawer suggestion chip "AI suggests EVT-2026-0136"; 012 finance controller dashboard; owner notification "3 card lines may belong to your budgets".

## Content and actions

Header: title, metrics strip "Last 30 days: 312 suggestions reviewed, 296 accepted (94.9%); High suggestions accepted 99.1%", Export (CSV, XLSX, PDF). Filter chips: confidence, source (card, expense, travel, AP), legal entity, target type (request, commitment, event, budget), age.

Queue (one row per line): date, source, merchant and memo, card holder or claimant, amount in transaction currency and USD at the locked plan rate, suggested target, confidence, reasons (short), actions Accept, Choose another, Reject. Samples:

- High: Concur expense INR 4,560.00 (USD 54.61) "Cafe Mocha Indiranagar", 18 Oct, Kavya Shah -> REQ-2026-0145 Team lunch Q4 (approved USD 57.49). Reasons: "Same person; receipt date within the request window; amount within approved; receipt attached matches."
- Medium: Ramp card GBP 412.00 (USD 523.24) "THE BRASS LANTERN LONDON", 6 Nov, Emma Clarke -> commitment PO-2026-0263, London team social (EVT-2026-0136). Reasons: "Event on 6 Nov; card holder is a co-organizer; restaurant merchant; 2 other candidates within 10% of the amount."
- Low: Navan hotel USD 1,240.00 "Hotel Westlake", 3 Nov, Tom Reilly -> budget Westlake Team Activities (no event). Reasons: "Cost center CC-3100 maps to Westlake Team Activities; no event on that date."

Detail (side sheet): the line (all source fields, receipt thumbnail), the suggested target with its encumbered and remaining amounts, the other candidates ranked with their scores in words, the facts used, Sources, AI tag. FX block as in 080b: transaction amount, budget USD at the locked plan rate, month-end value, FX effect (never consumes budget). Actions: Accept (opens the 080b match confirmation prefilled: target, amount, partial or full, difference handling), Choose another (candidate list or budget search), Reject suggestion (reason: wrong event, wrong budget, not budget-relevant, personal expense, other).

Bulk: select High suggestions only; "Accept 18 suggestions" shows a confirmation with the count, total USD 2,184.60, targets grouped by budget and the note "Each line is matched through the normal match command and can be reversed in an open period." Medium and Low suggestions cannot be bulk accepted.

## Data and permissions

After the Phase 6 matching steps (reference, event code, mapping rules 080b) leave a line unmatched, `libs/api/ai` ranks candidate targets the reviewer could match to, using structured features (merchant, memo tokens, date distance, card holder or claimant, event dates and organizers, attendees, amount difference, cost center) and a model score; the model sees merchant, memo, dates, amounts and record ids, never card numbers or personal contact details. Suggestions are stored with features, score, candidate list, model id and version (`ai.ts`). Accepting calls the same idempotent match endpoint as 080b (`actuals.manage` for finance; the 080b owner permission for owners), with ordered row locks; the match's audit entry records the suggestion id, model id and version. Cross-source duplicates held by 99a are never suggested. Every ranking writes an `ai_query_log` row. Evaluation threshold: precision of High suggestions at least 0.95 on the evaluation set (113a Accuracy).

## States

| State           | Behaviour                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Queue           | as above                                                                                                         |
| Detail          | side sheet as above                                                                                              |
| Accept confirm  | 080b match confirmation, prefilled; over-commitment warning as in 080b                                           |
| Bulk confirm    | count, total and targets; Confirm or Cancel                                                                      |
| Target changed  | "PO-2026-0263 was released since this suggestion. Choose another target." Accept disabled with that reason       |
| Closed period   | info line "Accounting date in a closed period: the match posts to the next open period (Dec 2026), flagged late" |
| Rejected        | row moves to "Rejected" with the reason; the line returns to 080b without a suggestion                           |
| Empty           | success empty state "No suggestions waiting. Unmatched lines without a suggestion are in the queue (080b)."      |
| AI off          | tab hidden; 080b works as before                                                                                 |
| Unavailable     | shared AI banner; existing suggestions stay reviewable; no new ones                                              |
| Loading / error | `sat-ghost`; error banner with Retry                                                                             |

## Budget safety and audit

Nothing is matched without a person accepting, one line at a time or in an explicitly confirmed bulk of High suggestions. An actual is matched once; partial matches release the remaining commitment as in 080b; corrections are reversals in an open period. FX effects stay separate from consumption. Accepts, bulk accepts and rejections are audited (rejections with their reason, which also feeds the evaluation set).

## Responsive and accessibility

Desktop and tablet; mobile read-only list. Reasons are full sentences in the detail; confidence is a word with an icon; bulk selection uses the standard selection bar with the count announced.

## Satori components

`sat-header-bar`, `satInteractiveTag` (filters), `mat-table` with `satTableWithRowStates` and `sat-selection-bar`, `sat-status-tag` (confidence), `sat-tag` (AI), `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material side sheet (detail), dialog (bulk confirm, reject reason), snackbar; `bf-ai-sources`, `bf-money`.

## Related screens and navigation

080a actuals import, 080b unmatched queue and mapping rules, 080c GL tie-out, 099a cross-source duplicates, 051 commitments, 085a commitment hygiene, 018b product analytics (auto-match rate), 113a AI settings, 088 audit log.

## Decisions taken

- No automatic matching by AI: every suggestion is accepted by a person through the normal match command. Recommended because a wrong match silently moves spend between budgets.
- Bulk accept is limited to High suggestions and always shows the count, total and target budgets before confirming.
- Suggestions run only after the deterministic matching steps, so references, event codes and mapping rules stay the first and explainable path.
- Owners can accept suggestions that point to their own budgets, matching who may resolve those lines in 080b.
- Rejection reasons are required, because they are the evaluation data that keeps precision above its threshold.
