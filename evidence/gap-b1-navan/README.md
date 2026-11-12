# Gap B1 — Navan live integration (Phase 16a)

Package B1 of `docs/gap-closure-plan.md`: the Navan connector on Navan's documented paths and shapes,
built against the mock provider (decision D4). Design and the values to confirm before a live
connection: `docs/architecture/navan-integration.md`.

| Check                         | Result                                                                                                                      | Evidence                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `scripts/gate.sh` (all modes) | PASS secrets, lint, styles, satori, typecheck, build, openapi, db, functional-api, functional-e2e; visual FAIL (see below)  | `gate-summary.txt`                    |
| Visual after the fix          | 092 hub baselines updated for the Navan copy; integrations screens re-run: 120 passed, 2 failed (`101-api-keys`, see below) | `visual-qa/README.md`                 |
| Navan API scenarios           | 17 of 17, three runs on one stack                                                                                           | `functional/README.md`                |
| Navan journeys                | 3 of 3 (connect, field mapping, exception queue)                                                                            | `functional/README.md`                |
| API samples                   | sync runs, connection detail, custom fields, pushes, over-budget exceptions, mock call log                                  | `api/`                                |
| Invariant map                 | rows 100-102                                                                                                                | `docs/testing/invariant-scenarios.md` |

## The visual failure

The gate's visual step failed on `092-integrations-hub` (9 states, expected: the Navan connector
copy changed) and on `101-api-keys` default and create-form at desktop. The 092 copy was shortened
and its baselines updated with `npm run e2e:update-snapshots -- -g 092-integrations-hub`
(only the three desktop states differed). The `101-api-keys` difference is not from this change: the
seeded API key's expiry is computed from the real clock (`apps/api/src/seed/integrations.ts`,
`realNow()`), so the masked expiry date has a different width on a different day and the table
columns shift by a few pixels. This branch does not touch that screen or its data (not re-run on
`main` to confirm); it is left as a follow-up rather than re-baselined here. Four other screens were flaky (passed on retry).

## Not done here

- The public research notes (`docs/research/navan-integration.md`) are in the main checkout,
  uncommitted, waiting for the user's go-ahead.
- `infra/.env.example` does not list `NAVAN_LIVE_ENABLED` (the worktree guard blocks reading env
  files); the default is off and the Compose file does not pass it.
- Live mode is untested by design: it needs Navan credentials, and CI never runs it.
