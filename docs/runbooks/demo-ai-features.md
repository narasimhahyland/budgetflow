# Demo runbook: AI features on Amazon Bedrock

How to run the AI features live and how to explain what happens behind a question. Credentials and
setup detail: [`../ai-harness/bedrock.md`](../ai-harness/bedrock.md). Users and passwords:
[`../local-access.md`](../local-access.md). Rules the features follow: `.cursor/rules/ai-features.mdc`.

## 1. Before the demo

1. Put one credential in the gitignored `.env` at the repository root (never commit it):

   ```text
   AWS_BEARER_TOKEN_BEDROCK=...
   ```

   Or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (+ `AWS_SESSION_TOKEN`). Optional: `AWS_REGION`
   (default `us-east-1`), `BEDROCK_MODEL_ID` (the model must be enabled in your account and region).
   `.env` only needs your overrides; `scripts/stack.sh` fills the rest from `infra/.env.example`.

2. Start the stack with the deterministic seed:

   ```bash
   scripts/stack.sh up && scripts/stack.sh reset
   ```

   If another stack already uses the default ports, set different `BF_*_PORT` values in `.env` first.

3. Print the URLs and sign in as the roles below (realm `budgetflow`, password in `docs/local-access.md`):

   ```bash
   scripts/stack.sh urls
   ```

4. Switch the features on: sign in as `org.admin@example.test`, open **Admin > AI > Features**
   (`/admin/ai/features`), and turn on the features you will show. Finance-affecting ones stay pending
   until a Finance Admin (`finance.admin@example.test`) confirms. If Bedrock is not configured the
   switches are refused with "No model provider is configured".

## 2. Demo script

| Step | Sign in as                        | Screen                                           | Do                                                      | What to point out                                                                                                  |
| ---- | --------------------------------- | ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1    | `location.manager@example.test`   | Ask BudgetFlow (`/ask`)                          | Ask "How much is left in Bengaluru Events?"             | Answer is labelled AI-generated, lists the records it used, and the figures panel comes from the ledger.           |
| 2    | same                              | Ask BudgetFlow                                   | Ask "Approve REQ-..." or "Move 5,000 to another budget" | Refused with a link to the screen where a person does it. The model is never called.                               |
| 3    | same                              | Ask BudgetFlow                                   | Ask about a budget in another region                    | Refused as out of scope. It does not confirm the budget exists.                                                    |
| 4    | `employee@example.test`           | Policy assistant (`/policy-assistant`)           | Pick a request and ask why a rule applies               | The rules engine outcome comes first; the AI only explains it and never lists a workaround.                        |
| 5    | `finance.admin@example.test`      | Spending outlook (`/insights/outlook`)           | Open a budget's outlook                                 | The range and drivers are kept apart from ledger figures.                                                          |
| 6    | `finance.controller@example.test` | Actual matching (`/finance/actuals/suggestions`) | Rank an unmatched spend line                            | Suggestion only; matching goes through the normal command and records the decision.                                |
| 7    | `finance.controller@example.test` | Anomaly flags (`/finance/anomalies`)             | Open a flag, then clear it with a reason                | Advisory only; it changes nothing on the record.                                                                   |
| 8    | `regional.manager@example.test`   | Suggested split (`/budgets/:id/suggest-split`)   | Suggest a split of a parent budget                      | Totals match exactly; nothing is saved until the owner posts it through the normal allocation.                     |
| 9    | the uploader                      | Receipt extraction (`/documents/extraction`)     | Upload a real receipt PDF, run extraction               | Bedrock reads the file; card digits never reach the form; unreadable fields stay empty and are flagged.            |
| 10   | `auditor@example.test`            | Admin > AI > Log, Accuracy                       | Open the query log and accuracy tabs                    | One row per question with scope, records, field names sent, model id and latency. The question text is not stored. |

The seeded receipt files have no content, so for step 9 upload your own receipt.

## 3. What happens when a user asks a question

```text
Browser -> POST /api/ai/ask -> AiAskService -> AiGateway -> BedrockAiProvider -> Amazon Bedrock
```

1. **Gates, in one tenant-scoped transaction.** The feature switch must be on. The hourly question
   limit (default 50) is checked. A question that asks for an action (approve, move money) is refused
   with a link to the screen, and the model is not called.
2. **Retrieval by BudgetFlow, not the model.** The service pulls search terms, request references and
   the open budget out of the question and reads matching budgets, events and requests through
   `PolicyService`, so only records this user can already see come back. Nothing in scope means a
   refusal and no model call. Ledger numbers come from the read models.
3. **Minimization.** Each record becomes a small fact. Only the fields on that feature's allowlist
   survive, and values that look like personal data or credentials are dropped.
4. **The Bedrock call.** The Converse API gets a system prompt, the facts as JSON and the user's words,
   each in its own tag and both treated as untrusted data. The reply is forced through one tool whose
   input schema is the feature's zod schema, at temperature 0.
5. **Guards on the reply.** The output is checked against the schema. The figure guard then checks that
   every number in the text appears in the facts. Any miss discards the whole answer ("I could not
   produce a reliable answer"). A Bedrock error or timeout degrades to "AI answers are unavailable
   right now".
6. **The user sees** the answer, the records it used, follow-up suggestions, a figures panel read from
   the ledger, and provenance (model id and a query-log link).
7. **Logging.** One query-log row is written whatever the outcome (answered, refused, discarded,
   failed): who asked, the scope applied, the records used, the field names sent and the latency, never
   the question text. The turn is saved in the asker's own history, which they can delete.

The other features use the same gateway and differ only in retrieval and per-task instructions. Their
outputs are open suggestions; accepting one goes through the normal command path (policy check,
delegation-of-authority limits, audit) and records the suggestion id and model id. The AI never posts
to the ledger, approves, or changes a rule.

## 4. Troubleshooting

| Symptom                                             | Cause and fix                                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switches refused: "No model provider is configured" | No AWS credential reached the API. Check `.env`, then `scripts/stack.sh up` again.                                                                                                  |
| "AI answers are unavailable right now"              | Bedrock call failed. Check `docker logs` of the API for `Bedrock call failed`; usual causes are an expired token, a model not enabled in the region, or a wrong `BEDROCK_MODEL_ID`. |
| "I could not produce a reliable answer"             | The figure guard or schema check discarded the output. The API log shows the untraceable numbers. Ask about one budget or period.                                                   |
| `stack.sh up` complains about missing variables     | Use the current `scripts/stack.sh`, which layers `.env` over `infra/.env.example`.                                                                                                  |
| Port already allocated                              | Another stack uses it. Set `BF_*_PORT` values in `.env`.                                                                                                                            |

## 5. Running the live checks

```bash
BF_AI_LIVE=1 npx playwright test -c apps/api-e2e src/ai
```

These call the real model, so wording varies and they skip when `BF_AI_LIVE` is unset.
