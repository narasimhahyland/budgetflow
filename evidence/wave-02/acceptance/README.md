# Wave 2 core acceptance journey

- **Spec:** `apps/web-e2e/src/acceptance/wave-2-core.spec.ts`
- **Command:** `npx nx run web-e2e:functional-e2e -- --grep "Wave 2 core acceptance"`
- **Stack:** `COMPOSE_PROJECT_NAME=bf-demo scripts/stack.sh reset` (gate re-ran stack before functional-e2e)

| Step | Scenario                                                     | Role(s)                       | Expected                                         | Actual                                   | Result         |
| ---- | ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------ | ---------------------------------------- | -------------- |
| 1    | FY2026 USD plan tie-out                                      | finance-admin                 | Plans page + API `tiedOut`                       | USD, `tiedOut: true`, version `approved` | PASS           |
| 2    | India hierarchy and per-head Hyderabad                       | regional-manager              | Per-head copy + USD authorized > 0               | UI + `getBudget`                         | PASS           |
| 3    | Cross-location event submitted                               | budget-owner                  | Event `submitted` with own-funds request         | API after UI wizard                      | PASS (desktop) |
| 4    | Inter-Director Budget Contribution Request partial + decline | budget-owner, department-head | Co-funding board + `earmarked` / `rejected`      | API + UI                                 | PASS (desktop) |
| 5    | DoA approval route                                           | department-head, budget-owner | Request `approved`, history shows Within DoA     | API poll + UI                            | PASS (desktop) |
| 6    | Freeze then set-to-zero on pending request                   | finance-admin, budget-owner   | `onHold` then `cancelled`                        | API poll + UI banners                    | PASS (desktop) |
| 7    | Seeded November actuals import                               | finance-controller            | Auto/partial/unmatched KPIs + mixed API statuses | UI + `/api/actuals`                      | PASS           |
| 8    | Event reconciliation blocked                                 | finance-controller            | `EVENT_HAS_UNMATCHED_ACTUALS`                    | UI blocker + reconciliation API          | PASS           |
| 9    | GL tie-out India difference                                  | finance-controller            | Sign-off disabled; India exceptions > 0          | UI + `/api/actuals/tie-outs`             | PASS           |
| 10   | Utilization roll-up                                          | regional-manager              | Table totals match `/api/utilization`            | UI + API                                 | PASS           |

**Residual gaps (not in this journey):**

- Full event **close** after matching (happy path) remains in `apps/api-e2e/src/actuals/event-close.spec.ts`; step 8 proves the **block** on seeded NYC offsite only.
- Finance-admin **sign-off** on a prepared tie-out (mutating) remains in `apps/web-e2e/src/accounting/tieout.spec.ts`.
- Intercompany recharge and contribution **full** approve path remain in API scenarios; step 4 covers partial + decline only.
- Visual QA was not re-run in this session.
