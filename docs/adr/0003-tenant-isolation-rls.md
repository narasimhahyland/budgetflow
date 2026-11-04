# 0003 Tenant isolation with row-level security

## Context

Tenants must never see each other's data, even if application code has a bug or a request carries a forged `X-Tenant-Id`.

## Decision

- Every table with `tenant_id` enables and forces RLS with the `tenant_isolation` policy `tenant_id = app_current_tenant()`; `tenants` uses its id. The security migration applies this to every such table; `apps/api-e2e/src/db/rls-policies.spec.ts` fails if a new table lacks it.
- The API (`bf_app`) and worker (`bf_worker`) roles have no `BYPASSRLS`; the owner role runs migrations and the seed.
- `withTenant` sets `app.tenant_id` (and `app.subject`) per transaction. Before a tenant is chosen, a subject may read only its own memberships, grants and those tenants' names (`membership_self`, `role_grants_self`, `tenant_member_read`). The worker may list tenants (`worker_list_tenants`) and sets the context per tenant.
- On top of RLS, `PolicyService.can` decides per action and scope.

## Consequences

- Cross-tenant jobs must iterate tenants explicitly.
- Foreign keys are checked without RLS, so services load referenced rows through RLS first (a reference to another tenant's id is answered with 404 before any insert).
