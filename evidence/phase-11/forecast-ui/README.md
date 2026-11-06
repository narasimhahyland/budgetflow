# Phase 11 frontend: forecast and variance (087), forecast cycle (87a), board pack (16a)

The Angular screens for the Phase 11 backend that landed in `feat/p11-forecast-boardpack`, plus a
fix to the report catalog's card grid (079). No contract, API, worker, database or seed file is
touched: every figure on these screens is rendered exactly as the API typed it.

## The 079 card-grid overlap

A card that wrapped to a second row sat on top of the "Screen NNN" footer of the card above it. It
was pre-existing and baked into the Phase 10 baselines: `baseline-before--tablet.png` shows the
wrapped row clipping "Screen 080" and "Screen 081", and the tenth report card (087) pushed the same
overlap onto desktop.

**Cause.** `.bf-report` fills its grid row with `height: 100%`, and the app has no `border-box`
reset. The row track was sized from the card's content and then `height: 100%` resolved to that
track as the card's **content box**, so its 16px of padding top and bottom and its 1px border were
added on top. Measured on the running app at the tablet viewport: grid rows `122px 122px 122px`,
card border-box height `156px` — 34px of overflow against a 12px row gap, leaving each wrapped row
22px over the row above it.

**Fix.** `box-sizing: border-box` on `.bf-report`, one declaration, in
`libs/web/features/reports/src/lib/catalog.page.ts`. Nothing else changed about the grid: the cards
in a row still share a height, and no card is clipped internally.

**Confirmed by eye, not by a green diff**, because the bug was in the baseline:

| Viewport | Measured after the fix               | Image                                       |
| -------- | ------------------------------------ | ------------------------------------------- |
| Desktop  | 10 cards, 0px overflow, none clipped | `visual-qa/079-grid/live--desktop.png`      |
| Tablet   | 10 cards, 0px overflow, none clipped | `visual-qa/079-grid/live--tablet.png`       |
| Mobile   | 10 cards, 0px overflow, none clipped | `visual-qa/079-grid/live--mobile-cards.png` |

Every "Screen NNN" label sits 17px above its card's bottom edge at desktop and tablet. The mobile
baseline captures only the first viewport (the shell scrolls an inner container), so the mobile
proof is the live capture of the grid itself plus the measurement above, not the baseline.

`baseline-after--*.png` are the regenerated baselines. They also carry the two new header links.

## Screens delivered

| Screen | Route                          | States                                                                                                 |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 087    | `/reports/forecast-variance`   | default, commentary-required-only, compare-snapshots, scoped-owner, loading, empty, error, forbidden   |
| 87a    | `/finance/forecast-cycles`     | list, empty, loading, error, forbidden                                                                 |
| 87a    | `/finance/forecast-cycles/:id` | monitor, closed, owner, owner-submission, commentary-required (422), loading, error, forbidden         |
| 16a    | `/reports/board-pack`          | default, draft, page-with-no-data, generating, ready, expired, failed, loading, error, forbidden-owner |

087 is the existing Phase 10 report frame with the forecast filters added, so the shared report
components (`ReportTable`, `Reconciliation`, `ScopeNote`, `DrilldownPanel`) work unchanged. The
board pack renders its pages through the same `ReportTable`, because the API returns them as report
columns and rows.

### How the rules are kept

- **No money is recomputed in the browser.** Every page renders `columns` and `cells` as returned.
  The only arithmetic on these screens is `bps / 100` for display and the progress bar's share of a
  count.
- **`notes` is rendered, never replaced.** The "no accepted forecast yet" state arrives as a note
  and is shown as the API wrote it (`ReportNotes`), rather than an empty state the screen invented.
- **`varianceDirection` is the word.** 087 shows the API's "under" / "over" column; 87a writes
  "under budget" / "over budget" beside each variance. Neither screen relies on a sign or a colour.
- **A forecast is visually distinct.** Forecast columns and the forecast KPI are hatched and
  labelled "Forecast, not actual", so a projection never reads like committed or actual money.
- **`reconciliation.ties === false` is surfaced**, on 087 through the shared `Reconciliation`
  component and on the cycle monitor through its own important banner naming the number of figures
  that disagree.
- **`allowedActions` drives 87a.** Accept, Ask for commentary, Forecast and Close cycle appear only
  when the API lists them. Nothing infers a permission from a role in the browser.
- **The FX bridge keeps its framing.** It is its own card, labelled "Not part of spend or variance;
  FX never consumes budget", and the variance page's FX column reads "Bridged separately".
- **Download links are fetched on click**, never cached onto a button, because the signed URL lasts
  five minutes. An expired generation shows "The files for this pack have expired. Generate it
  again to get new links." instead of a dead button, and a 409 on download surfaces the API's
  sentence.

## Outcome table

