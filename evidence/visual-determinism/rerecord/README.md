# Handoff 2.2 step 2: classifying the differing baselines before any re-record

Status: **measured, nothing recorded.** Against `main` at `b2141ae`, with every clock change from
issue #86 merged.

## Method

A zero-allowance run (`npm run visual:headroom`) saves an expected and an actual image for every state
that differs at all. [`tools/railsplit.mjs`](tools/railsplit.mjs) splits each pair's differing pixels
into the navigation rail (x < 56) and the content, with the content bounding box.
[`tools/contact-sheet.mjs`](tools/contact-sheet.mjs) renders the changed regions old | new for
inspection. Both use the Node standard library only. They are analysis aids for this record, not
harness tooling.

Three runs from fresh seeds, on the same day:

| Run | Differing states | Duration | Notes                                                                                                                                                                                                                    |
| --- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 485              | 11.0 min | [`run1-classified.tsv`](run1-classified.tsv)                                                                                                                                                                             |
| 2   | 461              | 19.9 min | Stack slowed from test #748; the last 35 states timed out on the Keycloak sign-in page under resource pressure (another stack was running). Those states were not compared. [`run2-classified.tsv`](run2-classified.tsv) |
| 3   | 485              | 10.8 min | Other stack stopped; zero timeouts. [`run3-classified.tsv`](run3-classified.tsv)                                                                                                                                         |

A state counts as stable only when its total, rail and content counts are identical in every run that
compared it: [`stable-across-runs.txt`](stable-across-runs.txt) (399) and
[`varying-between-runs.txt`](varying-between-runs.txt) (87, never to be recorded as they stand).

## The caveat was right: not all of them are rail drift

| Stable states           | Count |
| ----------------------- | ----- |
| Differ only in the rail | 290   |
| Differ in content       | 109   |

The 109 were inspected on contact sheets; the index is [`content-sheet-index.txt`](content-sheet-index.txt).
They fall into four kinds:

1. **Seed growth.** Most of these baselines were last recorded on 5 November; the Phase 10–16 seeds
   landed on 6–7 November. Figures, counts and documents moved accordingly, every one within its
   state's allowance and therefore green. The two deltas traced exactly: Available −240 is IDC-00003
   (USD 240), and −1,500 is REQ-00007 (USD 1,500). Others: `056a` −3,954; `013` 20.0% → 19.4%; `023`
   set-to-zero 1,226.25 → 3,678.75; `059` Completed 4 → 5; `060` Documents 0 → 3. A baseline is not the
   authority for money; the functional suites are (ledger rebuild equals cached balances).
2. **Corrections the baselines were hiding.** Report screens showed the generic title "Report" in the
   mobile top bar and the desktop breadcrumb — the `086` defect from the handoff, on eight screens.
   Disabled "Give award" and "Submit claim" buttons were unstyled in the baseline. `051a` quotes now
   show "Expired", a consequence of the pinned clock that sat inside its allowance.
3. **Mechanism explained, trigger not.** `080e` acknowledge dialog on mobile: tapping the button
   scrolls the wide checklist table sideways, hiding the status column behind the dialog. The other
   three `080e` mobile states are identical to their baselines, so the chips render; why the scroll
   amount changed after 6 November is not established.
4. **Real-date-dependent — must not be recorded yet.** Same-day runs cannot see a value that changes
   once a day, so three identical runs are not proof here:
   - `065` counter-offer shows the seed's real date ("5 Nov" → "9 Nov") and an expiry 7 days later,
     both from `Date.now()` at routing.
   - `066` rules overview buckets decisions by week from `evaluatedAt`, seeded from real time.
     Handoff 2.2 step 1 left that seed on real time because ages compare against `Date.now()`; that
     holds for ages and is wrong for anything rendered as a date.
   - Most of the 39 hairlines are **mask edges moving by 1–3 px**: the masked text changed length. A
     mask hides glyphs, not their width (issue #70), and some masked values are real-time.

## A product defect found on the way

`libs/api/channels/src/lib/channels.service.ts` around line 1690 falls back to the hard-coded name
"Nadia Farouk" as the installer of a chat app whenever the real installer is missing or cannot be
looked up. The old `061e` baseline showed it; the seed now records the real installer. Any tenant
without a recorded installer would be shown a fictitious person on a screen that reads as an audit
trail. Out of scope for this record; worth its own change.

## What can be recorded, and when

The 290 rail-only states are already proven stable **across days**: their content is identical to
baselines recorded on earlier dates. The real-date-dependent group is not, and recording it would
restart issue #86 from the day after. Two ways forward, not yet decided:

- **Fix the remaining real-time sources first, then one re-record** — the order handoff 2.2 asks for.
  Acceptance: two headroom runs on different real dates agree.
- **Record the proven-stable part now** and leave the date-dependent states for after the fix, which
  makes it two re-records.
