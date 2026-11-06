# Phase 16 — Ecosystem (backend half)

The BI connector (092a), no-code connectors (092b), the connector for AI assistants (092c), the
partner marketplace (092d) and embeddable widgets (102d). Native app wrappers (115a) are deferred by
product decision and are not in this change.

Branch `feat/p16-ecosystem-backend`, migration `0018_p16_ecosystem`, seed prefix `92`.

## Outcome

| Surface                            | Proven on the running stack                                                                                                                                                                      | Result |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| BI connector (092a)                | Datasets and field reference, per-tenant switch, connect needs `report.read`, feed scoped to the connecting person, stable order, grant check, 8-per-day refresh limit, revocation, forged token | pass   |
| Connector for AI assistants (092c) | Read-only tool list, app allow-list, consent audited, cross-tenant lookup answers neutrally, owner sees own subtree only, minimization, one `ai_query_log` row per call, invented tool refused   | pass   |
| No-code connectors (092b)          | Zapier allowed and the rest not, platform refusal, balance read scoped, ungranted action refused, draft stays a Draft with one audit entry, idempotent replay, revocation                        | pass   |
| Partner marketplace (092d)         | Vendor controls before enablement, blocked vendor refused, browse limited to enabled partners, deterministic order, filters, booking is a quote, budget untouched                                | pass   |
| Embeddable widgets (102d)          | Exact-origin policy, wildcard refused, identity from the token only, unlisted host refused and recorded, cross-tenant widget not found, amounts hidden, paused widget                            | pass   |

44 scenarios in `apps/api-e2e/src/ecosystem/`, all passing: `functional/api-scenarios.txt`.
Full API suite on the same stack from a fresh deterministic seed: **551 passing, 0 failing**. One
Phase 13 assertion that hard-coded the number of AI features now reads `AI_FEATURES.length`, since
this phase adds `mcp`; that is the only existing scenario this change touches.

## The guardrails are not vacuous

Each guardrail was weakened in the source, the API rebuilt and redeployed, and the matching scenario
confirmed to fail; the source was then restored and the suite re-run green.

| Weakening                                                                      | Scenarios that failed                                                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `WidgetsService` always accepts the host origin                                | "the host site must be on the list", "a paused widget renders nothing, and the blocked sites are reported back"                             |
| `ECOSYSTEM_LIMITS.biRefreshesPerDay` raised from 8 to 500                      | "the ninth refresh in a day is refused", "the Integration Admin sees the datasets and their field reference"                                |
| `EcosystemScopedReads.budgets` returns rows without the `PolicyService` filter | "an owner sees their own subtree and not a budget belonging to someone else", "a copied snippet cannot name a tenant, a person or a budget" |
| The automation draft command changed to `submit: true`                         | "a draft it creates stays a draft, is labelled, and writes one audit entry"                                                                 |

Removing the `PolicyService` row filter does **not** break the cross-tenant scenarios, which is the
expected layering: tenant isolation is row level security, and the policy filter is what keeps a
person inside their own scope within their tenant. Both layers are proven separately.

## Evidence

- `functional/api-scenarios.txt` — the 44 ecosystem scenarios with their names and timings.
- `api/connector-views.json` — scrubbed responses for the five connector views and the offer list
  (connection tokens redacted; none are issued by these reads).
- `db/rls.txt` — `ENABLE` and `FORCE ROW LEVEL SECURITY` plus a `tenant_isolation` policy on all
  seven new tables, and the append-only triggers on `ecosystem_calls`.
- `gate-summary.txt` — `scripts/gate.sh static --affected`.

## How it was run

Local Docker Compose stack on its own ports (compose project `bf-p16`, API 3260, Postgres 5692,
Keycloak 8340, mock providers 4260) with the deterministic seed, the fake AI provider and the mock
marketplace partner. No external network call leaves the stack: `OutboundHttp` refuses any host
outside `INTEGRATIONS_ALLOWED_HOSTS`, and the partner catalogue is served by `mock-providers`.

## Risks and follow-ups

- **Automation trigger delivery is not built.** The Phase 12 fan-out builds one payload per
  tenant-wide endpoint; delivering those to a personal automation would hand the platform records the
  connected person may not see. The trigger catalogue is published with `deliveryAvailable: false`
  until the fan-out learns per-person scoping.
- The `/embed/*` Angular routes that serve the widget frame are the frontend's half; the API already
  computes the `frame-ancestors` value and returns it on the content response.
- `libs/api/ecosystem/tsconfig.json` does not set `noPropertyAccessFromIndexSignature`, because the
  Phase 12 integrations library it depends on does not compile under it. Tightening that flag means
  changing four accessor lines in `libs/api/integrations/src/lib/sync.service.ts`.
