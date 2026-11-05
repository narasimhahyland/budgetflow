# 017c Anomaly flags (split, duplicate, unusual cost per head)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 13 batch. Build phase P13. Finance > Anomaly flags (`/finance/anomalies`); flags also appear on the approval card (059 detail pane, 060, 061, 059a) for the deciding approver.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the queue and drawer of 080b and the AI output pattern of 11a. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                  |
| ------------------------------- | -------------------------------------------------------------- |
| flags queue                     | `design/stitch/017c-anomaly-flags/default--desktop--light.png` |
| flag detail drawer              | `detail--desktop--light.png`                                   |
| flag on the approval card (060) | `approval-card-flag--desktop--light.png`                       |
| "Not an issue" dialog           | `dismiss-dialog--desktop--light.png`                           |
| empty queue                     | `empty--desktop--light.png`                                    |

## Purpose

Point finance and approvers to requests and receipts that look unusual before money is committed: possible split requests, possible duplicates and reused receipts, cost per head far above similar events, and vendors that do not fit the category, with the evidence side by side, so a person can check quickly and either clear the flag or follow it up.

## Roles

Finance Controller and Finance Admin (work flags); Auditor (read all, including cleared flags); the approver deciding a flagged request sees the flag on the approval card; requesters do not see AI flags about their own requests (they see a reviewer's question if one is asked).

## Entry points

Finance > Anomaly flags; 017a exceptions dashboard tile "AI anomaly flags"; 012 finance controller dashboard; flag line on approval cards; 074a post-spend exceptions "Related AI flag"; weekly finance digest (64a).

## Content and actions

Header bar: title, Export (CSV, XLSX, PDF). Tabs: Open (9), Cleared, Followed up. Filter chips: kind (Possible split, Possible duplicate, Receipt reused, Unusual cost per head, Unusual vendor), confidence, stage (Before approval, After approval), region.

Queue (one row per flag): raised, kind, confidence, request or receipt, requester, budget, amount (USD; transaction currency below), stage, status. Samples:

- High, Possible split: REQ-2026-0449 USD 2,400.00 and REQ-2026-0452 USD 2,300.00, Rahul Verma, Bengaluru Events, same vendor Spice Route Caterers, 2 days apart; together USD 4,700.00, above his USD 2,500.00 commitment limit. Before approval.
- High, Receipt reused: the same receipt image on REQ-2026-0398 (Sep) and REQ-2026-0440 (Oct), 97% image similarity, amounts entered USD 64.00 and USD 71.00. After approval.
- Medium, Unusual cost per head: REQ-2026-0461 Team dinner, Bengaluru Events, USD 960.00 for 20 people = USD 48.00 per head; median of 12 Bengaluru team dinners in FY2026 is USD 18.50. Before approval.
- Low, Unusual vendor: "Electronics retailer" charged to London Wellbeing, GBP 300.00 (USD 381.00 at the FY2026 plan rate). After approval.

Detail drawer: what was found (plain sentence), the evidence side by side (both requests, both receipts with thumbnails, the cost-per-head comparison with the peer group and its size), Sources (records used), Why and confidence (shared pattern), timeline (raised, viewed, actions), and actions:

- "Not an issue" (reason code and note required; the flag closes as Cleared).
- "Ask the requester" (posts a comment on the request through 60a, visible to the requester: "Please explain why these two catering requests are separate."; the flag stays open).
- "Raise exception" (after approval: opens 074a with the flag attached; before approval: adds a "Finance review requested" note to the approval card and notifies the approver).
- Bulk: none; every flag is reviewed on its own.

Approval card line (deciding approver only): warning-tone line "AI flag: cost per head USD 48.00 is 2.6 times similar Bengaluru team dinners (median USD 18.50). This does not block approval." with "See details" (drawer, read-only for approvers) and the usual Approve, Approve part, Reject and Request changes.

## Data and permissions

Detection runs on request submission, receipt verification (121, 121a) and nightly; it combines deterministic features (amounts, dates, vendor, requester, image hashes, peer-group statistics of cost per head by city and category) with a model score. Flags are written to `integrity_flags` with the details (features, peer group, source ids, model id and version) and statuses open, acknowledged (followed up) and resolved (cleared); P13 adds the kinds `unusual_cost_per_head` and `unusual_vendor` and records the source (rule or AI) in the details (integrator adds). Split and duplicate patterns already caught by the Phase 7 rules (074a) are not raised twice. `integrity.read` to view (FA, FC, AUD); `actuals.manage` or the Phase 7 exception action to work flags; approvers read the flag on a task assigned to them. Kinds whose measured precision falls below their threshold (113a Accuracy) stop raising new flags until re-evaluated.

## States

| State               | Behaviour                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Queue               | as above                                                                                                         |
| Detail              | drawer as above                                                                                                  |
| Not an issue dialog | reason code (Legitimate business reason, Data error, Known pattern, Other) and note required                     |
| Asked requester     | info tag "Waiting for Rahul Verma" with the comment; reply shows in the timeline                                 |
| Followed up         | flag moved to Followed up with a link to the exception (074a) or the approval note                               |
| Already decided     | the request was approved or rejected meanwhile: banner with the decision; actions limited to After approval ones |
| Paused kind         | info banner "Unusual vendor flags are paused: precision 0.62 is below the 0.80 threshold (113a)"                 |
| Empty               | success empty state "No open anomaly flags"                                                                      |
| AI off              | page shows only flags raised before the switch, read-only; approval cards show no AI line                        |
| Loading / error     | `sat-ghost`; error banner with Retry                                                                             |

## Budget safety and audit

AI flags never block, hold, approve or reject anything; approval decisions and exceptions follow their own rules and delegation-of-authority limits. Clearing and following up are audited with the flag id, reason code, model id and version; raising a flag is audited as a system entry ("BudgetFlow AI"). Cleared flags remain visible to auditors.

## Responsive and accessibility

Desktop and tablet; mobile read-only list. Evidence comparisons are two-column tables with row headers; image similarity is stated in text; confidence and kind are words with icons.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `satInteractiveTag` (filters), `mat-table` with `satTableWithRowStates`, `sat-status-tag` (kind, confidence, status), `sat-tag` (AI), `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material side sheet (detail), dialog (not an issue), snackbar; `bf-ai-sources`, `bf-money`.

## Related screens and navigation

017a exceptions dashboard, 074a post-spend exceptions, 099a cross-source duplicates, 17b red-flag analytics (P15), 059 inbox, 060 request details, 061 decision, 060a comments, 121 and 121a receipts, 088 audit log, 113a AI settings.

## Decisions taken

- AI flags are advisory: they never block or hold a request; the approver sees the flag and decides. Recommended because a model score is not evidence of wrongdoing.
- Requesters do not see AI flags about themselves; they see a reviewer's question if one is asked through comments.
- Clearing a flag needs a reason code and a note, which also feed the evaluation set.
- Flags are reviewed one by one; there is no bulk clear.
- A flag kind is paused automatically when its measured precision falls below its threshold, instead of flooding reviewers.
