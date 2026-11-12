# Gap A2: employee and gift caps are enforced, not just saved

Package A2 of [`docs/gap-closure-plan.md`](../../docs/gap-closure-plan.md), built 11 November 2026.
Every claim below points at a file in this folder or at a command whose output is summarised here.

## What was wrong

- The per-employee annual cap (screen 071) and the annual gift cap (073) were stored policy only.
  Nothing read them when a request was submitted or approved.
- "Employees nearest cap" was a hard-coded fixture in `libs/api/rules/src/lib/rules-defaults.ts`.
- Found while building this: the rules engine itself never ran on a real request. `evaluateRules`
  was called only by the simulation and the workflow tester, and `rule_executions` was never written.
  So no rule had any effect on submission, and the rules dashboard counts and the policy assistant's
  "decided by the rules engine" branch never had data.

## What it does now

| Piece                                                                                                                                                                                                                                                                                                        | Where                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| New facts: employee year-to-date benefit, cap left, cap used %, gift value per recipient, gifts this year, annual gift cap left, alcohol amount, non-employee count, intercompany flag, requester's 30-day total                                                                                             | `libs/domain/src/lib/rules/evaluator.ts`, `libs/domain/src/lib/rules/cap-facts.ts` (pure), contract `FACT_KEYS` |
| Usage read from the ledger: a request's live consumption is the sum of its pre-encumbered, encumbered and actual lines (reporting currency at the plan rate), split evenly between recipients and non-employees (largest remainder)                                                                          | `libs/api/rules/src/lib/cap-usage.ts`                                                                           |
| Enforcement on submission, approval and counter-offer acceptance; a block returns `409 POLICY_BLOCKED` with the rule code, version and cap figures; every allowed decision writes one `rule_executions` row with the rule versions and facts                                                                 | `libs/api/spend/src/lib/request-policy.service.ts`, `requests.service.ts`                                       |
| The rules, as data (versioned like any rule): R-31 blocks when `employee_cap_remaining_minor < 0`, R-32 warns when `employee_cap_used_pct >= 80`, R-33 blocks when `gift_annual_cap_remaining_minor < 0`. The cap amounts stay in policy, so changing the cap on screen 071 or 073 takes effect immediately. | `libs/seed/src/lib/rules.ts`                                                                                    |
| Request input: `benefitRecipientIds`, `nonEmployeeCount`, `alcoholAmount`; the detail returns `benefitRecipients` and `policyCheck`                                                                                                                                                                          | `libs/contracts/src/lib/domains/requests.ts`, migration `0022_a2_caps.sql`                                      |
| "Policy check" card on the request page: outcome, the decisive rule's explanation, the cap facts, the matched rules with versions                                                                                                                                                                            | `libs/web/features/requests/src/lib/request-detail.page.ts`                                                     |
| "Employees nearest cap" computed from live spend (top 10), with an empty state                                                                                                                                                                                                                               | `libs/api/rules/src/lib/policy-config.service.ts`, `policies.page.ts`                                           |
| Concurrency: per-recipient advisory locks, taken in id order after the budget lock                                                                                                                                                                                                                           | `cap-usage.ts` `lockCapPeople`                                                                                  |

Rules and choices worth knowing:

- **Cap year.** One cap year for the whole tenant: the group fiscal year that contains today.
  Submission, approval and the list all use it. A request counts in the year it was submitted, so a
  release posted after the year turns never lowers the next year's total.
- **Who a cap applies to.** Only employees named as benefit recipients. A request that names none is
  not attributed to anyone, including the requester. Event funding cannot name recipients (422),
  because its money reaches people through the event's own commitments.
- **Which categories count.** The included categories come from the cap policy (employee events,
  team lunch, wellbeing). Gifts are requested under the `gifts` spend type.

## Functional proof

Run on this worktree's stack with the deterministic seed. Roles: budget owner (requester),
department head (approver), finance admin (policy). The outcomes are in
[`functional/outcomes.md`](functional/outcomes.md).

- API scenarios: `apps/api-e2e/src/rules/caps.spec.ts`, 17 scenarios, all passing.
- Journey: `apps/web-e2e/src/rules/caps.spec.ts`, passing.
- Sample responses: [`api/at-cap-201-policy-check.json`](api/at-cap-201-policy-check.json) and
  [`api/one-unit-above-409-problem.json`](api/one-unit-above-409-problem.json).
- Screens: [`screens/request-policy-check.png`](screens/request-policy-check.png) and
  [`screens/employees-nearest-cap.png`](screens/employees-nearest-cap.png).
- Invariants: rows 100–102 in [`docs/testing/invariant-scenarios.md`](../../docs/testing/invariant-scenarios.md).
- Gates: [`gate-summary.txt`](gate-summary.txt). `scripts/gate.sh all` passed every mode at commit
  `b2e987d9`. The visual suite reported 941 passed and 3 flaky; the flaky screens (021 set-to-zero
  mobile, 024 allocate mobile, 087c rollover desktop) are untouched by this change and passed on
  retry. On a loaded machine, `security/dev-secrets.spec.ts` once timed out in an earlier run. It
  passed 18/18 alone and passes in this run.

## Behaviour changes to review

- **Active block rules now take effect on every request**, not only the cap rules. Of the seeded
  rules this means R-07: a `cash_gift_cards` request is refused, as its category policy (not allowed)
  always said. A tenant-authored block rule becomes live the moment it is published. Requests already
  waiting are re-checked when they are approved.
- **Only block and warn are enforced.** `require_approval` and `freeze` outcomes are recorded and shown,
  but approval routing still comes from the workflow templates and the DoA matrix, and the budget
  controls still decide frozen budgets.
- **A refused decision is not stored.** The transaction rolls back, so there is no `rule_executions`
  row for it. The rule code, version and cap figures are returned in the problem's `params`.

## Known limits

- The cap is stored in USD (`annualCapUsdMinor`) and compared in the reporting currency. That is right
  only while the tenant reports in USD, as the Hyland tenant does.
- The new-request form does not yet offer a recipient picker. Recipients come through the API (and
  integrations); the form is a follow-up.
- `vendor_status` is always `none`, because requests carry no vendor.
- The consumption read uses a sub-select on `commitments.request_id`, which has no index. That is
  fine at the seeded scale; add the index (concurrently, in its own migration) before the Phase 17
  scale target.
