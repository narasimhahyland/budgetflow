# Gap B9: AI jobs

Package B9 of [`gap-closure-plan.md`](../../docs/gap-closure-plan.md): the nightly outlook (016b)
and anomaly (017c) scans, and 113a's Reported answers tab. Built and checked on the local stack
`bf-gap-b9-ai-jobs-2ae57e` (ports 38xxx) with the deterministic seed, the pinned clock
(2026-11-16) and the offline recorded AI provider. No live model was called.

## What was built

- **Scan runs as worker jobs.**
  - `AiScanRunsService` (`libs/api/ai/src/lib/scan-runs.service.ts`) and the table `ai_scan_runs`
    (migration `0030`, RLS forced).
  - The nightly sweep (`ai.scan_nightly`, `AI_SCAN_NIGHTLY_CRON`, 03:00 UTC by default, `off` in the
    local stack) iterates tenants one at a time, each under its own tenant context and failing
    alone. It creates one run per tenant, feature and night under a partial unique index.
  - A run executes on `ai.scan.execute`, an `exclusive` pg-boss queue keyed by the run id. A sweep,
    an API request and a redelivered job therefore never execute one run twice. A finished run is
    final, so a replay is a no-op.
  - The run calls the same scan the on-demand path uses (`AiOutlookService.runInTx`,
    `AiAnomalyService.scanInTx`) as a read-only, tenant-wide worker identity. It writes outlook
    snapshots and advisory flags only.
- **Kill switch.** A feature switched off (or no provider) skips its run with `feature_off` and no
  model call.
- **Outage.** When every model call of an attempt fails, the attempt is recorded and retried with
  exponential backoff (`AI_SCAN_RETRY_DELAY_SECONDS`, 60 s in code, 2 s locally). After the last
  retry the run shows `failed` and its job sits in `integrity.dead-letter`. A failed call never wipes
  drivers stored earlier that day.
- **Screens.** 016b and 017c say which nightly scan they show (`bf-scan-run-note`), and warn when the
  newest run could not reach the model.
- **API.** `GET/POST /api/ai/scan-runs` and `GET /api/ai/scan-runs/{id}`.
  - Reading needs the feature's own read permission (outlook `tenant.read`, flags
    `integrity.read`).
  - Queuing needs `tenant.settings.manage` or `ai.confirm_finance`.
  - Queuing writes one audit entry; a no-op writes none.
  - Runs are always for today.
- **Reported answers (113a, 011a).**
  - 011a gains "Report a problem" (reason, optional note, "Include my question and the answer", on
    by default).
  - `POST /api/ai/reported-answers` accepts only the caller's own answer, once.
  - Query log gains All activity / Reported answers sub-tabs (`/admin/ai/log/reported`), with a
    status filter, counts, the AI label on the answer, and "Mark reviewed" behind a note dialog.
  - Reading follows the query log (`audit.read` or `tenant.settings.manage`); reviewing needs
    `tenant.settings.manage`, returned to the UI as `canReview`.
  - Text and the reporter's note are masked after 90 days and cleared by `ai.report_text_retention`.
  - Audit entries never hold the question, the answer or the review note.
  - Seed: two fictional reports (one new with text, one reviewed without).
- **Shared surfaces (approved or additive).**
  - `infra/compose.yaml`: worker `AI_SCAN_NIGHTLY_CRON=off` and `AI_SCAN_RETRY_DELAY_SECONDS=2`,
    approved by the user.
  - Contracts: `domains/ai-jobs.ts`, plus the problem codes `AI_REPORT_ALREADY_REVIEWED` and
    `AI_ANSWER_ALREADY_REPORTED`.
  - No new policy actions.

## Outcome table

