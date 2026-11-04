---
name: gate
description: Slash command /gate [lint|typecheck|build|functional-api|functional-e2e|visual|static|functional|all] - runs BudgetFlow gates through scripts/gate.sh and fixes failures.
disable-model-invocation: true
---

# /gate

Run the BudgetFlow gates in the modes given after `/gate` (default `all`) by following the `run-gates` skill (`.cursor/skills/run-gates/SKILL.md`).

- If the user wrote `/gate ... --evidence <dir>` or mentions a phase, pass `--evidence evidence/<phase-id>`.
- Fix failures that are inside the current task's scope and re-run until green; report out-of-scope or pre-existing failures instead of fixing them. Report SKIP lines as skips, not passes.
- Finish with the summary table and log paths of anything still failing.
