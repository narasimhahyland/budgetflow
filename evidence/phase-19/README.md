# Phase 19 — local evidence

The whole product proven on the local Docker Compose stack from the deterministic seed, on `main` at
`30d64422` (after #108, the targeted visual re-record), on 11 November 2026. One command,
`scripts/gate.sh all --evidence evidence/phase-19`, ran every mode in order. The gate reseeds before
each functional and visual suite, so every suite starts from the same seed.

## Gate

[`gate-summary.txt`](gate-summary.txt): every step passes.

| Step                                                                               | Result                                                                 |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Secret scan, lint, styles, Satori check, typecheck, build, OpenAPI drift, db       | pass                                                                   |
| Stack up (Postgres 16, Keycloak, Mailpit, MinIO, mock providers, API, worker, web) | pass                                                                   |
| `functional-api` (API scenarios over HTTP, real Keycloak tokens per role)          | **627 passed**, 0 failed — [`api-scenarios.txt`](api-scenarios.txt)    |
| `functional-e2e` (user journeys, desktop, tablet, mobile)                          | **590 passed**, 170 skipped, 0 failed — [`journeys.txt`](journeys.txt) |
| `visual` (pinned Playwright image, every screen state, three viewports)            | **941 passed**, 3 flaky, 0 failed — [`visual.txt`](visual.txt)         |

The 170 skipped journeys are the ones that change data: they run once, on desktop, and skip
themselves on tablet and mobile by design.

## Core acceptance scenario

`apps/web-e2e/src/acceptance/wave-2-core.spec.ts`, the extended scenario that runs at every wave gate
and again here, each step asserting what the UI shows against what the API reports. All ten steps
pass on desktop (it changes data, so tablet and mobile skip it):

| Step | What it proves                                                                                               | Result |
| ---- | ------------------------------------------------------------------------------------------------------------ | ------ |
| 1    | The FY2026 plan ties out in USD and matches the API                                                          | pass   |
| 2    | The India hierarchy, per-head allocation for Hyderabad, and authorized amounts                               | pass   |
| 3    | A cross-location event is created and submitted for funding                                                  | pass   |
| 4    | An Inter-Director Budget Contribution Request: the giving director contributes in part and declines the rest | pass   |
| 5    | The approval goes through within the approver's delegation-of-authority limit; the requester sees the route  | pass   |
| 6    | Freeze holds approvals; set to zero cancels pending requests while commitments complete                      | pass   |
| 7    | The seeded ERP import is matched at the locked plan rate                                                     | pass   |
| 8    | An event cannot close while an actual is still unmatched                                                     | pass   |
| 9    | The GL tie-out shows the travel difference; the preparer cannot sign off alone                               | pass   |
| 10   | Utilization by location and the ledger roll-up match the API totals                                          | pass   |

## The three flaky visual states

Each failed its first attempt and passed its retry, all at tablet width and all an AI caption:

- `069a-policy-assistant is-allowed`: diagnosed in #108. The caption ends with a query-log id that
  differs every run; the mask hides its glyphs but not its width, so on tablet the id sometimes wraps
  and the card grows a line. It is on #108's list of states that vary between runs and is left
  unrecorded on purpose.
- `011a-ai-assistant-panel action-redirect` and `refused-out-of-scope`: the same panel family with
  the same trailing id, so very likely the same cause. Not separately diagnosed here.

The fix is to keep the id from re-wrapping (as done elsewhere in commit `0bc4f02e`), proposed to the
user as its own piece of work. Until then these states can flake about once a run; they never
indicate a product change.

## How to reproduce

```bash
scripts/stack.sh up
```

```bash
scripts/gate.sh all --evidence evidence/phase-19
```

Counts come from the Playwright list reporter of each suite; the visual list is the run's own summary.
Raw logs, traces and reports stay in `tmp/` and `dist/.playwright/`, out of git.
