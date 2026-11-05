# 101 API key and webhook management

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Admin > Integrations > API keys and webhooks (`/integrations/api-keys`, `/integrations/webhooks`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the one-time secret pattern of 098. Planned Stitch states, to be generated in a later session:

| State                         | Planned image                                                     |
| ----------------------------- | ----------------------------------------------------------------- |
| API keys list                 | `design/stitch/101-api-keys-webhooks/default--desktop--light.png` |
| create key, secret shown once | `key-created--desktop--light.png`                                 |
| webhook endpoints             | `webhooks--desktop--light.png`                                    |
| webhook delivery log          | `deliveries--desktop--light.png`                                  |
| failing endpoint disabled     | `endpoint-disabled--desktop--light.png`                           |

## Purpose

Let the company automate around BudgetFlow safely: issue scoped, expiring API keys for internal systems, subscribe endpoints to BudgetFlow events with signed (HMAC) webhooks, and see every delivery, so automations are traceable and a leaked key or a broken endpoint is contained quickly.

## Roles

Integration Admin (create, rotate, revoke keys; manage webhooks); Finance Admin and Auditor (read).

## Entry points

092 header "API keys and webhooks"; 101a docs "Create a key"; notifications "Webhook endpoint disabled after repeated failures".

## Content and actions

Tab API keys:

- Table: name, key prefix (`bf_live_3f9a...`), scopes (chips), service owner (person), created, last used, expires, status (Active, Expiring soon, Revoked). Sample: "Intranet budget widget", scopes budgets.read and events.read, owner Nadia Farouk, last used 10:12, expires 2 Feb 2027.
- Create key dialog: name; service owner (a person accountable for it); scopes (checkboxes): budgets.read, ledger.read, reports.read, events.read, events.write (draft events only), actuals.write (import batches into the 080a review), webhooks.manage; note "API keys can never approve or reject requests, change controls (freeze, reduce, set to zero) or move money."; expiry (90 days default, at most 365); allowed IP ranges (optional).
- Created: the full key shown once with Copy and the checkbox "I have stored this key"; afterwards only the prefix is visible.
- Row actions: Rotate (new key; the old one keeps working for 7 days), Revoke (immediate; confirmation), View usage (calls per day, last 50 requests with path and status).

Tab Webhooks:

- Endpoints table: URL (https only), description, events subscribed (chips), status (Active, Failing, Disabled), last delivery (200 in 120 ms), success rate (7 days).
- Endpoint editor: URL, description, events (budget.frozen, budget.reduced, budget.set_to_zero, request.submitted, request.approved, request.rejected, commitment.created, commitment.released, actual.matched, event.approved, event.closed, period.closed), "Send test ping", signing secret (shown once; Rotate keeps both secrets valid for 24 hours and signs with both).
- Delivery log: event id, type, attempt, status code, duration, next retry, Redeliver; payload view.
- Verification panel: "Each delivery has a `BudgetFlow-Signature` header with a timestamp and an HMAC-SHA256 of the timestamp and body. Reject deliveries older than 5 minutes." Link to 101a.

## Data and permissions

`api_keys` (hashed key, prefix, scopes, owner, expiry, allowed ranges, last used) and `webhooks` (URL, events, hashed secrets with validity, status) per the phase handoff, in `integrations.ts`. A key acts as a service identity whose scopes map to `PolicyService` actions at tenant scope; scopes for approvals and controls do not exist. Webhook payloads contain identifiers and the fields of the event, never secrets; deliveries retry with backoff for 24 hours, then the endpoint is disabled and its owner notified. `integration.manage` to act; `integration.read` to view. Key creation, rotation and revocation, and webhook changes are audited.

## States

| State           | Behaviour                                                                                |
| --------------- | ---------------------------------------------------------------------------------------- |
| Keys list       | as above                                                                                 |
| Key created     | warning tone "Copy this key now. You won't see it again."; Done after the checkbox       |
| Expiring soon   | warning tag 14 days before expiry; owner notified                                        |
| Revoke dialog   | "Requests with this key will fail immediately." typed key name to confirm                |
| Webhooks list   | as above                                                                                 |
| Test ping       | result inline "200 OK in 140 ms" or the error                                            |
| Failing         | warning tag with the last error; retries continue                                        |
| Disabled        | error banner "Disabled on 4 Nov after 24 hours of failures" with Re-enable and Send test |
| Validation      | "Use an https address", "Choose at least one event", "Choose at least one scope"         |
| Empty           | "No API keys yet" and "No webhook endpoints yet" with Create buttons                     |
| Loading / error | `sat-ghost`; error banner with Retry                                                     |

## Budget safety and audit

API keys cannot decide approvals or apply controls, so automation never bypasses people with delegation-of-authority limits; `actuals.write` only feeds the review queue. Secrets are shown once and stored hashed. All key and webhook changes are audited; API calls made with a key are logged with the key prefix.

## Responsive and accessibility

Desktop and tablet; mobile read-only. One-time secrets use a monospace field with Copy that announces "Copied"; scope checkboxes have descriptions.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `mat-table` with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag`, `satInlineChip` (scopes, events), `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material dialog (create key, revoke, endpoint editor), checkboxes, form fields, side sheet (delivery payload), snackbar.

## Related screens and navigation

101a public API docs and sandbox, 092 hub, 100 errors (inbound webhooks), 098 SCIM tokens, 088 audit log, 102d embeddable widgets (P16).

## Decisions taken

- API keys can never approve, reject, apply controls or move money; there is no scope for it. Recommended because decisions must stay with a person who holds the authority.
- Keys expire (90 days by default, at most 365), have an accountable service owner and are shown once; rotation keeps the old key valid for 7 days.
- Webhooks are https only, HMAC-signed with a timestamp, retried for 24 hours, then disabled with a notification.
- Rotating a webhook secret signs with both secrets for 24 hours so receivers can switch without downtime.
