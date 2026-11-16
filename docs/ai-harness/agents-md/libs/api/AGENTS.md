# libs/api — NestJS domain modules

One module per domain under `libs/api/<module>` (budgets, ledger, events, contributions, approvals, rules, audit, org, tenancy, documents, integrations, notifications, ai). `libs/api/db` holds the Drizzle schema and migrations.

- Controllers are thin: contract parse, policy check, one service call, contract response.
- Services orchestrate one transaction: load and lock (ordered row locks), call `libs/domain`, persist ledger entries and state, append the audit event, write outbox messages.
- Modules talk to each other through exported services, never through each other's tables.
- Every module is proven by API scenarios in `apps/api-e2e` against the running stack (Testcontainers Postgres for isolated runs), including RLS isolation for each tenant-owned table it reads or writes.
- Documents (receipts, quotations, approval evidence) go through the `DocumentStore` interface: MinIO in Compose, in functional runs and in CI (no in-memory fake). AI calls go through `AiProvider`; functional runs and CI use the offline recorded provider (`AI_PROVIDER=recorded`), the product Amazon Bedrock (`AI_PROVIDER=bedrock`).

Use `/api-endpoint`, `/db-migration`, `/ledger-change`, `/integration-adapter`. Rules: `.cursor/rules/api-nestjs.mdc`, `db-drizzle-rls.mdc`, `testing-functional.mdc`.
