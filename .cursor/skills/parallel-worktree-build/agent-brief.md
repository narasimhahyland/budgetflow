# Agent brief template

Copy, fill every `<...>`, and give it to one agent.

```markdown
# Agent brief: <wave>-<scope>

You are one of <N> agents building wave <wave> (phase <P#>) of BudgetFlow in parallel.
Work only in the worktree <absolute path>, on branch agent/<wave>-<scope> (based on integrate/<wave> at <sha>).
Read AGENTS.md first; the project rules and skills apply.

## Goal
<screens (numbers) or behavior, and the plan phase and gate items they implement>

## You own (edit only these)
- <libs/web/features/<group>/** or libs/api/<module>/**>
- <apps/web-e2e/src/<scope>/**>

## Do not edit
package.json, package-lock.json, nx.json, tsconfig.base.json, apps/*/project.json, apps/web/src/app/**,
apps/api/src/app.module.ts, libs/contracts/**, libs/api/db/**, libs/domain/** public API, libs/web/ui/**,
libs/web/data-access/**, apps/web-e2e/visual/screens.json, .cursor/**, .github/**, and every other agent's paths.
If you need a change there, stop that part and put the exact request (file, API, reason) in your report.

## Build against
- Contracts: libs/contracts at <sha> (generated client and OpenAPI)
- Domain: libs/domain/src/index.ts; DB schema: libs/api/db at <sha>
- Shared UI and data access: libs/web/ui/src/index.ts, libs/web/data-access/src/index.ts
- Your routes or module are mounted by the integrator; export them as <group>Routes / <Module>Module.

## How to work
- One screen at a time with the add-feature-screen skill; API work with api-endpoint, db-migration, ledger-change and domain-change as they apply.
- Iterate with scripts/gate.sh static --affected; finish with /functional-check for your flows and scripts/gate.sh.
- E2E on your own port so agents do not collide:
  npx nx serve web --port=<port> (background), then
  BASE_URL=http://localhost:<port> npx nx e2e web-e2e -- --project=desktop -g "<your spec>"
- UI work: run /visual-qa with --base http://localhost:<port> and --out evidence/<wave>/<scope>/visual-qa.
- Commit on your branch with Conventional Commits; stage named files only; leave nothing uncommitted.
- Before reporting: scripts/worktree.sh check <wave>-<scope> --base integrate/<wave> '<owned glob>' ...

## Final report
1. Files changed (grouped) and commit list
2. Gate summary table and e2e result
3. Shared-file change requests (exact), including visual baseline entries to add
4. Risks and open UX questions
5. Evidence paths (visual QA report, screenshots)
```
