# UX review log

Every Stitch design and its review status. The user chose autonomous delivery: designs are recorded as **proposed - awaiting user review** and implementation may start from them; a later review changes the status to approved or lists the changes needed.

Stitch project: `projects/1643421514270618068`. Design system: `assets/8229316405357604751` (BudgetFlow Satori). Images live in `design/stitch/<NNN-slug>/`; specs in `docs/ux/screens/`.

| Screen | Spec | States (image files) | Default Stitch screen | Status | Date |
| --- | --- | --- | --- | --- | --- |
| 000 Design system | [spec](screens/000-design-system.md) | default light, default dark | `5d02c6a4235a47d7968986b9629e76b9` | proposed - awaiting user review | 2026-11-04 |
| 000a Application shell | [spec](screens/000a-app-shell.md) | default light, default dark, switcher-open, notifications-open, search-open, employee-forbidden, nav-drawer-open (mobile) | `fd62ca975f5b497e960db74a6f608b2c` | proposed - awaiting user review | 2026-11-04 |
| 011 Executive dashboard | [spec](screens/011-executive-dashboard.md) | default, loading, empty, error | `be92f0b4721f4632a3e01098b0f8b9e6` | proposed - awaiting user review | 2026-11-04 |

Per-state Stitch screen ids are in each spec and in `design/stitch/<NNN-slug>/meta.json` (`approved: null`, `status: proposed - awaiting user review`).

## Failures and retries
| Screen | What happened | Outcome |
| --- | --- | --- |
| 000 Design system, dark | `generate_variants` timed out on the client | Generation finished server-side; found with `get_project` and exported |
| 000a Application shell, dark | First render had a low-contrast title and a broken user row; `edit_screens` changes do not reach exported screenshots | Fixed as a REFINE variant (`cdd3e3dc...`); the first render (`0dd60c15...`) is superseded |
