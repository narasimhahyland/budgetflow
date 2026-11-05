# 092c Connector for AI assistants (Model Context Protocol)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 16 batch. Build phase P16. Admin > Integrations > AI assistants (`/integrations/mcp`), in the connector frame of 092; personal page "Connected AI assistants" (`/me/ai-assistants`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the connector frame of 092 and the AI rules of 11a and 113a. Planned Stitch states, to be generated in a later session:

| State                              | Planned image                                                  |
| ---------------------------------- | -------------------------------------------------------------- |
| connector overview and tools       | `design/stitch/092c-mcp-connector/default--desktop--light.png` |
| consent when an assistant connects | `consent--desktop--light.png`                                  |
| my connected assistants            | `my-assistants--desktop--light.png`                            |
| tool call log                      | `log--desktop--light.png`                                      |

## Purpose

Let people ask about their budgets from the AI assistant they already use (any assistant that supports the Model Context Protocol), through a BudgetFlow server that offers read-only tools under the person's own scope, so the same answers are available outside the app without widening access or letting an assistant act on money.

## Roles

Integration Admin (enables the connector, chooses tools, allows assistant apps, revokes connections); Organization Admin (AI switch in 113a also applies); every signed-in person connects their own assistant within their scope; Auditor (reads the log).

## Entry points

092 hub tile "AI assistants"; 113a AI settings "Connector for AI assistants"; user menu "Connected AI assistants"; an assistant's "Add connector" flow with the BudgetFlow server address.

## Content and actions

Overview (connector frame): status (Enabled), server address, connected people 14, tool calls in 7 days 1,320, allowed assistant apps (by client registration; "Any assistant that supports MCP sign-in" or a named list).

Tools (each with on or off and a description shown to assistants):

- list_my_budgets: budgets the person owns or can see, with "Available under this budget's rules".
- get_budget_balance: one budget's authorized, pending, committed, actual and available.
- list_my_requests and get_request_status.
- list_waiting_approvals: approvals waiting for the person (titles, amounts, due), each with a BudgetFlow link.
- explain_policy: the 69a explanation for a request or a policy question.
- search_events: events the person can see, with dates and RSVP status.
- create_draft_request (off by default): creates a Draft labelled "Drafted from an AI assistant"; the person must open and submit it in BudgetFlow.
- Note: "There are no tools to submit, approve, reject, apply controls or move money."

Consent (when the assistant connects): "Your AI assistant wants to read budgets, requests, approvals and events you can see in BudgetFlow. It can't approve or change anything." Allow or Cancel; connection valid 30 days.

My connected assistants: assistant name, connected, last used, tools used, Revoke.

Log tab: time, person, assistant, tool, records returned (count), outcome; feeds the AI query log (113a) with channel "mcp".

## Data and permissions

New P16 MCP server (`libs/api/integrations` or a small app behind the API) using the protocol's OAuth sign-in with BudgetFlow (Keycloak) as the authorisation server; each call carries the person's token and runs through the same read services and `PolicyService` checks as 11a, with RLS underneath. Responses are minimal (names, amounts, statuses, links), at most 50 records per call, and never include other people's contact details. `integration.manage` to enable and configure; the AI feature switch in 113a (`ai.mcp`) must also be on. Every call writes an `ai_query_log` row.

## States

| State             | Behaviour                                                                         |
| ----------------- | --------------------------------------------------------------------------------- |
| Enabled           | as above                                                                          |
| Disabled          | assistants receive "BudgetFlow connector is turned off for Hyland"                |
| Consent           | as above                                                                          |
| App not allowed   | sign-in ends with "This assistant isn't allowed by Hyland"                        |
| Expired           | assistant asked to sign in again after 30 days                                    |
| Out of scope call | the tool returns "Not found in budgets you can see" (same neutral wording as 11a) |
| Revoked           | next call fails with "Access revoked"                                             |
| Loading / error   | `sat-ghost`; error banner with Retry                                              |

## Budget safety and audit

Tools are read-only apart from an optional draft request that a person must submit in BudgetFlow; nothing can approve, submit, apply controls or move money. Balances use "Available under this budget's rules". Enabling, tool changes, connections and revocations are audited; every call is in the AI query log.

## Responsive and accessibility

Desktop and tablet; mobile read-only. Tool descriptions are plain sentences; switches have visible On and Off text.

## Satori components

`sat-header-bar`, `sat-navigation-tabs` (connector frame), `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material slide toggles (tools), dialog (revoke), snackbar.

## Related screens and navigation

092 integrations hub, 113a AI settings and query log, 011a assistant panel, 061f chat questions, 069a policy assistant, 101 API keys, 088 audit log.

## Decisions taken

- The connector offers read-only tools under each person's own sign-in and scope; the only write tool, a draft request, is off by default and always needs submission in BudgetFlow. Recommended so outside assistants never gain access the person does not have, and never act on money.
- Out-of-scope lookups get the same neutral "not found" as the in-app assistant.
- Results are capped at 50 records per call, so the connector cannot be used for bulk export.
- Connections last 30 days and every call is logged in the AI query log.
