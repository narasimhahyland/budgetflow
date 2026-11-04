---
name: domain-change
description: Changes BudgetFlow domain behavior safely - budgets, allocation, controls (freeze, reduce, set to zero), delegation-of-authority, approval hygiene, events, Inter-Director Budget Contribution Requests, scope checks and audit - in libs/domain first, then the API command that wraps it, proven by API scenarios on the running stack. Use whenever a change touches business rules, commands, balances, statuses, approvals or audit entries. For ledger postings use ledger-change as well.
---

# Domain change

```text
- [ ] 1 State the rule change in one sentence; find the invariants and their scenarios
- [ ] 2 Write or extend the API scenarios first (they fail now)
- [ ] 3 Implement in libs/domain (pure), then the API command (transaction)
- [ ] 4 Update contracts, callers and the invariant map
- [ ] 5 Functional check and review with domain-invariant-reviewer
- [ ] 6 Gates and report
```

## 1. Frame it
Read `.cursor/rules/domain-invariants.mdc` (and `ledger-accounting.mdc`, `audit-trail.mdc` for ledger and audit work). Write down: the rule as it is, the rule as it should be, the plan phase, the invariants touched (rows in `docs/testing/invariant-scenarios.md`), and the public surface that changes (`libs/domain` exports, `libs/contracts` schemas). A change that weakens an invariant needs the user's explicit approval before you continue.

## 2. Scenarios first
In `apps/api-e2e/src/<area>/`, add or extend scenarios that fail against the current stack (`scripts/stack.sh up && scripts/stack.sh reset`), with tokens per role:
- happy path with exact minor-unit amounts and the currency triplet;
- the boundary (exactly at the limit) and one minor unit past it, at the locked plan rate;
- rejection on frozen, set-to-zero, exhausted, expired and closed budgets with the right problem `code`, while existing commitments still complete;
- authority: within and one minor unit over the DoA limit; self-approval, beneficiary and attendee approvers rejected;
- scope: out-of-scope role denied, Director A on Director B's budget denied, other tenant invisible;
- splits, partial approvals and surplus returns sum exactly to the whole;
- one hash-chained audit entry on success, none on rejection; idempotent retry posts once; concurrent calls cannot jointly exceed a limit.

## 3. Implement
- `libs/domain`: pure functions and state machines, no framework, database or HTTP imports. Return `{ ok: true, value }` or `{ ok: false, error: { code, message, params } }`; never throw for business failures.
- API command (`libs/api/<module>`): one transaction — validate, `PolicyService.can`, row locks in fixed order, idempotency key, domain call, journal post (`/ledger-change`), audit entry, outbox message. No partial writes when a later check fails.
- Money only as integer minor units with ISO 4217 codes through the shared money helpers.

## 4. Contracts, callers, map
Contract changes start in `libs/contracts` (`/api-endpoint`) and regenerate OpenAPI in the same change. Update every caller (API modules, web data-access, journeys). Update `docs/testing/invariant-scenarios.md` rows (scenario path, status). List shared-file changes in the final message.

## 5. Prove and review
Run `/functional-check` for the change: the API scenarios pass, and a UI journey covers it when users see the rule. Then hand the diff and the rule statement to the `domain-invariant-reviewer` subagent, which re-runs the scenarios; fix critical and high findings.

## 6. Gates and report
`scripts/gate.sh static functional`. Report the rule change, invariants touched, scenarios added (names) with results, contract changes, reviewer verdict, and the evidence path.
