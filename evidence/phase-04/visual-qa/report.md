# Phase 4 visual QA

- Screens: 21 Phase 4 screens, 30 states, desktop, tablet and mobile in the light theme (dark theme and accessibility deferred), signed in per role from the Keycloak test users on the deterministic seed.
- Loop: 4 capture passes (3 fix iterations, then a final capture on the merged-ready build); stop reason: no blocking findings.
- Final pass: 90 captures, 0 blocking findings, 3 warnings (`capture-report.md`, `report.json`, `screens/`).
- Visual regression: 137 baselines pass twice in the pinned image (`npm run e2e:visual`), and in the full gate.

## Iterations

| Pass | Blocking | What was found                                                                                                                                                                                                                            | Fix                                                                                                                                                                                                       |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 56       | 404s when a regional or location manager opened a tree dialog (the lookup asked for the program root they cannot see); a 422 from the phasing validation state; horizontal overflow on mobile tables; layout shift; two states timing out | Fallback to the visible budgets when the root is out of scope; phasing totals validated in the browser (mismatch banner, save disabled); tables scroll inside their own positioned container; waits added |
| 2    | 44       | The fallback still logged the failed root request; layout shift on two states from header buttons appearing after load                                                                                                                    | Shared `sameTree` lookup lists the user's visible top-level budgets, so no request fails; header buttons always render (disabled until data loads)                                                        |
| 3    | 0        | Two layout-shift warnings on tablet                                                                                                                                                                                                       | —                                                                                                                                                                                                         |
| 4    | 0        | Final capture after moving the plan-import actions into the card header                                                                                                                                                                   | —                                                                                                                                                                                                         |

## Remaining warnings (not blocking)

- Layout shift on tablet: `022a-per-head-driver-allocation` default (0.18) and `023-budget-hierarchy` default and set-to-zero dialog (0.17). The tree and the headcount table render after their data arrives; above the 0.1 warning line, below the 0.25 blocking line. Follow-up: reserve the table height while loading.

## Design parity

See `design-parity/design-parity.md`: every state was inspected against its approved Stitch export; deviations are listed with their reasons and none blocks a task.

## Budget-safety visual rules

- Blocked and over-floor states use the important tone with the amount that is allowed (`024 blocked`, `026 below-floor`, `022 warning-block`).
- Freeze and set to zero show the impact preview (floor, what children keep, pending requests listed separately) before the confirm button enables.
- Available under the budget's rules carries a tooltip explaining any difference from the company-wide figure.
- Money uses the Angular formatters with the ISO code (USD) everywhere.

## Fixes after the last full capture

- Dialog states in `apps/web-e2e/visual/screens.json` and two journeys now wait for the dialog's bound content before typing: static dialog text renders before Angular's first binding pass, and input typed earlier was dropped (one flaky baseline in the gate run).
