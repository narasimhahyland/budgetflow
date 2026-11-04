# Ledger

The ledger is the financial source of truth: balances derive from it and nothing changes money except a posting. Rules: `.cursor/rules/ledger-accounting.mdc`. Code: `libs/domain/src/lib/ledger/` (pure), `libs/api/ledger` (posting service), `libs/api/db/src/schema/ledger.ts` (tables), `libs/api/db/migrations/0001_security_rls_ledger_guards.sql` and `0002_ledger_hardening.sql` (database guards).

## Accounts and sign convention

Every journal is a balanced set of lines. Line amounts are signed: **debit positive, credit negative**, in each currency view. A journal balances when the transaction amounts sum to zero and the reporting amounts sum to zero (budget-currency amounts differ per budget and are not summed across budgets).

| Account                                         | Kind          | Normal side    | Meaning                                                                                         |
| ----------------------------------------------- | ------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `authorized`                                    | budget bucket | credit         | Money the budget holds (original amount or allocations received)                                |
| `allocated_out`                                 | budget bucket | debit          | Money passed to children                                                                        |
| `held`                                          | budget bucket | debit          | Earmarks: approved Inter-Director Budget Contribution Requests held on the giver, reserve holds |
| `pre_encumbered`                                | budget bucket | debit          | Submitted requests                                                                              |
| `encumbered`                                    | budget bucket | debit          | Approved commitments                                                                            |
| `actual`                                        | budget bucket | debit          | Matched actuals                                                                                 |
| `accrued`                                       | budget bucket | debit          | Accruals past service date; never consumes budget                                               |
| `plan_funding`                                  | counter       | debit          | The approved plan version funding root budgets                                                  |
| `savings`                                       | counter       | credit         | Reductions sent to savings                                                                      |
| `obligations`                                   | counter       | credit         | Counterpart of commitments, actuals and accruals                                                |
| `earmark_reserve`                               | counter       | credit         | Counterpart of earmarks                                                                         |
| `fx_variance`                                   | counter       | debit          | FX effects reported separately (actual rate minus locked plan rate, Phase 6)                    |
| `intercompany_due_from` / `intercompany_due_to` | counter       | debit / credit | Recharge receivable and payable; net to zero at group level                                     |

Bucket balance in its natural sign = normal sign × Σ amounts (`NORMAL_SIGN` in `accounts.ts`).

**Available** = authorized − (allocated out, held, pre-encumbered, encumbered, actual), counting only the buckets in the budget's control basis. Allocation always counts allocated out and allows no tolerance; spend checks follow the control mode (hard blocks beyond tolerance, soft warns, track records).

## Posting tables

Amounts below are in the transaction currency; every line also carries the budget-currency amount (budget lines only) and the reporting amount at the locked plan rate. "Implemented" means an API command posts it today.

