# Visual QA inspection notes (Phase 2 shell)

Captures were opened one by one in iterations 1-3 and as per-viewport contact sheets of all 33 captures in iterations 4 and 5. Captures of iterations 2-4 were moved to `tmp/evidence/phase-02/visual-qa/` (gitignored) to keep the repository small; their `report.md` files stay here.

## Iteration 1 (36 captures, 1 automated blocking)

| Screen / state                   | Viewport        | Severity | Finding                                                                                                                                                 | Screenshot                                                              |
| -------------------------------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 000a nav-expanded                | mobile          | blocking | Capture timed out: the selector matched the zero-width rail button before the header's "Open navigation" trigger                                        | `iter-1/report.md`                                                      |
| 000a default, notifications-open | all             | blocking | Home listed budgets created by API scenarios ("Scenario root ...") for the Finance Controller, so the state is not deterministic after `functional-api` | `iter-1/screens/000a-app-shell--default--desktop--light.png`            |
| 000a notifications-open          | desktop, tablet | blocking | Hint text clipped ("changes to your … will appear here"): panel wider than the Material menu                                                            | `iter-1/screens/000a-app-shell--notifications-open--desktop--light.png` |
| 000a employee-forbidden          | desktop         | minor    | 403 card spans the full width; the design centers a narrower card                                                                                       | `iter-1/screens/000a-app-shell--employee-forbidden--desktop--light.png` |

Fixes: last-visible-match selector for the navigation toggle; Home visual states use the Europe department head, whose budgets scenarios never touch (lakh/crore stays proven by the formatting journey); panel width 280px; `.bf-card--state` max width 720px, centered.

## Iteration 2 (33 captures, 0 automated blocking)

| Screen / state    | Viewport | Severity | Finding                                                                                            |
| ----------------- | -------- | -------- | -------------------------------------------------------------------------------------------------- |
| 000a default      | mobile   | blocking | Home table scrolls sideways and clips the USD column                                               |
| 000a placeholder  | all      | blocking | Breadcrumbs read "Home > Budgets Budget hierarchy": two non-link crumbs render without a separator |
| 000a nav-expanded | all      | info     | Renamed to `nav-drawer-open` so design parity compares it with the mobile drawer design            |

Fixes: USD equivalent as a secondary line under the budget-currency amount, "Created" hidden on phones; section crumbs removed (sections have no page).

## Iteration 3 (33 captures, 0 automated blocking)

| Screen / state | Viewport | Severity | Finding                                                         |
| -------------- | -------- | -------- | --------------------------------------------------------------- |
| 000a default   | all      | minor    | Secondary line read "USD equivalent USD 30,000.00" (code twice) |

Fix: "Reporting USD 30,000.00", matching the header chip.

## Iteration 4 (33 captures, 0 automated blocking)

My own inspection found nothing blocking; the independent `ux-reviewer` then found one blocker I had missed, plus non-blocking items:

| Screen / state       | Viewport | Severity | Finding                                                                          |
| -------------------- | -------- | -------- | -------------------------------------------------------------------------------- |
| 000a placeholder     | all      | blocking | "Go to Home" sits on the card's bottom border (plain `bf-card` has no padding)   |
| 000a employee-home   | all      | minor    | Empty-state text cramped against the card's bottom border (same cause)           |
| 000a not-found       | all      | minor    | Breadcrumb and mobile title read "Home" (the `**` route had no page title)       |
| 000a nav-drawer-open | all      | minor    | Satori's "Collapse navigation" tooltip is captured (pointer rests on the toggle) |

Fixes: `bf-card--padded` on the placeholder and employee empty cards; page title "Page not found" on the `**` route; the capture hovers the navigation's brand block before the screenshot.

## Iteration 5 (33 captures, 0 automated blocking, 0 inspection blocking)

All states render as intended on desktop, tablet and mobile (checked as per-viewport contact sheets of all 33 captures); nothing clipped or overlapping; states are visually distinct; money shows currency codes with tabular numerals and the reporting equivalent in a quieter secondary style. Remaining non-blocking notes are listed in `report.md` (Satori's fixed platform title, Keycloak default copy on the sign-in pages, rail avatar shows one initial).
