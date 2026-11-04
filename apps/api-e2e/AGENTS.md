# apps/api-e2e — API scenario tests

- Proves BudgetFlow behavior over HTTP against the running API: Playwright test runner with the `request` fixture, real Keycloak tokens per role from the local realm, real Postgres. Target: `functional-api` (`scripts/gate.sh functional-api`).
- Default target is the Compose stack (`scripts/stack.sh up && scripts/stack.sh reset`: Postgres, Keycloak, Mailpit, MinIO, API, worker, web; deterministic seed; fake `AiProvider`). For parallel or isolated runs each worker starts its own Postgres 16 Testcontainer with migrations applied and an API instance against it; migration checks (empty to head, previous release with seed data to head) also use Testcontainers.
- Layout: `src/<area>/*.spec.ts` (budgets, ledger, approvals, contributions, actuals, events, scope, audit, db, integrations, ai, worker); `src/support/` for tokens per role, seed ids, contract validation and the Testcontainers fixture.
- Assert business outcomes: status, problem `code`, amounts in minor units, statuses, visibility per role, audit entries, ledger effects. Every response validates against its `libs/contracts` schema.
- Every invariant row in `docs/testing/invariant-scenarios.md` points at a scenario here; keep the map current.
- Performance checks use autocannon against the stack when a gate asks; results go to `evidence/<phase>/perf/`.
- Tokens and responses with personal data stay in `tmp/`; evidence gets redacted copies.

Rules: `.cursor/rules/testing-functional.mdc`. Skill: `/functional-check`.
