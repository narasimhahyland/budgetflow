# Harness mirrors for Claude Code and the agents convention

`.cursor/` is the source of truth. `.claude/` and `.agents/` are mirrors so that Claude Code and the tools
that follow the [Agent Skills](https://agentskills.io) convention get the same skills, rules, subagents and
guard hooks. Every mirrored file is a symlink or a small adapter: there is one copy of each rule body, skill
and guard, so the three directories cannot drift apart.

`sh scripts/validate-harness.sh` fails when a rule, skill or subagent exists in `.cursor/` without its
mirror, so adding one to `.cursor/` tells you exactly what to add here.

## What maps to what

| Piece     | `.cursor/`                        | `.claude/`                                                       | `.agents/`                 |
| --------- | --------------------------------- | ---------------------------------------------------------------- | -------------------------- |
| Skills    | `skills/<name>/SKILL.md`          | `skills/<name>` → symlink                                        | `skills/<name>` → symlink  |
| Commands  | `skills/commands/<name>/SKILL.md` | `skills/<name>` → symlink (flattened)                            | `skills/<name>` → symlink  |
| Rules     | `rules/<name>.mdc`                | `rules/<name>.md` (`paths` + import of `rule-sources/<name>.md`) | not part of the convention |
| Subagents | `agents/<name>.md`                | `agents/<name>.md` → symlink                                     | not part of the convention |
| Hooks     | `hooks.json`, `hooks/*.mjs`       | `settings.json` + `hooks/bridge.mjs`                             | not part of the convention |
| Guidance  | —                                 | `CLAUDE.md` (imports `AGENTS.md`)                                | `AGENTS.md` at the root    |

### Skills

Cursor, Claude Code and the Agent Skills convention all read `<dir>/<name>/SKILL.md` with `name` and
`description` frontmatter, and all three honour `disable-model-invocation`, so a symlink per skill is enough.
Claude Code and the convention expect one level of nesting, so the six command skills under
`.cursor/skills/commands/` are linked at the top level of each mirror; their folder names are already unique
across the harness.

### Rules

Claude Code reads `.claude/rules/*.md`. A rule with no `paths` frontmatter loads at session start, and one
with `paths` loads when Claude touches a matching file, which is what Cursor's `alwaysApply` and `globs` mean.
Each mirror file carries the converted globs and pulls the body in with an `@` import, so the text lives only
in `.cursor/rules/`.

The import needs a `.md` target, so `.claude/rule-sources/<name>.md` is a symlink to the `.mdc` file. Those
shims sit outside `.claude/rules/` on purpose: anything under `rules/` is itself discovered as a rule and
would load unscoped.

Two deviations:

- `git-worktree-workflow.mdc` has no globs. Cursor offers it to the model by description; Claude Code has no
  equivalent, so the mirror loads it at session start. It is 29 lines, and over-applying it is harmless.
- Cursor globs ending in `/**` are written as `/**/*`, the form Claude Code documents for "every file under
  this directory".

### Subagents

`name`, `description` and `model: inherit` mean the same thing in both tools, so three of the four subagents
are symlinks. `ux-reviewer` is the exception: Cursor says `readonly: true`, a field Claude Code ignores
without warning, which would quietly give the reviewer write tools. Its mirror is therefore a real file that
states the equivalent `tools` list and points at the shared brief.

### Hooks

`.claude/settings.json` wires Claude Code's events to `.claude/hooks/bridge.mjs`, which translates the payload,
runs the matching `.cursor/hooks/` guard as a child process, and translates the verdict back. The guard logic
is not duplicated. `sh .claude/hooks/test-bridge.sh` exercises every guard through the bridge with real
Claude Code payloads.

| Cursor event           | Claude Code event and matcher                          | Guard          |
| ---------------------- | ------------------------------------------------------ | -------------- |
| `beforeShellExecution` | `PreToolUse` / `Bash`                                  | `guard-shell`  |
| `beforeReadFile`       | `PreToolUse` / `Read`                                  | `guard-read`   |
| `preToolUse`           | `PreToolUse` / `Grep\|Glob\|Write\|Edit\|NotebookEdit` | `guard-tool`   |
| `beforeSubmitPrompt`   | `UserPromptSubmit`                                     | `guard-prompt` |
| `afterFileEdit`        | `PostToolUse` / `Write\|Edit\|NotebookEdit`            | `format`       |
| `stop`                 | `Stop`                                                 | `stop-summary` |

Differences worth knowing:

- Cursor's `beforeReadFile` is handed the file content. Claude Code's `PreToolUse` for `Read` is handed only
  the path, so the bridge reads the file itself (up to 5 MB, skipping `node_modules`) before running the
  secret scan. The outcome is the same: a file that looks like it holds a credential is denied before the
  model sees it.
- A Cursor `allow` verdict becomes no output rather than `permissionDecision: allow`. In Claude Code `allow`
  skips the permission prompt entirely, so mapping it directly would have auto-approved every command.
- Claude Code has no `Delete` tool, so the `Delete` branch of `guard-tool` never fires there. Deletions go
  through `Bash`, where `guard-shell` already blocks `rm` and `find -delete` outside the repository and its
  worktrees.
- Files you attach to a prompt with `@` are inserted without a tool call, so no `Read` guard runs on them.
  This is a documented Claude Code behaviour, not something the bridge can close.
- Claude Code reads hooks from `.claude/settings.json` only in a trusted workspace, the same condition Cursor
  puts on project hooks.

## `.agents/`

`.agents/skills/` is a real convention: it is where the `skills` CLI installs for Cursor, Codex, Gemini CLI,
GitHub Copilot, Amp, OpenCode and others, and the Agent Skills specification lists it as a discovery location.
There is no `.agents/rules/`, `.agents/agents/` or `.agents/hooks.json` in that convention, so this mirror
holds skills only. The instruction file those tools read is the repository's existing root `AGENTS.md`; it is
not copied.

## Rebuilding a mirror

The skill and subagent links were created with `npx skills add ./.cursor/skills --full-depth --skill '*' -a claude-code -a universal`
for the layout, then repointed at `.cursor/` so nothing is copied. To add a skill, rule or subagent by hand:

```sh
ln -s ../../.cursor/skills/<name> .claude/skills/<name>
ln -s ../../.cursor/skills/<name> .agents/skills/<name>
ln -s ../../.cursor/agents/<name>.md .claude/agents/<name>.md
ln -s ../../.cursor/rules/<name>.mdc .claude/rule-sources/<name>.md
```

A rule also needs `.claude/rules/<name>.md` holding the `paths` list and `@../rule-sources/<name>.md`.
