# UX review log

Every Stitch design and its review status. Implementation agents may build from "proposed" designs; the user's decision is recorded here and in the screen's `design/stitch/<NNN-slug>/meta.json` (`approved` date).

Stitch project `1643421514270618068`, design system `assets/8229316405357604751` (BudgetFlow Satori, light only).

| Screen | Spec | Default Stitch screen | States exported | Status | Date |
| --- | --- | --- | --- | --- | --- |
| 000 Design system | [spec](screens/000-design-system.md) | `5d02c6a4235a47d7968986b9629e76b9` | default | proposed - awaiting user review | 2026-11-04 |
| 000a Application shell | [spec](screens/000a-app-shell.md) | `fd62ca975f5b497e960db74a6f608b2c` | default, switcher-open, notifications-open, search-open, employee-forbidden, nav-drawer-open (mobile) | proposed - awaiting user review | 2026-11-04 |
| 011 Executive dashboard | [spec](screens/011-executive-dashboard.md) | `8e3e69d7a1894ea68503b203dd1141e0` | default, loading, empty, error | proposed - awaiting user review | 2026-11-04 |

## Decisions
- 2026-11-04: dark theme deferred; design and export light theme only.
