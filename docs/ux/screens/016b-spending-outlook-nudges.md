# 016b Under/overspend forecasts and nudges (spending outlook)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 13 batch. Build phase P13. Insights > Spending outlook (`/insights/outlook`); outlook card on 021 budget details and on owner homes; nudges delivered as notifications and in digests.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the chart language of 016 and the AI output pattern of 11a. Planned Stitch states, to be generated in a later session:

| State                               | Planned image                                                            |
| ----------------------------------- | ------------------------------------------------------------------------ |
| outlook list (finance, all budgets) | `design/stitch/016b-spending-outlook-nudges/default--desktop--light.png` |
| budget outlook with range chart     | `budget-outlook--desktop--light.png`                                     |
| nudge card on budget details (021)  | `nudge-card--desktop--light.png`                                         |
| not enough history                  | `no-history--desktop--light.png`                                         |
| mobile                              | `default--mobile--light.png`                                             |

## Purpose

Warn owners early when a budget is heading for an overrun or for money left unused at year end, using run rate, commitments, the request pipeline and last year's seasonality (Diwali, Thanksgiving, year-end), and suggest a concrete next step they can take themselves, so overruns and use-it-or-lose-it spending in Q4 are avoided.

## Roles

Budget owners (BO, DH, RM, LM) for budgets they own or co-own and their subtrees; Finance Admin, Finance Controller, CEO and Read-only Analyst company-wide (read; analysts cannot act on nudges). Employees and organizers do not see outlooks.

## Entry points

Insights > Spending outlook; outlook card on 021; nudge notifications (in-app, email, Slack or Teams per 59c); the owner and finance weekly digests (64a); 016 forecast dashboard "Compare with AI outlook"; 087a forecast cycle "Use AI outlook as a starting point"; 017 alerts "Forecast to lapse".

## Content and actions

Header bar: title, FY2026, as-of time, Export (CSV, XLSX, PDF). Filter chips: outlook (Likely overspend, Likely unused, On track), region, budget type, "Only budgets I own".

Summary cards: likely overspend 3 budgets, USD 4,900.00 in total; likely unused 6 budgets, USD 13,600.00; on track 41; not enough history 4.

Outlook table (one row per budget): budget, owner, authorized, actual plus committed to date, year-end outlook (most likely and range), gap to authorized, confidence, main driver, nudge status. Samples (AI tag on the outlook column header):

- India Wellbeing (Meera Iyer): authorized USD 12,000.00; to date USD 5,900.00; outlook USD 7,800.00 (range 7,100-8,400); likely unused USD 4,200.00; High; "Spending has been flat at USD 650.00 a month since June; nothing booked for Nov-Dec." Nudge sent 3 Nov.
- Westlake Team Activities (Jordan Lee): authorized USD 15,000.00; to date USD 12,400.00; outlook USD 16,800.00 (range 15,900-17,600); likely overspend USD 1,800.00; Medium; "Thanksgiving and year-end events cost USD 4,400.00 last year; USD 2,600.00 is left." Nudge sent 4 Nov.
- Bengaluru Events (Anand Kumar): authorized USD 10,000.00; to date USD 8,050.00; outlook USD 9,650.00 (range 9,200-10,100); on track; Medium; "Diwali celebration already committed."

Budget outlook (row click, side sheet or full view from 021):

- Chart: cumulative actual (solid), committed (solid, lighter), pipeline of pending requests (hatched), outlook range to 31 Dec (dashed band), authorized line; "View as table".
- Why: drivers as sentences with the facts used (monthly run rate, seasonal months from last year, open commitments, pending requests, planned events).
- Sources: the budget, last year's budget of the same program, events and requests used.
- Nudge (when shown): for likely unused, "About USD 4,200.00 of India Wellbeing may go unused. Plan an activity before 15 Dec, or release money to India Region so another team can use it." Actions: "Plan an event" (045 prefilled with the budget), "Release to India Region" (026 reduce, prefilled with destination parent and the amount; the owner chooses the amount and reason and confirms), "Snooze 14 days", "Not useful" (reason). For likely overspend: "Westlake Team Activities may exceed its budget by about USD 1,800.00." Actions: "Request an increase" (029 prefilled), "Review phasing" (032a), "Review open commitments" (085a), Snooze, Not useful.
- "Use as my forecast" (only during an open forecast cycle, 87a): copies the most likely value into the owner's forecast draft with method "Owner input" and the note "Started from AI outlook"; the owner edits and submits.

