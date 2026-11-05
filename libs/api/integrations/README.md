# api-integrations

Phase 12 integrations module: the connector framework (port, allowlisted HTTP client, retry with
backoff, dead letter), the adapters for ERP, planning, card, expense, HR, calendar and identity
providers, inbound HMAC-signed provider webhooks, cross-source duplicate review, event-code and
card-limit pushes, and the public API with scoped keys, rate limits and outbound webhooks.

Connectors never post to the ledger. Everything that moves money goes through the Phase 6 actuals
review (`ImportsService`), which de-duplicates by source reference and posts under the normal
idempotency keys and ordered row locks.
