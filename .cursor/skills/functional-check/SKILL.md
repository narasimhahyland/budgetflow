---
name: functional-check
description: Proves a BudgetFlow change works on the running product - starts the local Docker Compose stack with the deterministic seed, runs the feature end to end as the relevant roles through API scenario tests (apps/api-e2e) and Playwright journeys (apps/web-e2e), explores the flow with browser tools, checks Mailpit and worker jobs, records evidence, and loops through fixes until green (max 5 iterations). Use for every feature, fix or domain change before calling it done, and at phase and wave gates.
---

# Functional check

The definition of done for every change. Unit tests are not required; this check is. Rule: `.cursor/rules/testing-functional.mdc`.

```text
- [ ] 1 Frame: outcomes, roles, invariants touched, evidence folder
- [ ] 2 Stack up with the deterministic seed
- [ ] 3 API scenarios (apps/api-e2e)
- [ ] 4 UI journeys (apps/web-e2e) for user-facing flows
- [ ] 5 Exploratory pass (browser tools, Mailpit, worker)
- [ ] 6 Fix loop until green (max 5 iterations)
- [ ] 7 Evidence and report
```

## 1. Frame
Write down before running anything:
- the business outcomes to prove, phrased as a user or finance would check them ("Regional manager cannot allocate INR 1 more than Hyderabad's available; the error names the remaining amount");
- the roles involved (ids from `apps/web-e2e/src/support/roles.ts`) and which role must be denied;
- the invariants touched and their rows in `docs/testing/invariant-scenarios.md`;
- the evidence folder: `evidence/<phase>/<change>/functional/`.

## 2. Stack
```bash
scripts/stack.sh up && scripts/stack.sh reset   # Postgres 16, Keycloak, Mailpit, MinIO, API, worker, web; deterministic seed
scripts/stack.sh urls                           # web, API, Keycloak, Mailpit (http://localhost:8025), MinIO console
```
Documents go to MinIO and AI features use the deterministic fake `AiProvider`. If Docker is unavailable, stop and report that functional checks could not run; never mark them passed.

## 3. API scenarios
Add or extend specs in `apps/api-e2e/src/<area>/` (Playwright `request` fixture; tokens per role from the local Keycloak realm). Each scenario: arrange through the API or seed, act as the role, assert status, problem `code`, amounts in minor units, statuses, visibility per role, audit entry and ledger effect. Cover the happy path, the exact boundary, one minor unit past it, the rejection, the denied role, and idempotent retry for mutations. Concurrency and isolation scenarios use Testcontainers Postgres per worker. Run:
```bash
npx nx run api-e2e:functional-api -- -g "<scenario or area>"
```
Update the invariant map row (scenario path, status `passing`).

## 4. UI journeys
For anything a user does in the web app, add or extend a journey in `apps/web-e2e/src/<area>/` using the role's `storageState`. Assert what the user sees (numbers, states, blocked, error and success messages) and cross-check the numbers through the API. Run:
```bash
npx nx run web-e2e:functional-e2e -- -g "<journey>"
```
From Wave 2 on, also run the core acceptance journey (`apps/web-e2e/src/acceptance/`) at gates and after cross-cutting changes.

## 5. Exploratory pass
With the Playwright MCP (`.cursor/mcp.json`) or the browser tools, sign in as each involved role and click through the changed flow: numbers add up, the right states and messages appear, denied roles see the forbidden state, nothing unexpected in the console. When the flow sends email, open Mailpit and check recipient, subject and amounts. When it enqueues jobs, check the worker outcome (worker logs or pg-boss state through `scripts/stack.sh logs worker`). Take screenshots of key states.

## 6. Fix loop
If any check fails: decide whether the product or the check is wrong, fix the product (or the check, only when it is genuinely wrong), and re-run steps 3-5 for the affected scenarios. Stop after 5 iterations. Never skip, weaken or delete a check, and never report done while one fails; report what still fails, the output, and your best diagnosis instead.

## 7. Evidence and report
Write `evidence/<phase>/<change>/functional/README.md`:

```markdown
# Functional check — <change>
- Commit: <sha>; stack: scripts/stack.sh up && reset; iterations: <n>
| Scenario | Level | Role | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Over-allocation by one minor unit | API | regional-manager | 409 OVER_ALLOCATION, remaining 0 | 409 OVER_ALLOCATION, remaining 0 | PASS | api/over-allocation.json |
```
Add API responses (tokens redacted) under `api/`, screenshots under `screens/`, log excerpts under `logs/`. Traces, videos, auth state and HAR files stay in `tmp/`. Final message: outcomes proven, commands with results, iterations, remaining risks, evidence path.
