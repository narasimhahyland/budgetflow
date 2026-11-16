# Visual QA — 094b finance and payroll exports

No approved Stitch design exists (the spec's images are pending), so the screen is checked against
`docs/ux/screens/094b-finance-payroll-exports.md` and the frontend rules. States captured: default
(empty month), new-export (dialog with the balanced preview of the seeded recharge), forbidden (budget
owner), at desktop 1440, tablet 834 and mobile 412, light theme.

| Iteration | Captures | Automated blocking     | Inspection blocking                                                   | Fixed                                                                                                         |
| --------- | -------- | ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1         | 9        | 2 (layout shift 0.291) | 2 (empty period select, clipped dialog labels)                        | period bound to the list's month; dialog filter grid with top padding; rate without trailing zeros            |
| 2         | 9        | 2 (layout shift 0.291) | 0                                                                     | traced the shift to the header actions wrapping; toolbar moved to its own row                                 |
| 3         | 9        | 0                      | 2 (dialog wider than itself on tablet/mobile; table headers touching) | `minmax(0, 1fr)` dialog column; cell padding; nowrap headers                                                  |
| 4         | 9        | 0                      | 0                                                                     | —                                                                                                             |
| 5         | 9        | 0                      | 0                                                                     | ux-reviewer findings: empty-state padding, wider Type, "Reporting rate", date-only values without a UTC shift |

- Stop reason: no blocking findings (iterations 4 and 5).
- Fixes (before/after): `before-after/default-desktop-period--before.png` -> `--after.png`;
  `before-after/new-export-desktop-labels--before.png` -> `--after.png`;
  `before-after/new-export-tablet-overflow--before.png` -> `--after.png`;
  `before-after/empty-state-padding--before.png` -> `--after.png`.
- Remaining non-blocking findings: see `iter-5/inspection.md`; the list uses the finance pages' plain
  table, not `mat-table` with row states as the spec's component list suggests (consistent with 080g
  and 080h); the populated list, re-export and payroll states are covered by the journey and the
  functional screenshots, not by visual baselines (a populated state would need a mutating capture).
- Exploratory: the journey `apps/web-e2e/src/finance-admin/finance-exports.spec.ts` clicks through every
  flow (create per type, downloads, view lines, re-export warning, reason, Mark posted); screenshots of
  the populated list and the lines dialog in `../functional/screens/`.
- Baselines: added for 094b (9 images, created with `--update-snapshots -g 094b` in the pinned image).
- ux-reviewer verdict: pass with non-blocking findings (no blockers). Findings 1, 2 and 4 fixed in
  iteration 5; 3 (mobile totals), 5 (component choice), 6 (populated states not in baselines) recorded
  above; 7 (tablet nav rail clipping) belongs to the shell, not this screen.
