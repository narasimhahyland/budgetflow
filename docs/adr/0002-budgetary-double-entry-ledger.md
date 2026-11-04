# 0002 Budgetary double-entry ledger

## Context

The finance review requires an accounting-grade ledger before budgets are built: separate request, commitment and actual buckets, accounting periods, the currency triplet, reversals instead of edits, balances that can be rebuilt and checked.

## Decision

- Seven budget buckets (`authorized`, `allocated_out`, `held`, `pre_encumbered`, `encumbered`, `actual`, `accrued`) plus tenant-level counter accounts (`plan_funding`, `savings`, `obligations`, `earmark_reserve`, `fx_variance`, `intercompany_due_from`, `intercompany_due_to`) so every business event is a balanced journal.
- Signed line amounts (debit positive, credit negative); a journal balances in transaction and reporting currency. Budget-currency amounts are carried per line.
- Posting builders in `libs/domain` are the only way to produce journals; the API posts them with ordered row locks and an idempotency key.
- Append-only enforced in the database (revoked grants and triggers), balance checked at commit, closed periods rejected by trigger.
- Cached balances per budget, period and bucket, verified by the worker's rebuild check; drift is flagged, never repaired automatically.
- Manual journals (finance admins) may touch only commitment, actual, accrual and earmark buckets, never `authorized` or `allocated_out`, so hierarchy invariants cannot be broken by hand.

## Consequences

- Hierarchy reconciliation compares parent `allocated_out` with children's `authorized` in reporting currency; lateral transfers and contribution transfers use journal types excluded from that comparison.
- FX effects on actuals are posted to `fx_variance` in Phase 6; budget control keeps using the locked plan rate.
- Reports can drill down to ledger lines (Phase 10) because every line carries dimensions and provenance.
