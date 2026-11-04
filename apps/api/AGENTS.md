# apps/api — NestJS edge

Module wiring, config, authentication, tenant resolution, error mapping, health and OpenAPI serving. Domain modules live in `libs/api/<module>`, rules in `libs/domain`, shapes in `libs/contracts`, schema in `libs/api/db`.

- Request path: Keycloak JWT verified against JWKS → tenant from `X-Tenant-Id` checked against memberships → DB transaction with `set_config('app.tenant_id', ...)` so RLS applies → zod parse from `libs/contracts` → `PolicyService.can(actor, action, resource)` → application service → contract response.
- Every mutation takes an `Idempotency-Key` header; replays return the stored response.
- Errors are RFC 9457 problem details with a stable `code` and a plain-English `detail`; never stack traces or SQL.
- `GET /health` (liveness) and `GET /health/ready` (database, Keycloak JWKS) exist from the first commit; `scripts/stack.sh` waits on them.
- Config is zod-validated env; every variable is listed in `infra/.env.example` with a dev placeholder.

Targets: `serve`, `build`, `lint`, `typecheck`, `seed`. Functional proof lives in `apps/api-e2e` (`functional-api`).
Use `/api-endpoint` for new endpoints. Rules: `.cursor/rules/api-nestjs.mdc`, `security.mdc`.
