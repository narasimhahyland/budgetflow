# Functional check — gap B2 part 2 (018, 018a, 018b, 088a)

Stack: own worktree stack `bf-gap-b2` (deterministic seed, clock pinned to 2026-11-16T09:00Z), with
migration 0024 (`evidence_packs`). Roles: finance-controller, finance-admin, auditor, ceo, analyst,
org-admin, department-head, regional-manager, employee; platform operator through the sweep.

```bash
npx playwright test -c apps/api-e2e/playwright.config.ts src/dashboards src/scope/operator-isolation.spec.ts
npx playwright test -c apps/web-e2e/playwright.config.ts src/reports/dashboards-2.spec.ts
```

| Scenario         | Expected                                                                                                            | Actual                                                                                                                      | Result |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| 018 pending item | a new request shows at its step with the approver and the amount held                                               | parent-owner step, Lena Fischer, USD 450.00 pre-encumbered                                                                  | pass   |
| 018 KPIs         | pending count equals pending tasks; pending amount equals pre-encumbered lines; steps add up; co-funding never held | equal                                                                                                                       | pass   |
| 018 nudge        | email and in-app; replay idempotent; second within 4 h is 409; one history entry; request unchanged                 | `in_app`, `email`; `Idempotent-Replayed: true`; 409 `CONFLICT`; one `approval.nudged`; `pending_approval`; email in Mailpit | pass   |
| 018 scope        | owners only their subtree (404 nudging outside it); employee 403; approver filter narrows                           | as expected                                                                                                                 | pass   |
| 018a views       | named for finance, aggregate for analysts (no names), own for approvers with the company median                     | as expected; channel and step counts add up                                                                                 | pass   |
| 018b KPIs        | counts from events and rows; plan targets; insufficient below 20 owners; no personal data                           | 6 owners, insufficient; auto-match by source equals actuals; no email in the body                                           | pass   |
| 018b scope       | org admin, finance admin, CEO read; owners and employees 403                                                        | as expected                                                                                                                 | pass   |
| 088a event pack  | ready, chain valid, manifest files, commitment count, ZIP holds every manifest file                                 | as expected                                                                                                                 | pass   |
| 088a audit       | requested, generated and downloaded (with the manifest fingerprint)                                                 | all three                                                                                                                   | pass   |
| 088a attendees   | attendee details only when asked                                                                                    | `attendees.csv` only with the toggle                                                                                        | pass   |
| 088a scope       | CEO lists and downloads but cannot generate; owners 403; unknown subject 404                                        | as expected                                                                                                                 | pass   |
| Operator sweep   | the new parameter-free reads (`/api/evidence-packs`, `/api/analytics/kpis`, the dashboards) refuse the operator     | green                                                                                                                       | pass   |
| Journeys         | the pages show the API's figures; nudge from the page; generate and download a pack; refused roles                  | 29 passed plus the two mutating journeys on desktop                                                                         | pass   |

API responses (no tokens): `../api/`. Invariant map rows 106–108.

Findings:

- The API pins its own clock (`FIXED_NOW`) but its database sessions do not, so timestamps the
  database stamps on API writes (approval task `created_at`, audit `occurred_at`) follow the real
  clock while the API's "now" is the pinned one. Waiting times of rows created by scenarios are
  therefore days off on a local stack; seeded rows are consistent. The nudge window is measured on
  the time the API records in the audit entry, so it is not affected. Recorded, not fixed (stack-wide).
- Seed data holds 7 decisions and 6 budget owners, so 018a shows the small-sample note and 018b the
  "not enough data yet" state on a fresh seed.
