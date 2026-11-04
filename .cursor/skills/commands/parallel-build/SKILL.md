---
name: parallel-build
description: Slash command /parallel-build <wave-id> [scopes] - plans and runs a wave of parallel agents in separate git worktrees, then merges and validates.
disable-model-invocation: true
---

# /parallel-build

Run the wave named after `/parallel-build` by following the `parallel-worktree-build` skill (`.cursor/skills/parallel-worktree-build/SKILL.md`).

- If scopes are given (for example `api-budgets web-budgets infra`), use them as the agent split; otherwise propose one from the plan.
- Stop after writing `evidence/<wave>/wave-plan.md` and wait for the user's approval before creating worktrees or launching agents.
- Merging, validation and the PR follow the skill; finish with its report.
