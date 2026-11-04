---
name: ledger-change
description: Changes how BudgetFlow posts to its accounting-grade ledger - buckets (authorized, allocated out, held, pre-encumbered, encumbered, actual, accrued), balanced append-only journals, reversals, accounting periods, the currency triplet with locked plan rates, intercompany entries, idempotency and ordered row locks - and proves every invariant with API scenarios on the running stack, including the ledger rebuild check. Use for any change to postings, balances, buckets, periods, FX, reversals, intercompany or the nightly rebuild.
---

# Ledger change

Rules: `.cursor/rules/ledger-accounting.mdc` (source of truth), `.cursor/rules/domain-invariants.mdc`, `.cursor/rules/audit-trail.mdc`. A change that weakens an invariant needs the user's explicit approval.

```text
- [ ] 1 Posting design table (lines per bucket, per currency)
- [ ] 2 Invariants touched and their scenarios
- [ ] 3 Implement: domain posting builder, then the API command
- [ ] 4 API scenarios incl. rebuild check
- [ ] 5 Review with domain-invariant-reviewer
- [ ] 6 Gates and report
```

## 1. Posting design
Before code, write the journal as a table for each business event: line, bucket, sign, transaction / budget / reporting amounts (minor units), rate type and rate, period, dimensions (legal entity, cost center, GL account, event code), provenance, reversal link. Check that it balances, that no amount sits in two consumption buckets, that FX does not consume budget, and how corrections reverse it. Example: request approved → pre-encumbered −X, encumbered +X on the same budget, one audit event.

## 2. Invariants and scenarios
List the rows of `docs/testing/invariant-scenarios.md` the change touches; add rows for new invariants with a scenario path.

## 3. Implement
- `libs/domain`: a pure posting builder returning balanced lines or a typed rejection; money helpers for conversion (half-even once per line) and splits (largest remainder).
- API command: one transaction with ordered row locks (parent before children, then by id), idempotency key, period status check (Closed and Locked reject; late items to the next open period with a flag), journal insert, cached balance update, audit entry. No `UPDATE`/`DELETE` on ledger rows; corrections are reversals.
- Worker: the nightly rebuild recomputes balances from lines, verifies every journal balances and the audit hash chain, and raises an integrity record on drift (never auto-repairs).

## 4. API scenarios (`apps/api-e2e/src/ledger/` and the business area)
Against the running stack (`scripts/stack.sh up && scripts/stack.sh reset`):
- each business event posts the designed lines (read back through the API or the ledger view) and balances;
- boundary: available exactly zero passes, one minor unit more is rejected with the right `code`;
- reversal nets to zero and links the original; closed-period posting is rejected; late item lands in the next open period flagged;
- cross-currency: budget control at the locked plan rate, FX effect reported separately;
- intercompany pairs net to zero at group level;
- idempotent replay posts once; concurrent postings keep available ≥ 0 (Testcontainers Postgres per worker for isolation);
- rebuild check: run the worker job, rebuilt balances equal cached ones; inject drift in an isolated database and the check raises an integrity record.
Run `npx nx run api-e2e:functional-api -- -g "ledger|<area>"`.

## 5. Review
Hand the diff and the posting table to the `domain-invariant-reviewer` subagent. Fix critical and high findings.

## 6. Gates and report
`scripts/gate.sh static functional-api` (plus `functional-e2e` if a screen shows the numbers). Report: posting table, invariants touched, scenarios with results, reviewer verdict, evidence path.
