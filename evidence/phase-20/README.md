# BudgetFlow Enterprise — final report

Phase 20, 11 November 2026, against `main` at `30d64422`. This closes the build plan's 20 phases.
Every figure below is derived from the repository; the evidence pack for each phase is under
`evidence/phase-NN/`.

## What was built

A multi-tenant corporate budget delegation and control platform, end to end:

- **Budgets** authorized at the top and allocated down a hierarchy, with per-head drivers, transfers,
  increases, reductions, freeze and set to zero, versions and phasing (Phases 3–4).
- **Requests and approvals** routed by a rules engine and delegation-of-authority limits, with
  delegation hygiene (no self-approval, time-boxed delegates), escalation and SLA timers (5, 7).
- **Events and co-funding** across locations through **Inter-Director Budget Contribution Requests**,
  with intercompany recharges, quotes, checklists, attendance and surveys (5, 9).
- **An accounting-grade ledger**: append-only journals over seven buckets, the currency triplet at
  locked plan rates, reversals instead of edits, periods and close, accruals, GL tie-out, forecasts,
  year-end roll-forward, and a nightly rebuild check (1, 6, 11).
- **Channels** (Slack, Teams, actionable email, mobile), **reports and dashboards** including the
  board and FP&A pack, **integrations and a public API**, an **AI layer that suggests and never
  acts**, **administration**, **extended product features** and an **ecosystem** layer (8, 10, 12–16).
- **Security work** (18): the allowed-network bypass fixed, break-glass access built, public
  development secrets refused in production, two operator reads and CSV formula injection closed,
  legal-hold reads narrowed.

| Surface                        | Size                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| API endpoints (contract)       | 479, of which 17 public (each authenticated otherwise)      |
| Database                       | 164 tables, 22 migrations, RLS forced on every tenant table |
| API libraries                  | 25 under `libs/api/`                                        |
| Web feature libraries          | 18 under `libs/web/features/`                               |
| Screens in the visual suite    | 178, in 930 baselines over three viewports                  |
| Invariants mapped to scenarios | 98 (`docs/testing/invariant-scenarios.md`)                  |

## How it is proven

The definition of done is functional proof on the running product, not unit tests.

| Proof                                               | Result                                                                          | Evidence                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| Every gate mode on `main`, fresh seed               | all pass                                                                        | `evidence/phase-19/`        |
| API scenarios over HTTP, real tokens per role       | 627 passed                                                                      | `evidence/phase-19/`        |
| User journeys, desktop, tablet, mobile              | 590 passed (170 skipped by design: data-changing journeys run once, on desktop) | `evidence/phase-19/`        |
| Core acceptance scenario, ten steps                 | all pass                                                                        | `evidence/phase-19/`        |
| Visual regression, every screen state               | 941 passed, 3 flaky (known id-wrap in AI captions)                              | `evidence/phase-19/`        |
| Every routed screen reached by a functional check   | 112 of 112                                                                      | `evidence/phase-17/` (#101) |
| Migrations from empty and from the previous release | pass, data survives                                                             | `evidence/phase-17/` (#101) |
| Performance on the seed and on 20,136 ledger lines  | all 2xx; two aggregating reads slow 3–4x, the rest flat                         | `evidence/phase-17/` (#101) |
| Ledger rebuild and audit chain at volume            | clean over 20,130 lines; chain valid                                            | `evidence/phase-17/` (#101) |
| Security review, eight checks plus secrets          | six findings, all fixed and proven                                              | `evidence/phase-18/`        |

## Decisions the user took

| Decision                                                 | What it means                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Keep the fake AI provider                                | The repository stays token-free and every AI test reproducible; no real model has been exercised |
| Purge AI conversation turns (built)                      | The retention window is a deletion, not a read filter                                            |
| Ship the twelve retention periods as provisional         | Finance and legal have not signed them off; the product says so on its own screen                |
| Read-only roles may edit a summary draft                 | Collaborative editing is the intent                                                              |
| Accessibility and dark theme deferred                    | `AGENTS.md`; not part of Phase 17                                                                |
| Isolated Testcontainers runs deferred                    | API scenarios run serially on one stack                                                          |
| Refuse to start on public development secrets            | A deployment must set five secrets; the local stack opts in                                      |
| Legal holds read only by admins, finance and the Auditor | Retention policies stay readable by every member                                                 |
| CI records no traces unless `BF_CI_TRACES=1`             | Public artifacts carry no tokens; #82 can still get a trace                                      |

## Open at the end of the build

**Waiting on the user**

- Review and merge [#101](https://github.com/narasimhahyland/budgetflow/pull/101), the Phase 17
  evidence pack (every item done or deferred).
- Add to `infra/.env.example`: `TRUSTED_PROXY_CIDRS`, the five production secrets
  (`SLACK_SIGNING_SECRET`, `TEAMS_WEBHOOK_SECRET`, `CHAT_LINK_SECRET`, `APPROVAL_LINK_SECRET`,
  `INTEGRATIONS_SECRET_KEY`) and `BF_ALLOW_DEV_SECRETS` for the local stack. The file is blocked
  to agents.
- Approve or decline the `multer` bump (a denial-of-service advisory, unreachable from the code today).

**Known defects, not blocking**

- [#82](https://github.com/narasimhahyland/budgetflow/issues/82): about one visual state per run
  renders blank and passes on retry.
- AI captions end with a query-log id whose width varies, so three tablet states can flake
  (Phase 19); the fix is to stop the id re-wrapping.
- The default board pack (016a) shows zeros because the seed closes a period without close snapshots.
- A monospace `font-family` in an inline component style escaped stylelint, which only checks `.scss`.
- The "Nadia Farouk" fallback name, deferred by agreement.
- The two aggregating reads (budget health dashboard, budget vs actual) are the first candidates for a
  read model if a real dataset needs one; no latency budget is set.

**Not built, by nature or by decision**: the demo environment (102c, a separate deployment) and the
screens listed in `docs/handoff.md` section 5.

## Where to start

[`README.md`](../../README.md) to run it; [`AGENTS.md`](../../AGENTS.md) to work in it;
[`docs/handoff.md`](../../docs/handoff.md) for the state of play and the traps that cost time to learn.
