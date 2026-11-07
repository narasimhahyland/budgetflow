# Phase 16 — Ecosystem (backend half)

The BI connector (092a), no-code connectors (092b), the connector for AI assistants (092c), the
partner marketplace (092d) and embeddable widgets (102d). Native app wrappers (115a) are deferred by
product decision and are not in this change.

Branch `feat/p16-ecosystem-backend`, migration `0019_p16_ecosystem`, seed prefix `93`, invariant rows 88-94.

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
- `gate-summary.txt` — `scripts/gate.sh static --affected` during the build.
- `../gate/gate-summary.txt` — `scripts/gate.sh` (all modes) on the merged branch, all 14 steps pass.

## How it was run

Local Docker Compose stack on its own shifted ports (compose project `bf-p16-ecosystem`, API 3320,
Postgres 5752, Keycloak 8400, web 4520, mock providers 4330; `bf-demo` holds the default ports) with
the deterministic seed, the fake AI provider and the mock marketplace partner. No external network
call leaves the stack: `OutboundHttp` refuses any host outside `INTEGRATIONS_ALLOWED_HOSTS`, and the
partner catalogue is served by `mock-providers`. A worktree that runs visual checks has to put its
ports in `.env`, not only in the shell: `scripts/visual/pw-docker.sh` forwards only `BASE_URL` and
`BF_E2E_*` into the container.

## CI

All five checks green on [PR #67](https://github.com/narasimhahyland/budgetflow/pull/67): preflight,
harness, static gates, functional (API scenarios and journeys on Compose) and visual regression.
`scripts/gate.sh` (all modes) passes locally in one invocation: `../gate/gate-summary.txt`.

Three things needed attention on the way there, all recorded here so the next reader does not repeat
the diagnosis:

- **The red functional job was a flaky Phase 13 journey, not this change.** Run 42309685790 attempt 1
  failed on one test only: `apps/web-e2e/src/ai/suggestions.spec.ts:241` — _Anomaly flags (017c) ›
  raises an advisory flag with evidence from the records and clears it with a reason_, on desktop.
  Re-running the same commit passed, and `functional-e2e` has since passed three times locally on
  the merged branch. The test belongs to the Phase 13 AI screens; nothing in this phase renders UI or
  posts to the ledger.
- **Six 113a baselines were re-recorded once, after merging `main`.** Phase 15 and Phase 16 each
  added AI features to the same 113a settings screen, so both branches changed the same six images
  and they could not be merged pixel-wise. The re-recorded list shows all three additions
  (`ai.leadership_summary`, `ai.variance_commentary`, `ai.mcp`). Only those six changed; the full
  `visual-light` project then passed at 628 screenshots.
- **The 113a query-log baselines look wrong in a filtered run, and are not.** They mask
  `[data-testid=log-rows]`, and the seed writes no `ai_query_log` rows — the rows come from the AI
  screens that run earlier in the same suite. Run `-g 113a` on its own and the empty state renders
  unmasked and the comparison fails. Only ever judge them from a full `visual-light` run.

`011a-ai-assistant-panel action-redirect` on **tablet** is independently nondeterministic
(issue #70, owned elsewhere): it failed once and passed on retry in one local full run, and passed
outright in the others. The diff is a vertical offset around the asynchronously loaded conversations
card. Nothing in this phase touches 011a.

## Integrating with Phase 15

Phase 15 merged to `main` while this branch was being built and took the next migration number, the
seed prefix and the invariant rows this branch had claimed. All four collisions were resolved on the
branch, not on `main`:

- **Migration `0018_p16_ecosystem` → `0019_p16_ecosystem`.** The snapshot was **regenerated** on top
  of `0018_p15_extended` rather than renamed, so it carries Phase 15's twelve tables: 164 tables
  (157 + this phase's 7), `prevId` `50d4047d-8d92-4036-b6e8-251928c504c9`. A renamed snapshot would
  have described a world without those tables and the next phase's diff would have tried to recreate
  them. The hand-written tail (FORCE RLS and `tenant_isolation` on all seven tables, the append-only
  grants and triggers on `ecosystem_calls`) was restored byte for byte; the generated DDL above it
  came out identical. `npx nx run db:db-check` passes both parts.
- **Seed prefix `92` → `93`,** which fixed a real duplicate rather than a style clash: both phases
  had claimed `92` and issued ordinals 1, 2, 3, 11 and 12, so a marketplace partner and a wallet
  programme would have shared a UUID. No `93` id exists anywhere else, and the registry in
  `docs/architecture/phase-handoff.md` now records `92` for P15, `93` for P16 and `94`+ as free.
- **Invariant rows 83-89 → 88-94** in `docs/testing/invariant-scenarios.md`.
- **The six 113a baselines**, above.

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
