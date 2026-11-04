---
name: ux-verify
description: One capture-and-inspect pass over BudgetFlow screens on the real app - local stack with seeded data, Playwright sign-in state per role from Keycloak test users, screenshots of every state at desktop, tablet and mobile in the light theme (dark theme deferred), console, network, overflow and layout-shift checks, and design parity against approved Stitch exports. No fixing loop (use visual-qa-loop for that). Use when the user asks for screenshots, a quick UX check, or evidence of the current UI.
---

# UX verify

A single pass of the visual QA loop's capture and inspection, without fixes. Rule: `.cursor/rules/testing-visual.mdc`.

## 1. Stack, data and sign-in

```bash
scripts/stack.sh up && scripts/stack.sh reset                                    # local stack + deterministic seed
npx playwright test -c apps/web-e2e/playwright.config.ts --project=setup        # tmp/e2e-auth/<role>.json
```

The setup project (`apps/web-e2e/src/auth.setup.ts`) signs in one Keycloak test user per role (`src/support/roles.ts`) and saves its `storageState`; screens pick a role with `"role"` in `screens.json`. Without the workspace's Playwright, run `sh scripts/visual/setup-tools.sh --with-browser`.

## 2. Describe the screens

Every screen state has an entry in `apps/web-e2e/visual/screens.json` (template: `docs/ai-harness/templates/web-e2e/visual/screens.json`): `id` (`NNN-slug`), `path`, `role`, `waitFor` (selector proving the screen is ready), optional `actions` (`click`, `fill`, `select`, `hover`, `press`, `waitFor`) to open dialogs or reach a state, `mask` for dynamic regions, `allowRequests` for expected 4xx (forbidden states).

## 3. Capture and compare

```bash
node scripts/visual/capture.mjs --screens apps/web-e2e/visual/screens.json --only <ids> --out <out>
node scripts/visual/design-parity.mjs --captures <out> --only <ids>
```

Options: `--viewports desktop,tablet,mobile`, `--themes light` (the default; dark theme deferred, `--themes light,dark` re-enables it), `--base <url>` (another port for a worktree). Exit 1 means blocking findings (console or page errors, failed requests, overflow, interpolation leftovers, layout shift > 0.25, missing sign-in state, timeouts).

## 4. Inspect

Open every screenshot and side-by-side image with the Read tool and check them against the approved design and the budget-safety visual rules, as in step 3 of the `visual-qa-loop` skill. Never describe a screen you did not open.

## 5. Report

Embed two or three representative screenshots, list blocking findings with file paths, link `report.md` and `design-parity.md`, and state open UX questions. To fix what you found, run `/visual-qa`.
