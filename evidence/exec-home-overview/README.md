# Home as an executive overview — Stage 1 of screen 011

Turns the interim Home from an inventory of budget records into a decision surface, using only
endpoints that already exist in `libs/contracts`. Screen 011
(`docs/ux/screens/011-executive-dashboard.md`) replaces this page later with its chart, forecast and
region drill-down; this is the subset that lands now.

## What is on the page, in reading order

1. **The answer line** — one sentence from fixed client-side templates over the API's own figures
   (no model is involved), plus a context line with the scope, fiscal year, reporting currency, the
   accounting date the figures are as of, and the FX rule on its own line.
2. **Budget position** — Authorized, Committed (held + pre-encumbered + encumbered), Actual and
   Available, each with its share of authorized drawn as a meter, Actual also against the share of
   the year elapsed.
3. **Needs attention** — the five worst budgets the API flagged, in the API's own order, each with
   the reasons it wrote and the figures that make it a problem, linking to the budget; the rest are
   one click away in Budget health (013).
4. **Waiting on your decision** — count, total, age of the oldest, linking to the approval inbox.
5. **All budgets you can see** — the former sole content, demoted to a tool: search over name, code
   and owner, sortable columns, status and health filters, rows that open the budget.

## Evidence

| Path                                           | What it holds                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `functional/README.md`                         | how it was run, the 23-row outcome table across five roles, and the one gap this run could not cover                         |
| `api/README.md` and `api/*.json`               | the scrubbed response bodies behind every figure, and the field each figure comes from                                       |
| `visual-qa/report.md`, `visual-qa/report.json` | the capture run: 36 captures over Home and the shell at 1440 / 834 / 412 px, light theme, 0 blocking findings and 0 warnings |
| `visual-qa/screens/`                           | Home for the executive, finance-controller, department-head and filtered-table states at the three viewports                 |
| `gate-summary.txt`                             | `scripts/gate.sh` output, with a note on the two modes that did not run to completion here and why                           |
| `functional/journey-desktop.log`               | the whole desktop journey project on a fresh seed: 264 passed, 1 skipped, 0 failed                                           |

## Gates

`secrets`, `lint`, `styles`, `satori`, `typecheck`, `build`, `openapi`, `db` and `functional-api`
all pass (`gate-summary.txt`). Two modes did not finish in this worktree:

- **`functional-e2e`** — the desktop journey project passes 264/264 from a fresh seed, which covers
  every check this change adds or touches. The gate's full three-viewport pass was stopped after
  about 80 minutes: this machine was running six BudgetFlow stacks (42 containers, load average 29)
  and another worktree had held a Playwright container at ~140% CPU for nearly four hours, so the
  run was starved rather than broken. Worth re-running on a quiet machine or in CI.
- **`visual`** — run directly instead of through `npm run e2e:visual`, because
  `scripts/visual/pw-docker.sh` forwards only `BASE_URL`, `CI`, `HOME` and `BF_E2E_*` into the
  pinned image; `BF_KEYCLOAK_PORT` and `BF_API_PORT` therefore fall back to the defaults, which on
  this machine belong to a different stack. The comparison itself is the one CI makes, in the same
  pinned image: the 24 baselines this change touches were recorded and then re-compared clean.

## Where this deliberately differs from 011

011 is the full dashboard; this is the interim Home, so the following are left to it rather than
half-built here: the budget-vs-actual chart by region and its table alternative, the year-end
forecast and its sparkline, the region drill-down side sheet, the Export and Schedule delivery
actions, and the period / scope / currency filter chips. The regions table of 011 is not rebuilt
either — the budget list below already answers "show me everything" and 011's version is scoped to
regions with a forecast marker.

Two further differences are forced by what the API exposes today, and both are stated on screen
rather than papered over:

- **Pacing is against the share of the fiscal year elapsed, not the phased plan.** 011's KPI set
  implies a phased plan to date. The only phased figure the API returns is `pacedToDateBps` on a
  single health row, so the scope-wide comparison says "87% of the year gone: 70% behind an even
  spread" in those words instead of claiming "behind plan".
- **No FX effect figure.** 011's Available card states the FX effect as an amount. No endpoint Home
  may read carries a scope-level FX effect, so the line states the rule and, when the budget and
  reporting currencies match, that there is nothing to separate. Both are contract change requests
  in the pull request rather than client-side arithmetic over ledger figures.

One addition 011 does not describe: the page carries **two different Available figures** (the
company-wide one the roll-up and the health rows report, and each budget's own under its control
rules). They differ for a seeded budget, so they are labelled "Available company-wide" and
"Available (own rules)" and a journey asserts the distinction holds.

## Design-system fidelity (KPI cards and the budget table)

The KPI tiles follow the design system's **section 9 (KPI Metric Cards)**: a header label with a
header icon, the amount in bold tabular figures (green for the Available hero), a bordered footer
carrying a sub-label, the share as a bold toned percentage and a thin progress bar, and a delta
pill (Authorized carries the frozen / set-to-zero / over-threshold counts; Actual carries the
pacing against the year elapsed).

The budget table follows **section 6 (Dense Data Table)** via the sanctioned
`satTableWithRowStates` / `satRowState` / `satRowPrimaryAction` directives (the same pattern
`people`, `requests` and `events` use): dense rows, the budget code as a small chip, the owner with
an initials avatar, right-aligned tabular numeric columns, and a status tag. A `mat-paginator`
(10 rows per page) sits at the foot.

Two deliberate choices, both to stay inside the harness rules:

- **Numeric columns are not individually sortable; sorting is on the text columns** (Budget, Owner,
  Status). A sortable numeric header lays its label out left and ignores the cell's right-alignment,
  and the only way to right-align it is to override a Satori internal (`.mat-sort-header-container`),
  which `no-ds-internals-overrides` forbids. The design's own dense table shows numeric headers
  without sort arrows, so this matches it. If sortable numerics are wanted, they belong in the
  shared dense-table style (see the conflict note below), where the alignment can be solved once.
- **The paginator hides its page-size selector** (`hidePageSize`). The generic design-system table
  footer has a "rows per page" `<select>`, but ADR 0006 keeps Home free of any combobox
  (`role-navigation.spec.ts` asserts zero comboboxes on the landing screen), so the page size is
  fixed at 10 with prev/next and a range label only.

### Overlap with `fix/visual-rerecord` (for the integrator)

That branch restyles this same Home table to the dense spec via a new shared stylesheet
`libs/web/ui/src/styles/data-table.scss` (a `bf-table` class, state stripes, code chip, paginator).
This change reaches the same look through the Satori `satTableWithRowStates` directives and
component-scoped styles in `home.page.scss` instead, so the two **both touch Home's table** and will
conflict on merge. Resolve by keeping one dense-table implementation: if `bf-table` lands, Home's
table should adopt it (and its left state stripes), and the per-page styles here can drop out.
