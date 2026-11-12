# Local access (dev only)

Everything below works only against a local Docker Compose stack. Every credential on this page is a dev-only placeholder committed in [`infra/.env.example`](../infra/.env.example); none of it is a real secret, and none of it is reused anywhere else. Running the stack: [`README.md`](../README.md#run-it-locally); how it is wired: [`architecture/README.md`](architecture/README.md#local-stack).

## Ports

`scripts/stack.sh` reads `.env` when the checkout has one (your overrides and secrets such as `AWS_BEARER_TOKEN_BEDROCK`), and fills anything it leaves out from `infra/.env.example`. The defaults below are the `infra/.env.example` values; `scripts/stack.sh urls` always prints the ports of the checkout you run it in.

| Service                  | Default URL             | Variable                 |
| ------------------------ | ----------------------- | ------------------------ |
| Web app                  | http://localhost:4200   | `BF_WEB_PORT`            |
| API                      | http://localhost:3000   | `BF_API_PORT`            |
| Keycloak                 | http://localhost:8080   | `BF_KEYCLOAK_PORT`       |
| Mailpit                  | http://localhost:8025   | `BF_MAILPIT_PORT`        |
| MinIO (S3 endpoint)      | http://localhost:9000   | `BF_MINIO_PORT`          |
| Mock connector providers | http://localhost:4010   | `BF_MOCK_PROVIDERS_PORT` |
| PostgreSQL               | `127.0.0.1:5432`        | `BF_PG_PORT`             |
| API health               | `/health/ready` on 3000 | —                        |
| Generated OpenAPI        | `/api/openapi.json`     | —                        |

Every port binds to `127.0.0.1`. The MinIO console (container port 9001) is not published; use the S3 endpoint or `docker exec`.

The compose project name derives from the checkout folder, so a second clone or a worktree runs its own containers and volumes side by side. `scripts/worktree.sh new` copies `infra/.env.example` to a gitignored `.env` with its own `COMPOSE_PROJECT_NAME`, but it keeps the default ports: change the `BF_*_PORT` values there before `scripts/stack.sh up` if another stack is already using them. `COMPOSE_PROJECT_NAME=<name>` overrides the project name for a single command.

## Sign-in (Keycloak test users)

Realm `budgetflow`. The password of every seeded user is `BF_E2E_PASSWORD`, currently `Budgetflow-dev-only-1`.

One user per role, all in the Hyland tenant:

| Role                 | Username                          | Seeded person                                    |
| -------------------- | --------------------------------- | ------------------------------------------------ |
| `super-admin`        | `super.admin@example.test`        | Sam Rivera, platform operator (no tenant grants) |
| `org-admin`          | `org.admin@example.test`          | Taylor Brooks, people systems administrator      |
| `ceo`                | `ceo@example.test`                | Morgan Lee, chief executive officer              |
| `finance-admin`      | `finance.admin@example.test`      | Priya Raman, finance systems lead                |
| `finance-controller` | `finance.controller@example.test` | Daniel Weber, group financial controller         |
| `budget-owner`       | `budget.owner@example.test`       | Jordan Smith, director, United States            |
| `department-head`    | `department.head@example.test`    | Lena Fischer, director, Europe                   |
| `regional-manager`   | `regional.manager@example.test`   | Ananya Iyer, regional manager, India             |
| `location-manager`   | `location.manager@example.test`   | Rahul Menon, location manager, Bengaluru         |
| `event-organizer`    | `event.organizer@example.test`    | Kavya Rao, employee experience coordinator       |
| `employee`           | `employee@example.test`           | Arjun Das, software engineer                     |
| `auditor`            | `auditor@example.test`            | Grace Kim, internal auditor                      |
| `integration-admin`  | `integration.admin@example.test`  | Omar Haddad, integration engineer                |
| `analyst`            | `analyst@example.test`            | Mei Chen, financial analyst                      |

Users that exist for a scenario rather than a role:

| Username                          | Tenant             | Roles                  | Why it exists                                                            |
| --------------------------------- | ------------------ | ---------------------- | ------------------------------------------------------------------------ |
| `finance.admin2@example.test`     | Hyland             | `finance-admin`        | A second Finance Admin, for flows that need two different approvers      |
| `mfa.user@example.test`           | Hyland             | `finance-controller`   | Enrolled in TOTP (`BF_E2E_TOTP_SECRET`); sign-in always asks for a code  |
| `reset.user@example.test`         | Hyland             | `employee`             | The forgot-password journey, which sets the same dev-only password again |
| `globex.admin@example.test`       | Globex Corporation | `finance-admin`, `ceo` | Tenant isolation: proves one tenant never sees another's data            |
| `sandbox.admin@example.test`      | Initech Sandbox    | `finance-admin`, `ceo` | Destructive integrity checks, kept out of the Hyland tenant              |
| `sandbox.controller@example.test` | Initech Sandbox    | `finance-controller`   | Period close and year end need a preparer separate from the approver     |
| `sandbox.auditor@example.test`    | Initech Sandbox    | `auditor`              | A legal hold needs two different people who may manage holds             |

`employee@example.test` is also linked to the local stand-in for the corporate identity provider ("Hyland SSO", realm `hyland-sso`), so it can sign in either with the password or through the broker.

The users, their roles and their fixed Keycloak subjects are generated from [`libs/seed`](../libs/seed/) into the realm export in [`infra/keycloak/`](../infra/keycloak/) — change `libs/seed/src/lib/roles.ts` and regenerate, never hand-edit the export. The role-action matrix is in [`architecture/authorization.md`](architecture/authorization.md).

## Service credentials

| Service                           | Where                       | Username     | Password             |
| --------------------------------- | --------------------------- | ------------ | -------------------- |
| Keycloak admin console            | http://localhost:8080/admin | `admin`      | `kc-admin-dev-only`  |
| Mailpit (captured emails)         | http://localhost:8025       | none         | none                 |
| MinIO (S3 endpoint)               | http://localhost:9000       | `budgetflow` | `minio-dev-only`     |
| Postgres owner (migrations, seed) | `127.0.0.1:5432/budgetflow` | `bf_owner`   | `bf-owner-dev-only`  |
| Postgres app role (RLS enforced)  | `127.0.0.1:5432/budgetflow` | `bf_app`     | `bf-app-dev-only`    |
| Postgres worker role              | `127.0.0.1:5432/budgetflow` | `bf_worker`  | `bf-worker-dev-only` |

Neither `bf_app` nor `bf_worker` has `BYPASSRLS`; use them when you want to see what the API and the worker see.

## Commands

Run these from the checkout whose stack you want. Node first: `source ~/.nvm/nvm.sh && nvm use 24`.

| Purpose                                      | Command                              |
| -------------------------------------------- | ------------------------------------ |
| Build the bundles, start, wait until healthy | `scripts/stack.sh up`                |
| Load the deterministic seed (idempotent)     | `scripts/stack.sh seed`              |
| Drop this checkout's volumes, start, reseed  | `scripts/stack.sh reset`             |
| Print the URLs for this checkout             | `scripts/stack.sh urls`              |
| Compose status                               | `scripts/stack.sh status`            |
| Last 200 log lines, optionally per service   | `scripts/stack.sh logs [service...]` |
| Stop, keep volumes                           | `scripts/stack.sh down`              |

`BF_SKIP_BUILD=1` skips the host bundle build on `up` and `reset`.

The private Satori registry token lives only in `~/.npmrc` and never in this repository. Design references for the screens are in [`ux/preview.md`](ux/preview.md).
