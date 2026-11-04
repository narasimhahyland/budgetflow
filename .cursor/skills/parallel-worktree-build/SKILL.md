---
name: parallel-worktree-build
description: Fans BudgetFlow work out to parallel agents in separate git worktrees with disjoint file ownership, then merges the branches one by one into an integration branch and validates the result (gates, e2e, UX and domain review, evidence). Use when the user asks for a parallel build, a wave of screen groups, multiple agents at once, or worktree-based delivery.
disable-model-invocation: true
---

# Parallel worktree build

```text
- [ ] 0 Preconditions: shared foundations merged, main green
- [ ] 1 Wave plan with disjoint scopes (evidence/<wave>/wave-plan.md)
- [ ] 2 Integration branch + worktrees
- [ ] 3 Launch one agent per scope with a brief
- [ ] 4 Collect reports, handle shared-file requests
- [ ] 5 Merge one at a time with gates (integrator)
- [ ] 6 Integration validation + evidence
- [ ] 7 PR, cleanup
```

## 0. Preconditions
- Shared code that scopes depend on is merged first, sequentially: `libs/contracts` and the DB schema (frozen in Phase 1), `libs/domain` public API, shell, `libs/web/ui`, `libs/web/data-access`, routes skeleton. Parallel agents build against it; they do not change it (contract changes during a wave go through the integrator).
- `scripts/gate.sh` is green on the base. Record the base commit.

## 1. Plan the wave
Write `evidence/<wave>/wave-plan.md` with one row per agent: name (`<wave>-<scope>`), goal and plan section, owned globs, port for e2e (4201, 4202, ...), dependencies. Rules:
- Owned globs never overlap. Natural units: one `libs/api/<module>` per agent, one `libs/web/features/<group>` per agent, or `infra/`. Stitch design work stays with the main agent so the design system remains consistent.
- Shared files belong to the integrator and are in no agent's scope: `package.json`, `package-lock.json`, `nx.json`, `tsconfig.base.json`, `apps/*/project.json`, `apps/web/src/app/**`, `apps/api/src/app.module.ts`, `libs/contracts/**`, `libs/api/db/**`, `libs/domain/**` public API, `libs/web/ui/**`, `libs/web/data-access/**`, `apps/web-e2e/visual/screens.json`, `.cursor/**`, `.github/**`.
- Each agent owns its own functional test folders (`apps/api-e2e/src/<scope>/`, `apps/web-e2e/src/<scope>/`) and asks the integrator to add its visual baseline entries and invariant-to-scenario rows.
- Three agents is the default ceiling on one machine: each worktree runs its own `npm ci` and builds.

Show the plan to the user and wait for approval before creating worktrees.

## 2. Prepare
```bash
git switch -c integrate/<wave> <base>
scripts/worktree.sh new <wave>-<scope> --base integrate/<wave>   # once per agent; runs npm ci
```
Alternative: let Cursor create isolated worktrees (Agents Window, or subagents asked to run "each in its own worktree"); `.cursor/worktrees.json` installs dependencies. Record each branch name for step 5.

## 3. Launch
Fill [agent-brief.md](agent-brief.md) per agent and start them in parallel:
- From this chat: one subagent per scope in a single message, each told to work only inside its worktree path (or launched with worktree isolation).
- Manually: open each worktree folder in its own Cursor window, or hand the brief to a cloud agent, and paste the brief.

## 4. Collect
Each agent ends with the report format from the brief. Reject reports without a gate table. Shared-file requests go to the integrator, who lands them on `integrate/<wave>`; affected agents then run `git merge integrate/<wave>` in their worktree.

## 5. Merge (integrator)
Delegate to the `integrator` subagent, or do it yourself, in dependency order:
1. `scripts/worktree.sh check <wave>-<scope> --base integrate/<wave> '<owned glob>' ...` must pass.
2. `git merge --no-ff agent/<wave>-<scope>` on `integrate/<wave>`.
3. Wire shared pieces the scope needs (routes in `apps/web`, modules in `apps/api`).
4. `scripts/gate.sh static`. Fix integration breakage; send feature bugs back to the owner.

## 6. Integration validation
- `scripts/gate.sh --evidence evidence/<wave>` (functional-api, functional-e2e and visual across all merged scopes; the core acceptance scenario from Wave 2 on).
- `/visual-qa` for every screen the wave touched, output to `evidence/<wave>/visual-qa`.
- `ux-reviewer` on the evidence and `domain-invariant-reviewer` on `git diff <base>...integrate/<wave>`; fix blockers.
- Complete the evidence README with the `phase-gate-review` skill.

## 7. Close
Open the PR `integrate/<wave>` to `main` with `/pr-workflow`. After merge: `scripts/worktree.sh remove <wave>-<scope>` and `git branch -d agent/<wave>-<scope>` for each agent.

## Report
Wave plan link, per-agent outcome, merge order with conflicts and resolutions, gate results after each merge, evidence folder, PR link, follow-ups.
