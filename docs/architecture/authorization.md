# Authorization

One decision point: `PolicyService.can(actor, action, resource)` in `libs/api/core`, backed by the pure rule table `ROLE_GRANTS` and `can` in `libs/domain/src/lib/authorization/policy.ts`. Controllers, components and jobs never check role names. Tenant isolation underneath is Postgres RLS on `tenant_id` ([ADR 0003](../adr/0003-tenant-isolation-rls.md)).

## Actor and resource

- **Actor** (resolved per request by `ActorResolver`): tenant, person, roles from `role_grants` valid today, materialized paths of the budgets the person owns or co-owns, and an active break-glass flag.
- **Resource**: the tenant, a budget (`id`, `path`), something owned by a person, an org unit (`id` and its ancestor ids as of a date) or a person (the ancestor ids of their location and team).
- **Org scope** (Phase 3): the actor also carries `orgScopeUnitIds` (units of the budgets they own or co-own, `role_grants.scope_org_unit_id`, and their own location and team) and `homeOrgUnitIds` (own location and team). For org resources `O` covers units whose ancestors include an org-scope unit, and `S` covers the actor's own units and their own person record.
- **Scopes**: `T` tenant-wide, `O` owned budget subtrees (the actor owns the budget or one of its ancestors), `S` self (resources the actor created or is party to).
- **Not found versus forbidden**: if the actor cannot see the resource the API answers 404 `NOT_FOUND` (other tenants' and other directors' ids are never confirmed); if it can see it but may not act, 403 `FORBIDDEN`.
- **Platform operator**: `super-admin` has no tenant grants; tenant financial data needs an audited, time-boxed `break_glass_grants` row (Phase 18 adds the grant flow).

## Role-action matrix

Generated from `ROLE_GRANTS` (regenerate this table when the rule table changes). Abbreviations: SA super-admin, OA org-admin, CEO, FA finance-admin, FC finance-controller, BO budget-owner, DH department-head, RM regional-manager, LM location-manager, EO event-organizer, EMP employee, AUD auditor, IA integration-admin, AN analyst.

| Action                   | SA  | OA  | CEO | FA  | FC  | BO  | DH  | RM  | LM  | EO  | EMP | AUD | IA  | AN  |
| ------------------------ | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `tenant.read`            |  –  |  T  |  T  |  T  |  T  |  T  |  T  |  T  |  T  |  T  |  T  |  T  |  T  |  T  |
| `tenant.settings.manage` |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `org.manage`             |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `org.read`               |  –  |  T  |  T  |  T  |  T  |  O  |  O  |  O  |  O  |  S  |  S  |  T  |  –  |  T  |
| `headcount.import`       |  –  |  T  |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `master_data.manage`     |  –  |  –  |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `users.manage`           |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `budget.read`            |  –  |  –  |  T  |  T  |  T  |  O  |  O  |  O  |  O  |  O  |  –  |  T  |  –  |  T  |
| `budget.create_root`     |  –  |  –  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `budget.create_child`    |  –  |  –  |  O  |  T  |  –  |  O  |  O  |  O  |  O  |  –  |  –  |  –  |  –  |  –  |
| `budget.allocate`        |  –  |  –  |  O  |  T  |  –  |  O  |  O  |  O  |  O  |  –  |  –  |  –  |  –  |  –  |
| `budget.control`         |  –  |  –  |  O  |  T  |  –  |  O  |  O  |  O  |  O  |  –  |  –  |  –  |  –  |  –  |
| `ledger.read`            |  –  |  –  |  T  |  T  |  T  |  O  |  O  |  O  |  O  |  O  |  –  |  T  |  –  |  T  |
| `ledger.manual_journal`  |  –  |  –  |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `ledger.reverse`         |  –  |  –  |  –  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `period.manage`          |  –  |  –  |  –  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `fx.manage`              |  –  |  –  |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `doa.manage`             |  –  |  –  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `doa.read`               |  –  |  –  |  T  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  T  |  –  |  –  |
| `rules.read`             |  –  |  –  |  T  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  T  |  –  |  –  |
| `rules.manage`           |  –  |  –  |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `exception.resolve`      |  –  |  –  |  –  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `request.create`         |  –  |  –  |  O  |  O  |  –  |  O  |  O  |  O  |  O  |  O  |  S  |  –  |  –  |  –  |
| `request.approve`        |  –  |  –  |  O  |  O  |  T  |  O  |  O  |  O  |  O  |  –  |  –  |  –  |  –  |  –  |
| `contribution.request`   |  –  |  –  |  O  |  O  |  –  |  O  |  O  |  O  |  O  |  O  |  –  |  –  |  –  |  –  |
| `contribution.decide`    |  –  |  –  |  O  |  O  |  –  |  O  |  O  |  O  |  O  |  –  |  –  |  –  |  –  |  –  |
| `event.manage`           |  –  |  –  |  O  |  O  |  –  |  O  |  O  |  O  |  O  |  S  |  –  |  –  |  –  |  –  |
| `event.read`             |  –  |  –  |  T  |  T  |  T  |  O  |  O  |  O  |  O  |  S  |  –  |  T  |  –  |  T  |
| `actuals.manage`         |  –  |  –  |  –  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `actuals.read`           |  –  |  –  |  –  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  T  |  –  |  –  |
| `gl.sign_off`            |  –  |  –  |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `report.read`            |  –  |  –  |  T  |  T  |  T  |  O  |  O  |  O  |  O  |  –  |  –  |  T  |  –  |  T  |
| `report.schedule`        |  –  |  –  |  T  |  T  |  T  |  O  |  O  |  O  |  O  |  –  |  –  |  T  |  –  |  T  |
| `audit.read`             |  –  |  –  |  T  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  T  |  –  |  –  |
| `integrity.run`          |  –  |  –  |  –  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `integrity.read`         |  –  |  –  |  –  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  T  |  –  |  –  |
| `integration.manage`     |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  T  |  –  |
| `integration.read`       |  –  |  –  |  T  |  T  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  T  |  T  |  –  |
| `notification.manage`    |  –  |  T  |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |
| `ai.confirm_finance`     |  –  |  –  |  –  |  T  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |  –  |

