# Reading gate failures

## secrets (`scripts/secret-scan.sh`)
Output: `path:line  <pattern-id>  <masked preview>`. Remove the value; use an env reference instead. `env-file`, `key-file`, `har-capture`, `playwright-trace` mean the file itself must not be committed: unstage it (`git rm --cached <file>`) and keep it in `tmp/`. A real secret that was ever committed must be rotated by the user; say so. `internal-*` findings: replace internal URLs with public ones or remove them.
Rerun: `sh scripts/secret-scan.sh --worktree`.

## lint (`nx run-many -t lint`)
- `@nx/enforce-module-boundaries`: a lib imports something its tag forbids (feature to feature, ui to feature). Move the shared piece to `libs/web/ui` or the store, or navigate by route instead of importing.
- `satori-icons/*`: unknown or deprecated Satori icon name; pick one from the Satori icon list.
- `@angular-eslint/*` template rules: fix the template; never disable a rule without the user's approval.
Rerun: `npx nx lint <project>`.

## styles (`stylelint`, Satori adoption rules)
- `no-ds-internals-overrides`: you targeted `.mat-*`, `.mdc-*`, `.sat-*`, `.cdk-*` or redefined their custom properties. Style a `bf-*` class or use a `mat.<component>-overrides()` mixin.
- `no-mds2-*`: legacy design-system imports or mixins; remove them.
Rerun: `npx stylelint "libs/web/features/<lib>/**/*.scss"`.

## build (Angular application builder)
Type errors list `file:line`. Budget errors (`exceeded maximum budget`) mean bundle or component-style size grew: lazy-load, or move styles out of components; never raise budgets without the user's approval.
Rerun: `npx nx build web`.

## satori (`sdsc check all`)
Sections: angular and ui versions, design-language, componentry, styling-hygiene, icons. Each failure names the file and the check. Typical: raw colors or fonts (use tokens), custom component where a Satori one exists, Material Symbols usage. `npx sdsc check <section>` reruns one section; `npx sdsc check score` shows the adoption score.

## stack (`scripts/stack.sh up && reset`)
- `docker info` fails: start Docker. A service never turns healthy: `scripts/stack.sh status`, then `scripts/stack.sh logs <service>` (api, worker, keycloak, postgres, minio, mailpit, web).
- Port already in use: another checkout's stack is running; stop it or set the `BF_*_PORT` variables for this worktree.
- Seed failures name the step; fix the seed, never hand-edit the database.

## functional-api (`apps/api-e2e`)
- Report: `dist/.playwright/apps/api-e2e/report/index.html`. Each failure shows the request, status and problem `code`.
- Wrong `code` or amount: decide whether the product or the expectation is wrong against the rules and the invariant map; fix the product unless the scenario misreads the rule.
- 401: the role's Keycloak user or the local realm changed; re-run `scripts/stack.sh reset`. 403/404 where access is expected: check `PolicyService` grants and the role's org scope in the seed.
- Flaky concurrency or isolation: use the Testcontainers database per worker; never add retries or sleeps to hide a race.
Rerun: `npx nx run api-e2e:functional-api -- -g "<scenario>"`.

## functional-e2e (`apps/web-e2e` journeys)
- Report: `dist/.playwright/apps/web-e2e/report/index.html`; traces in `dist/.playwright/apps/web-e2e/test-results/` (`npx playwright show-trace <trace.zip>`).
- Locator timeouts: the screen never reached the state or the accessible name changed; check the failure screenshot first.
- Missing sign-in state: run the `setup` project (`npx playwright test -c apps/web-e2e/playwright.config.ts --project=setup`).
Rerun: `npx nx run web-e2e:functional-e2e -- --project=desktop -g "<journey>"`.

## visual (pinned image)
- Diffs are in the HTML report (expected, actual, diff). Intended change: `npm run e2e:update-snapshots` and a "Visual baselines updated: <reason>" line in the PR. Unintended: fix the UI, then run `/visual-qa`.
- Docker or host networking unavailable: `scripts/visual/pw-docker.sh` explains; on macOS enable Docker Desktop host networking.
Rerun: `npm run e2e:visual`.
