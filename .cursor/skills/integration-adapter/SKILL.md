---
name: integration-adapter
description: Builds or changes a BudgetFlow integration adapter (ERPNext, Odoo, Workday, Adaptive Planning, Brex, Navan, Ramp, Coupa, Concur, NetSuite, HR, calendar, SCIM) on the connector framework - port interface, adapter, a mock server for the external API, contract tests against the mock, retry/backoff/dead letter, HMAC webhooks, idempotent sync, de-duplication, and functional checks on the local stack. Use when adding a connector, changing a sync, import or export, or handling external webhooks.
---

# Integration adapter

Rule: `.cursor/rules/integrations.mdc`. External systems are never called from functional runs or CI; every adapter has a mock.

```text
- [ ] 1 Port: what BudgetFlow needs, in domain terms
- [ ] 2 Mock of the external API (recorded shapes, fictional data)
- [ ] 3 Adapter on the connector framework
- [ ] 4 Contract tests against the mock
- [ ] 5 Functional checks on the stack (worker, retries, dedupe, webhooks)
- [ ] 6 Gates and report
```

## 1. Port
Define the port in `libs/api/integrations/<connector>/` in BudgetFlow terms (actuals with dimensions and currency triplet, cost centers, headcount, plan lines, card limits), never the vendor's shapes. Map vendor fields in one mapper with explicit currency and minor-unit conversion.

## 2. Mock
A mock server for the vendor API (`libs/api/integrations/<connector>/mock/`) built from the vendor's public documentation: fictional data, realistic pagination, rate limits, error responses (401, 404, 409, 429, 5xx) and webhook signatures. The local stack runs it in place of the vendor; real credentials are never needed for any check.

## 3. Adapter
Built on the connector framework: credentials from the secret store by reference (never in code, logs or the database in clear), sync runs with cursor or since-timestamp, idempotent upserts keyed by the external id, retry with exponential backoff and jitter, dead letter after the limit, sync status per connection, outbound HMAC-signed webhooks and verified inbound signatures with replay protection. Cross-source de-duplication flags card, expense and AP duplicates before matching.

## 4. Contract tests (`apps/api-e2e/src/integrations/<connector>/`)
Run the adapter against the mock: every port operation round-trips the documented shapes; pagination is exhausted; 429 and 5xx retry then dead-letter; 401 marks the connection broken without leaking the credential; webhook signatures are verified and replays rejected; mapping keeps exact minor-unit amounts and currencies.

## 5. Functional checks on the stack
With `scripts/stack.sh up && scripts/stack.sh reset` (mock enabled): trigger a sync as the Integration Admin through the API, then check the business outcome — imported actuals auto-match by event code and cost center, unmatched lines reach the queue, duplicates are flagged, sync status and dead letters are visible, the worker job is idempotent when re-run, emails or alerts arrive in Mailpit when configured. Record evidence with `/functional-check`.

## 6. Gates and report
`scripts/gate.sh static functional-api` (plus `functional-e2e` when screens change). Report: port, mock coverage, contract and functional results, secrets handling, evidence path.
