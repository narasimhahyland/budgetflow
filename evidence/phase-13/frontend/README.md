# Phase 13 frontend — the AI layer

Nine screens built against the merged `/api/ai` endpoints on the local stack with the deterministic
seed and the fake provider. Branch `feat/p13-ai-ui`, base `88c18f4`.

Stack for every run in this pack: compose project `bf-p13-ui`, web 4410, API 3210, Keycloak 8290,
Postgres 5642, Mailpit 8235, MinIO 9210.

## How the UI tells model text from BudgetFlow figures

One pattern, used by all nine screens (`libs/web/features/ai/src/lib/ai-output.ts`):

| Piece              | What it carries                                                                     |
| ------------------ | ----------------------------------------------------------------------------------- |
| `bf-ai-label`      | "AI answer", "AI suggestion", "AI flag" with the Satori `ai` icon                   |
| `bf-ai-prose`      | Model sentences only, in an info-tone block, with "Written by the model" underneath |
| `bf-ai-figures`    | `AskAnswer.figures` and read-model amounts, each row naming the record it came from |
| `bf-ai-sources`    | The records the output used, each a link, only ones the viewer may read             |
| `bf-ai-why`        | The key facts behind the output, plus confidence as a word                          |
| `bf-ai-provenance` | Model id and version, provider, query-log id and suggestion id                      |
| `bf-ai-refusal`    | One honest state per refusal kind, with `AiRefusal.redirect` as a link              |
| `bf-ai-disabled`   | The `409 AI_FEATURE_DISABLED` state, with what still works without the feature      |

No component parses a number out of model text. Projections on 016b are drawn apart from ledger
figures, under the column heading "Year-end outlook (AI)" and the words "not spent money".

## Outcome table

| Scenario                                                            | Expected                                                                       | Actual                                                              | Result |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------ |
| 011a, Rahul Menon (location manager) asks about a budget he owns    | answer under an AI label; figures equal the budget read model                  | `authorized` USD 12,000.00 and `available` USD 3,081.71 both match  | PASS   |
| 011a, same user asks about Europe Region                            | `refused_out_of_scope`, no answer, no figures, record not confirmed to exist   | "I can only answer about records you can see" and nothing else      | PASS   |
| 011a, same user asks to approve REQ-00001                           | `refused_action` plus a link to the screen where a person decides              | "BudgetFlow AI does not act." with "Open requests to decide"        | PASS   |
| 011a conversation history                                           | private to the asker, deletable                                                | created and deleted from the panel                                  | PASS   |
| 061f, chat channel while `ai.ask_chat` is off                       | the disabled-feature state, not empty data                                     | `409 AI_FEATURE_DISABLED` rendered as its own state                 | PASS   |
| 016b, finance admin recomputes the outlook                          | ledger figures and the AI range shown apart; nudge only suggests               | "not spent money" on the range; nudge says nothing is released here | PASS   |
| 017c, finance controller scans                                      | advisory flag with record-derived evidence; clearing needs a reason            | "Does not block approval"; clear blocked until a note is typed      | PASS   |
| 022d, regional manager edits a suggested split and submits          | posts through the normal batch allocation command, then records the acceptance | query log: `appliedResourceType: budget`, India Region              | PASS   |
| 080f, finance controller accepts the Hack Week travel suggestion    | the match command refuses it; no acceptance is recorded                        | `MATCH_OVER_TOLERANCE` shown; accepted list still empty             | PASS   |
| 080f, same user accepts the Northside Print suggestion              | matched by the normal command, then decision recorded with its audit entry     | actual `matched`; query log holds the audit event id                | PASS   |
| 080f, acceptance recorded without applying it (API the screen uses) | refused                                                                        | `409 AI_SUGGESTION_NOT_APPLIED`                                     | PASS   |
| 113a, org admin turns on a feature                                  | the exact fields it would send are shown first                                 | `availableMinor`, `authorizedMinor`, … listed in the dialog         | PASS   |
| 113a, org admin turns on a finance feature                          | stays pending until a Finance Admin confirms; API still refuses                | "Waiting for Finance Admin confirmation"; run returns 409           | PASS   |
| 113a, Finance Admin confirms                                        | feature comes on; the same call then succeeds                                  | run returns 200 after confirmation                                  | PASS   |
| 113a, limits validation                                             | plain English, save disabled                                                   | "History must be 7 to 90 days."                                     | PASS   |
| 113a, auditor reads the query log                                   | scope and records shown, no question text                                      | `budget.read`, "Refused – out of scope"; no question text in table  | PASS   |
| 113a, employee opens the query log                                  | forbidden in place, URL kept                                                   | `sat-403-error-state`, URL still `/admin/ai/log`                    | PASS   |
| 069a, employee asks a policy question no rule covers                | the rules engine's outcome leads; nothing restated under an AI label           | "No policy covers this"; assistant adds nothing                     | PASS   |
| 069a, employee asks about someone else's request                    | refused                                                                        | "I can only explain your own requests…"                             | PASS   |
| 121a, finance admin reads a verified receipt and confirms           | fields prefilled, confirmation required, only confirmed values recorded        | confirm blocked until checked; confirmed values listed back         | PASS   |
| 121a, receipt with a field the model could not read                 | left empty and marked, never guessed                                           | "Please check: we could not read this clearly"                      | PASS   |

