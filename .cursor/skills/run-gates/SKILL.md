---
name: run-gates
description: Runs BudgetFlow gates through scripts/gate.sh - lint (ESLint, satori-lint, sdsc), typecheck, build (incl. OpenAPI drift and migration check), functional-api (API scenarios on the running stack), functional-e2e (Playwright journeys) and visual (baselines in the pinned image) - and diagnoses failures. Use before handing off any change, when the user asks to verify, check the build or run the gates, or when CI is red.
---

# Run gates

## Pick the modes

| Situation | Command |
| --- | --- |
| Iterating on a change | `scripts/gate.sh static --affected` (lint, typecheck, build of affected projects) |
| Backend or domain change | `scripts/gate.sh static functional-api` |
| UI or cross-cutting change | `scripts/gate.sh` (all: static, functional-api, functional-e2e, visual) |
| Before handing off, merges, phase and wave gates | `scripts/gate.sh` with `--evidence evidence/<phase-id>` |

Modes can be combined (`scripts/gate.sh lint functional-e2e`). A secret scan always runs first. Functional and visual modes start the local stack with the deterministic seed once (`scripts/stack.sh up && reset`) and leave it running. Add `--fail-fast` to stop at the first failure, `--no-cache` to bypass the Nx cache when a result looks stale.

The gate is not the whole definition of done: features also need `/functional-check` evidence, and UI changes `/visual-qa`.

## Run it
1. The script selects Node 24 (`source ~/.nvm/nvm.sh && nvm use 24`); if it warns about the Node version, fix that first.
2. If it exits with "node_modules missing", run `npm ci`. If `npm ci` fails with 401/403 on `@hylandsoftware/*`, stop and tell the user the registry token in `~/.npmrc` is missing or expired. Never read `~/.npmrc`; `npm whoami --registry=https://npm.pkg.github.com` checks auth.
3. Read the summary table. Each failed step prints its last 40 lines; the full log is `tmp/gate/<stamp>/<step>.log`. SKIP lines say why (target not defined yet, stack files not created yet); a SKIP is not a PASS — report it.

## Fix loop
1. Fix the first failing step only, starting from the earliest error in its log (later errors are often fallout).
2. Re-run just that piece (commands in [failures.md](failures.md)), then the gate again.
3. Repeat until green, at most 5 iterations for functional failures. Never skip, disable or weaken a check, scenario, journey, lint rule or threshold to get there; if a failure is outside your scope or pre-existing, report it with the log path instead.

## Report
Paste the final summary table, name any step still failing or skipped with its log path and your diagnosis, and say which modes you ran. "Gates pass" without the table is not a report.
