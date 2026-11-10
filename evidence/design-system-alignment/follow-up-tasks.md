# Draft follow-up tasks: design-system alignment

Draft only; nothing has been filed. Order follows "Prioritised shared-component fixes" in `report.md`. Each task follows the repo's definition of done: `/functional-check` for the affected roles, `/visual-qa` with no blocking findings, `scripts/gate.sh`, and baselines updated only through `npm run e2e:update-snapshots` with "Visual baselines updated: <reason>". Branch per task: `fix/<scope>` or `feat/<scope>` from `main`.

## Wave 1: restore budget-safety distinctions (shared, small)

- [ ] **fix(web-ui): replace undefined status tokens** (X1). Change the 13 declarations listed in `tmp/audit/undefined-token-uses.txt` to `--sat-sys-*-icon` / `--sat-sys-on-*-container`, and add a stylelint guard for bare `--sat-sys-{info,success,warning,important,neutral}`. Check: pending vs approved amounts differ; the impact-bar pending segment and "This request" are visible on 059/060/061; funded bars fill on 046/046a; 087a shows all four segments.
- [ ] **fix(web-ui): status tags per section 5** (X3). Project icons into `bf-budget-status` / `bf-spend-status` (lock for Frozen, …) and use section 5 tones. Fix `report-frame.ts:274` (labels → enum keys) and `:372-374` (row-tag tones). Replace status `bf-chip`s. Check: Frozen and Set to zero differ on 016a, 087, 019.
- [ ] **fix(web): satImportantButton hosts** (X7). Put `mat-flat-button` on the 8 bare uses (Close period, year-end, close dialogs, AI accept) and stop using it for routine actions.
- [ ] **fix(web-ui): bf-facts pairing and banner stretch** (X8, X13). Check at 834px: 068, 071, 072a, 074, 075 show values under the right labels; the 011a refusal is readable.

## Wave 2: shared components

- [ ] **feat(web-ui): bf-budget-bar** (X2, section 10), adopted by budget-impact, the lifecycle spectrum, the allocation workspace, co-funding/funded bars, forecast cycles and the mobile balance.
- [ ] **feat(web-ui): dense table style** (X5, section 6). Extend `data-table.scss` from `a614b2bd` (merge `fix/visual-rerecord` first): `mat.table-overrides` 52/48, `sat-avatar`, `satInlineChip`, frozen/zero stripes, the responsive pattern below 600px. Then migrate features area by area.
- [ ] **feat(web-ui): bf-kpi-card** (X4, section 9). Replace `.bf-kpi` on the 54 screens and delete the per-feature KPI styles.
- [ ] **refactor(web-ui): one bf-load-state** (X6, X9). Add `satErrorStateAction` retry, `satEmptyStateAction` on the 41 empty-state actions, and content-shaped ghosts. Check: CLS < 0.1 on 105, 111, 108, 082.
- [ ] **feat(web-ui): confirm-with-reason dialog** (X12), adopted by the budgets, close and approvals dialogs. Check: the block reason is visible above the actions at 1440×900 and 412 on 024/026.
- [ ] **refactor(web): single shared stylesheet** (X14). Remove the drifted `page.scss` copies in org and finance-admin. Check: no overflow at 412 on 108, 041, 102a, 106b, 106c.
- [ ] **feat(web): sat-navigation-tabs and sat-header-bar** (X16).

## Wave 3: verification and polish

- [ ] **fix(visual): full-height captures and scroller overflow** (X10) in `scripts/visual/capture.mjs`; add `allowRequests` for 016a, 087a, 061f, 102d.
- [ ] **test(visual): add the missing screens.json entries** (each area's "Not covered" list: Home, 107, 108, 080a–c, 022c, 023a, the rule builder, frozen budget, controls drawer, …), then re-baseline with a reason.
- [ ] **feat(reports): section 13 charts** (X11): dataviz tokens, dashed forecast, shared scales, table alternative.
- [ ] **chore(web): copy and formatting pass** (X15, X16): enum label maps, no internal ids, `bf-money` / `DatePipe` everywhere, heading weight, corner-medium, no inline font-family.

## Functional defects found during the audit (separate fixes, outside design fidelity)

- [ ] **fix(reports): board-pack totals mix currencies.** INR lines are summed and labelled USD 325,000.00 (016a). Total in the reporting currency at the locked plan rate. Needs an API scenario.
- [ ] **fix(reports): commitment hygiene compares USD with INR** in one row (085a).
- [ ] **fix(events): quotes copy prints raw minor units** (`quotes.service.ts:89`, 051a).
- [ ] **fix(events): dashboard says 100% funded for an 86% funded event** (043).
- [ ] **fix(budgets): locked phasing periods are editable** (`detail-tabs.ts:271-290`, 032a). Confirm the API rejects the write too.
- [ ] **fix(requests): rejected requests show "Available after approval"** (060).
- [ ] **feat: screens not built to their approved design**: Home executive dashboard (011), event approval workflow (050), rule builder (069), over-budget request (058), budget comparison (031) and calendar (032), shell search (000a).
