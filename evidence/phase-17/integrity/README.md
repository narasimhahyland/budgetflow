# Phase 17: data integrity

Two proofs, both on this worktree's Compose stack.

## 1. The integrity invariants pass on the deterministic seed

77 API scenarios, all passing ([`scenarios.txt`](scenarios.txt)), cover the invariants in
`docs/testing/invariant-scenarios.md` that are about the ledger and audit trail staying correct:

| #   | Invariant                                                                | Scenarios                                                                                            |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 5   | Every journal balances; append-only; corrections are reversals           | `ledger/available`, `ledger/journal`, `ledger/reversal`                                              |
| 6   | Parent allocated out equals children's authorized; roots tie to the plan | `ledger/rebuild-check`, `budgets/planning`, `budgets/p4-plan-baseline`                               |
| 7   | Nothing posts to a Closed or Locked period                               | `ledger/closed-period`, `ledger/fiscal-period`, `close/closed-period-database`, `close/period-close` |
| 8   | FX never consumes budget; triplet amounts match the stored rate          | `ledger/fx-triplet`, `actuals/fx-plan-rate`, `ledger/rebuild-check`                                  |
| 15  | An actual is matched once; cross-source duplicates flagged               | `actuals/import-auto-match`, `actuals/queue-matching`, `actuals/refunds-reversals`                   |
| 19  | One hash-chained audit entry per mutation; none on rejection; immutable  | `audit/hash-chain`                                                                                   |
| 20  | Cached balances equal a full rebuild; the nightly check detects drift    | `ledger/rebuild-check`, `actuals/ledger-rebuild`                                                     |

The drift scenarios inject corruption on purpose (in the sandbox tenant) and assert the check finds
it, so a clean result below means something.

## 2. The ledger and audit trail stay consistent at volume

After the 10,000-line generator ran through the API (see `../perf/README.md`), the ledger rebuild
check and the audit chain verification ran once, through the API, as the roles that use them
([`large-dataset-checks.json`](large-dataset-checks.json)):

| Check                                     | Result                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Ledger rebuild check (finance-controller) | clean: 10,065 journals and 20,130 lines checked, 0 unbalanced, 0 drifts, 0 flags, 3 s |
| Audit hash-chain verification (auditor)   | valid: 162 events checked, no broken link                                             |

On the plain seed the same probe gave 65 journals, 130 lines, clean, and 81 events, valid. The
stack was reseeded afterwards.