## Data and permissions

Outlooks are computed nightly by `libs/api/ai` from ledger history (monthly actual and committed movements), open commitments, pending requests, planned events and the same program's prior year, using a statistical model for the range; the language model only writes the driver sentences from those numbers. Results are stored as AI outlook snapshots in the new P13 `ai.ts` contract (budget, as-of, most likely, low, high, confidence, drivers, source ids, model id and version), not as a forecast method in 87a. Reads use `budget.read` and `report.read` scope. Nudges are raised when the outlook is High or Medium confidence and the gap is at least USD 500.00 and at least 10% of authorized (settings in 113a), at most once per budget every 14 days, and only to the owner and co-owners. Every outlook computation and nudge writes an `ai_query_log` row.

## States

| State              | Behaviour                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Default            | list as above                                                                                                   |
| Budget outlook     | chart, drivers, sources, nudge                                                                                  |
| Nudge card (021)   | warning-tone card for likely overspend, info-tone card for likely unused, with the actions above                |
| Snoozed            | neutral tag "Snoozed until 18 Nov" in the list; no new nudge until then                                         |
| Acted on           | success tag "Event planned" or "Released USD 2,000.00" when the linked action completed; the outlook recomputes |
| Not enough history | "An outlook needs at least 3 months of spending. Check back in January." (no figures shown)                     |
| Frozen or zero     | frozen or set-to-zero budgets show no nudge; the row says "Frozen: no outlook actions"                          |
| AI off             | page and cards hidden; 016 and 087 forecasts unchanged                                                          |
| Unavailable        | shared AI banner; last night's outlook shown with its as-of date if available                                   |
| Loading / error    | `sat-ghost`; error banner with Retry                                                                            |

## Budget safety and audit

The outlook range is drawn dashed and labelled as AI, never mixed with actual or committed; pending requests stay hatched. Nudge actions only open prefilled forms; reductions, increases and events go through their own checks (floor, destination, reason code, delegation of authority) and audit entries, which record the suggestion id, model id and version. Nothing is reduced or released automatically.

## Responsive and accessibility

Mobile: summary cards in a scroller, the table as cards, the chart replaced by its table. Ranges are written as text ("between USD 7,100.00 and USD 8,400.00"); outlook categories carry icon and words, not colour alone.

## Satori components

`sat-header-bar`, `sat-interactive-card` (summary and nudge cards), `satInteractiveTag` (filters), `mat-table` with `satTableWithRowStates`, `sat-status-tag` (outlook, nudge status), `sat-tag` (AI), `sat-banner`, `sat-rich-tooltip` (range explanation), `sat-empty-state`, `sat-ghost`; line chart with band from `libs/web/ui/charts`; Angular Material side sheet, menu, snackbar; `bf-ai-sources`, `bf-money`.

## Related screens and navigation

016 forecast and variance view, 087 forecast report, 087a forecast cycle, 017 alerts, 021 budget details, 026 reduce, 029 revise (increase), 032a phasing, 045 create event, 085a commitment hygiene, 086 unused report, 086a reclaim, 064a digests, 059c notification channels, 011a assistant, 113a AI settings.

## Decisions taken

- The AI outlook is a separate, labelled view and never replaces the owner's forecast in the forecast cycle; owners can start their forecast from it. Recommended so official forecasts stay owned by people.
- Nudges go only to owners and co-owners, only above USD 500.00 and 10% of authorized, at most once every 14 days per budget.
- Nudges suggest actions the owner takes: plan an event, release money to the parent, request an increase or review phasing. Nothing is released or reduced automatically.
- The numbers come from a statistical model; the language model only explains them, so the same data always gives the same range.
- No outlook is shown with less than 3 months of history, rather than a guess.
