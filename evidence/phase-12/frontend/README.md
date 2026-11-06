# Phase 12 — Integrations and public API (frontend half)

Branch `feat/p12-integrations-ui`, on the merged Phase 12 API (migration `0013_p12_integrations`).
No contract, schema or API change: every screen reads the endpoints the backend half shipped.

## Screens delivered

| Screen                        | Route                                 | States                                                                                                                                  |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 092 connector hub             | `/admin/integrations`                 | default, connect form, needs-attention banner, paused, empty, read-only, forbidden, loading, error                                      |
| 092 connector frame (093-097) | `/admin/integrations/connections/:id` | overview, connection, mappings, sync, push, logs, degraded, paused, disconnect confirm, read-only, loading, error                       |
| 094a Adaptive Planning        | same frame, Plan import tab           | credentials refused, preview, blocked by a floor, new money needs the CEO, unmapped levels, read-only                                   |
| 098 identity and SCIM         | `/admin/integrations/identity`        | default, no live token, token shown once, revoke confirm, refused operations, empty log, read-only                                      |
| 099 sync status               | `/admin/integrations/sync`            | default, run detail, failed run, partly succeeded, empty, loading, error                                                                |
| 099a cross-source duplicates  | `/finance/actuals/duplicates`         | open queue, comparison, keep one, keep both, already-matched reversal warning, decided, empty, read-only                                |
| 099b pushes                   | `/admin/integrations/pushes`          | event codes, card limits, card-limit push on/off, failed pushes, empty                                                                  |
| 100 errors and retries        | `/admin/integrations/errors`          | retrying, dead letter, discarded, payload drawer, discard with reason, empty, read-only                                                 |
| 101 API keys                  | `/admin/integrations/api-keys`        | list, create form, key shown once, rotate, revoke confirm, usage, empty, read-only                                                      |
| 101 webhooks                  | `/admin/integrations/webhooks`        | endpoints, add endpoint, signing secret shown once, failing, disabled, test ping, deliveries, payload, remove confirm, empty, read-only |

Out of scope and why: 092a (BI connector) and 092c (AI assistant connector) are **Phase 16** screens and
have no provider in `INTEGRATION_PROVIDERS` or endpoint in `integrations.ts`; 101a (developer docs and
sandbox) and 094b (finance and payroll exports) have no backing endpoints in this phase.

## What was proven, and where

| Outcome                                                                                      | Evidence                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 13 journeys pass as the roles that use these screens                                         | `functional/journeys.txt`                                                                                                                       |
| A connector that is not working is named on the hub, in its frame, and on its plan import    | `functional/journeys.txt`, `visual-qa/094a-adaptive-planning--plan-import--desktop.png`                                                         |
| A stored credential never reaches the page; only "stored, encrypted, last set by"            | `functional/api-responses.json` (`credential` is `secretRef` + `setAt` + `setByName`), `visual-qa/092-connector-frame--connection--desktop.png` |
| Replacing a credential clears the field and never echoes the value back                      | `functional/journeys.txt` (credentials 092 Connection tab)                                                                                      |
| Repeating a sync applies nothing twice, and the counts separate "already seen" from "failed" | `functional/journeys.txt` (running a sync)                                                                                                      |
| An API key and a SCIM token are shown once, then only by prefix, and not after a reload      | `functional/journeys.txt`, `functional/api-responses.json` (`prefix` only)                                                                      |
| Revoking a key states the consequence and needs the name typed                               | `functional/journeys.txt`, `visual-qa/101-api-keys--create-form--desktop.png`                                                                   |
| A role without integration permissions is refused in place, and the API refuses it too       | `functional/journeys.txt`, `visual-qa/092-integrations-hub--forbidden--desktop.png`                                                             |
| An auditor reads everything and is offered no action                                         | `functional/journeys.txt` (who may do what)                                                                                                     |
| A duplicate is resolved without deleting a line, with the consequence stated first           | `functional/journeys.txt`, `visual-qa/099a-cross-source-duplicates--default--desktop.png`                                                       |
| 60 visual baselines at desktop, tablet and mobile; stable across a reseed                    | `apps/web-e2e/src/__screenshots__/visual-light/`                                                                                                |
| Static gate green on the affected projects                                                   | `gate-summary.txt`                                                                                                                              |

## How to reproduce

```sh
export COMPOSE_PROJECT_NAME=bf-p12-ui BF_WEB_PORT=4350 BF_API_PORT=3150 \
       BF_KEYCLOAK_PORT=8230 BF_PG_PORT=5582 BF_MAILPIT_PORT=8175 BF_MINIO_PORT=9150 \
       BF_MOCK_PROVIDERS_PORT=4151
scripts/stack.sh up && scripts/stack.sh reset
npx playwright test -c apps/web-e2e/playwright.config.ts --project=setup
npx playwright test -c apps/web-e2e/playwright.config.ts --project=desktop \
  --grep "connector hub|credentials \(092|running a sync|API keys \(101|webhooks \(101|identity and SCIM|cross-source duplicates|who may do what"
BASE_URL=http://localhost:4350 npm run e2e:visual -- --grep "092-|093-hr-connector|094a-|096-card|098-identity|099-sync|099a-|099b-|100-integration|101-"
```

## Keeping the checks deterministic

The gate runs the API scenarios, then the journeys, then reseeds and runs the baselines. Three findings
came from CI and were reproduced locally by running `apps/api-e2e/src/integrations` first:

- The API scenarios repair the seeded planning connector and break the ERP one, so "the connector that
  is not working" is a different connector there. The journey now breaks the planning connector itself
  (replace the credential with the placeholder the mock provider rejects, then test the connection) and
  asserts on the failure it caused.
- The duplicates journey now imports its own card and expense line and decides that pair. Deciding the
  seeded duplicate excluded a line on `6140 / CC-IN-HYD-210`, which is the account the GL tie-out
  journey reads, so it broke that journey at the viewports that happened to run after it.
- An API key's prefix is generated per seed run, so its glyphs sized the key column and moved every
  column after it. `.bf-key-prefix` gives the prefix a fixed box; the baselines then survive a reseed
  with a different prefix (verified by capturing, reseeding and re-running the comparison).
- `101-webhooks` `default` was removed as a baseline state, and its three images deleted: the delivery
  log and the endpoints' "Last delivery" column reflect whatever ran before the capture, so the state
  has no stable pixels. The screen keeps its `add-endpoint` baseline, and the delivery log stays
  covered by the webhook journeys.

## Notes

- `functional/api-responses.json` is the read side of the screens as the API returns it. No credential,
  key or token appears in it, by construction: the API has only a hash or a reference to give back.
- Everything in it is the deterministic seed's fictional data; the connectors run in Mock mode against
  `infra/mock-providers`, so the whole phase runs offline.
- Exploration traces, auth state and Playwright reports stay in `tmp/` and `dist/.playwright/`.

## Open follow-ups

- The Admin > Integrations navigation entry still requires `integration.manage`, so a Finance Admin,
  Finance Controller, CEO or Auditor — all of whom hold `integration.read` and can open every screen
  by link — do not see it in the sidebar. Changing it touches `libs/web/shell` navigation and would
  move pixels on screens captured as those roles, so it is left for a change that owns the nav.
- The connector frame's breadcrumb reads "Connector" rather than the connector's name; a dynamic
  route title needs a resolver.
- 094a can preview the differences between a planning version and the root budgets but cannot apply
  them: the contract has `previewPlanImport` and no apply endpoint. The screen says so and points at
  the budget plan import, where the plan version is approved.
