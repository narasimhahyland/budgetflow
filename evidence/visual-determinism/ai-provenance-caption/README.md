# AI provenance caption: a stable width for the query-log id

Status: **fixed; 27 caption baselines re-recorded; two zero-allowance runs from a fresh seed show
every caption state matching exactly.** Branch `fix/adoring-mclaren-6b335f`, from `main` at `dd39763f`.

## Symptom

069a policy assistant `is-allowed` and 011a AI assistant panel `action-redirect` and
`refused-out-of-scope` were flaky at tablet: they passed only on retry in the Phase 19 gate on `30d64422`,
and 069a tablet failed CI on #108 twice (2,631 px). All 27 caption states were on #108's list of states
that varied between runs and were left unrecorded
([`../after-clock/varying-not-recorded.txt`](../after-clock/varying-not-recorded.txt)).

## Cause

The caption ends "Query log entry `<id>`.", with the id cut to eight hex characters. The visual suite
masks the id (`[data-testid=ai-ids]`), but a mask hides glyphs, not width. In the body-small font
(Noto Sans 12px) digits and `a`/`e` are 7px, `b`/`d` 8px, `c` 6px and `f` 4px, so the id's width varied
per run. On tablet that was enough to move the id onto a second line or not, which changed the
card's height.

`0bc4f02e` fixed this by setting the id in a monospace font. `7b688666` later removed that
`font-family` declaration, which the stylelint config bans in app styles, and the variation came back.

## Fix

Each id sits in an `inline-block` box of fixed width, `9.25ch` with tabular numerals. Eight of the widest
glyphs (`b`, `d`) measure 9.14ch, measured in the pinned Playwright image against the running app. So
line breaking sees the same width whatever the id is, without declaring a font. `nowrap` and the
full stop directly after the span still keep the sentence from breaking inside the ids.

- `libs/web/features/ai/src/lib/ai-output.ts`: `bf-ai-provenance`, used by 011a, 017c, 022d, 069a,
  080f and 121a (query-log id, plus the suggestion id where there is one).
- `libs/web/features/extended/src/lib/figures.ts`: `bf-ai-draft-note`, used by 011b and the summary
  detail. The same rule is duplicated here because feature libs cannot import each other.

## Runs

Each run is `npm run visual:headroom -g '011a-|011b-|017c-|022d-|069a-|080f-|121a-|113a-'` after a fresh
`scripts/stack.sh reset`, which measures 83 states at 1440, 834 and 412 px.

| Run | Code  | Baselines   | States differing                                                        | Report                                 |
| --- | ----- | ----------- | ----------------------------------------------------------------------- | -------------------------------------- |
| 1   | fixed | `main`      | 29: the 27 caption states plus 113a ×2; identical pixel counts to run 2 | [`headroom-run1.md`](headroom-run1.md) |
| 2   | fixed | `main`      | 29, the same counts                                                     | [`headroom-run2.md`](headroom-run2.md) |
| 3   | fixed | re-recorded | 2 (113a only)                                                           | [`headroom-run3.md`](headroom-run3.md) |
| 4   | fixed | re-recorded | 2 (113a only), the same counts                                          | [`headroom-run4.md`](headroom-run4.md) |

Runs 1 and 2 match pixel for pixel, so the fixed caption renders deterministically. The 27 differences
are the new layout against baselines recorded with the old one. They were re-recorded with
`npm run e2e:update-snapshots -- --update-snapshots=all -g '011a-|017c-|022d-|069a-|080f-|121a-'` from a
fresh reset ([`rerecorded.txt`](rerecorded.txt)). Four further files that Playwright re-encoded but
that had matched exactly in both runs were restored rather than committed.

**113a query-log is not caused by this change.** `query-log.page.ts` uses neither component. With the
table masked, the only difference is the number of log rows: the full suite makes more AI calls
before 113a than the scoped run does, so the baseline has a "Show more" button and the scoped render
doesn't. It depends on suite order and is not re-recorded here. The full gate below runs it in its
real order.

A full-suite headroom run was also attempted. It lost its Keycloak session after 142 states on a
heavily loaded machine (load average about 7, 35 containers), and the remaining 801 states timed out
on the sign-in page without reaching a comparison, so it measured none of the caption screens. It
does not count as one of the two runs.

## Gate

`scripts/gate.sh` (all modes) on the working tree with this change: every step PASS
([`gate-summary.txt`](gate-summary.txt); it names `dd39763f`, the commit the change sits on). The
visual step ran all 944 states in 15.2 minutes: 944 passed, none flaky, no retries. That includes 113a
query-log, which passes in its real suite order.
