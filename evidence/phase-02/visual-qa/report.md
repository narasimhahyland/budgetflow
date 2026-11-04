# Visual QA — 000a application shell and sign-in pages (Phase 2)

Stack: this worktree's Compose stack (web 4210, Keycloak 8090) with the deterministic seed; sign-in state from the Playwright `setup` project (real Keycloak sign-in per role). Light theme only. Commands: `node scripts/visual/capture.mjs --screens apps/web-e2e/visual/screens.json --base http://localhost:4210 --out evidence/phase-02/visual-qa/iter-<n>` and `node scripts/visual/design-parity.mjs --captures <iter> --only 000a-app-shell`.

| Iteration | Captures | Automated blocking | Inspection blocking | Fixed |
| --------- | -------- | ------------------ | ------------------- | ----- |
| 1         | 36       | 1 (wait timeout)   | 3                   | 4     |
| 2         | 33       | 0                  | 2                   | 2     |
| 3         | 33       | 0                  | 0 (1 minor)         | 1     |
| 4         | 33       | 0                  | 1 (ux-reviewer)     | 3     |
| 5         | 33       | 0                  | 0                   | —     |

- Stop reason: no blocking findings (iteration 5).
- Fixes (before/after):
  - `before-after/notifications-panel--before.png` -> `--after.png` (clipped hint text)
  - `before-after/forbidden-card--before.png` -> `--after.png` (centered, narrower 403 card)
  - `before-after/home-table-mobile--before.png` -> `--after.png` (no sideways scroll; reporting equivalent as a secondary line)
  - `before-after/breadcrumbs--before.png` -> `--after.png` (separator between crumbs)
  - `before-after/placeholder-card--before.png` -> `--after.png` ("Go to Home" sat on the card border; the employee empty card is fixed the same way)
  - `before-after/not-found-title--before.png` -> `--after.png` (breadcrumb and mobile title read "Home" on the 404 page)
- Inspection notes per iteration: [inspection.md](inspection.md).
- Design parity: [iter-5/design-parity/design-parity.md](iter-5/design-parity/design-parity.md) (default, employee-forbidden, notifications-open on desktop; nav-drawer-open on mobile). `000b-sign-in-pages` has no Stitch design; it was checked against the shell spec and the Satori rules. The 000a designs are still marked "proposed" in `design/stitch/000a-app-shell/meta.json`; parity was judged against them as instructed for this phase.
- Baselines: created with `npm run e2e:update-snapshots` in the pinned image (33 states x viewports) and updated after iteration 5. Reason: new Phase 2 shell and sign-in page states.
- Not in the baselines: an INR (lakh/crore) Home, captured in iteration 1, is left out of `screens.json` because API scenarios add budgets to the India managers' views before the gate's visual step. Lakh/crore formatting is proven by `apps/web-e2e/src/shell/formatting.spec.ts` against API minor units and shown in `../shell-auth/functional/screens/08-home-regional-manager-lakh-ist.png`.
- Captures of iterations 2-4 live in `tmp/evidence/phase-02/visual-qa/` (gitignored); iterations 1 and 5 are committed.
- Independent review: `ux-reviewer` on iteration 4 — one blocker (fixed in iteration 5) and non-blocking findings (listed in `../README.md`).

## Deviations from the Stitch designs (and why)

| Design element                                                          | Built                                                                                                                           | Why                                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant and organization switcher in the sidebar (`switcher-open` state) | Company name only ("BudgetFlow / Hyland" in the header and in the expanded navigation)                                          | Binding decision: one company, no tenant or organization switcher (ADR 0006)                                                                                                                               |
| Sidebar expanded at 240px with the BudgetFlow logo                      | Satori `sat-platform-nav`: collapsed rail by default, expanded as an overlay; its title is the fixed "Content Innovation Cloud" | Satori's component behaves this way and has no title input; overriding its internals is banned by satori-lint. BudgetFlow and the company name sit in the header and at the top of the expanded navigation |
| Global search (`search-open` state)                                     | Not built                                                                                                                       | No search API yet; a field that searches nothing would mislead. Follow-up for the phase that adds search                                                                                                   |
| Notifications with items and a Tasks tab                                | Bell with an empty panel ("You are all caught up")                                                                              | Notifications arrive with approvals (Phase 5) and channels (Phase 8)                                                                                                                                       |
| Help icon                                                               | Not built                                                                                                                       | No help content yet                                                                                                                                                                                        |
| "Request access" on the 403 page                                        | "Go to Home" only                                                                                                               | No access-request flow exists; the text tells the user to ask their administrator                                                                                                                          |
| Content area of the default design (budget hierarchy skeleton)          | Interim Home: welcome, role and location, budgets the user can see with available amounts in budget and reporting currency      | The budget hierarchy is Phase 4; role dashboards replace Home in Phases 5 and 10                                                                                                                           |
| Lock illustration on 403                                                | Satori's `sat-403-error-state` illustration                                                                                     | Satori component first                                                                                                                                                                                     |

## Exploratory pass

Scripted browser sessions (Playwright, headless) signed in through the real BudgetFlow sign-in page as the Finance Controller and the employee and looked at Home, the console and network (this found the concurrent-guard 401 and the `NG0203` guard error, both fixed). The remaining paths — every role's navigation, menus, forbidden and unknown deep links, sign-out and back in, Hyland SSO, MFA and forgot password — were exercised by the journeys in `apps/web-e2e/src/{auth,shell}` (see `../functional/README.md`), with failure screenshots inspected while fixing them.
