# libs/domain — framework-free business rules

Pure TypeScript: money and currency triplets, the ledger (buckets, postings, reversals, periods), budget state machine and controls, delegation-of-authority checks, Inter-Director Budget Contribution Request decisions, the rules evaluator, the approval router, and the audit hash chain.

- No Angular, NestJS, Drizzle, HTTP or environment access. No `Date.now()` or randomness inside rules: clocks, ids and rates are passed in.
- Deterministic functions returning typed results (`{ ok: true, value } | { ok: false, error }`) for business failures.
- Every invariant is proven by an API scenario in `apps/api-e2e` (happy path, exact boundary, one minor unit past it, rejection); the map is `docs/testing/invariant-scenarios.md`. Unit tests are optional, never a substitute.
- Changes go through `/ledger-change` (ledger, buckets, periods, currency, intercompany) or `/domain-change` (state machine, controls, DoA, rules, approvals, contributions).

Rules: `.cursor/rules/ledger-accounting.mdc`, `domain-invariants.mdc`, `rules-engine-approvals.mdc`, `audit-trail.mdc`.
