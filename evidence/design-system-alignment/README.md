# Design-system alignment (screen 000)

Branch `chore/design-system-audit`, on `main` at `dbfba140` (includes #95, #96 and #97). The web app was audited against screen 000, the Design System Specification (`design/preview/html/000-design-system/default.html`), and the Stitch exports, then fixed.

- **Audit:** [`audit-report.md`](audit-report.md). It covers 60 blocking, 510 major and 495 minor rows, plus the ranked shared fixes. It was taken on `main` at `b2141aeb`, before #96 rebuilt Home.
- **Fixes:** each area's outcome is in [`fixes/`](fixes/), one table row per finding (fixed / skipped with reason / needs another owner).
- **Not done here:** [`follow-up-tasks.md`](follow-up-tasks.md) and the follow-ups below.

## What changed

| Shared fix                                          | Where                                                                                                                                                                                         | Result                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Undefined status tokens replaced, with a lint guard | 13 declarations; `.stylelintrc.mjs`; an `eslint.config.mjs` rule for inline styles (which stylelint never saw), also covering `font-family`                                                   | Pending and approved amounts differ again. The pending and "this request" segments, approved and funded fills, forecast-cycle segments and the AI-output stripe render again.                                                                                                                                                                       |
| Section 10 budget bar                               | new `libs/web/ui/src/lib/budget-bar.ts`, used by the impact card, the budget lifecycle spectrum, the allocation workspace (with an over-limit marker), co-funding, mobile balance and reports | One colour per bucket everywhere, with the forecast dashed                                                                                                                                                                                                                                                                                          |
| Section 5 status tags                               | `budget-status.ts` / `spend-status.ts` (icon and tone per status, all 15 budget states); report row tags                                                                                      | Frozen (lock, info) and Set to zero (stop, important) are always distinct                                                                                                                                                                                                                                                                           |
| Section 6 dense table                               | `libs/web/ui/src/styles/data-table.scss` (from a614b2bd, extended to native `bf-split-table`)                                                                                                 | 52/48 px, uppercase header band, `bf-num` on th and td, owner `sat-avatar`, code chip, frozen and zero stripes, sticky first column or stacked rows below 600 px                                                                                                                                                                                    |
| Section 9 KPI card                                  | `libs/web/ui/src/styles/kpi-card.scss`, alongside #96's `bf-kpi-tile` (scoped so the two never interfere)                                                                                     | Icon head, bold tabular value, bordered footer with toned % and bar where the API gives the ratio                                                                                                                                                                                                                                                   |
| One `bf-load-state`                                 | `libs/web/ui/src/lib/load-state.ts`; the 17 per-feature copies removed                                                                                                                        | The retry button renders (`satErrorStateAction`), and content-shaped ghosts remove the layout shift                                                                                                                                                                                                                                                 |
| Buttons, fact lists, banners                        | features                                                                                                                                                                                      | `satImportantButton` only on filled financial confirms; `bf-facts` pairs label and value; banners no longer clip                                                                                                                                                                                                                                    |
| Charts                                              | `@hylandsoftware/satori-tokens/css/dataviz` loaded for charts                                                                                                                                 | Distinct series colours, dashed forecasts, shared scales, a table alternative                                                                                                                                                                                                                                                                       |
| Visual QA harness                                   | `scripts/visual/capture.mjs`, `apps/web-e2e/src/visual/visual.spec.ts`, `screens.json`                                                                                                        | Full-height captures (they used to stop at 900 px). Overflow inside the shell's scroller and clipped tables are now detected. CLS leaves out shifts within 500 ms of scripted input. `screens.json` now covers 178 screens and 310 states (was 153 and 258). Self-test cases were added: 25/25 pass, and the old capture fails 2 of the 3 new ones. |

Per-screen fixes are in `fixes/A-shell.md` through `fixes/H-admin.md`.

## Gates and checks

| Check                                                                                                                                                            | Command                                                                    | Result                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static                                                                                                                                                           | `scripts/gate.sh static`                                                   | PASS: secrets, lint, styles, satori (sdsc), typecheck, build, openapi, db ([`gate-summary.txt`](gate-summary.txt))                                                                                          |
| Functional                                                                                                                                                       | `scripts/gate.sh functional`                                               | PASS: API scenarios and all UI journeys on a reseeded stack (`last-run: passed`, no failed tests)                                                                                                           |
| Visual QA capture ([report](visual-qa/report.md), [corrected states](visual-qa/report-corrected-states.md), [Home after #96](visual-qa/report-home-after-96.md)) | `node scripts/visual/capture.mjs` (all states × 1440/834/412, full height) | 924 captures, 0 blocking after three `screens.json` corrections; 12 layout-shift warnings (0.10–0.19) listed below. After merging #96, shell and Home were recaptured (000a, 000c): 36 captures, 0 findings |
| Visual regression                                                                                                                                                | `npm run e2e:update-snapshots`, then `scripts/gate.sh visual`              | PASS: 942 comparisons passed; 2 passed on retry (000a `platform-operator` mobile, 011a `action-redirect` tablet), 0 failed                                                                                  |
| Visual tooling                                                                                                                                                   | `node scripts/visual/self-test.mjs`                                        | 25/25                                                                                                                                                                                                       |

**Visual baselines updated:** the shared design-system components restyle every screen, and captures now cover the full page height instead of the first 900 px. They were re-recorded in the pinned image on a freshly reseeded stack.

Full-height captures reach tables that were never baselined, and two of them order equal rows differently on every seed. Their rows are masked until the API sorts with a tie-breaker (see the follow-ups): the deliveries on 061e (equal times) and the open-commitment rows on 085a. The Ask BudgetFlow (011a) and policy assistant (069a) states stay viewport-only, as they were before: each state asks a question, so the conversation history (masked) grows with the order the states run in, and with it the page height. The three `000a-app-shell--account-menu-open` baselines were removed because that state is now `user-menu-open`, so design parity can pair it with its Stitch export; its new baselines are recorded.

**Journeys changed** (copy that the fixes changed on purpose; each still checks the same rule):

- `auth/sign-in.spec.ts` and `support/auth.ts`: the sign-in title is "Sign in to BudgetFlow".
- `shell/formatting.spec.ts`: there is no reporting-currency chip in the header; Home's FX line states USD.
- `admin/administration.spec.ts`: "granted only through user administration" appears once, for the whole invite table.
- `ai/settings.spec.ts`: the scope reads "Read budget".
- `ai/suggestions.spec.ts`: "card number".
- `budgets/budgets.spec.ts`: "Contractors".
- `close/close.spec.ts`: reopening a period asks for the period to be typed.
- `finance-admin/finance-setup.spec.ts`: rates show four decimals.
- `integrations/integrations.spec.ts`: records read is its own column.

## Before and after

`before-after/` holds the audit captures (cut at the viewport) and the final full-height captures for 019, 021, 028, 046a, 059, 068 (834 px), 082, 087a, 103 (412 px) and 016a.

## Follow-ups (not in this change)

- **Pagination:** one shared cursor-paged table (Next/Previous, a rows-per-page control that is not a combobox, sort and search), rolled out to the lists that grow. #96's Home table already pages client-side with sort and search.
- **API:**
  - a tie-breaker (by id) on lists ordered by time, so equal rows come back in a stable order (061e deliveries, 085a commitments); then unmask them
  - the board-pack total sums INR lines as USD 325,000.00
  - commitment hygiene puts USD next to INR in one row
  - a `pendingOthers` field for the impact card
  - impact previews computed in the budgets dialogs
  - widget bucket amounts
  - the 043 funded-percentage copy
  - the 051a quote message
- **Not yet built:** Home executive dashboard stage 2, the 069 rule builder, the 050 approval workflow, the 058 layout, 031 and 032, and shell search.
- **Seed:** a frozen budget, documents, gallery photos, sync runs and dead letters, so those states can be captured.
- **Smaller items:**
  - Layout-shift warnings (0.10–0.19) on 087c, 114, 080a, 085a, 107, 108 and 106a.
  - Move `ROLE_LABELS` into data-access.
  - Make `--only 092` also match `092a`–`092d`.
  - Spec conflicts to decide: 068 shows Publish disabled, per-section titles on 071–076, and a docked desktop sidebar (Satori's nav is overlay-only).
