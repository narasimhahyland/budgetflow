# Visual QA — 000a application shell (navigation) and 023 budget hierarchy

| Iteration             | Captures                    | Automated blocking                                                                | Inspection blocking                                                                            | Fixed |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----- |
| before (reproduction) | 24 (6 viewports x 4 states) | n/a                                                                               | 1: menu clipped flush against the account row, items unreachable without hover, Escape ignored | —     |
| 1                     | 33                          | 0 (1 warning: layout shift 0.173 in the set-to-zero dialog, tablet, pre-existing) | 0                                                                                              | yes   |

- Stop reason: no blocking findings.
- Fixes (before/after), in `../before-after/`:
  - `desktop-1024x768--expanded--before.png` -> `--after.png` (the reporter's case: "My requests" cut under "Ananya Iyer" -> divider above the account row)
  - `desktop-1024x600--expanded--before.png` -> `--after.png` (short window: account row on top of EVENTS -> menu scrolls above it)
  - `desktop-1024x768--expanded-scrolled--before.png` -> `--after.png` (end of the menu reachable without hover)
  - `tablet-834x1112-ceo--expanded-scrolled--before.png` -> `--after.png`, `mobile-412x915-ceo--expanded-scrolled--before.png` -> `--after.png` (touch users reach "Audit log")
  - `*--closed--before.png` -> `--after.png` (closing reveals the page; unchanged)
- Remaining non-blocking findings: rail does not highlight the active item on URLs with query parameters (pre-existing, follow-up); layout shift in the set-to-zero dialog on tablet (pre-existing).
- Design parity: `iter-1/design-parity/design-parity.md`
- Exploratory: `exploratory.md`
- Baselines: updated for `000a-app-shell` (19 files: every desktop and tablet state shows the rail divider; the three nav-drawer-open states show the scrollable menu above the divider). Other screens' baselines differ only by the 48px rail divider, within the 0.2% threshold, and were left unchanged.
