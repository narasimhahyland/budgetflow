# UX review log

Every Stitch design and its review status. Implementation agents may build from "proposed" designs; the user's decision is recorded here and in the screen's `design/stitch/<NNN-slug>/meta.json` (`approved` date).

Stitch project `1643421514270618068`, design system `assets/8229316405357604751` (BudgetFlow Satori, light only).

| Screen | Spec | Default Stitch screen | States exported | Status | Date |
| --- | --- | --- | --- | --- | --- |
| 000 Design system | [spec](screens/000-design-system.md) | `5d02c6a4235a47d7968986b9629e76b9` | default | proposed - awaiting user review | 2026-11-04 |
| 000a Application shell | [spec](screens/000a-app-shell.md) | `fd62ca975f5b497e960db74a6f608b2c` | default, switcher-open, notifications-open, search-open, employee-forbidden, nav-drawer-open (mobile) | proposed - awaiting user review | 2026-11-04 |
| 011 Executive dashboard | [spec](screens/011-executive-dashboard.md) | `8e3e69d7a1894ea68503b203dd1141e0` | default, loading, empty, error | proposed - awaiting user review | 2026-11-04 |
| 022 Budget allocation workspace | [spec](screens/022-budget-allocation-workspace.md) | `ccdbc282cac64caeba9a188fb6fcc676` | default, warning-block | proposed - awaiting user review | 2026-11-04 |
| 023 Budget hierarchy | [spec](screens/023-budget-hierarchy.md) | `78e9e80886724ba799cba008d430c342` | default, set-to-zero-dialog | proposed - awaiting user review | 2026-11-04 |
| 045 Create event budget | [spec](screens/045-create-event-budget.md) | `bd913fe9a61c407bb2da75de0b33b6fa` | default, validation | proposed - awaiting user review | 2026-11-04 |
| 059 Approval inbox | [spec](screens/059-approval-inbox.md) | `989446b543a047778ce424b9107f5fc7` | default, delegated-escalated, empty | proposed - awaiting user review | 2026-11-04 |
| 069 Rule builder | [spec](screens/069-rule-builder.md) | `bbb72843f67d43a087e8308adcf569d7` | default, conflict-simulation | proposed - awaiting user review | 2026-11-04 |
| 088 Audit log | [spec](screens/088-audit-log.md) | `eb69eed067bf4f34a1dcba6b01ccd962` | default, chain-broken | proposed - awaiting user review | 2026-11-04 |
| 115 Employee dashboard | [spec](screens/115-employee-dashboard.md) | `aa20c4f997c44ee4bc67a99eba9db261` | default, blocked | proposed - awaiting user review | 2026-11-04 |

## Decisions
- 2026-11-04: dark theme deferred; design and export light theme only. Dark screens already generated stay in Stitch but are not exported or specified.

## Failures and retries
| Screen | What happened | Outcome |
| --- | --- | --- |
| 000 Design system | `create_design_system_from_design_md` normalised the Satori tokens (primary became `#3e3b92`) and dropped sections; `update_design_system` rejects every payload | Created the design system directly with `create_design_system` (exact DESIGN.md kept, `assets/8229316405357604751`); the import asset is superseded |
| 011 Executive dashboard | First Satori render showed the logo icon as literal text and an invented "Live System Sync" tag; `edit_screens` changes do not reach exported screenshots | Fixed as a REFINE variant (`8e3e69d7...`); `be92f0b4...` is superseded |
| 022 Budget allocation workspace | First variant timed out on the client and never returned an id; the warning-block state returned an empty session once | Regenerated (`ccdbc282...`); warning-block succeeded on retry (`0fd10f99...`) |
| 023 Budget hierarchy | Tree table clipped its right-hand columns; a REFINE fix (`78e9e808...`) recovered Available and Used % but still clips Status | Two attempts used; kept `78e9e808...` and recorded the clipped Status column in the spec; `21172b7d...` is superseded |
| 069 Rule builder | First variant failed with a Stitch 502 | Succeeded on retry (`bbb72843...`) |
