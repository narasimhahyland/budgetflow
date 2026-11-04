# API conventions

Rules: `.cursor/rules/api-nestjs.mdc`, `.cursor/rules/contracts.mdc`. Procedure: `/api-endpoint`.

## Contract first

1. Add or change schemas and the endpoint entry in `libs/contracts/src/lib/domains/<domain>.ts` (one file per domain; register the domain's endpoint map in `libs/contracts/src/lib/endpoints.ts`). Schemas are `.strict()`, carry `.describe()` text, and every request and response schema is registered with `named()` so it becomes an OpenAPI component.
2. `npx nx run contracts:openapi` regenerates `libs/contracts/openapi/openapi.json` (OpenAPI 3.1 from zod's JSON Schema output). `contracts:openapi-check` fails the build gate on drift. The API serves the same document at `GET /api/openapi.json`.
3. The typed client (`createApiClient`) derives its methods from the endpoint registry; there is no generated code to keep in sync.
4. Controllers parse with the same schemas (`parseWith`), so validation errors are 400 `VALIDATION_FAILED` with dot paths in `errors[]`.

## Paths and shapes

- Resource paths under `/api/` (`/api/budgets/{budgetId}/allocations`); health at `/health` and `/health/ready`.
- Ids are UUIDs; timestamps ISO 8601 UTC; dates `YYYY-MM-DD`.
- Money is `{ amountMinor, currency }` (integer minor units, ISO 4217). Ledger lines carry the triplet `transaction`, `budget`, `reporting` plus `budgetRate` / `reportingRate` (`type`, `from`, `to`, 12-decimal `value`, source `rateIds`).
- Budgets return ledger-derived balances in budget and reporting currency, `available`, `allocationAvailable`, and `allowedActions` from `PolicyService` (the UI hides what the API says the user cannot do; the API still enforces).
- Lists are cursor-paginated (`cursor`, `limit` up to 200) and filter in SQL under RLS.

## Authentication and tenancy

- `Authorization: Bearer <Keycloak access token>`: signature via JWKS, issuer `KEYCLOAK_ISSUER`, audience `budgetflow-api`, expiry.
- `X-Tenant-Id`: required when the user belongs to more than one tenant (400 `TENANT_REQUIRED`); a tenant the user does not belong to is 403 `TENANT_NOT_MEMBER`. Without the header, the single membership is used.
- Each request runs its queries with `app.tenant_id` set so RLS filters every table.

## Mutations

- `Idempotency-Key` header required (8-200 visible characters; 400 `IDEMPOTENCY_KEY_REQUIRED`). A replay with the same request returns the first response and status with `Idempotent-Replayed: true`; the same key with a different request is 422 `IDEMPOTENCY_KEY_REUSED`. Rejected commands roll back and do not consume the key.
- One transaction per command: key, policy, ordered row locks, domain call, journal, exactly one audit event, outbox messages.
- Side effects (email, integrations, jobs) leave through `outbox_messages`; the worker publishes them to pg-boss.

## Errors

RFC 9457 problem details, `content-type: application/problem+json`:

```json
{
  "type": "urn:budgetflow:problem:over-allocation",
  "title": "Over allocation",
  "status": 409,
  "code": "OVER_ALLOCATION",
  "detail": "Only 40000 USD minor units are available to allocate; 40001 were requested.",
  "instance": "/api/budgets/…/allocations",
  "params": {
    "availableMinor": 40000,
    "requestedMinor": 40001,
    "shortfallMinor": 1,
    "currency": "USD"
  }
}
```

| Status | When                                                                    | Codes (examples)                                                                                                                                                                                          |
| ------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Malformed input, missing headers                                        | `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REQUIRED`, `TENANT_REQUIRED`                                                                                                                                        |
| 401    | Missing or invalid token                                                | `UNAUTHENTICATED`                                                                                                                                                                                         |
| 403    | Visible but not allowed; not a tenant member                            | `FORBIDDEN`, `TENANT_NOT_MEMBER`                                                                                                                                                                          |
| 404    | Does not exist or not visible to the user                               | `NOT_FOUND`                                                                                                                                                                                               |
| 409    | Conflicts with current state                                            | `OVER_ALLOCATION`, `INSUFFICIENT_AVAILABLE`, `ALREADY_REVERSED`, `CANNOT_REVERSE_REVERSAL`, `REVERSAL_WOULD_OVERDRAW`, `BUDGET_FROZEN`, `BUDGET_SET_TO_ZERO`, `NO_OPEN_PERIOD`, `IDEMPOTENCY_IN_PROGRESS` |
| 422    | Valid shape, invalid business input                                     | `JOURNAL_UNBALANCED`, `MANUAL_JOURNAL_BUCKET_NOT_ALLOWED`, `NOT_A_CHILD`, `CURRENCY_MISMATCH`, `RATE_MISSING`, `AMOUNT_NOT_POSITIVE`, `ROOT_REQUIRES_PLAN_VERSION`, `IDEMPOTENCY_KEY_REUSED`              |
| 500    | Unexpected; logged with the request id, never leaks SQL or stack traces | `INTERNAL_ERROR`                                                                                                                                                                                          |

Domain failures map through `domainProblem` (`libs/api/core/src/lib/problem.ts`): input-shaped codes are 422, state conflicts 409. The full code list is `PROBLEM_CODES` in `libs/contracts/src/lib/common.ts`.

## Phase 1 endpoints

| Method and path                                        | Purpose                                                                       | Permission                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /health`, `GET /health/ready`                     | Liveness; readiness (database, Keycloak JWKS)                                 | public                                                                                     |
| `GET /api/openapi.json`                                | Generated OpenAPI 3.1                                                         | public                                                                                     |
| `GET /api/me`                                          | User, tenant, roles, memberships, permissions, timezone, fiscal years (P2)    | any member (own identity plus non-financial tenant settings: name, timezone, fiscal years) |
| `GET /api/auth/config`                                 | Issuer and public web client for OIDC sign-in (P2)                            | public                                                                                     |
| `POST /api/analytics/events`                           | Product analytics from the web app; retry-safe by event id, no audit (P2)     | `tenant.read`                                                                              |
| `GET /api/budgets`                                     | Budgets visible to the user                                                   | `budget.read` (tenant or owned subtrees)                                                   |
| `POST /api/budgets`                                    | Root budget with original amount (posts `original_budget`), or an empty child | `budget.create_root` / `budget.create_child`                                               |
| `GET /api/budgets/{id}`                                | Budget with balances                                                          | `budget.read`                                                                              |
| `POST /api/budgets/{id}/allocations`                   | Allocate to a direct child at the locked plan rate                            | `budget.allocate`                                                                          |
| `GET /api/budgets/{id}/ledger`                         | Ledger lines of a budget                                                      | `ledger.read`                                                                              |
| `GET /api/ledger/journals/{id}`                        | Journal with lines and totals                                                 | `ledger.read` on a budget in it                                                            |
| `POST /api/ledger/journals`                            | Manual journal (opening balances, adjustments)                                | `ledger.manual_journal`                                                                    |
| `POST /api/ledger/journals/{id}/reversals`             | Linked reversal                                                               | `ledger.reverse`                                                                           |
| `POST /api/integrity/ledger-checks`, `GET .../{id}`    | Queue and read a ledger rebuild check                                         | `integrity.run` / `integrity.read`                                                         |
| `GET /api/audit/events`, `GET /api/audit/verification` | Audit events; chain verification                                              | `audit.read`                                                                               |
