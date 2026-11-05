# Wave 2 core acceptance proof (P4 + P5 + P6 merged)

- **Commit:** `e422d7f` (`e422d7f` on `origin/main` — Wave 2 core acceptance merged after Phase 5 PR #35 and Phase 6 PR #16)
- **Acceptance spec:** `apps/web-e2e/src/acceptance/wave-2-core.spec.ts` — ten named steps with API cross-checks; outcome table in `acceptance/README.md`
- **Prior merges:** Phase 5 PR #35, Phase 6 PR #16 (CI green at merge)
- **Stack:** `COMPOSE_PROJECT_NAME=bf-demo scripts/stack.sh reset` (gate re-ran `up && reset` before functional tests)
- **Demo URLs:** web http://localhost:4200 · API http://localhost:3000 · Keycloak http://localhost:8080

## Gate commands

```bash
git fetch origin && git checkout main && git merge --ff-only origin/main
COMPOSE_PROJECT_NAME=bf-demo scripts/stack.sh reset
COMPOSE_PROJECT_NAME=bf-demo scripts/gate.sh functional --evidence evidence/wave-02/
```

| Step                                                | Result | Duration |
| --------------------------------------------------- | ------ | -------- |
| secrets                                             | PASS   | 5s       |
| stack (up + reset + seed)                           | PASS   | 48s      |
| functional-api (all `apps/api-e2e` scenarios)       | PASS   | 79s      |
| functional-e2e (desktop + tablet + mobile journeys) | PASS   | 91s      |

Playwright reports: `dist/.playwright/apps/api-e2e/report`, `dist/.playwright/apps/web-e2e/report`  
Latest gate summary: `gate-summary.txt` (logs under `tmp/gate/20261105-114549/`)

## Core acceptance journey (Wave 2)

| Step | Outcome                                    | Proven in                               |
| ---- | ------------------------------------------ | --------------------------------------- |
| 1    | USD plan tie-out                           | `acceptance/wave-2-core.spec.ts` Step 1 |
| 2    | Hierarchy + per-head                       | Step 2                                  |
| 3    | Cross-location event funding               | Step 3 (desktop)                        |
| 4    | Inter-Director Budget Contribution Request | Step 4 (desktop)                        |
| 5    | DoA approval                               | Step 5 (desktop)                        |
| 6    | Freeze / set-to-zero on requests           | Step 6 (desktop)                        |
| 7    | Actuals import / matching                  | Step 7                                  |
| 8    | Event reconciliation (close blocked)       | Step 8                                  |
| 9    | GL tie-out                                 | Step 9                                  |
| 10   | Utilization / ledger roll-up               | Step 10                                 |

Focused run:

```bash
npx nx run web-e2e:functional-e2e -- --grep "Wave 2 core acceptance"
```

## Supplementary coverage (full functional gate)

| Outcome                              | Primary API proof                    | UI journey (if any)         |
| ------------------------------------ | ------------------------------------ | --------------------------- |
| Per-head grid allocation             | `budgets/per-head-grid.spec.ts`      | `budgets/budgets.spec.ts`   |
| Cross-entity contribution / recharge | `contributions/intercompany.spec.ts` | (API-only)                  |
| Event close happy path               | `actuals/event-close.spec.ts`        | —                           |
| GL sign-off (mutating)               | `actuals/tieout.spec.ts`             | `accounting/tieout.spec.ts` |
| Ledger rebuild = cached balances     | `ledger/rebuild-check.spec.ts`       | —                           |

## Gaps and risks

1. **Acceptance journey not on `main` yet** — spec and evidence updates are local until committed; merge before CI wave gates depend on them.
2. **Step 8 proves close blocked, not full close** — happy-path event close remains API-only (`actuals/event-close.spec.ts`).
3. **Visual regression** — `npm run e2e:visual` green (239/239) when Playwright Docker targets the same stack as functional tests (see `gate-steps-summary.txt`). Formal `/visual-qa` loop not run in this pass.
4. **Single Compose project on default ports** — `bf-demo` occupies `4200`/`3000`/`9000`; this checkout’s gate used alternate ports or `COMPOSE_PROJECT_NAME=bf-demo` per run. CI is unaffected.

## Local acceptance verdict

**Safe to commit** the acceptance spec and evidence after review: static gate green, functional-api and functional-e2e green on the seeded stack (including `wave-2-core.spec.ts`), visual baselines unchanged (no baseline updates required). **Blockers for a one-shot local `scripts/gate.sh all`:** stop conflicting stacks or use a full gitignored `.env` with non-default `BF_*` ports before visual. Formal `/phase-review` still needs reviewer subagents per the phase-gate skill.
