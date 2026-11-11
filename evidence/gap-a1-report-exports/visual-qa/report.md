# Visual QA — report frame Download (080, 082, 086) and 091 scheduled reports and exports

| Iteration | Captures         | Automated blocking | Inspection blocking                       | Fixed          |
| --------- | ---------------- | ------------------ | ----------------------------------------- | -------------- |
| 1         | 15 + exploratory | 0                  | 1 (saved-view star unsized, pre-existing) | sized to 18 px |
| 2         | 15 + exploratory | 0                  | 0                                         | —              |

- Stop reason: no blocking findings.
- Fixes (before/after): `before-after/saved-view-star--before.png` -> `before-after/saved-view-star--after.png`.
- Remaining non-blocking findings: on mobile the Recent exports Download column scrolls with the
  table (the app's table pattern); the "File" header is a visible label on purpose.
- Design parity: 091 has no approved Stitch export (spec only, `docs/ux/screens/091-export-scheduled-reports.md`);
  the report frames keep their approved layout, only the button label and menu changed.
- Inspection: `iter-1/inspection.md`, `iter-2/inspection.md`. Exploratory: `exploratory.md`.
- Baselines: updated for 087 (header reflows around "Download") and 091 (new banner and hint copy);
  080, 082 and 086 stayed within the threshold. Compare run in the pinned image
  `mcr.microsoft.com/playwright:v1.64.1-noble`: 942 passed, 2 flaky (011a and 069a tablet, the
  carried AI-caption id wrap, green on retry; unrelated). Two baselines of those screens that moved
  during the update run were reverted, not committed.
- ux-reviewer: pass with non-blocking findings (the two above). It also noted pre-existing items
  outside this change: 091's exports table lacks the spec's size and requested-at columns, and the
  082 drill-down's close button and Owner cell crowd on tablet and mobile.
