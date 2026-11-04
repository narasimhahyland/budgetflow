# BudgetFlow review guidance

BudgetFlow Enterprise is a public repository for a multi-tenant corporate budget delegation and control platform: an Nx monorepo with an Angular 22 + Satori UI web app, a NestJS API, a pg-boss worker, PostgreSQL 16 with row-level security, Keycloak OIDC and an accounting-grade ledger. Flag real bugs and rule violations, not style that the linters already enforce.

## Always flag (high severity)

- Secrets or tokens in any file, auth lines in `.npmrc`, `.env` files, HAR files, Playwright traces or saved auth state committed. Internal company URLs, ticket keys or employee names (the repo is public).
- Money as floating point (`parseFloat`, `toFixed` arithmetic, `* 100` conversions, numbers without a currency). Money is integer minor units plus an ISO 4217 code, carried as a currency triplet (transaction, budget, reporting).
- Ledger entries updated or deleted instead of reversed, journals that do not balance, postings to a Closed or Locked period, FX effects consuming budget, or cached balances changed outside a posting.
- Any path that lets child allocations plus commitments exceed the parent's available amount at the locked plan rate, missing ordered row locks or idempotency keys on money mutations, or a frozen, set-to-zero, exhausted, expired or closed budget accepting new requests, allocations or contributions.
- Controls that delete or hide existing commitments, or reduce / set-to-zero without a destination, reason code, typed reason, impact preview and the floor at committed + actual + children.
- Approvals that ignore the delegation-of-authority limit, allow self-approval, or treat budget ownership as approval authority.
- Inter-Director Budget Contribution Requests that bypass the giving director's decision, or approved amounts without ledger and audit entries.
- Mutations without exactly one hash-chained audit entry, audit records being updated or deleted, or rejected commands writing audit entries.
- Authorization decided outside `PolicyService.can`, queries that bypass tenant RLS, or one director able to read or change another director's budget.
- AI features that post to the ledger, approve anything, or retrieve data outside the asker's `PolicyService` scope.
- CI workflows that print or write `SATORI_PACKAGES_TOKEN`, or that fail (instead of skipping) when the secret is absent.

## Flag (medium severity)

- UI built with anything other than Satori UI or Angular Material: Tailwind, PrimeNG, Bootstrap, Material Symbols, other icon sets. Raw colors (hex, rgb, named) instead of `--mat-sys-*` / `--sat-sys-*` tokens; imports of `satori-tokens/css/base|light|dark`; overrides of `.mat-*`, `.mdc-*`, `.sat-*` internals.
- App translation files, translation keys or the `translate` pipe in app code (copy is plain English; `@ngx-translate/core` exists only as Satori's peer dependency). Money formatted by hand instead of the shared money component and Angular formatters.
- Missing screen states (loading, empty, error, forbidden, blocked) or budget-safety states rendered alike (soft warning vs hard block, frozen vs zero, encumbered vs actual).
- Status shown by color alone, or blocked actions without a visible reason.
- Behavior changes without a functional check (API scenario in `apps/api-e2e` or journey in `apps/web-e2e`); invariants changed without updating `docs/testing/invariant-scenarios.md`; skipped, focused or weakened scenarios; selectors on Satori or Material internal classes; fixed sleeps.
- Visual baseline PNGs (`**/__screenshots__/**`) changed without a "Visual baselines updated:" reason in the PR, or baselines generated outside the pinned Playwright image.
- Drizzle schema changes without a generated migration and RLS policy tests; `drizzle-kit push`.
- API shapes changed without the zod contract and OpenAPI regenerated in the same change.
- Feature libs importing each other, or web code importing API code.

## Domain detail

The full rules live in these files; apply them when the diff touches the matching area:

- [Domain invariants and authority](rules/domain-invariants.mdc)
- [Ledger and accounting](rules/ledger-accounting.mdc)
- [Audit trail](rules/audit-trail.mdc)
- [Database, RLS and migrations](rules/db-drizzle-rls.mdc)
- [Contracts](rules/contracts.mdc)
- [Satori styling](rules/frontend-satori-styling.mdc)
- [Angular conventions, screen states and budget-safety visuals](rules/frontend-angular.mdc)
- [Functional verification](rules/testing-functional.mdc)
- [Visual verification](rules/testing-visual.mdc)
- [Security](rules/security.mdc)
- [AI features](rules/ai-features.mdc)

Use the exact product term "Inter-Director Budget Contribution Request"; flag code or copy that frames it as free-form budget sharing.