| Scenario                              | Expected                                                                                                                                                                                                               | Actual      | Result |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ |
| Nightly sweep over every tenant       | one run per tenant (Hyland, Globex, Sandbox) × feature; Hyland outlook evaluated budgets and called the model; outlook list as of tonight                                                                              | as expected | pass   |
| Scan only suggests                    | no ledger journal, approval task or `system:ai-scan` audit row added; model calls logged as system                                                                                                                     | as expected | pass   |
| Replay of the night                   | API request returns the same completed run; idempotent replay header; second sweep and redelivered job change no run, query-log count or snapshot count                                                                | as expected | pass   |
| Tenant isolation                      | Globex sees none of Hyland's runs; Hyland id 404 from Globex; forged `X-Tenant-Id` 403; RLS returns 0 rows as `bf_app`                                                                                                 | as expected | pass   |
| Kill switch                           | run `skipped` / `feature_off`, 0 model calls, no query-log row; redelivery leaves it skipped (1 attempt); switched back on the same scan calls the model                                                               | as expected | pass   |
| Outage to dead letter                 | 4 attempts (redeliveries and a sweep during backoff add none), 4 failed query-log rows, span ≥ 12 s, run `failed`, 1 dead-letter job, screens keep the last nightly run                                                | as expected | pass   |
| Scan scope                            | employee 403 on queue and on anomaly runs; auditor reads, cannot queue; other night 400; one audit entry per queue                                                                                                     | as expected | pass   |
| Report own answer                     | 201 with text when included, none without, 90-day expiry; second report 409 `AI_ANSWER_ALREADY_REPORTED`; another person's answer 404; audit has no text                                                               | as expected | pass   |
| Reported answers scope                | employee and reporter 403; auditor reads, review 403; Org Admin reviews once (409 `AI_REPORT_ALREADY_REVIEWED` after); empty note 400; filter by status; Globex sees none; forged tenant 403; review note not in audit | as expected | pass   |
| 90-day text removal                   | expired text and note masked at once; `ai.report_text_retention` clears them in the database; report stays                                                                                                             | as expected | pass   |
| Journey: report and review            | location manager reports; Org Admin sees it with the AI label and reviews with a note; auditor has no review control (desktop, tablet, mobile)                                                                         | as expected | pass   |
| Journey: filter, forbidden, scan note | status filter, "did not include the text", 403 state for an employee, outlook note names the nightly run and its counts                                                                                                | as expected | pass   |

Scenarios: [`apps/api-e2e/src/worker/ai-scans.spec.ts`](../../apps/api-e2e/src/worker/ai-scans.spec.ts),
[`apps/api-e2e/src/ai/reported-answers.spec.ts`](../../apps/api-e2e/src/ai/reported-answers.spec.ts);
journey [`apps/web-e2e/src/ai/reported-answers.spec.ts`](../../apps/web-e2e/src/ai/reported-answers.spec.ts).
Invariants 143-148 in [`invariant-scenarios.md`](../../docs/testing/invariant-scenarios.md). Roles:
org-admin, finance-admin, auditor, employee, budget-owner, department-head, location-manager,
globex-admin.

## Gates

- [`gate-summary.txt`](gate-summary.txt) — `scripts/gate.sh all` on `47875613`: every static check, functional-api and
  functional-e2e PASS; visual FAIL on three mobile states whose copy the review fixes changed
  (011a report dialog hint, 113a retention banner and review dialog).
- Those baselines were re-recorded in the pinned image. The 011a report-dialog state now opens from
  the short out-of-scope answer, because behind the long answer the page's scroll offset (and its
  masks) varied with suite order. `scripts/gate.sh visual` then passed on the final working tree
  (1064 baselines): [`visual-gate-summary.txt`](visual-gate-summary.txt).
- Visual QA: [`visual-qa/report.md`](visual-qa/report.md) (two iterations, no blocking findings).

## Review

An independent read-only review of the first commit found job dedup and retention holes:

- pg-boss `standard` queues ignore `singletonKey`;
- a requeue race on failed runs;
- an outage wiping stored drivers;
- past-night rewrites;
- text removal tied to the scan schedule, plus an unexpiring reporter note;
- the review note in the audit chain;
- one tenant stopping the sweep;
- manual runs shown as the latest scan.

All were fixed in `47875613` and are covered by the scenarios above.

## Risks and follow-ups

- Every gate run here shared the machine with other stacks. The first full run had one
  functional-api test (`extended/scenarios.spec.ts:67`, what-if impact) stall for 16.7 minutes
  against a 60 s timeout. It passed 20/20 on its own, then in the next full run. Treated as machine
  contention, not a product hang.
- A scan, model calls included, runs in one transaction holding its run row. That is fine on the
  recorded provider; with Bedrock latency and many budgets, long transactions are worth watching.
- The outlook reads up to 200 budgets per run (an existing limit of `budgetFacts`).
- The worker identity uses the auditor's read-only grants, as `board-pack.service.ts` does for
  finance.