| Business event                | Debit                                                                                              | Credit                                                                                          | Journal type               | Status                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------- |
| Original root budget          | `plan_funding` (plan version)                                                                      | root `authorized`                                                                               | `original_budget`          | Implemented (P1)                                                                  |
| Allocate to a child           | parent `allocated_out`                                                                             | child `authorized`                                                                              | `allocation`               | Implemented (P1)                                                                  |
| Reversal of any journal       | each line negated, linked by `reversal_of_line_id`                                                 |                                                                                                 | `reversal`                 | Implemented (P1)                                                                  |
| Opening balance or adjustment | `held` / `pre_encumbered` / `encumbered` / `actual` / `accrued`                                    | `obligations` / `earmark_reserve` / `fx_variance`                                               | `manual`                   | Implemented (P1, finance admins)                                                  |
| Reduce to parent              | child `authorized`                                                                                 | parent `allocated_out`                                                                          | `reduction`                | Implemented (P4, `postHierarchyMove`)                                             |
| Reduce to savings             | each budget up to the root `authorized`, root `authorized`                                         | each parent `allocated_out`, `savings` (plan version)                                           | `reduction`                | Implemented (P4): money leaves through the root                                   |
| Reallocate or transfer        | source and ancestors up to the common ancestor `authorized`; destination's parents `allocated_out` | their parents `allocated_out`; destination and ancestors below the common ancestor `authorized` | `reduction` / `transfer`   | Implemented (P4); the common ancestor's pair nets out                             |
| Plan version applied          | `plan_funding` (increase) or root `authorized` (decrease)                                          | root `authorized` or `plan_funding`, both with the plan version                                 | `increase` / `reduction`   | Implemented (P4)                                                                  |
| Per-head allocation / true-up | parent `allocated_out` or child `authorized` (return)                                              | child `authorized` or parent `allocated_out`                                                    | `allocation` / `reduction` | Implemented (P4)                                                                  |
| Request submitted             | `pre_encumbered`                                                                                   | `obligations`                                                                                   | `commitment`               | Builder ready (`postCommitmentMovement`), command P5                              |
| Request approved              | `encumbered`                                                                                       | `pre_encumbered`                                                                                | `commitment`               | Builder ready, P5                                                                 |
| Request rejected or withdrawn | `obligations`                                                                                      | `pre_encumbered`                                                                                | `commitment`               | Builder ready, P5                                                                 |
| Actual charged (P6)           | budget `actual` (transaction currency, plan rate)                                                  | `obligations`                                                                                   | `actual`                   | Implemented (P6, `MatchEngine`; refunds and credit notes post the opposite sides) |
| Actual matched: relief        | `obligations` (budget currency)                                                                    | `encumbered` (what the commitment still has)                                                    | `commitment`               | Implemented (P6; relief reuses the posted budget amount, so no FX drift)          |
| FX effect of an actual        | `fx_variance` (unfavourable) / `obligations`                                                       | `obligations` / `fx_variance`                                                                   | `actual`                   | Implemented (P6; counter accounts only, never consumes budget)                    |
| Prepaid recognized            | `actual` (budget currency)                                                                         | `encumbered`                                                                                    | `commitment`               | Implemented (P6, straight-line over the service days)                             |
| Remainder released            | `obligations`                                                                                      | `encumbered`                                                                                    | `commitment`               | Implemented (P6 hygiene release, cancellation fees; P5 on approval flows)         |
| Accrual / auto-reversal       | `accrued` / `obligations`                                                                          | `obligations` / `accrued`                                                                       | `accrual`                  | Implemented (P6; reversal by the actual or the next period start)                 |
| Earmark / release             | giver `held` / `earmark_reserve`                                                                   | `earmark_reserve` / giver `held`                                                                | `contribution`             | Builder ready, P5                                                                 |
| Intercompany recharge         | `intercompany_due_from` (charging entity)                                                          | `intercompany_due_to` (charged entity)                                                          | `recharge`                 | Builder ready (`postIntercompanyRecharge`), P5/P12                                |

Transfers between budgets that are not parent and child (P4) and contribution transfers (P5) use journal types `transfer` and `contribution`; the rebuild check excludes those two types from the parent/child reconciliation.

Manual journals exchange amounts between budgets and counter accounts only: every budget line sits on the same side (all debits or all credits), so a manual journal can never move value between budgets or between buckets of one budget (`MANUAL_JOURNAL_NEEDS_COUNTER_ACCOUNT`). No posting may leave any bucket below zero (`NEGATIVE_BUCKET_BALANCE`), and allocated out never exceeds authorized.

## Periods

Each legal entity has a fiscal calendar (`fiscal_calendars`, generated by `generateFiscalYear`: calendar year, non-calendar start, 4-4-5 / 4-5-4 / 5-4-4, 13-period); entity years map to the group year (`fiscal_years.group_fiscal_year_id`). Each line resolves its period from its own legal entity's calendar (`resolvePostingPeriod`):

- Open: posts there. Soft-closed: only finance adjustments (reversals, manual journals) post there; ordinary postings move on.
- Closed or Locked: nothing posts; the line lands in the next open period, flagged `late` with `original_period_id`.
- The database rejects any insert into a closed or locked period (`app_reject_closed_period`, SQLSTATE `BF002`).
- A journal posts within its budgets' fiscal year: an accounting date outside the year is rejected (`ACCOUNTING_DATE_OUTSIDE_FISCAL_YEAR`), checked once in `LedgerService.post` for every command.

Seed calendar (deterministic): periods ending before July 2026 are locked, July-September 2026 closed, October 2026 soft-closed, November 2026 onward open.

## Currency triplet and rounding

