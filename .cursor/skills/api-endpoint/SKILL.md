---
name: api-endpoint
description: Adds or changes a BudgetFlow API endpoint contract-first - zod schema in libs/contracts, generated OpenAPI and typed client, NestJS controller and command service with PolicyService authorization, tenant RLS, idempotency and problem-details errors, then API scenario tests in apps/api-e2e against the running stack. Use when creating, changing or removing an HTTP endpoint, request or response shape, or error code.
---

# API endpoint (contract first)

Rules: `.cursor/rules/contracts.mdc`, `.cursor/rules/api-nestjs.mdc`. `libs/contracts` is a shared surface: the task must own it.

```text
- [ ] 1 Contract: zod request, response, errors in libs/contracts
- [ ] 2 Generate OpenAPI and the typed client; commit together
- [ ] 3 Controller (thin) + command or query service
- [ ] 4 Authorization, tenancy, idempotency, audit
- [ ] 5 API scenarios in apps/api-e2e
- [ ] 6 Web data-access follows (if the UI uses it)
- [ ] 7 Gates and report
```

## 1. Contract
In `libs/contracts/src/<domain>/`: `.strict()` zod schemas with `.describe()` text, money as `{ amountMinor: int, currency: ISO 4217 }` (plus the triplet where relevant), ids as uuid, timestamps as ISO strings. Errors are RFC 9457 problem details with a stable `code` (`OVER_ALLOCATION`, `BUDGET_FROZEN`, `DOA_LIMIT_EXCEEDED`) and a plain-English `detail`. Mutations require an `Idempotency-Key` header.

## 2. Generate
`npx nx run contracts:openapi` then `npx nx run contracts:openapi-check`. The schema, generated OpenAPI and client are committed in the same change.

## 3. Controller and service
The controller validates with the contract (zod pipe), resolves the actor from the Keycloak JWT and the tenant from the token (never trust `X-Tenant-Id` alone), and calls one command or query service. No business logic, no role-name checks in controllers.

## 4. Command shape
One transaction: `PolicyService.can(actor, action, resource)` → set `app.tenant_id` → row locks in fixed order → idempotency check → `libs/domain` call → journal post (`/ledger-change`) → audit entry → outbox message. Business failures map to problem details; never leak stack traces, SQL or other tenants' identifiers.

## 5. API scenarios
In `apps/api-e2e/src/<domain>/<endpoint>.spec.ts`, against the running stack (`scripts/stack.sh up && scripts/stack.sh reset`), with tokens per role from the local Keycloak realm:
- happy path with exact amounts; response validates against the contract;
- validation failure (400 with field paths); each business rejection with its `code`;
- denied role (403) and other tenant (404) — including a forged `X-Tenant-Id`;
- idempotent retry returns the first result and posts once; concurrent calls cannot jointly break an invariant;
- the audit entry and ledger effect of a successful mutation.
Run `npx nx run api-e2e:functional-api -- -g "<endpoint>"`; update `docs/testing/invariant-scenarios.md` when a scenario proves an invariant.

## 6. Web data-access
If the UI uses the endpoint, extend `libs/web/data-access` on the generated client (idempotency key per user action) and prove the user flow with `/functional-check`.

## 7. Gates and report
`scripts/gate.sh static functional-api`. Report: contract changes (shared files), endpoints, error codes, scenarios added with results, evidence path.
