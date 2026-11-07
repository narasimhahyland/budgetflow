# `090-approval-history default › desktop`: the state that turned `main` red after #76

Run 42340927284, the post-merge run on `main` at `9e3482d`. One state failed: 2660 pixels against
an allowance of 2592 (103%), byte-identical across both attempts, so deterministic.

## Two differences adding up

Measured from that run's artifact, the diff splits in two:

| Where                       | What                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| x 0–44, the navigation rail | the rail from before the Phase 13 AI screens were added to it — the same staleness cleared for ten `080e` baselines in #76 |
| the `Decided` column        | the baseline reads `5 Nov 2026, 12:27 EST`, the run rendered `7 Nov 2026, 00:05 EST`                                       |

Neither crossed the allowance alone. Together they did.

## Why the timestamp moves

The Decided column renders the real decision time, and the seed makes those decisions when it
runs, so the value tracks the moment of the seed — a different day and a different hour on every
run. That is the same family as the cause of #73: data moving on a wall clock under a suite that
deliberately freezes the browser clock. Re-recording it would have bought a few hours.

Every other seed-time timestamp in the app is already wrapped in `data-testid="relative-time"`,
which `apps/web-e2e/visual/screens.json` masks globally — `api-keys`, `report`, `health`,
`board-pack`, including inside tables. This one cell was not. Now it is.

## Verification

Full `visual-light` project, no filter, fresh stack and deterministic seed before each run,
pinned image `mcr.microsoft.com/playwright:v1.64.1-noble`:

```text
run 1: 629 passed (5.5m)                    0 failed, 0 flaky
run 2: 628 passed, 1 flaky (5.6m)           0 failed
       flaky: 016a-board-pack draft › mobile (passed on retry)
```

States specifically checked in run 2:

```text
✓ 090-approval-history default › desktop / tablet / mobile
✓ 080e-period-close-checklist blocked › desktop / tablet / mobile      (#73)
✓ 011a-ai-assistant-panel action-redirect › tablet                      (#70)
✓ 050-event-approval-workflow default › mobile                          (#74)
```

The re-recorded images were opened and checked: the mask covers the Decided cells and nothing
else, the rest of the page is unchanged, and the navigation rail is current.

## Predicted by the headroom report

`npm run visual:headroom`, added in #76, had this state at **93% of its allowance** before it
tipped over — it is in `visual-headroom-report.md` in this directory at 2402 px of 2592. That is
what the report is for. 41 states remain at 70% or more.
