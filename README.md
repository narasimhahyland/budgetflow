# BudgetFlow Enterprise

BudgetFlow Enterprise is a multi-tenant corporate budget delegation and control platform. Budget is
authorized at the top of an organization and allocated down a hierarchy to owners who can delegate it
further; spending, transfer and increase requests are approved only inside delegation-of-authority
limits; finance can freeze, reduce or set a budget to zero without stranding commitments already made;
cross-location events are co-funded through **Inter-Director Budget Contribution Requests**; a rules
engine decides routing and policy; connectors sync with finance, HR and spend systems; and every money
movement posts to an accounting-grade, append-only ledger with a hash-chained audit trail.

This README is for someone who just opened the repository. For the product story there is a
[leadership overview](https://narasimhahyland.github.io/budgetflow/overview/) and a
[capabilities page](https://narasimhahyland.github.io/budgetflow/capabilities/); for the screens there
is a [clickable design preview](https://narasimhahyland.github.io/budgetflow/). Agents working in this
repository read [`AGENTS.md`](AGENTS.md) instead.

## Status

Delivery runs as 20 gated phases. A phase is on `main` only when its evidence pack is committed under
`evidence/phase-NN/`, so the table below is derived from the repository, not from the plan.

| Phase | Scope                                              | On `main`                 |
| ----- | -------------------------------------------------- | ------------------------- |
| 1     | Architecture, domain, ledger, schema, test harness | [yes](evidence/phase-01/) |
| 2     | Shell, identity, tenancy, Keycloak sign-in         | [yes](evidence/phase-02/) |
| 3     | Org and finance master data                        | [yes](evidence/phase-03/) |
| 4     | Budgets: allocation, controls, versions, phasing   | [yes](evidence/phase-04/) |
| 5     | Events, co-funding, approvals, requests            | [yes](evidence/phase-05/) |
| 6     | Actuals, matching, GL tie-out, accruals            | [yes](evidence/phase-06/) |
| 7     | Rules engine, workflows, delegation hygiene        | [yes](evidence/phase-07/) |
| 8     | Channels: Slack, Teams, actionable email, phone    | [yes](evidence/phase-08/) |
| 9     | Event depth: quotes, checklists, surveys           | [yes](evidence/phase-09/) |
| 10    | Reports, dashboards, analytics                     | [yes](evidence/phase-10/) |
| 11    | Close, forecast, board pack                        | [yes](evidence/phase-11/) |
| 12    | Integrations and public API                        | [yes](evidence/phase-12/) |
| 13    | AI layer (suggests only, never acts)               | [yes](evidence/phase-13/) |
| 14    | Experience and administration                      | [yes](evidence/phase-14/) |
| 15    | Extended product features                          | [yes](evidence/phase-15/) |
| 16    | Ecosystem: BI, assistant, no-code, marketplace     | [yes](evidence/phase-16/) |
| 17    | Quality: traceability, migrations, performance     | [yes](evidence/phase-17/) |
| 18    | Security review and break-glass access             | [yes](evidence/phase-18/) |
| 19    | Local evidence: whole product, all gates           | [yes](evidence/phase-19/) |
| 20    | Docs and final report                              | [yes](evidence/phase-20/) |

All 20 phases have their evidence on `main`, but the plan lists scope that is not built yet (Navan
live integration, dashboards, report file exports, tax and benefit ledgers and more):
[`docs/gap-closure-plan.md`](docs/gap-closure-plan.md) lists it as work packages.

Each pack holds the gate summary, the functional outcome table, scrubbed API responses and
database proofs, and the visual QA report — [`evidence/README.md`](evidence/README.md) explains the
layout. Screens are tracked individually in
[`docs/ux/screen-inventory.md`](docs/ux/screen-inventory.md) (124 specified screens plus the ones
added by product and finance review).

For the state of play in more detail — what is in flight, what was deferred and why, the known gaps,
and the operational traps that cost time to learn — read [`docs/handoff.md`](docs/handoff.md).

## Run it locally

You need Docker and Node 24. Installing dependencies pulls `@hylandsoftware/satori-ui` from GitHub
Packages, so you need a token for that registry in your own `~/.npmrc` — nothing in this repository
carries one.

```bash
source ~/.nvm/nvm.sh && nvm use 24
npm ci
scripts/stack.sh up     # builds the api, worker and web bundles, then starts Docker Compose
scripts/stack.sh seed   # loads the deterministic seed (idempotent)
scripts/stack.sh urls   # prints the URLs for this checkout
```

| `scripts/stack.sh …` | Does                                                        |
| -------------------- | ----------------------------------------------------------- |
| `up`                 | Build bundles, start every service, wait until healthy      |
| `seed`               | Load the deterministic seed data                            |
| `reset`              | Drop this checkout's volumes, start again, reseed           |
| `status` / `logs`    | Compose status; last 200 log lines (optionally per service) |
| `urls`               | Print the local URLs for this checkout                      |
| `down`               | Stop, keep volumes                                          |

Default host ports (all bound to `127.0.0.1`, all overridable — see
[`infra/.env.example`](infra/.env.example)):

| Service                       | URL                   |
| ----------------------------- | --------------------- |
| Web app                       | http://localhost:4200 |
| API                           | http://localhost:3000 |
| Keycloak (`budgetflow` realm) | http://localhost:8080 |
| Mailpit                       | http://localhost:8025 |
| MinIO                         | http://localhost:9000 |
| Mock connector providers      | http://localhost:4010 |
| PostgreSQL                    | `127.0.0.1:5432`      |

The compose project name derives from the checkout folder, so a second clone or a worktree runs its
own stack side by side; give it a `.env` with different ports. API health is `/health/ready` and the
generated OpenAPI document is at `/api/openapi.json`.

The seed creates one Keycloak user per role in the single Hyland tenant (all other seed data is
fictional). [`docs/local-access.md`](docs/local-access.md) lists the per-role usernames, the
scenario-only users, the service credentials and the stack commands. The shared dev-only password
lives in `infra/.env.example` as `BF_E2E_PASSWORD`; the usernames are generated from the fixtures in
[`libs/seed`](libs/seed/) into the realm export in [`infra/keycloak/`](infra/keycloak/). Every value
in `infra/.env.example` is a dev-only placeholder that works against a local stack only.

## How verification works

There are no unit tests, by design. Correctness is proven against the running product:

- **API scenarios** — `apps/api-e2e`, Playwright's request fixture over HTTP against the running API,
  with real Keycloak tokens per role and real PostgreSQL. Scenarios run on one worker against the local
  stack (isolated per-worker Testcontainers runs were deferred); the migration checks use throwaway
  Postgres 16 containers. Every response is validated against its `libs/contracts` schema.
- **User journeys** — `apps/web-e2e`, Playwright through the real browser as the relevant role,
  asserting the UI and the numbers the API reports.
- **Visual regression** — baselines in `apps/web-e2e/src/__screenshots__/`, captured in a pinned
  Playwright image so they are reproducible. Update only with `npm run e2e:update-snapshots`.

Every invariant maps to the scenario that proves it in
[`docs/testing/invariant-scenarios.md`](docs/testing/invariant-scenarios.md).

`scripts/gate.sh` runs exactly what CI runs:

```bash
scripts/gate.sh static --affected   # lint, typecheck, build — the fast loop
scripts/gate.sh                     # everything (default)
```

Modes are `lint`, `typecheck`, `build`, `functional-api`, `functional-e2e` and `visual`, plus the
groups `static`, `functional` and `all`. A secret scan always runs first. The functional and visual
modes start the local stack and reseed between suites, so each suite starts from the deterministic
seed. Logs land in `tmp/gate/<timestamp>/`.

## Layout

| Path                              | What it is                                                               |
| --------------------------------- | ------------------------------------------------------------------------ |
| `apps/web`                        | Angular SPA: the Satori shell and routes                                 |
| `apps/api`                        | NestJS HTTP edge: JWT verification, tenant resolution, OpenAPI, errors   |
| `apps/worker`                     | pg-boss jobs, the transactional outbox drain, the nightly ledger rebuild |
| `apps/api-e2e`                    | API scenario tests                                                       |
| `apps/web-e2e`                    | User journeys, the core acceptance scenario, visual baselines            |
| `libs/domain`                     | Framework-free business rules: money, ledger posting, DoA, controls      |
| `libs/contracts`                  | zod request and response shapes, generated OpenAPI and typed client      |
| `libs/api/db`                     | Drizzle schema, migrations, row-level-security policies                  |
| `libs/api/<module>`               | NestJS domain modules (budgets, events, approvals, ledger, ai, …)        |
| `libs/web/features/*`             | One lazy-loaded library per screen group                                 |
| `libs/web/{shell,ui,data-access}` | Navigation, shared components, typed API access and state                |
| `libs/seed`                       | Deterministic fixtures: fixed ids and amounts, dates from the API clock  |
| `infra/`                          | Docker Compose, Keycloak realm, Postgres roles, mock connector providers |
| `scripts/`                        | `stack.sh`, `gate.sh`, `worktree.sh`, `secret-scan.sh`, visual tooling   |
| `design/`, `docs/`, `evidence/`   | Approved Stitch exports, documentation, per-phase evidence packs         |

Nx tags enforce the boundaries: web never imports API code, `libs/domain` imports no framework,
database or HTTP code, `libs/contracts` depends only on zod, and feature libraries never import each
other.

## Stack

Nx 23 monorepo on npm and Node 24. Angular 22 (standalone, signals, OnPush) with Angular Material and
`@hylandsoftware/satori-ui`; NestJS 11 with zod contracts and generated OpenAPI; PostgreSQL 16 with
row-level security and Drizzle migrations; Keycloak 26 for OIDC with PKCE; pg-boss for background work
behind a transactional outbox; Docker Compose for the local stack; Playwright for every test level.

## Configuration

Everything comes from environment variables validated at startup; `infra/.env.example` holds
development placeholders and `scripts/stack.sh` passes them to Compose. Variables worth knowing:

| Variable                                                                                                              | What it does                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BF_FIXED_NOW` (`FIXED_NOW` in the API)                                                                               | Development and test only: the instant the API and the database (`app_now()`) treat as now, so a visual run describes the product, not the day it ran. Unset means real time.                         |
| `SLACK_SIGNING_SECRET`, `TEAMS_WEBHOOK_SECRET`, `CHAT_LINK_SECRET`, `APPROVAL_LINK_SECRET`, `INTEGRATIONS_SECRET_KEY` | Signing and encryption secrets, 16 characters or more. In production the API and worker refuse to start without them, because the development values are public (`libs/api/core/src/lib/secrets.ts`). |
| `BF_ALLOW_DEV_SECRETS`                                                                                                | Local stack only (`infra/compose.yaml` sets it): lets those secrets fall back to the public development values, with a warning per secret. Never set it in a deployment.                              |
| `TRUSTED_PROXY_CIDRS`                                                                                                 | The reverse proxies whose `X-Forwarded-For` the API believes when it decides a caller's address (API-key and SCIM allowed networks). Empty means the header is ignored.                               |
| `BF_CI_TRACES`                                                                                                        | CI records no Playwright traces, because its reports are public artifacts; `BF_CI_TRACES=1` keeps them for failing tests on that run.                                                                 |

## Deliberate constraints

A newcomer would otherwise trip over these. Each is a decision, not an oversight.

- **Light theme only.** Dark theme is deferred and visual checks capture light only
  ([ADR 0004](docs/adr/0004-light-theme-only.md)).
- **English only.** App copy is plain English in the templates; there are no translation files.
- **Accessibility checks are deferred.** They are not part of the gates yet.
- **No native app.** The phone experience is the responsive web app. Native wrappers (115a) are
  deferred by decision: the Phase 8 mobile routes already serve phone users, so deferring costs no
  user-facing capability.
- **The AI layer runs on a deterministic fake provider.** No model token, no live model call. The
  features are real and guarded — retrieval scoped by the same authorization as the rest of the API,
  data minimization, a query log, and a person confirming every action — but the answers come from
  fixtures, so they are reproducible in tests.
- **No unit tests.** See [how verification works](#how-verification-works).
- **Money is integer minor units** with ISO 4217 codes, and the ledger is append-only: corrections
  are reversals, never edits.

## Documentation

| Where                                                  | What                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [`docs/handoff.md`](docs/handoff.md)                   | State of play: what is in flight, what is deferred, known gaps, operational traps |
| [`docs/architecture/`](docs/architecture/)             | Domain model, ledger, state machines, authorization, API conventions              |
| [`docs/adr/`](docs/adr/)                               | Architecture decisions and their consequences                                     |
| [`docs/ux/`](docs/ux/)                                 | Screen inventory, per-screen specs, design system, design preview                 |
| [`docs/testing/`](docs/testing/invariant-scenarios.md) | Invariant-to-scenario map                                                         |
| [`docs/ai-harness/`](docs/ai-harness/README.md)        | How the agent harness builds this repository                                      |
| [`evidence/`](evidence/)                               | Per-phase proof: gate summaries, outcomes, screenshots, API and database samples  |

Published pages: [overview](https://narasimhahyland.github.io/budgetflow/overview/),
[capabilities](https://narasimhahyland.github.io/budgetflow/capabilities/),
[design preview](https://narasimhahyland.github.io/budgetflow/).

This repository is public. Seed and fixture data name the company Hyland; everything else is
fictional. Credentials in the repository are dev-only placeholders that work against a local stack and
nowhere else.
