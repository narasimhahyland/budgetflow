# apps/web-e2e — user journeys and visual regression

- Runs against the local stack (`scripts/stack.sh up && scripts/stack.sh reset` for a clean seeded tenant). `BASE_URL` points at the web app; the API and Keycloak come from the Compose ports.
- Projects: `setup` (signs in each seeded Keycloak test user and saves `tmp/e2e-auth/<role>.json`), `desktop` (1440x900), `tablet` (834x1112), `mobile` (Pixel 7), `visual-light` (light theme only; dark theme deferred). Templates: `docs/ai-harness/templates/web-e2e/`.
- Credentials come from `BF_E2E_*` env vars that default to the dev-only seed values in `infra/.env.example`.
- Journeys (`src/<area>/`, target `functional-e2e`) prove user flows as the relevant role and cross-check numbers through the API. The core acceptance scenario lives in `src/acceptance/` and runs at every wave gate from Wave 2 onward.
- Visual regression (`src/visual/visual.spec.ts`) takes `toHaveScreenshot` baselines for every entry in `visual/screens.json`, only inside the pinned Playwright image (`npm run e2e:visual`, `npm run e2e:update-snapshots` with a reason in the PR).
- A baseline can sit just under `maxDiffPixelRatio` and still pass, so unrelated drift piles up until one small change tips it over. `npm run visual:headroom` measures every state with no allowance at all and lists the ones already using 70% or more of theirs (report in `tmp/visual-headroom/`). It is informational: it never fails a build and is not part of `scripts/gate.sh`.
- The stack's worker sweeps are off (`BF_*_CRON=off` in `infra/.env.example`): a suite freezes the browser clock, so nothing may appear under it on a wall clock. Drive that work through its API instead.
- Selectors: `getByRole` / `getByLabel` / `getByText` first, `data-testid` only when nothing else is stable, never Satori or Material internal classes. No fixed sleeps.
- Pick the subject of a journey by a seeded id, code, reference or name, or create it through the API first. Never by position or by a mutable property ("the first row", "whichever connector is degraded"): `functional-api` runs before `functional-e2e`, so a subject chosen by state becomes a different subject and the journey asserts the wrong thing while the product is correct. The gate reseeds between the suites, so assume a freshly seeded stack and assert outright instead of guarding assertions with `if`.
- Traces and auth state stay in `dist/.playwright/` and `tmp/`; never commit them (they contain tokens).

Rules: `.cursor/rules/testing-functional.mdc`, `.cursor/rules/testing-visual.mdc`.
