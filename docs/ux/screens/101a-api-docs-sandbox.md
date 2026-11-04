# 101a Public API docs and sandbox

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Developer docs (`/developers`, reference `/developers/reference`, guides `/developers/guides/:slug`), signed-in users with API access; the sandbox is a separate deployment with fictional data.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a). Planned Stitch states, to be generated in a later session:

| State                             | Planned image                                                     |
| --------------------------------- | ----------------------------------------------------------------- |
| API reference with try-it panel   | `design/stitch/101a-api-docs-sandbox/default--desktop--light.png` |
| guide page (webhook verification) | `guide--desktop--light.png`                                       |
| try-it response                   | `try-it-response--desktop--light.png`                             |
| no sandbox key yet                | `no-key--desktop--light.png`                                      |

## Purpose

Give developers what they need to build on BudgetFlow without asking: a reference generated from the same contracts the app uses, short guides (authentication, idempotency, errors, pagination, webhooks), code samples, and a sandbox to try calls against fictional data, never against real budgets.

## Roles

Integration Admin (full access, creates sandbox keys); developers working with an Integration Admin (read the docs when granted `integration.read`); Finance Admin (read).

## Entry points

101 "API docs"; 092 Developer tile; links in webhook deliveries ("How to verify this signature").

## Content and actions

Left navigation: Overview, Authentication (API keys, scopes), Idempotency keys, Errors (problem details with error codes), Pagination and filtering, Money and currencies (integer minor units, ISO 4217, currency triplet), Webhooks (events, signature verification), Rate limits, Reference (generated, grouped by tag: budgets, ledger, events, requests, actuals, reports, audit), Changelog.

Reference page (sample `GET /api/budgets/{budgetId}`): summary, required scope (budgets.read), path and query parameters, response schema with field descriptions (amounts as minor units with currency), error codes, examples in curl, JavaScript and Python; "Try it" panel: environment fixed to Sandbox, sandbox key select, parameters prefilled with fictional ids, Send; response with status, headers and body.

Guides include copyable snippets, for example verifying `BudgetFlow-Signature` (timestamp and HMAC-SHA256), and sending an `Idempotency-Key` header on every write.

Sandbox banner on every try-it panel: "Sandbox: fictional data, reset every night at 00:00 UTC. Sandbox keys start with `bf_test_` and never work in production."

## Data and permissions

The reference renders the generated OpenAPI 3.1 document from `libs/contracts` (`contracts:openapi`), filtered to endpoints available to API keys, so docs never drift from the API. Try-it calls go only to the sandbox deployment (fictional seed, nightly reset); production keys are rejected there and sandbox keys are rejected in production. Viewing needs `integration.read`; creating sandbox keys needs `integration.manage` in the sandbox.

## States

| State             | Behaviour                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Reference         | as above                                                                                        |
| Try-it response   | status tag (200, 4xx, 5xx) with the body; errors show the problem details and the guide link    |
| No sandbox key    | try-it disabled with "Create a sandbox key" (Integration Admin) or "Ask your Integration Admin" |
| Sandbox resetting | info banner during the nightly reset window; Send disabled                                      |
| Search            | search across guides and endpoints; "No results" with suggestions                               |
| Loading / error   | `sat-ghost`; error banner with Retry                                                            |

## Budget safety and audit

Try-it never reaches production data. The docs state the money rules (integer minor units, currency codes, idempotency keys on writes, no approval scopes). Sandbox key creation is audited in the sandbox; doc views are product analytics only.

## Responsive and accessibility

Desktop and tablet with the try-it panel beside the reference; mobile stacks the panel below. Code blocks have Copy buttons and language labels; headings follow the navigation order.

## Satori components

`sat-header-bar`, `sat-splitter` (reference and try-it), `sat-navigation-tabs` (code sample languages), `sat-status-tag` (HTTP status), `sat-banner` (sandbox), `sat-ghost`; Angular Material tree or list (navigation), form fields, select, snackbar.

## Related screens and navigation

101 API keys and webhooks, 092 hub, 100 errors, 102d embeddable widgets (P16), 092c connector for AI assistants (P16).

## Decisions taken

- The reference is generated from the same OpenAPI contracts the app uses, filtered to what API keys may call. Recommended so documentation cannot drift.
- Try-it only runs against a separate sandbox with fictional data reset nightly; sandbox and production keys are mutually rejected.
- The docs sit behind BudgetFlow sign-in for now (single company), not on a public website.
