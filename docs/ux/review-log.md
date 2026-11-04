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
| 115 Employee dashboard | [spec](screens/115-employee-dashboard.md) | `b42ff3f7211c4f85bd165d75d9aa1e8f` | default, blocked | proposed - awaiting user review | 2026-11-04 |

## Preview
Click-through review copy: [BudgetFlow Satori - Design preview](https://stitch.withgoogle.com/preview/4948604653652709875) (private until shared from the Stitch web app; static screens without clickable links between them). Per-screen preview links in flow order, plus links to every exported state: [preview.md](preview.md).

| Screen | Preview copy | Exported default |
| --- | --- | --- |
| 000 Design system | - | [5d02c6a4](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=5d02c6a4235a47d7968986b9629e76b9) |
| 000a Application shell | [aec8768a](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=aec8768aea754d11ab5575b46b932e6a) | [fd62ca97](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=fd62ca975f5b497e960db74a6f608b2c) |
| 011 Executive dashboard | [609c9843](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=609c9843515a4ab6b9b727936980c79e) | [8e3e69d7](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=8e3e69d7a1894ea68503b203dd1141e0) |
| 023 Budget hierarchy | [7b76bc04](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=7b76bc042a4e447e9216145c70273f08) | [78e9e808](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=78e9e80886724ba799cba008d430c342) |
| 022 Budget allocation workspace | [f4c64e2f](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=f4c64e2f9759456bbbac8c88238a2a40) | [ccdbc282](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=ccdbc282cac64caeba9a188fb6fcc676) |
| 045 Create event budget | [212fec96](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=212fec966dda41d7aa3856d8baa2bf59) | [bd913fe9](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=bd913fe9a61c407bb2da75de0b33b6fa) |
| 059 Approval inbox | [c40f9c36](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=c40f9c3629fa4a31ba9604ff8cd69a87) | [989446b5](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=989446b543a047778ce424b9107f5fc7) |
| 088 Audit log | [39dda5cc](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=39dda5cc01e84c1285ef9abe3ef75dfc) | [eb69eed0](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=eb69eed067bf4f34a1dcba6b01ccd962) |
| 069 Rule builder | [7cee12c6](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=7cee12c66ef441fc8944ea6df7f22a13) | [bbb72843](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=bbb72843f67d43a087e8308adcf569d7) |
| 115 Employee dashboard | [0f22185c](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=0f22185c21f145f1afa977e36d0f4ad3) | [b42ff3f7](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=b42ff3f7211c4f85bd165d75d9aa1e8f) |

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
