# Baselines after the clock fix: measure, re-record 82, verify

Status: **82 baselines re-recorded and verified.** Branch `fix/visual-baselines-after-clock`, from
`main` at `6b36c66`.

## Why

#103 recorded main's baselines on the real date (around 10 Nov), before #104 pinned the seed and the
database clock to `freezeTime` (16 Nov). So those baselines hold the dates and statuses the real clock
produced, plus some UI that has changed since.

## Measure (main, unchanged)

Two zero-allowance runs (`npm run visual:headroom`), each from a fresh `scripts/stack.sh reset`, on a
stack nothing else used, with zero timeouts. 114 states differed in each run
([`measure1-classified.tsv`](measure1-classified.tsv), [`measure2-classified.tsv`](measure2-classified.tsv)).
85 differed by identical total, rail and content counts in both runs, across 30 screens. The other 30
moved between runs.

The stable 85 are content, not drift. [`sample-old-vs-new.png`](sample-old-vs-new.png) shows the
changed region of 8 of them, baseline on the left and today's render on the right:

| State                                    | Baseline                          | Today (pinned clock)                       |
| ---------------------------------------- | --------------------------------- | ------------------------------------------ |
| 060 request details, approver            | "10 Nov 2026"                     | "16 Nov 2026"                              |
| 065 counter-offer                        | offer runs out on 17 Nov          | 23 Nov                                     |
| 059a mobile approvals                    | Overdue                           | Pending                                    |
| 021 budget details, set to zero          | Request increase enabled          | disabled (set to zero blocks new requests) |
| 079 and five other forbidden / not-found | heading in regular weight         | bold, as the current shell renders         |
| 064a digest editor, 105 feature flags    | no focus ring on the active field | focus ring                                 |

## Record

`npm run e2e:update-snapshots -- all` from a fresh reseed. The default update mode rewrites nothing
here: every one of these states is within the 0.002 tolerance, so they only show up at zero allowance.
`all` rewrites every baseline, so every file outside the stable 85 was restored from `main`.

Each recording was then compared with the renders both measurement runs saved in comparison mode
([`recorded-vs-measurement-renders.tsv`](recorded-vs-measurement-renders.tsv), written before 080f was
put back, so it lists 83; the four `CHANGED-though-runs-matched-old` rows are states whose render folder
Playwright truncates, checked separately at 0 px against both runs):

| Outcome                                                                    | States | Kept as                                  |
| -------------------------------------------------------------------------- | ------ | ---------------------------------------- |
| Recording pixel-identical to both runs' renders                            | 76     | the recording                            |
| Both runs' renders identical, recording 1-46 px off (an update-mode frame) | 6      | the comparison render both runs produced |
| Renders differ between runs (011a mobile, 017c tablet, 080f mobile)        | 3      | not re-recorded: main's baseline stays   |

080f mobile first looked like the second case. Both verification runs then moved it within the same
12 x 16 px glyph region (57 and 125 px), so it was put back. The full list is in
[`rerecorded.txt`](rerecorded.txt) (82).

## Verify (this branch)

Two more zero-allowance runs from fresh reseeds, zero timeouts:
[`verify1-classified.tsv`](verify1-classified.tsv) (28 differing),
[`verify2-classified.tsv`](verify2-classified.tsv) (31 differing; 080f was still in the set). Every
differing state in both runs is on [`varying-not-recorded.txt`](varying-not-recorded.txt) (33 = the 30
that varied while measuring, plus 011a, 017c and 080f). None of the 82 re-recorded states differs.

## Left open

The 33 varying states are nondeterminism and need a fix in the render, not a baseline. All of them pass
at the 0.002 tolerance today.
