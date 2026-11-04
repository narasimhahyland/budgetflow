---
name: visual-qa
description: Slash command /visual-qa [screens] [--out dir] [--max-iterations n] - runs the BudgetFlow visual QA loop that captures, inspects and fixes UI issues until no blocking issues remain (max 5 iterations), with an evidence report.
disable-model-invocation: true
---

# /visual-qa

Run the visual QA loop for the screens named after `/visual-qa` by following the `visual-qa-loop` skill (`.cursor/skills/visual-qa-loop/SKILL.md`) step by step.

- Screens: numbers or ids (`005`, `005-budget-allocation`); default is every screen changed on this branch (`git diff --name-only main...HEAD`, mapped through `apps/web-e2e/visual/screens.json`).
- Output folder: the `--out` value if given, else `evidence/<branch-name>/visual-qa`.
- `--max-iterations` may lower the limit, never raise it above 5.
- Never report done while the last iteration has blocking findings; report what is still blocking and why instead.
- End with the skill's report: iterations, stop reason, before/after screenshots embedded, remaining non-blocking findings, and the `ux-reviewer` verdict.
