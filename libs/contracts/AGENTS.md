# libs/contracts — the API contract

Single source of truth for API shapes: zod schemas, inferred types, the generated OpenAPI document, and the typed client the web uses.

- Owned by the integrator during parallel waves; feature agents request changes in their report instead of editing.
- Additive changes within a phase; removing or renaming a field needs a version bump and user approval.
- Money is `{ amountMinor, currency }`; ledger amounts are the currency triplet (transaction, budget, reporting) with the rate reference used.
- Schemas are strict and carry `.describe()` text; API scenarios validate every response against them.
- Regenerate OpenAPI and the client in the same change (`npx nx run contracts:openapi-check` fails on drift).

Rules: `.cursor/rules/contracts.mdc`. Use `/api-endpoint`.
