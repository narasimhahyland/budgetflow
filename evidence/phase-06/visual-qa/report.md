# Phase 6 visual QA — 080a, 080b, 080c, 080d, 085a, 053, 054 (plus matched actuals and mapping rules)

Scope: the Phase 6 accounting screens at desktop (1440x900), tablet (834x1112) and mobile (Pixel 7), light theme only (dark theme deferred), on this worktree's stack with the deterministic seed (freshly reset before iterations 2 and 3), signed in as the finance controller, the finance admin (sign-off), the auditor (read-only) and an employee (forbidden). Captures use `screens.p6.json` in this folder with `scripts/visual/capture.mjs`; the shared `apps/web-e2e/visual/screens.json` is integrator-owned and unchanged (entries proposed in the PR).

Designs: 080a, 080b and 080c have proposed Stitch exports and were compared side by side (`iter-3/design-parity/`). 080d, 085a, 053 and 054 have proposed specs (open UX PR #14) but no images yet; they were built from `docs/ux/design-system.md` and aligned with those specs, and checked against the specs and the rules only.

| Iteration | Captures | Automated blocking                             | Inspection blocking                                                                                                                                                                            | Fixed |
| --------- | -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1         | 54       | 3 (horizontal overflow on three mobile tables) | 4: commitment totals added INR and USD and labelled the sum USD; upload state still showed the previous import; active tab not highlighted with query parameters; "All" filters rendered blank | yes   |
| 2         | 54       | 0                                              | 0 (minor: drawer pre-selected a commitment when there was no suggestion; event close tab not highlighted on an event)                                                                          | yes   |
| 3         | 54       | 0                                              | 0                                                                                                                                                                                              | —     |

- Stop reason: no blocking findings (iteration 3).
- Warnings left (non-blocking): cumulative layout shift 0.10-0.14 on tablet for 080a and 085a while data loads (threshold for blocking 0.25).

## Fixes (before/after)

- `before-after/085a-commitment-hygiene-mobile--before.png` -> `--after.png`: totals now in USD at the locked plan rate from the ledger (USD 5,051.77 instead of a mixed-currency "USD 256,060.00"); the hidden "Actions" header label no longer widens the page.
- `before-after/080a-upload-tablet--before.png` -> `--after.png`: the upload form replaces the previous import's review instead of stacking above it.
- `before-after/080b-filters-desktop--before.png` -> `--after.png`: Entity and Currency show "All", the search field takes the remaining width, dates and references no longer wrap.
- `before-after/080a-tabs-kpis-desktop--before.png` -> `--after.png`: the active tab is highlighted when the URL has query parameters; KPI cards fill the row like the design.

## Inspection (iteration 3)

| Screen                                   | Check                                                                                                                                                                                                   | Result |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 080a import (review, upload, auditor)    | Stepper, file chip, five KPI cards, by-currency table with locked plan rate and USD at plan, FX banner, rules applied with meter; auditor sees no import actions                                        | pass   |
| 080b queue and drawer                    | Filters, status tags, suggested match with confidence; drawer shows transaction, USD at plan, month-end or spot value and FX effect separately; over-tolerance banner and over-budget action            | pass   |
| 080c tie-out                             | Entity chips (difference vs tied), reconciliation table with difference tone and unmatched-line cause, drill-down to ledger lines and queue lines, sign-off checklist with the blocking reason per role | pass   |
| 080d accruals and prepaids               | Accrued shown apart from consumption, reversal trigger, deposit with consumed and still encumbered                                                                                                      | pass   |
| 085a commitment hygiene                  | Aging buckets in USD, release suggested, accrued and deposit tags, inline release and cancel                                                                                                            | pass   |
| 053 / 054 event reconciliation and close | Blockers in error tone with counts, close disabled with the reason, confirmation of the final cost, contributors with surplus                                                                           | pass   |
| All                                      | Satori components and tokens only, money with ISO codes and tabular numerals (INR with lakh grouping), light theme, no clipping on tablet and mobile                                                    | pass   |

## Design parity (080a, 080b, 080c)

`iter-3/design-parity/design-parity.md`. Layout, hierarchy, components and copy follow the designs. Differences, all deliberate: the Phase 2 shell header (no global search yet), seed data and names, "Export CSV" instead of the Export menu (XLSX and PDF land with reports in P10), no "Show entity currency" toggle on the tie-out yet, and one primary "Post N matched lines" action (posting sends the rest to the queue in the same step) instead of two buttons.

## Exploratory

`exploratory.md`.

## Baselines

Unchanged: Phase 6 screens are not in the shared visual baselines (integrator-owned `screens.json`); the shell baselines still pass in the gate.
