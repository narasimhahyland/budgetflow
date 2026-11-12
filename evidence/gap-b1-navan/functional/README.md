# Gap B1 — functional check

Stack `bf-gap-b1` (this worktree, own ports), deterministic seed, mock provider in Mock mode, API
pinned to `2026-11-16T09:00:00Z`. Commands:

- `npx playwright test -c apps/api-e2e/playwright.config.ts integrations/navan.spec.ts` (17 scenarios,
  run three times on one stack without a reseed, all green each time; list in `api-scenarios.txt`)
- `npx playwright test -c apps/web-e2e/playwright.config.ts integrations/navan.spec.ts --project=desktop`
  (3 journeys)
- `scripts/gate.sh` functional-api and functional-e2e (whole suites, see `../gate-summary.txt`)

Roles: `integration-admin` (connect, map, run), `finance-admin` and `finance-controller` (mapping
rules, post batches, exception queue), `budget-owner` and `department-head` (event and its approval),
`employee` and `auditor` (refusal, audit read).

| Scenario                          | Expected                                                                                   | Actual                                                                         | Result |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------ |
| Token call                        | `client_credentials`, no `scope`, token carries Expense: Write                             | every token request `sentScope: false`; test message names Expense: Write      | pass   |
| Region                            | every call from the EU client carries `x-navan-region: eu`; without it the account refuses | all calls `region: eu`; region `us` → test fails 400, Needs attention          | pass   |
| Token cache                       | second run fetches no token; an expired token is renewed once                              | token requests unchanged, then +1                                              | pass   |
| Live mode, limits                 | live refused without `NAVAN_LIVE_ENABLED`; batch size 101 and page size 501 refused        | 409 `NAVAN_LIVE_DISABLED`; 422 `VALIDATION_FAILED`                             | pass   |
| 93-day windows                    | backfill from 1 Jan in contiguous windows of at most 93 days, all eight types              | 4 windows per type, last ends at the queue time; cursor = end − 4 h            | pass   |
| Cursor paging                     | page size 2 reads every page once                                                          | 3 pages with cursors; each of 5 refs once in the batch                         | pass   |
| 429 backoff                       | two 429s waited out; a 429 that never clears goes to the retry queue                       | run note "2 rate-limit wait(s)"; failed run queued as `rate_limit`             | pass   |
| Idempotent replay                 | replayed window applies nothing; the posted spend counts once                              | 0 applied; budget actual +12,500 once; re-post 409 `IMPORT_ALREADY_POSTED`     | pass   |
| Duplicate against a card feed     | Navan connected-card twin of Ramp `RMP-5501` is flagged before matching                    | `duplicateOfActualId` set, "Possible duplicate" note                           | pass   |
| Spend above remaining budget      | one `over_budget` exception, audited, nothing posted                                       | room 10,000, excess 5,000, Jordan Smith; actual 0; replay raises none          | pass   |
| Closed period                     | an August line posts late into Nov 2026                                                    | journal `late: true`, `Nov 2026`, accounting date 2026-08-14                   | pass   |
| Receipts                          | stored in the `DocumentStore`; an expired link is looked up again                          | both available as receipts; bulk lookup only for the expired one               | pass   |
| Frozen budget disables its option | freeze switches the event code off in Navan; unfreeze switches it back on; audited         | option `active` false then true; push `disabled` then `pushed`                 | pass   |
| Async option jobs                 | batch job polled to completion; a replay sends nothing                                     | jobs `COMPLETED` after ≥2 polls; replay "already matches", no new job          | pass   |
| Batch PATCH limit                 | one PATCH per item at size 1; no ERP sync status; `SYNCED` only as system of record        | as expected                                                                    | pass   |
| No write without the scope        | read-only credentials or Expense: Write off write nothing                                  | runs fail with the reason; 0 PATCH, 0 jobs                                     | pass   |
| Journey: connect                  | connect with client id, region and secret; test proves the scope; secret never on screen   | as expected                                                                    | pass   |
| Journey: field mapping            | map the list fields, turn write on through its consequence, publish event codes            | settings saved; `NYC-OFFSITE-26` row "Sent" on the Push tab                    | pass   |
| Journey: exception queue          | Finance sees the Navan spend above the remaining budget and settles it with a reason       | row shows type, Navan wording and the traveller; resolved `accept_with_reason` | pass   |

API responses: `../api/` (no credential, token or secret in any file; emails are fictional).
Screenshots of the Navan connector tabs at three viewports: `../visual-qa/screens/`.
