# Amazon Bedrock for AI features

Two providers sit behind `AiProvider`, chosen by `AI_PROVIDER` (decided 2026-11-12):

| `AI_PROVIDER`        | Provider             | Used by                                                                               |
| -------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `recorded` (default) | `RecordedAiProvider` | the local stack, functional runs and CI. Offline, no credentials, no live model call. |
| `bedrock`            | `BedrockAiProvider`  | the product with a real model, selected explicitly, credentials from the environment. |

`BedrockAiProvider` (`libs/api/ai/src/lib/provider/bedrock-provider.ts`) uses the Converse API with the
answer shape forced by a tool built from each feature's zod schema. `RecordedAiProvider`
(`recorded-provider.ts`) answers from committed, scrubbed recordings in `provider/recordings/`: guardrail
fixtures keyed by prompt fixture (`__eval:invent-figure`, `__eval:schema-invalid`, `__eval:unavailable`,
`__eval:workaround`), document readings keyed by file name, and a fixed answer shape per task filled only
with values copied from the call's facts. Recordings hold fictional data only. The gateway guards
(minimization, schema check, figure check, query log) are the same for both.

## Where to put credentials

Set `AI_PROVIDER=bedrock` and the credentials in the **gitignored `.env` at the repository root** (`scripts/stack.sh` reads it and passes the
values to the API container). Never commit them. Use one of:

```text
AI_PROVIDER=bedrock
AWS_BEARER_TOKEN_BEDROCK=...                 # Bedrock API key (simplest)
# or
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...                        # only for temporary credentials
```

Optional: `AWS_REGION` (default `us-east-1`) and `BEDROCK_MODEL_ID` (default
`us.anthropic.claude-sonnet-4-5-20250929-v1:0`; the model must be enabled for your account in that region).
Run the API outside Docker and these same variables, or `AWS_PROFILE`, are read from the shell.
In a deployment prefer an instance or task role; no variable is then needed except the region.

With `AI_PROVIDER=bedrock` and no credentials the API reports `AI_PROVIDER_NOT_CONFIGURED`, features cannot be switched on and
the UI shows its normal "unavailable" state. If a call fails at runtime the feature degrades (`AI_UNAVAILABLE`).

## Running the AI checks

`scripts/stack.sh reset`, then the `apps/api-e2e/src/ai` scenarios and `apps/web-e2e/src/ai` journeys run on
the recorded provider: same answers every run, no token. CI does the same and asserts the provider is
`recorded`. The accuracy evals (`libs/api/ai/src/lib/evals/fixtures.ts`) include the guardrail and
extraction sets, which replay recordings.

Against Bedrock: start the stack with `AI_PROVIDER=bedrock` and credentials, then run the same specs. The
scenarios run on either provider except the three guardrail scenarios that replay a recorded failure; the
journeys assert recorded wording and skip on a live provider; eval cases marked `requires: 'recorded'` are
left out of a live run. Live answers vary and cost tokens. Document extraction sends the verified file
(PDF or image) to Bedrock.
