# Phase 11 backend — period close, year end and roll-forward

Functional proof for the backend half of Phase 11 (`feat/p11-close-backend`). The frontend half
(screens 80e, 86a, 87a, 87b) follows in a separate change against these endpoints.

Run on the local Docker Compose stack of this worktree (`bf-p11-close`, API on 3110) with the
deterministic seed, reset before the run. Commands:

```text
scripts/stack.sh reset
npx playwright test -c apps/api-e2e/playwright.config.ts
```

Result: **327 of 327 API scenarios passed**, 18 of them new in `apps/api-e2e/src/close/`. Full list
in `api-scenarios.txt`.

## Business outcomes

| #   | Outcome                                                                                                                                   | Proven by                                                                                                                                                                                                    | Result |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | A period will not close while a legal entity's hard check fails, and the API says which entity and check                                  | `close/period-close.spec.ts` — a new entity with no GL tie-out gets `PERIOD_CLOSE_BLOCKED` naming it                                                                                                         | pass   |
| 2   | A hard check can never be waved through                                                                                                   | same spec — acknowledging `gl_tieout_signed_off` is `CHECK_NOT_ACKNOWLEDGEABLE`                                                                                                                              | pass   |
| 3   | A soft check blocks until it passes or someone accepts it with a reason code and typed reason                                             | same spec — November's unmatched actuals block, then stop blocking once acknowledged                                                                                                                         | pass   |
| 4   | Closing needs the exact typed confirmation                                                                                                | same spec — `close it` is refused with `CONFIRMATION_MISMATCH`; `CLOSE JAN 2026` succeeds                                                                                                                    | pass   |
| 5   | Closing writes one immutable as-of snapshot per legal entity                                                                              | same spec — one snapshot at version 1 with the entity's bucket totals                                                                                                                                        | pass   |
| 6   | Reopening a closed period needs two different people                                                                                      | same spec — the requester's own approval is `SAME_PERSON_APPROVAL`; a second person's approval reopens it                                                                                                    | pass   |
| 7   | Only one reopen request waits at a time, and a decline changes nothing                                                                    | same spec — `REOPEN_ALREADY_REQUESTED`; after a decline the period is still closed                                                                                                                           | pass   |
| 8   | Re-closing a reopened period keeps the original snapshot and adds the next version                                                        | same spec — snapshot versions `[1, 2]`                                                                                                                                                                       | pass   |
| 9   | Locking after reporting, and unlocking under the same two-person rule                                                                     | same spec — locked, then unlocked back to closed by a second person                                                                                                                                          | pass   |
| 10  | Every close, acknowledgement, request and decision is audited exactly once with its reason                                                | same spec — one `period.close` entry carrying the status change and the snapshot version                                                                                                                     | pass   |
| 11  | Postings into a closed **or locked** period are refused by Postgres, not only by application code                                         | `close/closed-period-database.spec.ts` — `BF002` on a journal and on a line, as the application role                                                                                                         | pass   |
| 12  | Corrections can only be reversals: ledger rows, audit events, snapshots, acknowledgements and commitment carries reject UPDATE and DELETE | same spec — the grant is revoked (`42501`) and the trigger refuses (`BF001`)                                                                                                                                 | pass   |
| 13  | The four new tables force RLS with `tenant_isolation` and another tenant's rows are invisible and unwritable                              | same spec                                                                                                                                                                                                    | pass   |
| 14  | A year-end dry run posts nothing and splits what each budget has into carry and lapse                                                     | `close/year-end.spec.ts` — a 25% cap carries 30,000 of 120,000 and lapses 90,000 to the parent; balances unchanged                                                                                           | pass   |
| 15  | Roll-forward does not mint money                                                                                                          | same spec — the ending year's budgets end at zero available, the target counterpart rises by exactly the carry, and every journal balances in both currency views                                            | pass   |
| 16  | Cached balances still equal the nightly rebuild after a close and after a year-end run                                                    | same spec and `close/period-close.spec.ts` — the ledger rebuild check reports `clean` with zero flags, including plan tie-out and the audit chain                                                            | pass   |
| 17  | A carried commitment keeps its amount and its funding                                                                                     | same spec — the ending year commitment becomes `carried_forward`, the new year's twin links back to it, and the target budget's authorized and encumbered both rise by 150,000 so its available is unchanged | pass   |
| 18  | Carry-with-approval is decided by someone else before anything posts, and part-approval never raises the request                          | same spec — `YEAR_END_NOT_READY` while it waits, 403 for the Finance Admin who runs the year end, `LIMIT_EXCEEDED` above the request, and carry + lapse still equal what the budget had                      | pass   |
| 19  | A budget with no rollover policy blocks its own line instead of guessing                                                                  | same spec                                                                                                                                                                                                    | pass   |
| 20  | A year-end run posts once                                                                                                                 | same spec — the second execution is `YEAR_END_ALREADY_EXECUTED`                                                                                                                                              | pass   |
| 21  | Close and year-end are finance work                                                                                                       | same specs — an employee gets 403 on the period list; a budget owner gets 403 starting a run                                                                                                                 | pass   |

## Where the money goes

A year-end carry is two mirror postings, one per year, each balanced on its own:

- Ending year: the budget's authorized is debited up the hierarchy to the root, and the root's
  `savings` counter is credited (`postHierarchyMove`, reason code `YEAR-END-CARRY`).
- Target year: the root's `savings` is debited and the root's authorized credited, then allocated
  down to the counterpart budget (`postYearEndCarryIn`, journal type `rollover`).

Because the target root's authorized grows by exactly what its savings gives up, both years still
satisfy `plan total = root authorized + savings`, which the rebuild check verifies per plan version.
Only the savings line carries the plan version, exactly as the mirror reduction does.

A lapse is a reduction with a destination: to the parent when the policy sweeps to the parent, or
out through the root to `savings` when it sweeps to corporate.

A carried commitment is `release_encumbrance` in the ending year and `carry_encumbrance` in the
target year for the same budget amount at the commitment's stored rates, so FX never consumes
budget and the commitment's history stays with the original row.

## Notes

- Period status changes run on a fiscal calendar and legal entity the scenario creates in the
  Initech Sandbox tenant, so closing and locking never blocks another scenario's postings.
- Year-end scenarios own their FY2026 and FY2027 roots, created through signed-off plan revisions.
- `evidence/phase-11/api/close-responses.json` holds the list, checklist, rollover policy and
  year-end run responses against the deterministic seed.
- `evidence/phase-11/db/p11-rls-and-append-only.txt` holds the RLS, append-only trigger and
  closed-period trigger definitions straight from Postgres.