Phase 1 enforces `tenant.read`, `budget.*`, `ledger.*`, `audit.read` and `integrity.*` through the API and proves them with API scenarios (`scope/director-isolation.spec.ts`, `budgets/over-allocation.spec.ts`, `ledger/reversal.spec.ts`, `audit/hash-chain.spec.ts`, `ledger/rebuild-check.spec.ts`). Phase 3 enforces `org.read`, `org.manage`, `headcount.import`, `master_data.manage`, `period.manage`, `fx.manage` and `doa.read` on the org and finance endpoints (`org/scope-visibility.spec.ts`, `org/effective-dating.spec.ts`, `org/imports.spec.ts`, `finance/*.spec.ts`); org and finance reference data (cost centers, legal entities, calendars, rates, GL, reason codes, vendors) is readable with `tenant.read`. Phase 6 enforces `actuals.manage` (imports, matching, mapping rules, commitment hygiene, accruals, prepaids, tie-out preparation and explanations, event close), `actuals.read` (finance and auditors read actuals, tie-outs, accruals and reconciliations) and `gl.sign_off` (finance admins sign off a tie-out they did not prepare); over-budget request decisions use `request.approve` on the budget plus the DoA limit and approval hygiene (`actuals/*.spec.ts`). Phase 7 adds three actions. `rules.read` opens the rules and policies section (`/admin/rules`) to Finance, the CEO and auditors; `rules.manage` lets Finance Admins create, edit, publish, retire and reorder rules and publish policy sections and approval routes; `exception.resolve` lets Finance Admins and Finance Controllers settle post-spend exceptions, with a reclassification additionally needing `ledger.reverse`. The CEO gains `doa.manage` because approving a delegation-of-authority version needs a second person who is not the Finance Admin who submitted it (`rules/workflows-authority.spec.ts`). Phase 12 adds two read actions. `integration.read` opens the integrations area (092-101) to the Integration Admin, Finance, the CEO and auditors, while only `integration.manage` connects, configures, synchronises, retries, pushes, issues API keys and SCIM tokens and manages webhook endpoints (`integrations/*.spec.ts`). `event.read` exists so a public API key can read events without holding `event.manage`, which writes. A public API key authorizes as a **service identity**: `Actor.serviceScopes` lists the actions its scopes grant at tenant scope and replaces role grants entirely, so a key can only do what its scopes name and there is no scope for approving, applying controls or moving money. The other actions are reserved for their phases; a phase that needs a new action adds it to `ACTIONS` and `ROLE_GRANTS` (shared surface, integrator) and regenerates this table.

## Ownership is not authority

Owning a budget grants visibility of its subtree and the right to request, delegate (create children, allocate) and apply controls within it. Approving spend, transfers and contributions additionally requires the delegation-of-authority matrix (`doa_limits`: person or role × spend type × legal entity × limit in the limit currency at the locked plan rate), checked by `checkAuthority` (exactly at the limit passes, one minor unit above escalates). Approval hygiene (`checkApprovalHygiene`) forbids self-approval and approvers who are beneficiaries or attendees; delegations are capped by the delegator's own limit and dates (`delegatedLimit`). Enforcement lands in Phase 5; the matrix is seeded in Phase 3 for Hyland (role limits in USD plus spend-type, entity and person-specific rows) and readable through `GET /api/finance/doa` and the `doa/lookup` check.

## Director isolation

Director A never reads or mutates Director B's budget: both are owners of sibling subtrees, so neither path is a prefix of the other. The only sanctioned flow between them is an Inter-Director Budget Contribution Request (Phase 5), decided by the giving director within their DoA limit.
