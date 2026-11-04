---
name: new-screen
description: Slash command /new-screen <screen number or name> - builds a BudgetFlow screen from its approved Stitch design with all states, a journey proving the flow, visual baselines and a visual QA pass.
disable-model-invocation: true
---

# /new-screen

Build the screen named after `/new-screen` by following the `add-feature-screen` skill (`.cursor/skills/add-feature-screen/SKILL.md`) step by step.

- Start by writing the step-1 spec (screen number, phase, roles, data, actions, states) in chat. If the screen has no approved design in `design/stitch/` or no spec in `docs/ux/screens/`, or it is ambiguous, ask one focused question before coding.
- Keep to the owned files named in step 2 of the skill.
- End with `/functional-check` for the flow, `/visual-qa` for the screen (no blocking issues), gates (`scripts/gate.sh`), and the skill's "Done means" report.
