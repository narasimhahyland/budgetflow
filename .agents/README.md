# `.agents/`

`.agents/skills/` is the shared skills location of the [Agent Skills](https://agentskills.io) convention, read
by Codex, Gemini CLI, GitHub Copilot, Amp, OpenCode, Cursor and others. Each entry is a symlink to the skill
in `.cursor/`, which is the source of truth.

The convention has no directory for rules, subagents or hooks; the instruction file it defines is the
repository's root `AGENTS.md`. See `docs/ai-harness/mirrors.md` for the full mapping and
`docs/ai-harness/README.md` for the harness inventory.
