# 0006 One company (Hyland), USD reporting, company-wide Available, Export only (Nov 2026)

## Context

The November 2026 product and finance review left several questions open: which company or companies BudgetFlow serves, which currency budgets and reports use, how the executive dashboard defines Available when budgets use different control bases, and how dashboards are shared. The product owner decided them before Phase 2 so the shell, seed and later dashboards follow one model. ADR [0003](0003-tenant-isolation-rls.md) (tenant isolation) and [0004](0004-light-theme-only.md) (light theme) stay in force.

## Decision

- **One company.** BudgetFlow runs for Hyland. The seed has one product tenant named Hyland; the shell shows the company name only, with no tenant switcher and no organization switcher. `tenant_id` and row-level security stay as built so a second company can be added later. Globex and Initech Sandbox remain scenario-only tenants (isolation and destructive checks), never shown as product data.
- **Seed data.** Apart from the company name and real office cities, seed data is fictional: no real employee names, internal figures or internal tools.
- **Currency.** The reporting currency is fixed per tenant and is USD for Hyland. Budgets are held in USD; transactions in local currency (for example INR, EUR) convert to the USD budget currency at the plan rate locked for the fiscal year, with the currency triplet stored and the FX effect reported separately (FX never consumes budget).
- **Available on the executive dashboard.** Company-wide Available = Authorized − Pre-encumbered − Encumbered − Actual, with child allocations counted once in roll-ups. Each budget's control basis still governs enforcement; drilling down to a budget shows "Available under this budget's rules" with a tooltip explaining any difference from the company-wide figure.
- **Sharing.** Dashboards and reports offer Export only (CSV, XLSX, PDF); there is no Share action anywhere in the product.
- **Theme.** Light theme only (unchanged from ADR 0004).

## Consequences

- Phase 2: the shell header names the company from `GET /api/me` (`tenantName`), shows the fixed reporting currency, and offers no switchers; `X-Tenant-Id` stays supported by the API for scenarios and a future second company.
- Phases 4 and 6: budget creation defaults to USD; local-currency actuals convert at the locked plan rate.
- Phase 10: the executive dashboard implements the company-wide Available above and the per-budget drill-down wording; report and dashboard toolbars have Export and no Share. Scenarios must prove roll-ups count child allocations once.
- Adding a second company later is a seed and onboarding change plus a tenant switcher design, not a schema change.
