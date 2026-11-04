# apps/worker — background jobs

pg-boss workers that drain the transactional outbox and run scheduled work: notifications (Mailpit locally), integration syncs and webhooks, approval SLA timers and escalation, period-end jobs, and the nightly ledger rebuild check.

- Jobs are idempotent: keyed by a business id, safe to run twice, and safe after a crash mid-way.
- Every job runs with an explicit tenant context (RLS still applies); cross-tenant jobs iterate tenants and set the context per tenant.
- Retries use exponential backoff with jitter and end in a dead-letter queue that the admin screens show.
- The nightly ledger rebuild check recomputes every bucket balance from ledger entries, compares it with cached balances, verifies the audit hash chain, records the result, and raises an alert on any drift. It never repairs data itself.
- Jobs call the same application services as the API; they never write tables directly.

Targets: `serve`, `build`, `lint`, `typecheck`. Job behavior (idempotency, retry to dead letter, nightly rebuild check) is proven by worker scenarios in `apps/api-e2e`.
Rules: `.cursor/rules/worker-jobs.mdc`, `ledger-accounting.mdc`.