| Scenario                                    | Expected                                                                                       | Actual      | Result |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------- | ------ |
| 079 wrapped rows at desktop, tablet, mobile | Zero card overflow, no clipped "Screen NNN"                                                    | as expected | pass   |
| 087 notes banner                            | The API's sentences shown verbatim, including "post nothing and consume no budget"             | as expected | pass   |
| 087 reconciliation                          | Authorized figure stated on screen, `ties` true, no broken banner                              | as expected | pass   |
| 087 forecast column                         | Header marked "Forecast, not actual", cells hatched                                            | as expected | pass   |
| 087 variance direction                      | Every row's direction is "under", "over" or "on", shown as the word                            | as expected | pass   |
| 087 row tags                                | "System run-rate" and "Commentary due" rendered as the API wrote them                          | as expected | pass   |
| 087 compare with a snapshot                 | "Previous forecast" and "Change" columns appear                                                | as expected | pass   |
| 087 commentary-required-only                | Row count narrows to the API's and the table shows exactly those rows                          | as expected | pass   |
| 87a monitor (finance)                       | `allowedActions` has accept and close; Accept offered on the submitted line only               | as expected | pass   |
| 87a close cycle                             | Typed confirmation, button disabled until the phrase matches                                   | as expected | pass   |
| 87a closed cycle                            | Read-only, "cannot change" banner, no Actions column at all                                    | as expected | pass   |
| 87a owner scope                             | Owner sees fewer lines than finance, the scope note, and no Accept or Close                    | as expected | pass   |
| 87a 422 commentary required                 | Error on the commentary field: "USD 8,000.00 (100.0%)… at least 20 characters"; nothing stored | as expected | pass   |
| 87a method cards                            | Run-rate, committed plus pipeline and own figure, each with its amount and explanation         | as expected | pass   |
| 16a pack preview                            | Every API page rendered in order, reconciliation ties                                          | as expected | pass   |
| 16a page with no data                       | Page keeps its place with the API's statement                                                  | as expected | pass   |
| 16a FX bridge                               | Own section, "Not part of spend or variance"; variance page says "Bridged separately"          | as expected | pass   |
| 16a draft                                   | Warning banner and a Draft mark on every one of the 11 pages                                   | as expected | pass   |
| 16a generation                              | 202 queued, polled to Ready, PDF and XLSX offered                                              | as expected | pass   |
| 16a download link                           | Fetched on click, expires within five minutes                                                  | as expected | pass   |
| Owner-scoped role on 16a                    | 403 from the API; forbidden state with the API's sentence; Generate disabled                   | as expected | pass   |
| The same owner on 087                       | 200, scoped to their subtree, with the scope note                                              | as expected | pass   |
| An employee on 87a and 16a                  | The route guard's forbidden page on both                                                       | as expected | pass   |

## Journeys

`apps/web-e2e/src/reports/forecast-board-pack.spec.ts`, 14 journeys across desktop, tablet and
mobile. `apps/web-e2e/src/reports/reports.spec.ts` keeps its "every report in the catalog opens in
the same frame" check, which now opens 087 in the frame as well.

No assertion sits inside a conditional. Where a journey needs a subject it takes it from a seeded
id (`FORECAST_CYCLES.october`, `P4_BUDGETS.berlin`) or from the API response read at the top of the
test, and asserts outright that the subject exists before using it.

**Result: 62 passed, 0 failed, 0 flaky** on a freshly seeded stack
(`functional/journey-results.txt`). Six mutating cases are skipped off desktop by design.

One flake was found and fixed rather than retried: Keycloak's brute-force quick-login check answers
`invalid_grant` when direct grants for one user arrive together, and several workers share the local
stack. The spec's token helper now retries with a short backoff; two runs after the change were
clean.

## Visual

`apps/web-e2e/visual/screens.json` gained `087-forecast-variance` (4 states), `087a-forecast-cycles`
(8 states) and `016a-board-pack` (3 states): 45 new baselines at desktop, tablet and mobile. The six
`079-report-catalog` `default` and `scoped-owner` baselines were regenerated for the grid fix and the
two new header links; `079 forbidden` is unchanged because an employee sees no cards.

Baselines were produced only with `npm run e2e:update-snapshots` in the pinned Playwright image.
**65 visual checks passed on consecutive runs** and again after a stack reset
(`visual-qa/visual-results.txt`). No other screen's baselines were touched.

## Gates

`scripts/gate.sh static --affected`: secrets, lint, styles, satori, typecheck, build, openapi and db
all pass (`gate-summary.txt`). `functional-api` was not run: no API, contract, worker or database
code changed in this branch. `functional-e2e` and `visual` were run targeted with `--grep` rather
than as whole suites, because the machine is shared with other agents' stacks.

## Files

```text
functional/journey-results.txt   the 62 journeys on a freshly seeded stack
visual-qa/visual-results.txt     the 65 visual checks against the committed baselines
visual-qa/079-grid/              before and after baselines, and the live captures of the fix
api/087-owner-scoped-run.json    087 as a location manager: scoped, with its notes and row tags
api/16a-owner-refused.json       the 403 the board pack answers an owner-scoped role
api/87a-commentary-required-422.json  the refusal the commentary field renders as money and per cent
gate-summary.txt                 scripts/gate.sh static --affected
```

## Risks and follow-ups

- **Neither new screen is in the shell navigation.** Adding items to `libs/web/shell/src/lib/nav.ts`
  or a tab to the close area's `CloseTabs` would move the `000a-app-shell` and period-close
  baselines, which this task was asked not to do while other agents are mid-wave. They are reachable
  from the report catalog header and from 087, and the integrator should add the nav entries
  ("Forecast cycles" under Finance, "Board and FP&A pack" under Insights) together with the three
  shell baselines in one change.
- **The seeded board pack is thin.** The latest closed period has no close snapshots, so the default
  pack reports zeros and an empty FX bridge, and two pages carry their "no data" statement. That is
  the honest state of the deterministic seed and the screen says so rather than implying more; the
  draft view of the open period shows the real figures. The seed was not changed.
- **The 087 `Commentary` column is given a minimum width** so a sentence is not squeezed into one
  word per line; the table scrolls sideways instead. It applies only to 087, so no other report's
  layout moved. The UX spec's "commentary moves into an expandable row on tablet" is a later
  refinement.
- **The forecast submission dialog does not reach the 860px it asks for** — something in the theme
  caps the panel at about 560px. The method cards read correctly at that width on all three
  viewports, so it is cosmetic, but worth tracing.
- **`ClosePeriodDialog`'s primary button is missing `mat-flat-button`** beside its
  `satImportantButton`, so it renders unstyled. Pre-existing, in another screen's file, and left
  alone; the three Phase 11 dialogs have both.
