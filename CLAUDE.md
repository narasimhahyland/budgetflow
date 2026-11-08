# BudgetFlow — Claude Code entry point

@AGENTS.md

## Where the rest of the harness is

`.cursor/` is the single source of truth for the harness. `.claude/` and `.agents/` are mirrors made of
symlinks and small adapters, so there is one copy of every rule, skill and guard. `docs/ai-harness/README.md`
is the full inventory, and `docs/ai-harness/mirrors.md` explains how the mirrors are built and what does not
cross over.

- **Rules** load from `.claude/rules/`. Each file carries the `paths` globs the Cursor rule declares and
  imports the rule body through `.claude/rule-sources/`.
- **Skills** load from `.claude/skills/`, one symlink per skill. Invoke the command skills as `/gate`,
  `/new-screen`, `/verify-ui`, `/visual-qa`, `/phase-review`, `/parallel-build`.
- **Subagents** load from `.claude/agents/`.
- **Guard hooks** are wired in `.claude/settings.json` and run the `.cursor/hooks/` guards through
  `.claude/hooks/bridge.mjs`. They block force pushes to `main`, reads of `~/.npmrc` and other credential
  stores, commits containing secrets, `drizzle-kit push`, and deletes outside the repository's worktrees.
  Do not reword a command to get around a block; report it instead.

Branching, commit messages, worktrees and pull requests follow `.cursor/rules/git-worktree-workflow.mdc`,
which is also mirrored as an always-on rule here. For the PR itself, use the `pr-workflow` skill.
