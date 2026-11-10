# Phase 18: break-glass access (screen 112)

The platform operator (`super-admin`) reads no tenant financial data without an approved,
time-boxed, read-only grant, and everything done under a grant is audited against it.

## What changed

| Area      | Change                                                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration | `libs/api/db/migrations/0021_p18_break_glass.sql`: status, scope, requested minutes, decision and revocation columns; window nullable until approval; existing rows backfilled as approved                             |
| Policy    | `libs/domain/src/lib/authorization/policy.ts`: `break_glass.request` (SA), `break_glass.decide` (OA), `break_glass.read` (OA, FA, AUD); a lone SA may only request, and under an active grant only `BREAK_GLASS_READS` |
| Actor     | `libs/api/core/src/lib/actor.ts`: a grant counts only when approved, not revoked and inside its window by the real time                                                                                                |
| Audit     | `libs/api/audit/src/lib/break-glass-audit.interceptor.ts`: one `break_glass.read_under_grant` event per request under a grant (method and path, no query or body); the audit write failing fails the request           |
| API       | `GET/POST /api/admin/break-glass`, `POST .../{grantId}/decision`, `POST .../{grantId}/revocation` (`libs/contracts/src/lib/domains/admin.ts`, OpenAPI regenerated)                                                     |
| Web       | `/admin/security/break-glass` (`libs/web/features/admin/src/lib/break-glass.page.ts`), linked from company settings, Sign-in and sessions                                                                              |

## Outcomes

Roles: super-admin (operator), org-admin, finance-admin, auditor. Stack: this worktree's own
Compose project with the deterministic seed.

| Scenario                                                   | Expected                                        | Actual      | Result |
| ---------------------------------------------------------- | ----------------------------------------------- | ----------- | ------ |
| Operator reads a budget or its ledger, no grant            | 404                                             | 404         | pass   |
| Request for 241 minutes                                    | 422 `VALIDATION_FAILED`                         | 422         | pass   |
| OA, FA or auditor asks for access                          | 403                                             | 403         | pass   |
| Operator asks for 120 minutes; replay same key             | 201 requested; replay same id, header set       | as expected | pass   |
| Second open request                                        | 409 `CONFLICT`                                  | 409         | pass   |
| Read while the request waits                               | 404                                             | 404         | pass   |
| Operator decides (404), FA and auditor decide              | 404 / 403 / 403                                 | as expected | pass   |
| OA approves                                                | active, window exactly 120 minutes              | as expected | pass   |
| Decide an approved request again                           | 409 `CONFLICT`                                  | 409         | pass   |
| Under the grant: budget, ledger, budget list               | 200                                             | 200         | pass   |
| Under the grant: allocation, security settings             | 403                                             | 403         | pass   |
| Audit per read                                             | one event per successful read, none for refused | as expected | pass   |
| Requested and approved steps audited                       | one event each                                  | 1, 1        | pass   |
| OA revokes; operator reads again; revoke again             | revoked; 404; 409                               | as expected | pass   |
| Declined request                                           | nothing opens (404)                             | 404         | pass   |
| Journey: OA reviews, approves, sees counted reads, revokes | banners, statuses, count > 0                    | as expected | pass   |

Existing scope scenarios re-run in the same pass (`identity/me`, `identity/role-scope`,
`scope/director-isolation`): green, so the operator without a grant still has no tenant access.

## Files

- `api-scenarios.txt`: `apps/api-e2e/src/admin/break-glass.spec.ts` with the scope specs.
- `journey.txt`: `apps/web-e2e/src/admin/break-glass.spec.ts` with the administration journeys (desktop).
- `screens/`: requested and active states at desktop 1440 and mobile 412, light theme, as the Organization Admin.

## Not covered here

- The shell-wide banner for Organization Admins while a grant is active (112 asks for one on this
  page and in the shell); this page shows it, the shell does not yet.
- Visual baselines: the new screen is not in `apps/web-e2e/visual/screens.json`, and the company
  settings screen gains one link, so its baseline changes at the next re-record.
