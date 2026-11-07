# Fix 011a: the nondeterministic `action-redirect` visual state (issue #70)

Branch `fix/011a-nondeterministic-state`, base `e961a85`. Stack: own Compose project `bf-fix011a`
(web 4470, api 3270, keycloak 8350, postgres 5702, mailpit 8295, minio 9270, mocks 4270).
Every capture and comparison ran in the pinned image `mcr.microsoft.com/playwright:v1.64.1-noble`
through `scripts/visual/pw-docker.sh`, as CI does.

## Root cause

The AI provenance note (`bf-ai-provenance`, shared by seven AI screens) ends with

> AI-generated. Check the figures before you act. Model budgetflow-fake 2026.11 through fake. Query log entry `<id>` .

`<id>` is the first eight characters of the query-log UUID, generated per call. Rendered in the
proportional app font, those eight characters are **52–58 px wide** depending on which hex
characters the UUID happens to start with. The note ends within a few pixels of the edge of its
card, so that width decides whether the closing full stop — a separate wrap token, because the
template put a newline between `</span>` and `.` — stays on the first line or drops to a second.

One extra line is 18 px, and the note sits above the rest of the page, so every element below it
moves 18 px. That is the ~36,000 differing pixels (≈4 % of the 834×1112 tablet image) against a
`maxDiffPixelRatio` of 0.002.

`screens.json` masks `[data-testid=ai-ids]`, which hides the _characters_ but not their _advance
width_, so masking could never stabilise this. The pixel count differed between CI attempts
(36,667 then 36,633) because each attempt drew a mask rectangle of a slightly different width.

The issue's working theory — a seeded request whose state another suite moves — is **not** the
cause. The state reproduces on a freshly seeded stack with no other suite running, and the
paragraph text is identical on every render once the id is normalised.

## What actually varied between renders

`tmp/ai-provenance-variance.mjs` asked the same question 14 times at the tablet viewport, on one
freshly seeded stack, with the clock frozen exactly as the visual project freezes it.

|        | id glyph width         | provenance note        | distinct paragraph text (id normalised) |
| ------ | ---------------------- | ---------------------- | --------------------------------------- |
| before | 52.000 – 58.000 px     | 1 line ×4, 2 lines ×10 | 1                                       |
| after  | 48.000 px every render | 1 line ×14             | 1                                       |

Nothing else moved: no status, no relative timestamp, no counter, no model or provider string.

## The fix

`libs/web/features/ai/src/lib/ai-output.ts` only:

- each id renders in a `<code class="bf-ai-provenance__id">` with `display: inline-block;
width: 8ch; overflow: hidden; white-space: nowrap`, so its width depends on the number of
  characters and nothing else. This is the treatment the audit log already uses for its hash
  (`code.bf-audit__hash`, `width: 11ch`); the project bans `font-family` in app styles, and a
  `<code>` element gets a monospace face from the browser without one.
- the full stop is glued to the ids instead of following a space, so it can never be orphaned on a
  line of its own.

The baseline was **not** re-recorded to whichever variant rendered, no mask was widened, and no
state was skipped.

## Siblings

| Screen                                                          | Shares the flaw                                                                                                         | Action                                                                                                                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `011a` `refused-out-of-scope`, `action-redirect`                | yes — observed flaky                                                                                                    | fixed (shared component)                                                                                                                                  |
| `011a` `answer`, `061f`, `017c`, `022d`, `069a`, `080f`, `121a` | yes — same component, not observed flipping                                                                             | fixed (shared component)                                                                                                                                  |
| `113a` query-log table                                          | latent: two `ai-ids` spans sit in a masked `<tbody>` whose auto-layout column widths still drive the unmasked `<thead>` | left alone — never observed flaky across five full runs; noted as a follow-up                                                                             |
| `050-event-approval-workflow default › mobile`                  | no — different cause                                                                                                    | reported separately: the "Confirm funding" action is absent on the first render and present on the retry, i.e. a missing wait condition, not a width leak |

## Baselines re-recorded

Nine, all states whose note previously wrapped to two lines: `011a` `refused-out-of-scope` and
`action-redirect` (three viewports each), `069a-policy-assistant is-allowed` (desktop, tablet) and
`121a-receipt-quote-extraction check-fields` (tablet). Reason: the ids now render monospace in a
fixed box and the full stop no longer follows a space, so the note legitimately renders
differently. Every other state that shows the note was re-run and produced a byte-identical PNG.

## Multi-run stability

Full `npm run e2e:visual` (all 629 states), each run preceded by `scripts/stack.sh reset`:

| Run                           | Result                            | Flaky / failed states                                        |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------ |
| before, run 1                 | 627 passed, 2 flaky               | `050 default › mobile`, `011a refused-out-of-scope › tablet` |
| before, run 2                 | 627 passed, 2 flaky               | `050 default › mobile`, `011a action-redirect › tablet`      |
| after, survey (old baselines) | 620 passed, 9 failed              | the nine states whose note legitimately changed              |
| after, run 1                  | **629 passed, 0 failed, 0 flaky** | —                                                            |
| after, run 2                  | **629 passed, 0 failed, 0 flaky** | —                                                            |

A _different_ 011a state was flaky in each of the two before-runs, which is the nondeterminism
itself. After the fix both runs are identical and clean.

The `011a` states alone were then re-run seven more times (`-g 011a-ai-assistant-panel`,
26 states each): repeats 1–4 and three further repeats on a fresh seed all passed 26/26. Repeats 5
and 6 of the first batch failed because the repetition had used up the product's own limit of 50
questions per person per hour and the screen correctly showed the rate-limited banner — an artefact
of hammering one seeded stack, not a regression.

`scripts/gate.sh static --affected`: see `gate-summary.txt` — secrets, lint, styles, satori,
typecheck, build, openapi and db all PASS.

## Files

- `visual/ci-run-42313160306-attempt1-diff.png` — the CI diff: the note's second line, then every
  element below shifted.
- `visual/before-baseline-two-line-note.png`, `visual/before-actual-one-line-note.png` — the two
  variants the same code produced.
- `visual/after-baseline.png` — the re-recorded baseline.
- `runs/visual-suite-runs.txt` — the five full-suite run summaries.
- `gate-summary.txt` — static gate result.
