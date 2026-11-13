---
name: ai-feature-guardrails
description: Builds or changes a BudgetFlow AI feature (plain-language questions, forecasts and nudges, suggested allocations, policy assistant, transaction matching, receipt and quote extraction, anomaly flags, copilot, summaries) behind the AiProvider interface with PolicyService-scoped retrieval, human confirmation for every action, data minimization, an AI query log, evaluation sets with accuracy thresholds, and permission scenarios using the deterministic fake provider. Use for any change that calls a model or shows model output.
---

# AI feature guardrails

Rule: `.cursor/rules/ai-features.mdc`. AI suggests; people decide. AI never posts to the ledger, approves, rejects or changes a budget on its own.

```text
- [ ] 1 Feature card: input facts, output, who sees it, what a person must confirm
- [ ] 2 Retrieval scoped by PolicyService
- [ ] 3 Provider call through AiProvider; data minimization; query log
- [ ] 4 Human confirmation for anything that changes data
- [ ] 5 Evaluation set with thresholds
- [ ] 6 Functional checks with the recorded provider, incl. permission scenarios
- [ ] 7 Gates and report
```

## 1. Feature card

Write in `docs/ai/<feature>.md`: purpose, the typed facts it reads, the output shape, roles that can use it, what a person confirms, failure behavior (no answer is better than a wrong one), and the evaluation threshold.

## 2. Scoped retrieval

Collect facts only through query services that call `PolicyService.can` for the asking user; never query tables directly for prompts, never widen scope for "context". Tenant RLS applies underneath.

## 3. Provider call

Through the `AiProvider` interface only (provider chosen at the Phase 1 review). Send the minimum fields; redact personal data and free text unless the feature needs them; never send secrets. Log every call in the AI query log (actor, feature, fact ids, model, latency, outcome; no raw personal data). Timeouts and provider errors degrade to "no suggestion", never to a guess.

## 4. Human confirmation

Suggestions (allocations, matches, extracted amounts, drafted text) are shown with their reason and source facts and become changes only through the normal command after a person confirms, with the usual authorization, DoA and audit. Auto-approve within policy stays behind a feature flag, off by default.

## 5. Evaluation set

Fictional labelled cases in `libs/api/ai/src/lib/evals/fixtures.ts` with a threshold per feature (for example matching precision ≥ 0.95 at the chosen recall), run by `apps/api-e2e/src/ai/settings-and-accuracy.spec.ts`. The offline recorded provider (`RecordedAiProvider`, recordings in `libs/api/ai/src/lib/provider/recordings/`) answers so the evaluation is stable in CI with no live call; a guardrail case that replays a recorded failure carries `requires: 'recorded'`. Run the same sets against Bedrock by starting the stack with `AI_PROVIDER=bedrock`.

## 6. Functional checks (`apps/api-e2e/src/ai/`, recorded provider on the stack)

- Permission scenarios: a user asks about a budget outside their scope and gets no data from it (Director A about Director B; another tenant); chat, widget and connector paths obey the same scope.
- Suggestions never change data without confirmation: the ledger and audit are unchanged until the confirm command runs.
- The query log records each call without raw personal data.
- The evaluation set meets its threshold.
  Run `npx nx run api-e2e:functional-api -- -g "ai"` and the journey for the UI surface via `/functional-check`.

## 7. Gates and report

`scripts/gate.sh static functional-api` (plus `functional-e2e` and `/visual-qa` for UI). Report: feature card, scope checks, evaluation result vs threshold, permission scenarios, evidence path. Consider `/security-review-handoff` for new data flows.
