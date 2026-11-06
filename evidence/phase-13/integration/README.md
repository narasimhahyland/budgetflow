# Phase 13 integration: the box-sizing root cause, and the AI screens in the navigation

Two pieces of work that both move shell and shared baselines, so they share one branch and one
baseline regeneration.

## 1. The `.bf-list__item` box-sizing defect, fixed at the root

### What was wrong

`.bf-list__item` in `libs/web/ui/src/styles/page-layout.scss` was `width: 100%` with `12px 20px`
padding in a content box, so the padding was added on top of the width and every item rendered 40px
wider than its card. `.bf-card` clips with `overflow: hidden`, so the symptom was not visible
overflow but the right-hand end of each row being cut off.

Measured on the running app at `043-events-dashboard`, with the fix taken back out
(`box-sizing: content-box` injected), at all three viewports:

| Viewport | Item width | Card width | Overflow |
| -------- | ---------- | ---------- | -------- |
| desktop  | 1374       | 1336       | 39px     |
| tablet   | 768        | 730        | 39px     |
| mobile   | 418        | 380        | 39px     |

With the fix in, 0 items overflow on any of the nine screens probed, at any of the three viewports.
That negative control matters: it proves the measurement is sensitive to the bug it is checking,
rather than reporting zero because it cannot see anything.

### Why a global reset rather than a fourth per-component fix

This was the third appearance of the same defect, and the second on this exact rule: Phase 8 patched
`.bf-settings__channel-row` in `notification-settings.page.ts`, Phase 11 patched `.bf-report` in
`catalog.page.ts` (a `height: 100%` grid card, the same family), Phase 13 patched `.bf-list__item`
itself in `ask.page.ts` and `suggest-split.page.ts`. The absence of a box-sizing reset is the root
cause, so the choice was a reset or a fourth local fix.

The reset was chosen because its blast radius was **measured** rather than estimated. Before
landing, `* { box-sizing: border-box !important }` was injected into the running app and the
bounding box of every element compared before and after:

|                            |                                                  |
| -------------------------- | ------------------------------------------------ |
| Screens                    | 9 (incl. the shell, a table screen, a card grid) |
| Viewports                  | desktop 1440, tablet 834, mobile 412             |
| Element boxes compared     | ~11,500 across 27 screen/viewport combinations   |
| Elements that changed size | **0**                                            |

Zero, because Satori and Material declare `box-sizing` themselves on the elements that rely on it,
and the reset is specificity 0, so their own declarations keep winning. The reset therefore inherits
the app as it is instead of relaying it out, which is what makes it safe to land in one change
alongside the navigation work. Had the measurement shown movement in Satori internals, the narrow
fix was the fallback.

The full visual run confirmed the prediction: of 152 baselines that moved, every one is explained by
the navigation change or by the `.bf-list__item` fix, and none by the reset acting on something else.

`box-sizing: border-box` is kept explicitly on `.bf-list__item` as well. It is redundant while the
app loads the reset, and it is kept because `page-layout.scss` is a library stylesheet that does not
control whether its host loads the reset, and because this is the rule that has regressed twice.

### Local workarounds removed

| Workaround                                                                    | Phase | Result after removal                  |
| ----------------------------------------------------------------------------- | ----- | ------------------------------------- |
| `box-sizing` on `.bf-settings__channel-row` (`notification-settings.page.ts`) | 8     | 059c page content pixel-identical     |
| `box-sizing` on `.bf-list__item` (`ask.page.ts`)                              | 13    | 011a conversation row inside its card |
| `box-sizing` on `.bf-list__item` (`suggest-split.page.ts`)                    | 13    | 022d page content pixel-identical     |

Each was exactly the declaration the shared rule was missing, so none of them over-corrected once
the shared rule was fixed: the two screens whose content is unmasked are pixel-identical before and
after apart from the navigation rail.

Phase 11's `box-sizing` on `.bf-report` is left alone. It is the same family but a different rule on
another team's screen, and removing it is not needed for this fix.

## 2. The nine Phase 13 AI screens in the navigation

Seven entries, for the seven routes reachable without a parameter. `022d`
(`/budgets/:budgetId/suggest-split`) is reached from the budget it splits, `061f` (`/ask/chat`) from
`011a`, and `121a` (`/documents/extraction`) from the receipt or quote it reads; none can be a rail
item.

