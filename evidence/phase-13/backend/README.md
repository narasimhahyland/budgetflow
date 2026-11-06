# Phase 13 — the AI layer, backend half

AI suggests; people decide. Everything in this change answers, explains or proposes. Nothing in it
posts to the ledger, approves a request, moves budget or changes a control, and no endpoint applies a
suggestion on a person's behalf.

Local stack: `COMPOSE_PROJECT_NAME=bf-p13-ai`, API on 3180, Postgres on 5612, `AI_PROVIDER=fake`.
Deterministic seed, reset before each recorded run.

## What is here

| File                          | What it shows                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `functional/ai-scenarios.txt` | The 31 Phase 13 API scenarios, from a reset database                                                                                               |
| `functional/full-suite.txt`   | The whole API scenario suite (444 scenarios) with Phase 13 merged in                                                                               |
| `functional/accuracy.txt`     | Each feature's evaluation result against its published threshold, with the labelled false positives                                                |
| `api/ai-endpoints.txt`        | Scrubbed request and response samples: in-scope answer, out-of-scope refusal, action refusal, a matching suggestion with the body a person submits |
| `api/query-log.txt`           | What an auditor sees: scope applied, records used, field names sent, model, outcome; no question text                                              |
| `db/rls-and-append-only.txt`  | Forced RLS and `tenant_isolation` on all six new tables; the append-only triggers and grants on `ai_query_log`                                     |
| `negative-controls.md`        | The figure guard and the scoped retrieval disabled on purpose, and the scenarios failing as a result                                               |
| `gate-summary.txt`            | `scripts/gate.sh` output                                                                                                                           |

## Outcomes proved

| Outcome                                                                                        | Where                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| An owner's answer carries only figures copied from the budget read models                      | `ai/scoped-retrieval.spec.ts`, `api/ai-endpoints.txt`         |
| A scoped owner cannot surface another subtree's figures, by question or by context chip        | `ai/scoped-retrieval.spec.ts`                                 |
| Another tenant never appears in an answer or in a query-log row                                | `ai/scoped-retrieval.spec.ts`                                 |
| An invented figure or an invalid shape is discarded and still recorded                         | `ai/guardrails.spec.ts`, `negative-controls.md`               |
| Asking the assistant to approve or move money is refused; the request and budget are unchanged | `ai/guardrails.spec.ts`                                       |
| A matching suggestion matches nothing by itself                                                | `ai/suggestion-decisions.spec.ts`                             |
| Applying a suggestion without `actuals.manage` is refused, and the line stays unmatched        | `ai/suggestion-decisions.spec.ts`                             |
| An acceptance is only recorded after the normal match command ran, with one audit entry        | `ai/suggestion-decisions.spec.ts`, `api/query-log.txt`        |
| A suggested split totals its amount exactly, stays within the parent and saves nothing         | `ai/suggestions-are-drafts.spec.ts`                           |
| The outlook reports a range from ledger figures and changes no balance, status or control      | `ai/suggestions-are-drafts.spec.ts`                           |
| Anomaly flags cite records, carry evidence and decide nothing; requesters cannot read them     | `ai/suggestions-are-drafts.spec.ts`                           |
| Extraction prefills without saving, drops card details and leaves unsure fields empty          | `ai/suggestions-are-drafts.spec.ts`                           |
| Every feature meets its published accuracy threshold against the fake provider                 | `ai/settings-and-accuracy.spec.ts`, `functional/accuracy.txt` |
| A finance-affecting feature stays off until a Finance Admin confirms it                        | `ai/settings-and-accuracy.spec.ts`                            |
| A feature switched off is refused on the next request                                          | `ai/guardrails.spec.ts`                                       |
| The AI query log is append-only in the database and unreadable by an employee                  | `ai/guardrails.spec.ts`, `db/rls-and-append-only.txt`         |

## Known limits

- The outlook and the anomaly scan are endpoints (`POST /api/ai/outlook/run`,
  `POST /api/ai/anomaly-flags/scan`); the nightly worker jobs that call them are not built.
- `receipt_reused` and `unusual_vendor` are in the contract for the UI but the scan does not raise
  them yet: they need document image hashes and vendor categories.
- The actuals match audit entry does not yet carry the suggestion id; that needs a Phase 6 change to
  `QueueService.match`. Until then the link lives on the AI query-log row, which names the applied
  record and the audit entry that command wrote.
- Reported answers (113a sub-tab, text kept 90 days with the asker's consent) are not built.
