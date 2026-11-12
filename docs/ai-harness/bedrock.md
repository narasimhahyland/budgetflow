# Amazon Bedrock for AI features

All AI features call Amazon Bedrock through `BedrockAiProvider` (`libs/api/ai/src/lib/provider/bedrock-provider.ts`,
Converse API, answer shape forced with a tool built from each feature's zod schema). There is no fake provider.
The gateway guards (minimization, schema check, figure check, query log) are unchanged.

## Where to put credentials

Put them in the **gitignored `.env` at the repository root** (`scripts/stack.sh` reads it and passes the
values to the API container). Never commit them. Use one of:

```text
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

Without credentials the API reports `AI_PROVIDER_NOT_CONFIGURED`, features cannot be switched on and
the UI shows its normal "unavailable" state. If a call fails at runtime the feature degrades (`AI_UNAVAILABLE`).

## Running the AI checks

`BF_AI_LIVE=1 scripts/stack.sh reset` then run the `apps/api-e2e/src/ai` and `apps/web-e2e/src/ai` specs. They
call the real model, so answers vary; they skip when `BF_AI_LIVE` is unset (CI has no credentials).
Document extraction sends the verified file (PDF or image) to Bedrock.