| Screen | Label                | Group       | Path                           | Permission               | Server check                                                                            |
| ------ | -------------------- | ----------- | ------------------------------ | ------------------------ | --------------------------------------------------------------------------------------- |
| 011a   | Ask BudgetFlow       | beside Home | `/ask`                         | `tenant.read`            | `POST /api/ai/ask` checks only the feature switch; facts are scoped to the asker        |
| 069a   | Policy assistant     | Requests    | `/policy-assistant`            | `tenant.read`            | `POST /api/ai/policy-explain`, same                                                     |
| 016b   | Spending outlook     | Insights    | `/insights/outlook`            | `budget.read`            | `GET /api/ai/outlook` has no tenant-scope check; returns the budgets the asker can read |
| 080f   | Matching suggestions | Finance     | `/finance/actuals/suggestions` | `actuals.read`           | `AiMatchingService.listInTx` asserts `actuals.read` at tenant scope                     |
| 017c   | Anomaly flags        | Finance     | `/finance/anomalies`           | `integrity.read`         | `AiAnomalyService.listInTx` asserts `integrity.read` at tenant scope                    |
| 113a   | AI settings          | Admin       | `/admin/ai/features`           | `tenant.settings.manage` | **diverges**, see below                                                                 |
| 113a   | AI accuracy          | Admin       | `/admin/ai/accuracy`           | `audit.read`             | **diverges**, see below                                                                 |

Five of the seven name exactly what the server asserts. The two Admin entries are deliberately
stricter: `AiSettingsService.viewInTx` and `AiEvaluationsService.accuracy` both assert only
`tenant.read`, which would put an Admin entry in front of every signed-in role, and 113a's roles are
Organization Admin, Finance Admin and Auditor only. Recorded in
`docs/ux/screens/113a-ai-settings-query-log.md` following the precedent in
`docs/ux/screens/090-approval-history.md`, including the backend gap worth raising: that read gate
is looser than the spec intends.

113a is one screen with three tabs and two audiences holding different permissions, which is why it
has two entries. `tenant.settings.manage` carries the Organization Admin to the switches;
`audit.read` carries Finance Admin, Finance Controller, Auditor and CEO to Accuracy and, from its
tabs, the query log. "AI settings" points at `/admin/ai/features` rather than `/admin/ai`, which
redirects: the rail matches with `exact: true`, so the entry would never highlight.

### Icon verification

Every name checked against `node_modules/@hylandsoftware/satori-icons/icon-list.json` (493 names)
and `deprecated-icons.json`. All six present, none deprecated:

`ai`, `chat_info`, `chart_arrow_up`, `flag`, `gear_ai`, `speed`.

Verified again on the running app rather than only against the list, because an unknown name renders
nothing and fails silently. Every item in the expanded rail renders an `<svg>` with a non-trivial
path, and the paths are distinct per icon: `gear_ai` is path length 2431 against `gear`'s 2445, so it
is its own glyph and not a fallback. `rail--*--expanded.png` in `eyecheck/` shows all three audience
roles. The `role-navigation` journey's glyph assertion covers this for all 14 roles and still passes.

### Per-role outcome, cross-checked against `/api/me`

`role-navigation` asserts exact order per role and cross-checks every label against the permissions
`/api/me` reports. 28 tests, all passing, which is what pins the table above to the real backend
rather than to the spec.

| Role                                                              | New entries                                                                                          |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| super-admin                                                       | none (holds no `tenant.read`)                                                                        |
| org-admin                                                         | Ask BudgetFlow, Policy assistant, AI settings                                                        |
| ceo                                                               | Ask BudgetFlow, Policy assistant, Spending outlook, AI accuracy                                      |
| finance-admin, finance-controller, auditor                        | Ask BudgetFlow, Policy assistant, Spending outlook, Matching suggestions, Anomaly flags, AI accuracy |
| budget-owner, department-head, regional-manager, location-manager | Ask BudgetFlow, Policy assistant, Spending outlook                                                   |
| analyst                                                           | Ask BudgetFlow, Policy assistant, Spending outlook                                                   |
| event-organizer, employee, integration-admin                      | Ask BudgetFlow, Policy assistant                                                                     |

`budget.read` is granted at `owned` scope to the owner roles, so it reads false for the
event-organizer and the employee, who own no budget: Spending outlook stays away from them, which is
what 016b asks for.

## Visual baselines

**Visual baselines updated: `.bf-list__item` is now border-box, so every list item fits its card
instead of being clipped, and the Phase 13 AI screens are in the navigation rail, which changes the
rail on every screen.**

| Run                                                         | Result                                       |
| ----------------------------------------------------------- | -------------------------------------------- |
| Compare before regenerating                                 | 153 failed, 476 passed                       |
| Of those failures, byte-identical diff across both attempts | 150 (real change, not flake)                 |
| Regenerate (`npm run e2e:update-snapshots`)                 | 152 baselines rewritten, 628 passed, 1 flaky |
| Verify (`npm run e2e:visual`)                               | **629 passed, 0 failed, 0 flaky**            |

