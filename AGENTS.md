# BudgetFlow — agent instructions

BudgetFlow Enterprise is a multi-tenant corporate budget delegation and control platform: hierarchical allocation and delegation, approvals within delegation-of-authority limits, freeze / reduce / set-to-zero controls, cross-location events with co-funding through Inter-Director Budget Contribution Requests, a rules engine, integrations, and an accounting-grade ledger with a hash-chained audit trail.

Delivery follows the build plan: 20 gated phases in 7 release waves (P1 architecture and accounting-grade domain; P2 shell, identity, tenancy; P3 org and finance master data; P4 budgets; P5 events, co-funding, intercompany; P6 actuals and accounting; then workflow, channels, events depth, reporting, close, integrations, AI, experience, extended product, quality, security, local evidence, docs). Each phase ends at a gate (`/phase-review`). If something here disagrees with the plan or `docs/architecture/`, those win; flag the conflict.

**This repository is public.** Never commit or print secrets or tokens, and never add internal company information (wiki or ticket content, internal tool names, internal URLs, employee names).

## Stack

- Nx 23 monorepo, npm, Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`).
- Web: Angular 22 (standalone, signals, OnPush), Angular Material/CDK, `@hylandsoftware/satori-ui` (mandatory UI library), Keycloak OIDC + PKCE.
- API: NestJS, zod contracts with generated OpenAPI, pg-boss worker, transactional outbox. Data: PostgreSQL 16 with RLS, Drizzle migrations.
- Local stack: Docker Compose (Postgres, Keycloak, Mailpit, MinIO, API, worker, web) with a deterministic seed and a fake AI provider.
- Verification: Playwright for API scenarios (`apps/api-e2e`, with Testcontainers for isolated runs), user journeys and visual regression (`apps/web-e2e`), autocannon for performance; ESLint + satori-lint, stylelint, `sdsc`.

## Layout

```text
apps/web        Angular SPA                    libs/web/ui            shared Satori-based components
apps/web-e2e    journeys, acceptance, visual   libs/web/data-access   typed API access and state
apps/api        NestJS edge                    libs/web/features/*    one lib per screen group
apps/api-e2e    API scenario tests (HTTP)      libs/api/<module>      NestJS domain modules
apps/worker     jobs, outbox, nightly rebuild  libs/api/db            Drizzle schema, migrations, RLS
libs/contracts  zod, OpenAPI, typed client     libs/domain            framework-free money, ledger, DoA rules
infra/          compose, Keycloak, seed        design/stitch/         approved Stitch exports per screen
docs/           architecture, ux, testing      evidence/              per-phase evidence packs
```

Boundaries (Nx tags): web never imports API code; `libs/domain` imports no framework, database or HTTP code; `libs/contracts` depends only on zod; feature libs never import each other. Area guides: `docs/ai-harness/agents-md/` (installed next to each project by `scripts/install-agents-md.sh`).

## Commands

| Purpose            | Command                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Gates (CI parity)  | `scripts/gate.sh [lint typecheck build functional-api functional-e2e visual \| static \| functional \| all]`                 |
| Local stack + seed | `scripts/stack.sh up \| reset \| seed \| status \| logs \| urls \| down`                                                     |
| Functional proof   | `/functional-check` (API scenarios, journeys, exploratory pass, evidence)                                                    |
| Visual QA          | `/visual-qa` (capture, Stitch parity, inspect, fix, re-run); baselines `npm run e2e:visual` / `npm run e2e:update-snapshots` |
| Secret scan        | `scripts/secret-scan.sh --staged` (also the pre-commit hook)                                                                 |
| Worktrees          | `scripts/worktree.sh new \| check \| list \| remove`                                                                         |

## Golden rules

1. Stay in scope: touch only files your task owns. Shared surfaces (root configs, `libs/contracts`, `libs/api/db`, `.cursor/`, `.github/`) change only when the task says so.
2. Contract first: API shapes start in `libs/contracts` (zod), then API and web.
3. Money is integer minor units with ISO 4217 codes, carried as a currency triplet (transaction, budget, reporting) with plan rates locked per fiscal year; FX never consumes budget.
4. The ledger is append-only with buckets authorized, allocated out, held, pre-encumbered, encumbered, actual, accrued; journals balance; corrections are reversals in an open accounting period, never edits; cached balances must equal the nightly rebuild (`ledger-accounting.mdc`).
5. Legal entity on every budget and line; cross-entity contributions follow the intercompany policy. Delegation-of-authority limits govern approvals, separate from budget ownership.
6. One authorization point (`PolicyService.can`), tenant isolation by Postgres RLS, idempotency keys and ordered row locks on money mutations, one hash-chained audit entry per mutation.
7. Use the exact term "Inter-Director Budget Contribution Request": an approved, audited contribution, never uncontrolled budget sharing.
8. Satori first, Angular Material second, custom last; style only with `--mat-sys-*` / `--sat-sys-*` tokens. App copy is plain English (no app translation files); money, numbers and dates via Angular formatters. Light theme only. Deferred: dark theme (visual checks capture light only) and accessibility checks.
9. AI features suggest; people decide (`ai-features.mdc`). Never read or print `~/.npmrc` or any token; project hooks block it.

## Definition of done

- [ ] `/functional-check` passes: local stack with the deterministic seed, the feature end to end as the relevant roles, business outcomes asserted through API scenarios and UI journeys, failures fixed and re-run (max 5 iterations). Unit tests are not required.
- [ ] Invariants touched are mapped to passing scenarios in `docs/testing/invariant-scenarios.md`.
- [ ] UI changes: `/visual-qa` has no blocking findings; baselines updated only via `npm run e2e:update-snapshots` with a reason.
- [ ] `scripts/gate.sh` passes; contracts, migrations and OpenAPI committed together.
- [ ] Evidence under `evidence/<phase>/` (outcome table, screenshots, API responses, logs); final message lists files changed, gates and checks with results, risks, evidence paths.

## Harness map

- Skills (`.cursor/skills/`, invoke with `/name`): `functional-check`, `visual-qa-loop` (`/visual-qa`), `ux-verify` (`/verify-ui`), `run-gates` (`/gate`), `add-feature-screen` (`/new-screen`), `api-endpoint`, `db-migration`, `ledger-change`, `domain-change`, `integration-adapter`, `ai-feature-guardrails`, `parallel-worktree-build` (`/parallel-build`), `phase-gate-review` (`/phase-review`), `pr-workflow`, `security-review-handoff`.
- Subagents (`.cursor/agents/`): `functional-tester`, `domain-invariant-reviewer`, `ux-reviewer`, `integrator`. Bugbot: `.cursor/BUGBOT.md`. Guard hooks: `.cursor/hooks.json`. Guide: `docs/ai-harness/README.md`.

## Cursor Cloud specific instructions

- The environment comes from `.cursor/environment.json`; its install step needs the `SATORI_PACKAGES_TOKEN` secret (Cursor dashboard, Cloud Agents, Secrets). If dependencies are missing, stop and report; never vendor or bypass the private registry.
- The local stack and Testcontainers need Docker. If `docker info` fails in the cloud VM, run the static gates only and say that functional and visual checks were not run.
