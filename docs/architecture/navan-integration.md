# Navan integration (Phase 16a)

BudgetFlow controls budgets; Navan books travel, issues cards and approves trips and expenses. This page
describes the Navan connector as built for gap package B1. It is built against the mock provider
(decision D4): the mock answers on the paths and with the shapes the public Navan developer
documentation describes. Live use needs Navan credentials and the values listed under
[Confirm before live use](#confirm-before-live-use).

Code: `libs/api/integrations/src/lib/navan/` (client, windows, mapping, settings, sync service), the
mock in `infra/mock-providers/navan.mjs`, scenarios in `apps/api-e2e/src/integrations/navan.spec.ts`,
journeys in `apps/web-e2e/src/integrations/navan.spec.ts`.

## Connection

- OAuth 2.0 client credentials. The client id is stored on the connection; the client secret is
  encrypted at rest (`integration_secrets`) and referenced by id, never returned or logged.
- The token call sends `grant_type`, `client_id` and `client_secret` and **never a `scope`
  parameter**: the documentation warns that one can strip the Expense: Write scope.
- Tokens (about 12 hours) are cached in memory per connection and secret, renewed five minutes
  before they expire, and renewed once when Navan answers 401. Every Navan call of a run happens in
  the worker (`integrations.navan.run` outbox topic), so the worker holds the cache; "Test
  connection" fetches its own token in the API.
- EU accounts (`settings.region = eu`) send `x-navan-region: eu` on every call.
- Expense: Write is a two-part opt-in: Navan grants the scope to the credentials, and an Integration
  Admin turns on `settings.expenseWrite`. Without both, no option, coding or write-back call is made.
- Mock mode calls the mock provider. Sandbox and live modes are refused unless
  `NAVAN_LIVE_ENABLED=true` is set in the API and worker environment, which CI never sets. The live
  host must also be on `INTEGRATIONS_ALLOWED_HOSTS`, with the host serving receipt links.

## Inbound

| Object         | What happens                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transactions` | Card, connected-card, manual (reimbursements, payroll), repayment, fee, adjustment, daily-rebate and dispute transactions, read by `modifiedFrom`/`modifiedTo` windows of at most 93 days, every cursor page (`limit` 1-500, `settings.pageSize`) |
| `users`        | Navan users mapped to people by email (`integration_mappings`, kind `person`); a user with no BudgetFlow person is reported in Errors and retries, never created                                                                                  |

- A run starts at the requested date, else the stored cursor, else the first day of the month two
  months back (how far Navan's filters reach). It ends at the instant the run was queued. The next
  cursor is that end less four hours, because Navan results can lag updates by up to four hours.
- 429s wait for `Retry-After` (or 250 ms doubling, at most 30 s) and retry up to five times; a run
  that still fails lands in the retry queue as `rate_limit`.
- Each run is one Phase 6 actuals review batch (source `travel`), uploaded as the connector actor:
  source references are unique, so a replayed window applies nothing; lines that match another
  source's line on date, amount, currency and merchant (a connected card the card feed also sent) are
  flagged as possible duplicates before matching; matching proposes by event code and cost center,
  or by a mapping rule. Nothing posts until Finance posts the batch. A line dated in a closed period
  posts to the next open period, flagged late, like any other actual.
- Negative transactions become refunds when they name the original transaction, otherwise credit
  notes. The legal entity and cost center come from Navan's HR fields through the connection's
  mappings; the event code from the custom field mapped as the event-code field.
- Receipts are presigned links valid for seven days. The worker copies each one into the
  `DocumentStore` against its actual (owner type `actual`, kind `receipt`), keyed by the Navan
  transaction id so a second fetch is a no-op. A link that already expired is fetched again through
  the bulk id lookup (`GET /transactions?ids=`, at most 100 ids).

## Outbound

| Object               | What happens                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event_codes`        | Event codes published as options of the mapped list field through async batch jobs (at most 5,000 operations each), polled until complete. Recorded in `integration_pushes` (kind `event_code`)    |
| `cost_centers`       | Cost center codes published the same way into the cost-center field (kind `cost_center`); an ended cost center is switched off                                                                     |
| `transactions` (out) | GL code, cost center and event code written back to the Navan transactions BudgetFlow matched since the last write-back, by batch PATCH of at most `settings.writeBatchSize` (at most Navan's 100) |

- An event-code option is active while its event is approved, funded, in progress, completed or
  reconciling **and** its budget accepts new activity with money left. A frozen, set-to-zero,
  exhausted, expired or closed budget switches the option off; re-opening switches it back on. The
  worker does this on every `budget.control_changed` message, and every change is audited
  (`integration.navan_option_changed`). Runs are diff-based: an option already in the wanted state
  is not sent again, and an option nobody may use is never created.
- Navan's ERP sync status is set (to synced, the only value Navan accepts) only when
  `settings.systemOfRecord` is on. Otherwise it is never touched.

## Approvals boundary

- Navan approves trips and expenses under its own policy. Nothing in BudgetFlow approves, rejects or
  gates anything inside Navan, and AI never approves.
- BudgetFlow keeps delegation-of-authority limits, co-funding and controls. Its control at the point
  of spend is the option list: a budget that stops accepting spend stops being selectable.
- Spend that arrives needing more than its budget has left (the commitment's remaining amount plus
  the budget's available amount, in the budget currency at the locked plan rate) becomes an
  `over_budget` exception in the post-spend exception queue (074a), one per actual, audited.

## Confirm before live use

Navan's public developer documentation describes these without naming them. They live in one place, `navan-client.ts`, and the mock uses the same
values:

| Value                           | Mock value                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Token path                      | `POST /v1/oauth/token` (form body)                                                                          |
| API base path                   | `/v1/expense`                                                                                               |
| Region header                   | `x-navan-region: eu`                                                                                        |
| List envelope and cursor        | `{ data, nextCursor }`, `limit` and `cursor` query parameters                                               |
| Option batch job and status     | `POST /custom-fields/{id}/options/batch`, `GET /custom-fields/jobs/{jobId}`, `IN_PROGRESS` then `COMPLETED` |
| Whether options can be disabled | `active: false` on an option (the alternative is deleting it)                                               |

Open questions carried from the plan: webhooks (polling is the baseline), a pre-approval hook (none
documented), the Booking API, and endpoints gated by Navan edition (users and audit logs answer 403
for ineligible companies).
