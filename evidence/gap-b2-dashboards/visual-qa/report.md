# Visual QA — 012, 017, 017a (gap B2, part 1)

Built from the written specs (decision D2); no Stitch design exists, so parity was judged against
`docs/ux/screens/012-*.md`, `017-*.md`, `017a-*.md` and the budget-safety rules.

| Iteration | Captures                    | Automated blocking | Inspection blocking | Fixed                                                                                                                      |
| --------- | --------------------------- | ------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1         | 27 (9 states x 3 viewports) | 0                  | 2                   | integrity, feeds and FX cards had no inner padding (content touched the card edge)                                         |
| 2         | 27                          | 0                  | 2                   | feeds list still unpadded (its own margin reset beat the card body); the forbidden state still offered "Open period close" |
| 3         | 27                          | 0                  | 0                   | —                                                                                                                          |

- Stop reason: no blocking findings (iteration 3). Capture report: `capture-report.md`.
- Fixes (before/after): `before-after/012-default-desktop--before.png` -> `--after.png`;
  `before-after/012-forbidden-owner-desktop--before.png` -> `--after.png`.
- Representative captures: `screens/`.
- Checked: hard block in the error tone and not snoozable; warnings in the warning tone; frozen in the
  info tone with the lock icon; set to zero in the important tone; severity written on every card;
  ticks, warnings and crosses with words; FX effect in its own card, "Not part of spend or available";
  money with currency code and tabular numerals; plain-English copy.
- Remaining non-blocking findings:
  - Mobile: the close-status table and the by-type table scroll sideways instead of one card per
    entity or type, as the specs suggest for mobile. Readable, nothing clipped.
  - The Export menu (CSV, XLSX, PDF) and Schedule delivery of the three specs are not built; the
    dashboards are not report-frame reports, so the A1 export path does not apply as is.
  - No sidebar entries: every full-page baseline renders the navigation rail, so adding items shifts
    every baseline. Pages are reached by URL and from each other (finance overview <-> exceptions).
- Exploratory: the journeys in `apps/web-e2e/src/reports/dashboards.spec.ts` click the queue tile to
  the unmatched queue, acknowledge an alert as the regional manager (snackbar, card leaves Open,
  appears under Acknowledged with "You acknowledged this"), drill into one exception type, and open
  each page as a refused role.
- Baselines: 27 new baselines recorded with `npm run e2e:update-snapshots -- --grep ...` in the
  pinned image. Reason: new screens 012, 017 and 017a.
- ux-reviewer hand-off: not run in this session (the subagent is not available here); the
  inspection above is the author's.

## Part 2 — 018, 018a, 018b, 088a

| Iteration | Captures                     | Automated blocking | Inspection blocking | Fixed                                                                                           |
| --------- | ---------------------------- | ------------------ | ------------------- | ----------------------------------------------------------------------------------------------- |
| 1         | 33 (11 states x 3 viewports) | 0                  | 1                   | 088a generate form laid out by the shared `.bf-form` grid: selects and checkboxes interleaved   |
| 2         | 33                           | 0                  | 0                   | non-blocking polish: channel and source names written out, "1 decision", unused-budget sentence |
| 3         | 33                           | 0                  | 0                   | —                                                                                               |

- Stop reason: no blocking findings (iteration 3). Capture report: `capture-report-part-2.md`.
- Fix (before/after): `before-after/088a-list-empty-desktop--before.png` -> `--after.png`.
- Checked: pending amounts shown as pre-encumbered (pending tone, dashed KPI) and co-funding as
  "not yet held"; SLA tags in words; no approve or reject control on 018; analysts see no names on
  018a; targets written next to each KPI on 018b; Generate is the `satImportantButton`; attendee
  details and comments off by default on 088a.
- Remaining non-blocking: on mobile the 018 tables scroll sideways rather than becoming cards; the
  "Evidence pack" entry on event and budget details (046, 021) is not added, the list page takes
  `?subjectType=&subjectId=` so those screens can link to it; no Export menu on 018, 018a, 018b.
- Baselines: 33 new, recorded with `npm run e2e:update-snapshots -- --grep ...` in the pinned image.
  Reason: new screens 018, 018a, 018b and 088a.
