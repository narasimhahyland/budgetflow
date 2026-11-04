---
name: visual-qa-loop
description: Runs the BudgetFlow visual QA loop that sees and fixes the UI - captures every screen state at desktop, tablet and mobile in the light theme (dark theme deferred), collects console errors, failed requests, overflow, interpolation leftovers and layout shift, compares with the approved Stitch design, opens and inspects every screenshot, fixes issues in code, and re-runs until no blocking issues remain (max 5 iterations), then writes an evidence report with before/after screenshots. Use after any UI change, for /visual-qa, and at every UI phase gate.
---

# Visual QA loop

Rule: `.cursor/rules/testing-visual.mdc`. Never report a screen done while the last iteration has blocking findings.

```text
- [ ] 1 Scope: screens, states, roles, approved designs, output folder
- [ ] 2 Prepare: stack + seed, sign-in state, tools
- [ ] 3 Iterate (max 5): capture -> parity -> inspect every image -> stop or fix
- [ ] 4 Exploratory click-through
- [ ] 5 Visual regression baselines
- [ ] 6 Evidence report and ux-reviewer hand-off
```

## 1. Scope

- Screens by id (`005-budget-allocation`) from `apps/web-e2e/visual/screens.json`; every meaningful state (default, empty, loading, error, forbidden, blocked, dialogs, warnings) must have an entry. Add missing states first (owned by the screen's task, or ask the integrator).
- Approved designs in `design/stitch/<id>/`. A screen without an approved design is checked against the screen spec (`docs/ux/screens/`) and the rules only; say so in the report.
- Output: `evidence/<phase-or-branch>/visual-qa/` (call it `<out>`).

## 2. Prepare

```bash
scripts/stack.sh up && scripts/stack.sh reset                                    # deterministic seed
npx playwright test -c apps/web-e2e/playwright.config.ts --project=setup        # tmp/e2e-auth/<role>.json per Keycloak test user
```

Playwright comes from the workspace; without it run `sh scripts/visual/setup-tools.sh --with-browser`.

## 3. Iterate (n = 1..5)

1. Capture: `node scripts/visual/capture.mjs --screens apps/web-e2e/visual/screens.json --only <ids> --out <out>/iter-<n>`
2. Parity: `node scripts/visual/design-parity.mjs --captures <out>/iter-<n> --only <ids>`
3. Inspect — open `<out>/iter-<n>/report.md`, then open **every** screenshot and every `design-parity/*.side-by-side.png` with the Read tool. Do not sample. Check:
   - parity with the approved design: layout, hierarchy, spacing, component choice, copy, iconography; the diff ratio is only a pointer;
   - budget-safety visual rules (`.cursor/rules/frontend-angular.mdc`): allocated vs available, held / pre-encumbered vs encumbered vs actual vs accrued, current vs forecast, soft warning vs hard block, frozen vs zero, pending vs approved, budget vs reporting currency with FX separate; set-to-zero dialog content;
   - states render correctly and look different where they must; numbers are plausible for the seed;
   - Satori compliance: Satori components, tokens only, no foreign UI kits or icon sets; light theme only (dark theme deferred);
   - responsive: nothing clipped, overlapping or cut off; tables and splitters degrade sensibly on tablet and mobile;
   - money shows currency code and tabular numerals; product terms are exact.
     Write `<out>/iter-<n>/inspection.md`: one row per finding (screen, state, viewport, theme, severity, what is wrong, screenshot path).
4. Blocking = every automated blocking finding in `report.json` (console or page error, failed request, overflow, interpolation, layout shift > 0.25, missing sign-in, timeout) **plus** every inspection finding a user would notice that breaks the approved design, a budget-safety rule, readability, or shows wrong numbers or states.
5. Stop when an iteration has zero blocking findings. Also stop (and report, not done) after iteration 5, or when a blocker needs a decision outside your scope (design change, backend bug, missing seed data) — say exactly what is needed.
6. Fix in code within scope (templates, component styles with `--mat-sys-*` / `--sat-sys-*` tokens, layout), never by masking, loosening thresholds or removing states. Before fixing, copy the affected screenshot to `<out>/before-after/<name>--before.png`; after the next capture copy the new one to `--after.png`. Then run the next iteration for all states of the affected screens.

## 4. Exploratory click-through

With the Playwright MCP or browser tools, sign in as the screen's role and click through its flows (menus, dialogs, tabs, filters, pagination, the primary financial action up to confirmation). Note anything broken, unreachable or inconsistent with the captures in `<out>/exploratory.md`; blocking issues go back into the loop.

## 5. Visual regression baselines

If the screen changed intentionally, regenerate its baselines in the pinned image: `npm run e2e:update-snapshots`, then confirm with `npm run e2e:visual`. The PR needs "Visual baselines updated: <reason>". Never update baselines to hide an unintended change.

## 6. Report

Write `<out>/report.md`:

```markdown
# Visual QA — <screens>

| Iteration                            | Captures        | Automated blocking   | Inspection blocking | Fixed |
| ------------------------------------ | --------------- | -------------------- | ------------------- | ----- |
| - Stop reason: <no blocking findings | iteration limit | needs decision: ...> |

- Fixes (before/after): before-after/<name>--before.png -> --after.png, one line each
- Remaining non-blocking findings: <list>
- Design parity: iter-<n>/design-parity/design-parity.md
- Exploratory: exploratory.md
- Baselines: <updated with reason | unchanged>
```

Then give `<out>` and the screen list to the `ux-reviewer` subagent and include its verdict. Final message: embed 2-4 before/after or representative screenshots, the stop reason, and the evidence path.
