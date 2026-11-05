# Phase 12 — Integrations and public API (backend half)

Branch `feat/p12-integrations-backend`, migration `0012_p12_integrations`. The Angular screens
(092-101a) are a separate change; this half ends at a proven API.

## What was proven, and where

| Outcome                                                                                    | Evidence                                                                                            |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 60 API scenarios pass against the running stack with the deterministic seed                | `backend/functional/api-scenarios.txt`                                                              |
| Connectors feed the actuals review and never the ledger; a posted batch is the only way in | `backend/functional/api-scenarios.txt` (`integrations/ledger-path.spec.ts`)                         |
| The same external record is never counted twice                                            | `api/integration-responses.json` (`syncRun`: 4 read, 0 applied, 4 skipped as duplicates)            |
| Inbound callbacks: HMAC, five-minute window, forged and replayed calls rejected            | `backend/functional/api-scenarios.txt` (`integrations/inbound-webhooks.spec.ts`)                    |
| An API key cannot reach another tenant, even with a forged `X-Tenant-Id`                   | `backend/functional/api-scenarios.txt` (`integrations/public-api.spec.ts`), `db/rls-p12-tables.txt` |
| Scopes, rate limit and the request log on the public API                                   | `api/integration-responses.json` (`publicMeta`, `publicEventsWithoutScope` is 403)                  |
| Outbound webhooks are signed, verified by the receiver, retried and rotated                | `backend/functional/api-scenarios.txt` (`integrations/outbound-webhooks.spec.ts`)                   |
| Every new table forces row level security with `tenant_isolation`                          | `db/rls-p12-tables.txt`                                                                             |
| Credentials are encrypted at rest; keys and tokens are stored as hashes with a prefix      | `db/rls-p12-tables.txt`                                                                             |

## How to reproduce

```sh
export COMPOSE_PROJECT_NAME=bf-p12-integrations BF_WEB_PORT=4320 BF_API_PORT=3120 \
       BF_KEYCLOAK_PORT=8200 BF_PG_PORT=5552 BF_MAILPIT_PORT=8145 BF_MINIO_PORT=9120 \
       BF_MOCK_PROVIDERS_PORT=4121
scripts/stack.sh up && scripts/stack.sh reset
npx playwright test -c apps/api-e2e/playwright.config.ts src/integrations/
```

The connectors run in Mock mode against `infra/mock-providers`, which also receives BudgetFlow's
outbound webhooks, so the whole phase runs offline and deterministically.

## Notes on the evidence

`api/integration-responses.json` holds scrubbed responses: every bearer secret is replaced with
`bf_live_<redacted>` / `bf_scim_<redacted>` before the file is written, and no credential appears in
any connector response by construction (the API never returns one).

`db/rls-p12-tables.txt` shows the thirteen new tables with row level security enabled and forced and
the `tenant_isolation` policy present, the stored credentials as AES-256-GCM ciphertext with no
plaintext, the key table holding only a 64-character hash and a short prefix, and a second tenant
seeing none of it.
