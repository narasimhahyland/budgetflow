---
name: phase-review
description: Slash command /phase-review <phase-id> - builds the evidence pack (gates, visual QA, reviews) and the pass / not passed result for a BudgetFlow phase (P1-P20) or release wave.
disable-model-invocation: true
---

# /phase-review

Run the gate review for the phase or wave id given after `/phase-review` by following the `phase-gate-review` skill (`.cursor/skills/phase-gate-review/SKILL.md`).

- No id given: ask which phase, offering the open todos from the current plan.
- UI phases include the visual QA loop for every screen in scope; the phase cannot pass with blocking visual findings.
- The pack goes to `evidence/<phase-id>/`; commit it only when the user asks.
- End with the result (passed / passed with follow-ups / not passed), embedded screenshots, open questions and follow-ups. Do not merge.
