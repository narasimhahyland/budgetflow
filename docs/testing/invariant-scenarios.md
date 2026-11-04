# Invariant-to-scenario map

Every domain and ledger invariant is proven by an API scenario in `apps/api-e2e` (HTTP against the running API, real Keycloak tokens, real Postgres). A change that adds or alters an invariant updates this table and the scenario in the same change. Status is `planned (Pn)` until the scenario exists and passes, then `passing`. Rules: `.cursor/rules/domain-invariants.mdc`, `.cursor/rules/ledger-accounting.mdc`, `.cursor/rules/testing-functional.mdc`.

| # | Invariant | Proving API scenario (`apps/api-e2e/src/...`) | Status |
| --- | --- | --- | --- |
| 1 | Available = authorized − allocated out − held − pre-encumbered − encumbered − actual, per control basis | `ledger/available.spec.ts` — post each bucket, read balance, compare with the formula per control basis | planned (P1) |
| 2 | Child allocations + commitments never exceed parent available at the locked plan rate | `budgets/over-allocation.spec.ts` — allocate one minor unit over (same and cross currency): 409 `OVER_ALLOCATION` with remaining amount | planned (P4) |
| 3 | Concurrent allocations never exceed the parent (ordered row locks) | `budgets/concurrent-allocation.spec.ts` — 20 parallel allocations summing over the limit: accepted total ≤ available | planned (P4) |
| 4 | Idempotent mutations post once | `budgets/idempotency.spec.ts` — same key twice: one journal, same response | planned (P4) |
| 5 | Every journal balances; ledger append-only; corrections are reversals | `ledger/reversal.spec.ts` — reverse a posting: original kept, reversal linked, net zero; update/delete attempts rejected | planned (P1) |
| 6 | Parent allocated out equals children's authorized; root ties to the approved plan version | `ledger/hierarchy-reconciles.spec.ts` | planned (P4) |
| 7 | Nothing posts to a Closed or Locked period; late items go to the next open period with a flag | `ledger/closed-period.spec.ts` | planned (P3) |
| 8 | FX never consumes budget; triplet amounts match the stored rate | `ledger/fx-triplet.spec.ts` — actual at a different rate: consumption at plan rate, FX effect reported separately | planned (P4) |
| 9 | Reductions need a destination, reason code, typed reason and impact preview; set to zero floored at committed + actual + children unless cascaded | `budgets/reduce-set-to-zero.spec.ts` | planned (P4) |
| 10 | Frozen / zero / expired / closed budgets reject new requests; existing commitments stay visible and complete | `budgets/set-to-zero-blocks.spec.ts` — new request 409 `BUDGET_SET_TO_ZERO`; existing commitment consumes an actual | planned (P4) |
| 11 | Approvers act within their DoA limit for spend type and entity; routing follows the DoA table and hierarchy | `approvals/doa-routing.spec.ts` — under, at and one minor unit over the limit; escalation | planned (P5) |
| 12 | No self-approval; approver not a beneficiary or attendee; delegation capped by the delegator's limit and dates | `approvals/hygiene.spec.ts` | planned (P5) |
| 13 | Inter-Director Budget Contribution Request: giver decides full / partial / reject; earmark or transfer with attribution | `contributions/partial-approval.spec.ts` — request 10,000, approve 6,000: held 6,000 on giver, attribution on the event | planned (P5) |
| 14 | Cross-entity contributions are blocked or recharged per policy before close | `contributions/intercompany.spec.ts` | planned (P5) |
| 15 | An actual is matched once; cross-source duplicates flagged | `actuals/match-once.spec.ts` | planned (P6) |
| 16 | Events cannot close with unmatched actuals or missing recharges; surplus returns by share | `events/close-rules.spec.ts` | planned (P6) |
| 17 | Director A never reads or mutates Director B's budget except through a contribution request | `scope/director-isolation.spec.ts` — 403/404 on read and write as director A | planned (P2) |
| 18 | Tenant isolation by RLS, even with a forged `X-Tenant-Id` | `scope/tenant-rls.spec.ts` (API) and `db/rls-policies.spec.ts` (application role with `app.tenant_id`) | planned (P1) |
| 19 | Exactly one hash-chained audit entry per successful mutation; none on rejection; audit immutable | `audit/hash-chain.spec.ts` | planned (P1) |
| 20 | Cached balances equal a full rebuild; the nightly check detects drift | `ledger/rebuild-check.spec.ts` — run the worker job; inject drift in a Testcontainers DB: integrity record raised | planned (P1) |
| 21 | AI answers, chat cards, widgets and connectors stay within `PolicyService` scope; suggestions need human confirmation | `ai/scope.spec.ts` with the fake `AiProvider` | planned (P13) |
| 22 | Money in integer minor units with ISO 4217; splits sum to the whole | `ledger/money-splits.spec.ts` — three-way split of an odd amount (JPY, USD, KWD) | planned (P1) |
