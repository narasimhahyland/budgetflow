# AI offline tests: recorded provider beside Bedrock

Decision (12 November 2026): keep Amazon Bedrock in the product (#119) and add back an offline test
provider, so the AI layer stays tested without live calls or tokens.

Branch `fix/ai-offline-tests`. Local stack `bf-amazing-bhabha-f4eb29` on its own ports (web 46200,
api 46000, keycloak 46080), deterministic seed, `AI_PROVIDER=recorded` (the compose default). No AWS
credentials were set at any point.

## What changed

| Area      | Change                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider  | `RecordedAiProvider` (`libs/api/ai/src/lib/provider/recorded-provider.ts`): guardrail fixtures keyed by prompt fixture (`recordings/guardrail-fixtures.ts`: `__eval:invent-figure`, `schema-invalid`, `unavailable`, `workaround`), extraction readings keyed by file name (`recordings/documents.ts`), and a fixed answer shape per task filled only with values copied from the call's facts |
| Selection | `AI_PROVIDER` is `recorded` (default) or `bedrock` (`libs/api/core` config, `ai.module.ts` factory). `infra/compose.yaml` passes `${AI_PROVIDER:-recorded}`; CI pins `AI_PROVIDER: recorded` on the functional step                                                                                                                                                                            |
| Evals     | Restored the invented-figure (ask, chat, summary, commentary), schema-discard and workaround cases and the `extraction-v1` field-accuracy set (threshold 95%). Cases that replay a recording carry `requires: 'recorded'` and are left out of a live run                                                                                                                                       |
| Scenarios | Restored the figure-guard, schema-discard and "discarded answer is logged" scenarios (`apps/api-e2e/src/ai/guardrails.spec.ts`); removed every `BF_AI_LIVE` skip; added "CI never calls a live model" (runs when `CI` is set)                                                                                                                                                                  |
| Journeys  | AI journeys assert the recorded provider (`apps/web-e2e/src/ai/recorded.ts`) and skip only on a live one; tenant-wide switch journeys moved to `switches.spec.ts` in a `tenant-switches` project that runs after the others                                                                                                                                                                    |
| Baselines | 21 AI visual baselines updated through `npm run e2e:update-snapshots`: the provenance line now names `budgetflow-recorded 2026.11-r1` instead of `budgetflow-fake 2026.11`                                                                                                                                                                                                                     |

## Outcomes

| Check                                                                | Expected                          | Actual                                                                                                                                                     | Result                         |
| -------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| AI API scenarios (`src/ai`, assistant connector, narratives)         | all run on the recorded provider  | 52 passed; 1 skipped locally: the CI-only provider check, which runs in CI                                                                                 | PASS                           |
| Accuracy evals                                                       | every set at its threshold        | all sets pass, including `extraction-v1` and the guardrail cases                                                                                           | PASS                           |
| Figure-guard and schema-discard scenarios                            | discarded, logged for the auditor | outcome `discarded_unreliable`, answer null, query-log row present                                                                                         | PASS                           |
| AI journeys (`src/ai`, `extended/narratives`), fresh seed            | all pass                          | all pass; skips are the existing "mutating journey runs once, on desktop"                                                                                  | PASS                           |
| Full journey suite (`functional-e2e`)                                | pass                              | 648 passed, 1 flaky (acceptance step 1, passed on retry)                                                                                                   | PASS                           |
| `scripts/gate.sh` static and functional modes                        | pass                              | `gate-summary.txt`: all PASS                                                                                                                               | PASS                           |
| AI visual states (95, pinned image)                                  | match baselines                   | 95 passed after the baseline update (`visual-ai-recorded.log`)                                                                                             | PASS                           |
| Full visual suite                                                    | pass                              | stopped at state 403 of 995: the browser crashed ("Target crashed") with ten stacks on the host; failures were non-AI screens (000a, 000c, 069, 070, 047e) | NOT PROVEN locally; CI decides |
| `sh scripts/validate-harness.sh`                                     | OK                                | OK                                                                                                                                                         | PASS                           |
| `npm audit --omit=dev` (`@aws-sdk/client-bedrock-runtime` from #119) | no finding in its tree            | none in the AWS SDK tree; 2 high in `multer` via `@nestjs/platform-express`, unrelated and older (`npm-audit.txt`)                                         | PASS for #119's dependency     |

## The 17 journeys #119 reported failing

Reproduced or explained on this stack:

1. The journeys assert recorded-provider wording and model ids; against Bedrock the wording varies.
   They now target the recorded provider and skip on a live one.
2. The seeded receipts have no file content, so Bedrock has nothing to read. The recorded provider
   reads them by file name.
3. A real race, reproduced here (three failures): the desktop 113a journey turns `matching` off and
   `ask_chat` on while tablet and mobile journeys, and the matching journeys in another worker,
   expect the seeded switches. Fixed with the `tenant-switches` project.
4. Running journeys on a stack the API scenarios already used breaks exact-count assertions (8 rows
   instead of 4). `scripts/gate.sh` reseeds between suites; journeys pass on a fresh seed.

Ports were not the cause: `apps/web-e2e/src/support/env.ts` reads `BF_*_PORT` from the shell. The
Bedrock run itself could not be repeated without credentials.

## Main's visual timeout

With `AI_PROVIDER=bedrock` and no credentials, the provider returns "unavailable" before the SDK is
called, so the AI states never render what their `waitFor` targets and each runs to its timeout and
retry. Measured here in the pinned image: all 95 AI states took 2.0 minutes on the recorded provider and
passed. On unconfigured Bedrock, the `011a-` selection alone took 10.8 minutes with 9 failed and 17
passed, the failures all 15-second `waitFor` and 30-second test timeouts
(`visual-011a-bedrock-unconfigured.log`).
The recorded default removes this from CI.

## Files

`gate-summary.txt` (`scripts/gate.sh --evidence`), `npm-audit.txt`. Raw logs and reports stay in
`tmp/evidence/ai-offline-tests/` and `dist/.playwright/`.
