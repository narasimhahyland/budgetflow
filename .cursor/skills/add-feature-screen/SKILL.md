---
name: add-feature-screen
description: Builds a new or reworked BudgetFlow screen end to end from its approved Stitch design - route in its feature lib, Satori components, data-access on the generated contracts client, plain-English copy, all states (loading, empty, error, forbidden, blocked, success), budget-safety visuals, responsive layout, a Playwright user journey proving the flow on the local stack, visual baselines and the visual QA loop. Use when adding a page, screen, dialog, wizard step or tab from the screen inventory.
---

# Add a feature screen

Copy this checklist into your working notes and tick it off:

```text
- [ ] 1 Spec: screen number, phase, roles, data, actions, states; approved Stitch design present
- [ ] 2 Place: feature lib, route, owned files
- [ ] 3 Components: Satori mapping chosen
- [ ] 4 Build: component, data-access, copy
- [ ] 5 States and budget-safety visuals
- [ ] 6 Functional: journey in apps/web-e2e + /functional-check
- [ ] 7 Visual: baseline entries + /visual-qa until no blocking issues
- [ ] 8 Gates: scripts/gate.sh
```

## 1. Spec (write it down before coding)
Read the screen's spec `docs/ux/screens/NNN-slug.md` and the approved design in `design/stitch/NNN-slug/`. A screen whose group is not approved yet is not built (ask the user). Note: the plan phase it ships in, roles that can see it (and what each can do), data shown, actions and the API commands behind them, validation (hard block vs soft warning), and every state. If the spec is silent on something, choose the simplest behavior consistent with `.cursor/rules/domain-invariants.mdc` and list it as an open UX question.

## 2. Place
- One feature lib per screen group: `libs/web/features/<group>` (mapping in the screen inventory under `docs/ux/`). Feature libs never import each other.
- Add the route to the lib's exported `Routes` with a plain-English title and the permission it needs (resolved from the API, never role names). Only touch `apps/web` routes if the lib is new (shared-file change; call it out).
- Owned files: the new component folder, the lib's routes file, the journey spec for this flow, and this screen's entries in `apps/web-e2e/visual/screens.json`. Anything else is out of scope unless the task says so.

## 3. Components
Pick from the mapping in `.cursor/rules/frontend-satori-styling.mdc`; check inputs in `node_modules/@hylandsoftware/satori-ui/types/`. Reuse `libs/web/ui` pieces (money display with currency triplet tooltip, KPI card, status tag mapping, impact preview, confirm-with-reason dialog, charts with table alternative) before writing new ones.

## 4. Build
Use the skeletons in [templates.md](templates.md). Data comes from `libs/web/data-access` on the generated `libs/contracts` client: read through its signals, mutate through its commands (idempotency key per user action), and show the API's problem `detail` for errors. Components never compute balances, availability or permissions. Copy is plain English in the template; money, numbers and dates use the Angular formatters (`frontend-angular.mdc`).

## 5. States and budget-safety visuals
Every state from `.cursor/rules/frontend-angular.mdc` must be reachable with seeded data: slow responses drive loading, a role without permission drives forbidden, a frozen or zeroed budget drives blocked, an empty tenant drives empty. Apply the budget-safety visual rules from the same file. Financial actions go through the confirm-with-reason dialog with impact preview.

## 6. Functional
Add or extend the journey in `apps/web-e2e/src/<group>/` as the role that uses the screen (its `storageState`): perform the action, assert what the user sees (numbers, states, blocked, error and success messages) and cross-check the numbers through the API; add the denied-role case. Then run `/functional-check` for the flow (stack, journey, exploratory pass, evidence, fix loop).

## 7. Visual
Add each state to `apps/web-e2e/visual/screens.json` (id `NNN-slug`, state, role, route, wait selector, masks for dynamic regions), run `/visual-qa` for the screen until no blocking findings remain, then `npm run e2e:update-snapshots` and give the reason in the PR.

## 8. Gates
`scripts/gate.sh` (all modes). Fix until green (see the `run-gates` skill).

## Done means
Gates green; the journey proves the flow as the right roles; all states reachable; budget-safety visuals correct; visual QA report with zero blocking findings; baselines added; final message with files changed, gate table, open UX questions and evidence paths.
