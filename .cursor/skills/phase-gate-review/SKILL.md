---
name: phase-gate-review
description: Assembles a BudgetFlow phase or wave gate review (P1-P20, waves 1-7) - runs every gate, proves the phase's functionality with API scenarios and journeys (the core acceptance scenario at every wave gate from Wave 2), runs the visual QA loop for every UI screen in scope, runs reviewer subagents, fills the evidence README from the template, and reports pass or not passed with follow-ups. Use at the end of a phase or release wave, or when the user asks for an evidence pack or gate review.
disable-model-invocation: true
---

# Phase gate review

```text
- [ ] 1 Scope: phase id, plan items, screens, commit
- [ ] 2 Gates: scripts/gate.sh --evidence evidence/<phase-id>
- [ ] 3 Functional proof: /functional-check per gate item; core acceptance scenario from Wave 2
- [ ] 3b Visual QA (every UI phase): /visual-qa into evidence/<phase-id>/visual-qa
- [ ] 4 Reviews: ux-reviewer, domain-invariant-reviewer, security hand-off if relevant
- [ ] 5 README from the template, every claim linked
- [ ] 6 Result and open questions to the user
```

## 1. Scope
Phase id (`p1-arch`, `p4-budgets`, `wave-2`), the plan todos it closes, the screens (numbers) and journeys it covers, and the commit being reviewed (`git rev-parse --short HEAD`). Work on a clean tree.

## 2. Gates
`scripts/gate.sh --evidence evidence/<phase-id>`. Every mode must pass: lint (ESLint, satori-lint, `sdsc check all`), typecheck, build (OpenAPI drift, migration check), functional-api, functional-e2e, visual. If one fails, stop the review, fix it (or report it), and restart from step 2; a gate review never records a red gate as acceptable. Gates never cancel or defer scope; failures are fixed before the next phase starts.

Phase-specific gates from the plan's "Phase gates" section also apply, each proven by API scenarios or journeys, for example: P1 every invariant in `docs/testing/invariant-scenarios.md` has a passing scenario (journals balance, rebuilt balances equal cached ones) plus authorization scenarios; P4 over-allocation blocked incl. cross-currency at plan rate and concurrent allocation; P5 contribution full/partial/reject/resubmit, intercompany block/recharge, DoA limits and approval hygiene; P6 GL tie-out and close blocked by unmatched actuals (Wave 2 gate: core acceptance scenario with evidence); P10 large dataset with autocannon; P13 AI scope permission scenarios and evaluation thresholds; P17 all critical scenarios automated, performance, migration and data integrity; P19 compose up + 17-step workflow + core acceptance scenario.

## 3. Functional proof
For each gate item, run `/functional-check` (API scenarios, journeys, exploratory pass) with evidence in `evidence/<phase-id>/<item>/functional/`. From Wave 2 on, every wave gate also runs the core acceptance scenario journey (`apps/web-e2e/src/acceptance/`) end to end on the Compose stack and records its outcome table. The phase cannot pass with a failing check.

## 3b. Visual QA (required at every UI phase)
Run the `visual-qa-loop` skill for every screen in scope with `--out evidence/<phase-id>/visual-qa`: every state at desktop, tablet and mobile in light and dark, console errors, failed requests, overflow, interpolation leftovers, layout shift, and design parity against `design/stitch/`. The phase cannot pass while the last iteration's `report.json` has blocking findings. Also attach the visual regression result (Playwright HTML report and any diffs) from step 2.

## 4. Reviews
- `ux-reviewer` with the visual QA evidence folder and the phase's screen list. It opens every screenshot itself.
- `domain-invariant-reviewer` with `git diff <previous-gate-commit>...HEAD`; it re-runs the invariant scenarios.
- Auth, secrets, uploads, CI, infra, integrations or AI changed: `/security-review-handoff`.
Fix blockers, re-run steps 2-3b if code changed.

## 5. Evidence README
Fill [evidence-template.md](evidence-template.md) into `evidence/<phase-id>/README.md`. Every row links to a file in the folder or quotes a command result. Keep traces, videos and auth state in `tmp/evidence/` and link them; never commit HAR files, traces or storage state.

## 6. Result
Tell the user: passed / passed with follow-ups / not passed (what must be fixed before the next phase), the reasons, 2-4 representative screenshots embedded (before/after when the loop fixed something), open UX questions, and the follow-up list. P1 is a review stop: wait for the user's approval. Do not merge as part of this skill.
