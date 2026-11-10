# Phase 17 — performance

Run with `node apps/api-e2e/perf/run.mjs` (autocannon) against the local Compose stack, one read
endpoint at a time, each as the role that uses it: 10 connections, 15 seconds per endpoint. A run is
valid only if every response is 2xx; a fast 403 is not a performance result, so the script refuses a
run with any non-2xx response, error or timeout.

autocannon reports fixed percentiles — p50, p90, p97.5, p99 — and no p95. Both neighbours are
recorded; **p95 lies between p90 and p97.5**. Numbers from a laptop stack measure regressions between
runs on the same machine, not production capacity.

## Baseline on the deterministic seed

[`seed-baseline/`](seed-baseline/) — `results.json` and `table.md`, measured on a freshly reseeded stack.
Every response was 2xx.

**The dataset is small**, which limits what this baseline says. Largest tables after the seed
([`dataset-top-tables.txt`](dataset-top-tables.txt)): 240 fiscal periods, 136 ledger lines, 83 audit
events, 68 ledger journals, 52 people. At that size these figures measure per-request overhead —
authentication, the policy check, RLS and serialization — not how the product behaves with a year of
postings. They are worth keeping as the floor every later run is compared against.

## Not yet done: the large-dataset run

The functional testing rule asks for performance on a documented large dataset. That needs data
generated through the API, so the ledger, the audit hash chain and the balances stay consistent —
writing rows directly would break the invariants the product exists to keep.
