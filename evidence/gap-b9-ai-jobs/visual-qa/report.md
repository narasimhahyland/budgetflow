# Visual QA — 011a, 016b, 017c, 113a (gap B9)

| Iteration | Captures | Automated blocking | Inspection blocking           | Fixed |
| --------- | -------- | ------------------ | ----------------------------- | ----- |
| 1         | 51       | 0                  | 1 (113a mobile stacked cells) | yes   |
| 2         | 51       | 0                  | 0                             | —     |

- Stop reason: no blocking findings (iteration 2).
- New states in `apps/web-e2e/visual/screens.json`: 011a `report-dialog`; 113a `reported-answers` and `review-dialog`.
- Fixes (before/after): `before-after/113a-reported-answers-mobile--before.png` -> `--after.png` (stacked cells grouped).
- Remaining non-blocking findings: `iter-2/inspection.md`.
- Design parity: 113a has no approved Stitch export (the spec says the image is pending), and neither does the 011a dialog; both were checked against `docs/ux/screens/113a-ai-settings-query-log.md`, `011a-ai-assistant-panel.md` and the Satori rules.
- Exploratory: the journey `apps/web-e2e/src/ai/reported-answers.spec.ts` drives report, review, the auditor's read-only view, the status filter and the forbidden state at all three viewports.
- Baselines: updated with `npm run e2e:update-snapshots -- -g "011a|016b|017c|113a"` in the pinned image. Reason: 011a answers gained "Report a problem"; 016b and 017c show which nightly scan they display; 113a's query log gained the All activity / Reported answers sub-tabs; new 011a and 113a states.
- Gate follow-up: the 011a `report-dialog` state opens from the out-of-scope answer, a short page, so the background's scroll offset and masks no longer vary with suite order. Its baselines and the two 113a mobile states (copy changed by the review fixes) were re-recorded, and the full visual gate passed.
