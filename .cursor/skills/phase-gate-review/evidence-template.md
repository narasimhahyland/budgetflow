# Evidence README template

```markdown
# <Phase id> — gate review

- Commit: <short sha> on <branch>, reviewed <YYYY-MM-DD>
- Scope: <plan todos closed>; screens <numbers>; journeys <list>
- Result: <passed | passed with follow-ups | not passed> — <one sentence why>

## Gates
| Gate | Result | Evidence |
| --- | --- | --- |
| Secret scan | PASS | gate-summary.txt |
| Lint (ESLint + satori-lint) | PASS | gate-summary.txt |
| Typecheck | PASS | gate-summary.txt |
| Styles (stylelint, Satori adoption) | PASS | gate-summary.txt |
| Build (OpenAPI drift, migration check) | PASS | gate-summary.txt |
| Satori design system check (sdsc) | PASS | gate-summary.txt |
| Functional API scenarios (apps/api-e2e) | PASS (<n> scenarios) | gate-summary.txt, api-e2e report |
| Functional journeys (apps/web-e2e) | PASS (<n> journeys) | gate-summary.txt, web-e2e report |
| Visual regression (toHaveScreenshot, pinned image) | PASS (<n> baselines) | playwright-report/ |
| <phase-specific gate> | <result> | <file> |

## Acceptance checklist (each item proven functionally)
| Criterion (from the plan's phase gate) | Proven by (scenario / journey) | Role(s) | Result | Evidence |
| --- | --- | --- | --- | --- |
| <e.g. Over-allocation is a hard block with reason> | api-e2e budgets/over-allocation.spec.ts; web-e2e budgets/allocate.spec.ts | regional-manager | PASS | <item>/functional/README.md |

## Core acceptance scenario (every wave gate from Wave 2)
| Step | Result | Evidence |
| --- | --- | --- |
| 1-10 (plan's extended scenario) | <PASS per step> | acceptance/README.md |

## Invariant coverage
All rows touched this phase in docs/testing/invariant-scenarios.md: <n> passing, <n> planned for later phases.

## Visual QA (required for UI phases)
| Item | Result | Evidence |
| --- | --- | --- |
| Screens x states captured | <n> x <n> at desktop, tablet, mobile x light, dark | visual-qa/report.md |
| Loop iterations | <n> of 5; stop reason: <no blocking issues> | visual-qa/report.md |
| Blocking findings in final iteration | 0 | visual-qa/report.json |
| Console errors / failed requests | 0 / 0 | visual-qa/report.json |
| Horizontal overflow / interpolation leftovers / layout shift > 0.1 | none / none / none | visual-qa/report.json |
| Design parity vs approved Stitch screens | <n> screens compared; deviations accepted: <list or none> | visual-qa/design-parity/design-parity.md |
| Budget-safety visual rules | met | visual-qa/report.md (inspection notes) |
| Exploratory click-through | <result> | visual-qa/exploratory.md |
| Before/after of fixes | <n> pairs | visual-qa/before-after/ |

## Reviews
| Reviewer | Verdict | Blockers fixed | Remaining |
| --- | --- | --- | --- |
| ux-reviewer | <verdict> | <n> | <list or none> |
| domain-invariant-reviewer | <verdict> | <n> | <list or none> |
| security review | <verdict or n/a> | <n> | <list or none> |

## Known issues
- <issue, impact, owner, follow-up>

## Open UX questions
- <screen>: <question>

## Not in this pack
Traces, videos, auth state and raw logs: tmp/evidence/<phase-id>/ (local only).
```
