# 0001 Monorepo and stack

## Context

BudgetFlow is built by several agents in parallel across 20 phases. It needs one dependency graph, enforced boundaries between web, API and shared code, and pinned versions that are known to work together with the private Satori packages.

## Decision

- Nx 23.3.0 integrated monorepo (TypeScript path aliases in `tsconfig.base.json`, npm, Node 24).
- Web: Angular 22.2 (standalone, signals, OnPush), Angular Material/CDK 22.2, `@hylandsoftware/satori-ui` 1.0.0-alpha.171 with `satori-lint` and `satori-design-system-checker` at the same version; `@ngx-translate/core` 18 only as Satori's peer with English defaults.
- API: NestJS 11 on Node 24, zod 4 contracts with OpenAPI 3.1 generated from them, Drizzle ORM over PostgreSQL 16, `jose` for JWKS verification, pg-boss 12 for jobs with a transactional outbox.
- Identity: Keycloak 26 (OIDC; PKCE for the SPA, direct grant only on the local test client).
- Verification: Playwright 1.64.1 for API scenarios (`apps/api-e2e`) and journeys (`apps/web-e2e`); Testcontainers and autocannon are installed for isolated runs and performance gates.
- Module boundaries by Nx tags (`eslint.config.mjs`); `libs/domain` may not import any external package.

## Consequences

- Shared surfaces (`package.json`, lockfile, `nx.json`, `tsconfig.base.json`, `eslint.config.mjs`, `libs/contracts`, `libs/api/db`) are owned by the integrator during parallel waves.
- The `sdsc` version check compares with the latest Satori release on the registry and reports the pinned alpha.171 as older; it is informational (exit 0).
- Satori's icon sprite makes the initial web bundle about 1 MB; the production budget allows up to 3 MB until a later phase optimizes it.