Moved baselines by viewport: 125 tablet, 19 desktop, 8 mobile. Tablet dominates because the rail
collapses to an icon column there, so adding entries moves every tablet screen; at desktop only the
screens whose content the box-sizing fix touched moved, plus the drawer shots.

The three failures whose diffs were not byte-identical across attempts differ by 2 bytes of PNG
compression on otherwise identical images (`011a refused-out-of-scope`, `121a check-fields`), and one
(`011a action-redirect`) by more; all three are the navigation change, not flake. The single flaky
test in the regeneration run (`099-sync-status no-runs-yet mobile`) passed on retry and passes in the
verification run.

### Eye check

A green diff is not proof when the bug was in the baseline, so the changed images were opened. Pairs
in `eyecheck/`, `--BEFORE` from `main` and `--AFTER` regenerated.

| Image                                              | What the eye check showed                                                                                                                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `043-events-dashboard--default--desktop`           | **The defect, visible.** Before: "Request contributio", "Send reminde", "Open checklis", "Compare quote" all cut off at the card edge. After: all four complete, inside the card, with the right padding. |
| `011a-conversation-row--LIVE--tablet`              | The originally reported symptom. Delete sits inside the card; measured 728px item in a 730px card, Delete 21px inside the right edge. Taken live because the baseline masks this card for generated ids.  |
| `059c-notification-channels-push--default--tablet` | Phase 8's workaround removed: page content pixel-identical, so nothing over-corrected. Only the rail differs.                                                                                             |
| `022d-suggested-allocations--default--tablet`      | Phase 13's workaround removed: page content pixel-identical. Only the rail differs.                                                                                                                       |
| `016a-board-pack--forbidden-owner--tablet`         | The 403 state unchanged and correct; rail gained the owner role's three entries.                                                                                                                          |
| `000a-app-shell--nav-drawer-open--desktop`         | Ask BudgetFlow directly under Home with its glyph.                                                                                                                                                        |
| `rail--finance-admin/auditor/org-admin--expanded`  | All seven entries in their groups with distinct glyphs, and absent for the roles that hold no permission for them.                                                                                        |
| `019-budget-list`, `059-approval-inbox` (tablet)   | Content unchanged; rail icon column one row taller. Nothing clipped.                                                                                                                                      |

### The stale board-pack baselines

A prior investigation found two `016a-board-pack--forbidden-owner` baselines stale (short one rail
icon) but passing under the 0.002 budget, so `--update-snapshots` would not rewrite them. This change
pushed the **tablet** one over the threshold, so it was regenerated and is now accurate. The
**desktop** and **mobile** ones are still under the budget and were not rewritten, so they are still
stale by one rail icon. Said rather than masked; they need a deliberate refresh, which is not this
change's to make.

## Gates

| Gate                                 | Result                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `scripts/gate.sh static --affected`  | PASS secrets 11s, lint 40s, styles 6s, satori 63s, typecheck 24s, build 1s, openapi 1s, db 3s |
| `role-navigation` journey (14 roles) | 28 passed                                                                                     |
| Full visual suite, verification run  | 629 passed                                                                                    |

The full `functional-api` and `functional-e2e` suites were not run locally: three other stacks were
up on this machine and the load average sat above 25 for most of the run. CI runs both.

## Follow-ups found, not fixed here

1. **022d at tablet clips its last column.** The "Suggested" amount input is cut off at the card's
   right edge. Pixel-identical before and after this change, so it is a pre-existing Phase 13 layout
   defect, not box-sizing: the grid is simply wider than the card at 834px and `.bf-card` clips. The
   spec's tablet behaviour needs a scroll container or a hidden column.
2. **Unstable ordering in the event location list.** `043-events-dashboard` rendered
   "Hyderabad, Bengaluru" in the committed baseline and "Bengaluru, Hyderabad" when regenerated, with
   no related change. The read model does not sort locations stably, which will produce visual flake
   on this screen sooner or later.
3. **The 113a read gate is looser than its spec.** `GET /api/ai/settings` and `GET /api/ai/accuracy`
   assert `tenant.read`, so any member of the tenant may read the Features and Accuracy tabs, while
   113a's roles are Organization Admin, Finance Admin and Auditor. Tightening it would let the nav,
   the route guards and the server converge and the divergence note in the spec be deleted.
4. **`notification-settings.page.ts` was unformatted on `main`.** `prettier --check` failed on it as
   committed, so it is reformatted in its own commit here; nothing else in that file changed.
