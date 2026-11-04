---
name: security-review-handoff
description: Prepares and runs a security review of BudgetFlow changes through Cursor's built-in Security Review (/review-security) with BudgetFlow-specific instructions - secrets and public-repo hygiene, registry auth, tenant isolation, authorization, audit integrity, uploads, CI. Use before merging changes to auth, secrets handling, CI workflows, scripts, hooks, uploads, integrations or infra, and at the Phase 10 security gate.
---

# Security review hand-off

This wraps the built-in `/review-security` skill; it does not replace it.

## 1. Pre-checks (cheap, run first)
```bash
sh scripts/secret-scan.sh --all
npm audit --omit=dev
```
Fix secret-scan findings before the review. Note audit results for the report (do not bump dependencies outside the task).

## 2. Run the review
Invoke `/review-security` on the branch changes with these custom instructions:

```text
BudgetFlow is a public repository. In addition to standard checks, verify:
1. No tokens, keys, .env files, HAR files or traces are committed; the repo .npmrc has no auth lines; CI never prints or writes SATORI_PACKAGES_TOKEN and skips (not fails) when it is absent.
2. No internal company URLs, ticket references or names.
3. Authorization goes through the single policy/scope check (PolicyService.can later); no endpoint or store command skips it; one director cannot read or change another director's budget.
4. Tenant isolation relies on Postgres RLS with FORCE ROW LEVEL SECURITY and app.tenant_id, not only on query filters (later phases).
5. Money is integer minor units; allocation and commitment paths cannot exceed parent available under concurrency (ordered row locks, idempotency keys).
6. Audit and ledger are append-only and the audit hash chain cannot be bypassed or rewritten.
7. Inputs are validated at the boundary (zod contracts, typed forms); no innerHTML or bypassSecurityTrust with user data; uploads are type- and size-limited.
8. Cursor hooks and scripts fail open only on internal errors and never log secret values.
```

## 3. Triage
For each finding: confirm it against the code (reviewers can be wrong), classify (fix now / document / false positive), and fix critical and high findings in this change. Re-run the gates after fixes.

## 4. Report
The review's findings table, what you fixed (with commits), what you documented and why, and the gate result. If a real secret was ever pushed, tell the user it must be rotated; history rewriting alone is not enough.
