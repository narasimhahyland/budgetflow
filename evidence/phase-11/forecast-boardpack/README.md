# Phase 11 follow-up: the backend screens 087 and 16a need

Wave 4 could not build the forecast and variance report (087) or the board and FP&A pack (16a)
because nothing exposed `forecast_snapshots` and there were no forecast cycle records to report on.
This pack is the backend that unblocks both, plus the forecast cycle (87a) lifecycle that produces an
accepted forecast in the first place. No Angular screens, journeys or visual baselines are included.

## Endpoints delivered

| Method | Path                                                             | What it does                                                     |
| ------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/close/forecast-cycles`                                     | Cycles with progress per status, newest first                    |
| POST   | `/api/close/forecast-cycles`                                     | Opens a cycle (as-of, due, scope, variance threshold, defaults)  |
| GET    | `/api/close/forecast-cycles/{cycleId}`                           | Monitor: lines the viewer may see, totals, ledger reconciliation |
| POST   | `/api/close/forecast-cycles/{cycleId}/submissions`               | Saves or submits one budget's or event's forecast                |
| POST   | `/api/close/forecast-cycles/{cycleId}/submissions/{id}/decision` | Accepts, or asks the owner for commentary                        |
| POST   | `/api/close/forecast-cycles/{cycleId}/close`                     | Closes and locks the snapshot (typed confirmation)               |
| GET    | `/api/reports/forecast-variance/run`                             | 087 in the Phase 10 report frame                                 |
| GET    | `/api/reports/forecast-variance/drilldown`                       | Ledger lines behind a figure (shared frame, no new code)         |
| GET    | `/api/reports/board-pack`                                        | 16a preview: pages, FX bridge, reconciliation                    |
| POST   | `/api/reports/board-pack/generations`                            | Queues generation in the worker (202)                            |
| GET    | `/api/reports/board-pack/generations`                            | Generations with status, newest first                            |
| GET    | `/api/reports/board-pack/generations/{generationId}`             | One generation with the files it rendered                        |
| GET    | `/api/reports/board-pack/generations/{generationId}/download`    | Short-lived signed URL for the PDF or XLSX                       |

Migration **0015** (`0015_p11_forecast_cycles_board_pack.sql`): new tables `forecast_cycles` and
`board_pack_generations`, the cycle columns on `forecast_snapshots`, `ENABLE`/`FORCE ROW LEVEL
SECURITY` with `tenant_isolation` on both new tables (hand-written block re-appended after the
generator), and a `NOT VALID`-then-validated check so a forecast snapshot always names a budget or
an event.

## Outcome table

| Scenario                                             | Expected                                                                                              | Actual      | Result |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- | ------ |
| Variance above the cycle threshold, no commentary    | 422 `FORECAST_COMMENTARY_REQUIRED` with the variance in `params`; nothing stored                      | as expected | pass   |
| The same variance with commentary                    | 201, status `submitted`, variance 600,000 minor / 6,000 bps, direction `under`                        | as expected | pass   |
| Variance exactly on the threshold (10% and 1,000.00) | 422: "at least" includes the boundary                                                                 | as expected | pass   |
| One minor unit inside the threshold                  | 201, `commentaryRequired` false                                                                       | as expected | pass   |
| Submitting a forecast                                | Every ledger bucket and company-wide Available unchanged; monitor reconciliation ties                 | as expected | pass   |
| System method amounts                                | Run-rate and committed-plus-pipeline computed from the ledger, pipeline never below run-rate          | as expected | pass   |
| Owner scope                                          | An owner forecasts their own budget, is refused another's, and sees only their subtree                | as expected | pass   |
| Decisions                                            | Only `forecast.manage` accepts; an accepted line answers 409 `FORECAST_ALREADY_ACCEPTED`              | as expected | pass   |
| Closing a cycle                                      | Submitted lines accepted, missing ones filled with System run-rate, later writes 409                  | as expected | pass   |
| Wrong confirmation phrase                            | 422 `CONFIRMATION_MISMATCH`                                                                           | as expected | pass   |
| Replayed submission                                  | `Idempotent-Replayed: true`, same id, one stored line                                                 | as expected | pass   |
| Cycle line order                                     | Identical across two reads, sorted by name then id                                                    | as expected | pass   |
| 087 catalog entry                                    | `forecast-variance`, screen 087, owner-scoped, CSV/XLSX/PDF                                           | as expected | pass   |
| 087 against the ledger                               | Authorized 1,000,000, Actual 85,000, Committed 150,000, Available 765,000; `ties` true                | as expected | pass   |
| 087 forecast column                                  | In the KPIs, never in `reconciliation.differences`: a forecast has no bucket                          | as expected | pass   |
| 087 fallback                                         | A budget with no accepted forecast is tagged `System run-rate` and the note says so                   | as expected | pass   |
| 087 comparison                                       | Previous forecast 780,000, change −40,000                                                             | as expected | pass   |
| 087 commentary-required-only                         | Narrows the rows; the ledger columns are then checked as a part of the ledger                         | as expected | pass   |
| 087 tied row order                                   | Largest authorized first, then label-then-id over the tied rows, same both times                      | as expected | pass   |
| 16a closed-period pack                               | `close_snapshot`, version 1, all 11 pages, snapshot version per entity row, `ties` true               | as expected | pass   |
| 16a FX bridge                                        | `fxEffect = atReportingRate − atPlanRate` per row, total is their sum, rows sorted                    | as expected | pass   |
| 16a FX stays out of variance                         | Variance = plan to date − (actual + committed); the page says "Bridged separately"                    | as expected | pass   |
| 16a open-period pack                                 | `open_period_draft`, no snapshot version, Draft in the statement and the notes                        | as expected | pass   |
| 16a empty page                                       | Page kept with a statement naming the period; all 11 pages still present                              | as expected | pass   |
| 16a generation                                       | 202 queued → worker renders → `ready`, PDF and XLSX in the store with sizes and digests               | as expected | pass   |
| 16a download                                         | Presigned URL under `tenants/<id>/board-packs/`, expiry ≤ 10 min, bytes start `%PDF-`                 | as expected | pass   |
| 16a before ready                                     | 409 `BOARD_PACK_NOT_READY`, never an empty file                                                       | as expected | pass   |
| 16a role scope                                       | Finance, CEO and auditor 200; regional manager and employee refused                                   | as expected | pass   |
| RLS on the new tables                                | `forecast_cycles`, `forecast_snapshots`, `board_pack_generations` force RLS; cross-tenant write 42501 | as expected | pass   |

26 API scenarios, all passing: `functional/scenario-results.txt`.

## The scenarios are not vacuous

`functional/vacuity-proof.txt` is the run after `commentaryRequired` in
`libs/domain/src/lib/fiscal/forecast.ts` was changed to `return false` and the stack rebuilt. Both
threshold scenarios fail (`Expected: 422, Received: 201`, and the submission comes back with
`commentaryRequired: false`). The behaviour was restored and both pass again. No assertion in any
scenario sits inside a conditional; every expectation is made outright.

## Forecast figures are kept out of the ledger

`db/forecast-not-in-the-ledger.txt` (queries in `db/queries.sql`):

- the `ledger_account` enum has 14 members and none of them is a forecast, so no posting can be one;
- no column of `ledger_journals`, `ledger_lines` or `ledger_balances` references a forecast;
- no journal was written by a forecast command.

In code, `ForecastCyclesService` writes `forecast_snapshots` and nothing else: it injects no ledger
command and posts no journal. The 087 builder puts the forecast in its own column and in the KPIs,
and its `reconcile` rules cover only `authorized`, `actual` and `committed` — the forecast has no
bucket to tie to, so it is deliberately absent from the reconciliation rather than silently excluded.
The scenario "a forecast posts nothing" asserts every bucket and company-wide Available are byte-for-byte
unchanged after a submission.

## The FX bridge never implies budget movement

The bridge values the same actual spend twice — once at the locked plan rate, once at the rate the
ledger reported it at — and publishes only the difference, with the note "Not part of spend or
variance; FX never consumes budget." on every row and on the bridge itself. It is a separate field
of the pack (`fxBridge`), not a page column: no page's Actual, Committed or Variance column contains
it. The scenario proves both halves: `fxEffect = atReportingRate − atPlanRate` per currency and the
total is their sum, and the variance page's Variance equals plan-to-date − (actual + committed) with
no FX term, while its Actual column sums to the reconciliation's actual exactly.

## Reconciliation

Every 087 run and every cycle monitor carries the Phase 10 `reconciliation` block built from
`ledger_balances`, with Available as Authorized − Held − Pre-encumbered − Encumbered − Actual and
child allocations counted once. The board pack adds a second check: when the period has close
snapshots, their stored bucket totals are compared with the as-of ledger balances and any difference
is reported per entity with `ties: false`, rather than one side quietly winning.

## Deterministic ordering

Every list has a total order: cycle lines and pack pages sort by label then by the unique row key;
087 sorts by authorized descending then label then id; FX bridge rows by currency code; close
snapshots by entity code then id; generations by requested time then id; the "latest accepted"
forecast snapshot per budget is picked with `distinct on` over a fully ordered key. Two scenarios
read the same list twice and assert the orders are identical.

## Seed additions (all fictional)

- A closed **September reforecast** (as of 2026-09-30) with accepted forecasts on four budgets, one
  carrying commentary for a large under-spend and one for an over-spend.
- An open **October reforecast** (as of 2026-10-31, due 2026-11-12) with one submitted, one draft and
  one commentary-required line, so the monitor shows every state at once.
- `period_close_snapshots` for the latest closed period, one row per legal entity, computed from the
  ledger over the fiscal year's live budgets — so a freshly seeded board pack has an immutable source
  and ties, and later drift is reported rather than absorbed.

Forecast amounts are a share of each budget's net authorized amount read from the ledger at seed
time, so the figures sit beside real money without ever becoming any.

## Files

```text
api/forecast-cycles.json          GET /api/close/forecast-cycles on the seeded stack
api/087-forecast-variance-run.json  087 run scoped to the India subtree, September cycle
api/16a-board-pack-preview.json   16a preview: summary, legal entity and variance/FX pages
functional/scenario-results.txt   26 API scenarios, all passing
functional/vacuity-proof.txt      the same scenarios failing with the behaviour reverted
db/queries.sql                    the queries behind the forecast-and-ledger separation proof
db/forecast-not-in-the-ledger.txt their output
gate-summary.txt                  scripts/gate.sh static --affected
```

## Gates

`scripts/gate.sh static --affected` (lint, typecheck, build, OpenAPI drift, migration check):
`gate-summary.txt`. `functional-api` was run targeted with `--grep` on the local stack
(`bf-p11-forecast`, ports 4360/3160/8240/5592/8185/9160/4160) rather than as a whole, because the
machine is shared; the visual gate was not run and no UI changed.

## Risks and open questions

- `infra/compose.yaml` gained four `DOCUMENT_STORE_*` variables on the **worker** service. The worker
  had none, so it defaulted to `http://localhost:9000` and could not reach MinIO to write a pack.
  This is a shared surface; it is the only change outside the task's own files and it is required for
  the generation job to work at all.
- A pack for a period that nothing was posted into reports zero figures and an empty FX bridge, which
  is correct but makes the default (latest closed period) pack thin on the deterministic seed, where
  the money sits in the open November period. The FX bridge scenario therefore reads the draft pack.
- The PDF and XLSX renderers are dependency-free and deliberately plain: they carry the pack's
  numbers, columns and the FX bridge, not its typography. A later phase can replace `renderPack` in
  `board-pack.service.ts` without touching the contract.
- Forecast cycles for _events_ are modelled and submitted but have no scenario of their own; the
  seed's cycles exclude open events. Worth a follow-up when 046 (event forecast at completion) is built.