Commands and full output: `functional/journeys.txt` (32 journeys, 0 failures). The whole journey
suite was then run the way CI runs it (`--project=desktop --project=tablet --project=mobile`): 377
passed, 128 skipped, 0 failures. Scrubbed API responses behind the states above:
`api/ai-states.json`.

Two cross-journey hazards CI found that a scoped local run could not, both now fixed:

- The matching journey accepted the seeded `ERP-2611-0009` line, which carries the `NYC-OFFSITE-26`
  event code the event reconciliation journeys need unmatched. It now imports a spend line of its
  own with a unique merchant and matches that.
- AI feature switches are tenant-wide, so the 113a switch journey and the 061f disabled-state journey
  decided each other's starting state. Every switch-sensitive test now runs in one serial group that
  restores the seeded switches, and each dependent journey asserts the switch it needs beforehand.

## Gates

`gate-summary.txt` — `scripts/gate.sh static --affected`: secrets, lint, styles, satori, typecheck,
build, openapi and db all pass.

Journeys: `npx playwright test --project=desktop apps/web-e2e/src/ai` — 32 passed, twice in a row on
a freshly seeded stack.

Visual: 72 new baselines (9 screens × 2–4 states × 3 viewports) generated in the pinned Playwright
image and compared again on a reseeded stack with no differences. Every desktop shot and the mobile
and tablet variants of the ask panel and the outlook list were opened and read.

## What the baselines mask, and why

- `[data-testid=ai-ids]` — query-log, suggestion and applied-record ids are generated per call.
- `[data-testid=ai-projection]` (016b) — the outlook range, gap, drivers and summary counts are
  computed from run rate over months observed, so they move with the real clock, not with the seed.
  Masking them keeps the rest of the screen under comparison instead of a baseline that breaks at
  the next month boundary.
- `[data-testid=ai-live-count]` (080f) — the two rolling 30-day counters.
- `[data-testid=log-rows]` (113a query log) — which calls the log holds depends on what the other AI
  captures logged moments earlier. The log's content is asserted in the journey instead.
- `[data-testid=conversation-list]` (011a) — every capture that asks a question adds a conversation.
  Masking the content was not enough: the list's height moved the card beside it, which CI caught as
  a diff the local run could not. The history panel now has a fixed height and scrolls, and the
  baselines were verified against a stack carrying twelve extra conversations.

## Bugs the visual pass found and fixed

- The conversation row's Delete button sat outside its card. Cause: the shared `.bf-list__item` in
  `libs/web/ui/src/styles/page-layout.scss` is `width: 100%` in a `content-box`, so its 20px side
  padding pushes it 40px past the card. Measured live (478px item in a 440px card), fixed with
  `box-sizing: border-box` scoped to the two AI screens that use the class. **The shared rule still
  has the bug and affects every screen using `bf-list__item`.**
- The policy assistant repeated the rules engine's own sentence back under an AI label; it now says
  there is nothing to add.
- The prose block promised "amounts in the figures below" on screens with no figures table.
- A receipt total was shown as minor units (`124000`) in an input a person is asked to check.
- Anomaly kinds and suggestion statuses were shown as raw keys (`possible_duplicate`, `stale`).
- The feature toggle flipped to On while its confirmation dialog was still open.

## Not built, and why

- **Nav entries.** Adding items to `libs/web/shell/src/lib/nav.ts` changes the navigation rail, which
  invalidates every tablet baseline in the repository and all four `000a-app-shell nav-drawer-open`
  shots (verified: 8 failures with an identical pixel count on re-run, so a real change, not flake).
  The change was reverted; the proposed entries are listed in the pull request for the integrator.
- **Reported answers** (113a sub-tab, "answers people reported with the question and answer kept 90
  days"). No endpoint exists in `ai.ts`; the "Report a problem" dialog of 011a needs it too.
- **Query-log filters for channel, person and date** (113a). `listAiQueryLog` takes feature, outcome,
  suggestionId, cursor and limit only. Feature and outcome are built.
- **Helpful / not helpful on an ask answer** (011a footer). `AskAnswer.provenance.suggestionId` is
  always null for `ask`, and `rateAiSuggestion` needs a suggestion id, so the control only renders
  where a suggestion exists (outlook, matching, allocation, extraction).
- **Snooze on a nudge** (016b). `BudgetOutlook.nudge.snoozedUntil` is rendered, but no endpoint sets
  it; "Not useful" is wired to the decision endpoint.
- **In-place panels on host screens.** 011a is a full page at `/ask` rather than a side panel on
  every screen, and 022d, 069a and 121a are their own routes rather than panels inside 022, 117 and
  121, because those host screens belong to other feature libs.

## Backend findings for the Phase 13 API

1. `GET /api/ai/conversations` returns `turnCount: 0` for a conversation that has turns, so the panel
   shows "0 questions" next to a real conversation (`api/ai-states.json` shows a turn was written).
2. `AiMatchSuggestion.budgetAmount` carries the transaction currency (INR 47,500.00) rather than the
   budget amount at the locked plan rate, so the column reading "Budget amount (plan rate)" repeats
   the transaction amount.
3. `AiMatchSuggestionList.shownLast30Days` is 0 on a freshly seeded stack immediately after a run
   that produced two suggestions.
4. `AnomalyFlag.budgetName` is null while `budgetId` is set, so the queue's Budget column is empty.
5. The top-ranked matching suggestion for the seeded Hack Week travel line is a commitment the match
   command then refuses (`MATCH_OVER_TOLERANCE`). Good for proving the guardrail, and worth checking
   against the High-confidence precision threshold.