- Amounts are integer minor units (`bigint` columns, `Number.isSafeInteger` in TypeScript) with ISO 4217 codes; exponents come from `CURRENCY_EXPONENTS` (JPY 0, USD 2, KWD 3).
- Rates are quoted as units of the quote currency per one unit of the tenant's reporting currency, held as 12-decimal scaled bigints. A cross rate is computed once and rounded half-even to 12 decimals; the amount is converted with exactly that rate, rounded half-even at the line, and both the rate value and source rate ids are stored on the line, so a re-conversion reproduces the stored amount.
- Exception on hierarchy lines (`authorized`, `allocated_out`; `budgetRoundingFor`): the budget giving value up (a debit) rounds its budget amount away from zero and the budget receiving it (a credit) rounds toward zero, so a child never holds more than its parent gave up. An allocation of INR 1.24 costs a USD parent USD 0.02; USD 0.01 credits a JPY child JPY 1. An amount worth less than one minor unit of either budget currency is rejected (`AMOUNT_ROUNDS_TO_ZERO`). Reporting amounts always round half-even, so a USD parent's budget and reporting views of one allocation line can differ by one cent.
- A manual journal balanced in its transaction currency may not balance in reporting after half-even rounding per line (INR 3.00 = 4 cents, three INR 1.00 = 3 cents). A rounding line to `fx_variance` with a zero transaction amount absorbs the difference (at most half a minor unit per line); it never carries budget value.
- Budget control always uses the plan rate locked for the budget's fiscal year (`exchange_rates.locked`). Spot, month-end and monthly-average rates exist for reporting (Phase 6 and 10). FX never consumes budget.
- Splits use the largest-remainder method so parts sum exactly to the whole (`splitByWeights`).

## Concurrency, idempotency, immutability

- Money commands lock the affected budget rows in a fixed order (`ORDER BY depth, id FOR UPDATE`: parent before children, then by id) inside one transaction, after the idempotency key row. 20 parallel allocations against one parent never exceed its available amount.
- `idempotency_keys (tenant_id, key)` is unique; a replay with the same request returns the stored response (`Idempotent-Replayed: true`); a different request with the same key is `IDEMPOTENCY_KEY_REUSED`. Rejected commands roll back and leave the key unused.
- `ledger_journals`, `ledger_lines`, `audit_events`, `budget_versions` and `period_close_snapshots` reject UPDATE, DELETE and TRUNCATE (no grants for the application roles, plus triggers raising `BF001`). Every journal balances at commit (deferred constraint triggers, `BF003`). Lines can only be inserted in the transaction that created their journal (`app_reject_lines_on_committed_journal`, `BF001`, migration `0002_ledger_hardening.sql`), so nobody appends lines to a committed journal.
- Foreign keys are checked without row-level security, so `budgets` references its parent, cost center, org unit and owner through `(tenant_id, id)` keys: a budget can never point at another tenant's rows.

## Cached balances and the rebuild check

`ledger_balances (budget, period, bucket)` holds signed sums updated in the posting transaction. The worker's rebuild check (`RebuildService`, on request through `POST /api/integrity/ledger-checks` and nightly) runs in one repeatable-read snapshot and verifies:

1. rebuilt balances from `ledger_lines` equal `ledger_balances`;
2. every journal balances and has at least two lines;
3. no bucket is negative and no budget has allocated out more than its authorized (`negative_bucket`, `over_allocated`);
4. every line's budget and reporting amounts equal a re-conversion of its transaction amount with the stored rates and the line's rounding rule, rounding lines stay within half a minor unit per line, and every reversal line exactly negates its original (`triplet_mismatch`);
5. each parent's allocated out equals its children's authorized valued in the parent's budget currency at the locked plan rate (bigint arithmetic): children may not be worth more than the parent gave up beyond the 12-decimal cross-rate slack, and the parent may have given up more only by per-line rounding (`hierarchy_mismatch`);
6. root budgets tie to their plan version (plan funding equals root authorized);
7. the audit hash chain verifies, up to the tenant's chain head (a chain cut short of its head is broken).

Any mismatch sets the run to `drift_detected` and writes `integrity_flags`. Nothing is repaired automatically.

## Actuals (Phase 6)

A matched actual posts, in one command: the charge in its transaction currency (budget `actual` against `obligations`, triplet at the locked plan rate, with the actual's cost center, GL account and event code on both lines for the GL tie-out), the relief of the commitment in the budget currency (`obligations` against `encumbered`, never more than the commitment still has encumbered, so partial invoices in another currency leave no drift), and the FX effect (reporting currency at the month-end or spot rate minus at the plan rate) on counter accounts only. A partial match relieves the matched amount; a match within tolerance relieves what is left and releases the difference; above tolerance needs an approved over-budget request. Matching a commitment reverses its posted accruals. Corrections reverse every journal of the match. Deposits matched as prepaids post nothing to the budget until recognized in their service period. Journals are not written inside savepoints: the guard that lines are inserted in their journal's transaction compares the top-level transaction id, so batch posting runs each match as a dry run first.
