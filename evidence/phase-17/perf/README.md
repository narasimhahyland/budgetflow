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

## Large dataset: 10,000 actuals through the API

[`large/`](large/): `results.json`, `table.md`, the generator log and the table sizes, measured on
the same stack and machine as the baseline, right after generation. The stack was reseeded afterwards.

**How the data was made.** `apps/api-e2e/perf/generate.mjs` creates a mapping rule, then imports
10,000 one-dollar actual lines in 40 batches of 250 against New York Events (USD), through the same
import and posting commands a person uses. Each line is auto-matched by the rule and posted, so the
ledger, the balances and the audit hash chain stay consistent. It took 84 seconds.

**Dataset after generation** ([`large/dataset-top-tables.txt`](large/dataset-top-tables.txt)):
20,136 ledger lines (seed: 136), 10,068 journals (68), 10,261 actuals, 10,007 matches, 164 audit
events (83). Audit events grow by batch, not by journal: posting a batch is one command and writes
one `actuals.import.posted` event that records how many journals it posted.

| Endpoint                      | p50 seed → large | p97.5 seed → large | Req/s seed → large |
| ----------------------------- | ---------------- | ------------------ | ------------------ |
| Budget list                   | 13 → 15 ms       | 21 → 23 ms         | 723 → 634          |
| Budget summary                | 12 → 15 ms       | 18 → 25 ms         | 758 → 615          |
| Approval inbox                | 9 → 12 ms        | 14 → 19 ms         | 989 → 763          |
| **Budget health dashboard**   | **17 → 54 ms**   | **24 → 84 ms**     | **554 → 177**      |
| **Report: budget vs actual**  | **12 → 47 ms**   | **17 → 70 ms**     | **766 → 202**      |
| Events                        | 21 → 24 ms       | 31 → 35 ms         | 441 → 397          |
| Actuals                       | 13 → 18 ms       | 19 → 31 ms         | 738 → 505          |
| Audit log                     | 12 → 13 ms       | 20 → 20 ms         | 758 → 697          |
| Audit hash-chain verification | 18 → 28 ms       | 25 → 41 ms         | 541 → 336          |

Every response in both runs was 2xx. p95 lies between p90 and p97.5 (see above).

**What it shows.** Reads that page or look up by id hardly move with 150 times the ledger. The two
endpoints that aggregate ledger lines — the budget health dashboard and the budget-vs-actual report —
grow roughly in step with the line count (about 3–4x slower at 20,000 lines). They stay under 100 ms
at p99 here, but a year of real postings is larger still: these two are the first candidates for a
read model or a cached aggregate if a later dataset pushes them past an agreed budget. No latency
budget is set in the plan, so this is recorded as an observation, not a failure.

Reproduce: reset the stack, then `node apps/api-e2e/perf/generate.mjs --lines 10000` (add `--plan`
for a dry run that only prints the plan), then `node apps/api-e2e/perf/run.mjs --out
evidence/phase-17/perf/large`, then reset again. Ports and the test password come from the
environment, as in the usage line of each script.
