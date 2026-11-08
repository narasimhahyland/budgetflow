# Stage 2 of the clock work: scope

Stage 1 (issue #86) added `libs/api/core/src/lib/clock.ts` and re-pointed only the two definitions
that drive the two drifting baselines. The system is therefore **half-pinned**: the event plan and
the reports read `FIXED_NOW`, everything else still reads real time. Stage 2 closes that, in its own
pull request.

This list is derived, not remembered:
`grep -rn "new Date()\.toISOString()\.slice(0, 10)" libs/api --include="*.ts"` at
`fix/086-calendar-drift`. Re-run it rather than trusting the line numbers.

## The 31 remaining copies in `libs/api`

Eight of them are `export const todayUtc` — the same function exported separately from eight
modules, which is why there was no single thing to override in the first place.

| File                                        | Line(s)       | Shape                      |
| ------------------------------------------- | ------------- | -------------------------- |
| `actuals/src/lib/actuals-reads.ts`          | 37            | `export const todayUtc`    |
| `approvals/src/lib/routing.service.ts`      | 23            | `export const todayUtc`    |
| `close/src/lib/close-reads.ts`              | 17            | `export const todayUtc`    |
| `extended/src/lib/support.ts`               | 12            | `export const todayUtc`    |
| `finance/src/lib/finance-base.ts`           | 9             | `export const todayUtc`    |
| `ledger/src/lib/ledger-commands.service.ts` | 28            | `export const todayUtc`    |
| `org/src/lib/org-reads.ts`                  | 25            | `export const todayUtc`    |
| `spend/src/lib/posting-support.ts`          | 10            | `export const todayUtc`    |
| `integrations/src/lib/scim.service.ts`      | 35            | module-local `todayUtc`    |
| `integrations/src/lib/sync.service.ts`      | 45            | module-local `todayUtc`    |
| `events/src/lib/depth/quotes.service.ts`    | 23            | module-local `todayIso`    |
| `rules/src/lib/doa-admin.service.ts`        | 39            | module-local `today`       |
| `rules/src/lib/policy-config.service.ts`    | 38            | module-local `today`       |
| `rules/src/lib/rules.service.ts`            | 61            | module-local `today`       |
| `core/src/lib/actor.ts`                     | 57            | default parameter          |
| `approvals/src/lib/budget-impact.ts`        | 35            | default via `opts.today`   |
| `actuals/src/lib/accruals.service.ts`       | 190, 405, 410 | inline at the call site    |
| `admin/src/lib/experience.service.ts`       | 196, 301      | inline at the call site    |
| `admin/src/lib/user-admin.service.ts`       | 72            | inline at the call site    |
| `ai/src/lib/features/allocation.service.ts` | 252           | inline, inside a SQL `gte` |
| `ai/src/lib/features/outlook.service.ts`    | 54, 236       | inline at the call site    |
| `integrations/src/lib/pushes.service.ts`    | 264           | inline at the call site    |
| `reports/src/lib/board-pack.service.ts`     | 450           | inline at the call site    |
| `reports/src/lib/health.service.ts`         | 68            | inline at the call site    |
| `rules/src/lib/rule-simulation.service.ts`  | 143, 213      | inline at the call site    |
| `rules/src/lib/workflow-test.service.ts`    | 65            | inline at the call site    |

Mostly mechanical, but not blindly: each one is a decision about whether that date should follow the
pinned clock or genuinely wants wall-clock time. An export signing timestamp or a generated file name
arguably wants real time; an overdue flag, a validity window or an "as of" date does not.

## Also in scope

- **`generatedAt` on a report run** (`reports/src/lib/reports.service.ts`) is still real time. It
  does not reach a baseline today because `report.page.ts` wraps it in
  `data-testid="relative-time"`, which the global mask covers — so this is correctness, not a red
  test.
- **Three API scenarios compute dates from the real clock** and currently agree with the services
  they exercise only because those services were not re-pointed in Stage 1. Re-point them in the
  same change or they will fail:
  - `apps/api-e2e/src/extended/wallets.spec.ts:76`
  - `apps/api-e2e/src/approvals/hygiene.spec.ts:30`
  - `apps/api-e2e/src/extended/recognition.spec.ts:26`
- **87 SQL `now()` calls** in `libs/api` (`grep -rn "now()" libs/api --include="*.ts" | wc -l`).
  Neither of Stage 1's two states goes through one, but a pinned Node clock and a real Postgres clock
  in the same query is a new way to disagree about "now". Decide deliberately whether to set the
  session time or leave SQL on real time, and write the decision down.
- **The worker** is not given `FIXED_NOW`. Its four wall-clock sweeps default to `off`, so nothing
  in a test run depends on its clock today — but it will matter if a sweep is ever turned on in a
  scenario.
- **12 `todayIso` copies in `libs/web/features/*/api.ts`.** Out of scope: the browser clock is
  already frozen by `page.clock.setFixedTime`, so these do not drift under test. Worth consolidating
  for its own sake, not for this bug.

## Expect baselines to move again

Stage 1 moved six baselines because the figures it corrected were being rendered. Stage 2 touches
validity windows, "as of" dates and approval hygiene, so budget on another full visual run and
another classify-then-record pass. Do not re-record from a grepped run.
