---
name: pr-workflow
description: Takes a finished BudgetFlow change from working tree to pull request - branch naming, scoped commits, Conventional Commit messages, the PR template with gate results and evidence, pushing, and watching CI (which skips cleanly until SATORI_PACKAGES_TOKEN exists). Use when the user asks to commit, push, open or update a PR.
---

# Commit and pull request

## 1. Branch
If on `main`, create a branch first: `feat|fix|chore|docs/<short-scope>` (waves use `integrate/<wave>`). Never commit to `main` directly once the repository has its first PR.

## 2. Verify
`scripts/gate.sh` (all modes) and `/functional-check` on the final state, plus `/visual-qa` for UI changes. Keep the summary table for the PR body.

## 3. Commit
- Review `git status` and `git diff`; stage named files only (`git add <paths>`).
- One logical change per commit, functional tests (`apps/api-e2e`, `apps/web-e2e`) with the code. Messages follow Conventional Commits with the lib or app as scope:
  ```text
  feat(budgets): block allocation above parent available

  Over-allocation now returns OVER_ALLOCATION with the remaining amount so the
  allocate screen can show a hard block instead of a toast.
  ```
- The pre-commit hook and the agent guard run the secret scan; if either blocks, remove the finding. Never `--no-verify`.
- For large or mixed changes, use the built-in `/split-to-prs` skill instead of one big PR.

## 4. Push and open
```bash
git push -u origin HEAD
gh pr create --title "<conventional commit style title>" --body-file tmp/pr-body.md
```
Fill `.github/pull_request_template.md` (write the filled copy to `tmp/pr-body.md`): problem, change summary, screens touched, gate table, evidence links (relative paths under `evidence/`), the visual QA report for UI changes, a "Visual baselines updated:" reason when any `__screenshots__` file changed, risks, and checklist. Embed screenshots for UI changes.

## 5. CI
`gh pr checks --watch`. Expected behavior:
- `harness` always runs (secret scan, harness validation, hook tests, visual tooling self-test, visual-baseline reason check) and must pass.
- `static`, `functional` and `visual` skip with a notice until the repository secret `SATORI_PACKAGES_TOKEN` and the Nx workspace exist; that is not a failure. Once they exist these jobs must pass.
If a check fails, read the log (`gh run view <id> --log-failed`), fix locally, re-run the gate, push. For longer CI babysitting the built-in `/autopilot` skill can take over.

## 6. Review
Bugbot reviews with `.cursor/BUGBOT.md`. To get a local review first, use the built-in `/review-bugbot`; for security-sensitive changes, `/security-review-handoff`.

## Report
Branch, commits, PR URL, CI status, and anything the reviewer should look at first.
