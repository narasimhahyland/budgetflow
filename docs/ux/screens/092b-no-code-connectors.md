# 092b No-code connectors (Zapier, Make, Power Automate, Workato)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 16 batch. Build phase P16. Admin > Integrations > No-code connectors (`/integrations/no-code`), in the connector frame of 092; personal page "My automations" (`/me/automations`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the connector frame of 092. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                       |
| ------------------------------- | ------------------------------------------------------------------- |
| platforms, triggers and actions | `design/stitch/092b-no-code-connectors/default--desktop--light.png` |
| consent screen when connecting  | `consent--desktop--light.png`                                       |
| active automations              | `automations--desktop--light.png`                                   |
| platform not allowed            | `not-allowed--desktop--light.png`                                   |

## Purpose

Let teams connect BudgetFlow to the long tail of tools they use (spreadsheets, ticketing, chat, HR forms) through common no-code platforms, with triggers on BudgetFlow events and a small set of safe actions, while decisions about money always stay with a person inside BudgetFlow.

## Roles

Integration Admin (allows platforms, sees and revokes every automation); any signed-in person with a role that can use an action (connects their own account, within their scope); Auditor (read).

## Entry points

092 hub tile "No-code connectors"; 101 API keys "Prefer no-code?"; user menu "My automations" (when a platform is allowed); a platform's BudgetFlow app listing (sign-in through BudgetFlow).

## Content and actions

Platforms (Integration Admin, each with Allowed or Not allowed): Zapier, Make, Microsoft Power Automate, Workato. All start Not allowed.

Triggers (events the automation can start from; payloads carry only what the connected person may see): budget threshold reached, budget frozen, reduced or set to zero, request submitted, request decided, co-funding request decided, event approved, event closed, actual matched, period closed.

Actions (what an automation may do in BudgetFlow, as the connected person):

- Look up a budget's balance ("Available under this budget's rules").
- Create a draft request (stays Draft until the person opens and submits it in BudgetFlow).
- Create a draft event.
- Add a comment to a request, budget or event (60a).
- Note on the page: "Automations can never submit, approve, reject, apply controls or move money."

Consent screen (when connecting from a platform): "Zapier wants to: read budgets you can see; create drafts as you; add comments as you. It can't approve, submit or move money." Allow or Cancel.

Automations (admin view, and each person's own in My automations): platform, connected person, triggers and actions used, last run, runs in 7 days, errors, Revoke.

## Data and permissions

New P16 OAuth app registrations per platform in `libs/api/integrations` (BudgetFlow as the authorisation server through Keycloak); tokens are scoped to `budgets.read`, `drafts.write` and `comments.write` and act as the connecting person under `PolicyService`. Triggers are delivered through the P12 webhook machinery (HMAC-signed, retried) to the platform's subscription for that person. Draft creation uses the existing request and event endpoints with a forced Draft status and an idempotency key. `integration.manage` to allow platforms and revoke; people manage their own connections. Calls are logged per connection.

## States

| State           | Behaviour                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------- |
| Default         | platforms list, triggers and actions reference                                               |
| Not allowed     | the platform's sign-in ends with "Hyland hasn't allowed Zapier. Ask your Integration Admin." |
| Consent         | as above                                                                                     |
| Active          | automations list                                                                             |
| Errors          | warning tag with the last error ("Draft request rejected: budget is frozen")                 |
| Revoked         | the platform's next call fails with "Access revoked"; the person is notified                 |
| Person left     | automations of deactivated people stop and are listed for clean-up                           |
| Loading / error | `sat-ghost`; error banner with Retry                                                         |

## Budget safety and audit

Automations create drafts and comments only; every submission, approval, control and transfer needs a person in BudgetFlow with the usual checks and delegation-of-authority limits. Drafts created by an automation are labelled "Drafted by Zapier for Kavya Shah". Allowing platforms, connections, revocations and every draft created are audited.

## Responsive and accessibility

Desktop and tablet; mobile read-only. The consent screen lists permissions as plain sentences.

## Satori components

`sat-header-bar`, `sat-navigation-tabs` (connector frame), `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `satInlineChip` (triggers, actions), `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material slide toggles (platforms), dialog (revoke), snackbar.

## Related screens and navigation

092 integrations hub, 101 API keys and webhooks, 101a API docs, 060a comments, 056 create budget request, 045 create event, 088 audit log.

## Decisions taken

- Automations can look up balances, create drafts and add comments, nothing more. Recommended so no workflow tool can submit, approve or move money without a person.
- Each automation acts as the person who connected it, with their scope, rather than as a company-wide service key.
- Every platform starts Not allowed until the Integration Admin allows it.
- Automations stop when the connected person leaves.
