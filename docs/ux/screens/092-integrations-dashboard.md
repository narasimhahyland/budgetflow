# 092 Integrations dashboard (connector hub)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Admin > Integrations (`/integrations`); each connector opens `/integrations/:connectorId`. This spec also defines the shared connector detail frame used by 093-098 and 094a.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a). Planned Stitch states, to be generated in a later session:

| State                                 | Planned image                                                          |
| ------------------------------------- | ---------------------------------------------------------------------- |
| connector hub                         | `design/stitch/092-integrations-dashboard/default--desktop--light.png` |
| nothing connected yet                 | `empty--desktop--light.png`                                            |
| connector detail frame (overview tab) | `connector-frame--desktop--light.png`                                  |
| connect wizard (credentials step)     | `connect-wizard--desktop--light.png`                                   |

## Purpose

One place to see every external system BudgetFlow exchanges data with (ERP, planning, cards, travel and expense, procurement, HR, calendar, identity, chat), whether each connection is healthy, when it last synced, and what needs attention, with the same detail layout for every connector so an Integration Admin learns it once.

## Roles

Integration Admin (connect, configure, disconnect); Finance Admin and Auditor (read); Finance Controller reads sync health through 012.

## Entry points

Sidebar Admin > Integrations; 012 feeds card; 099 and 100 "Back to integrations"; error notifications ("Card sync failed 3 times").

## Content and actions

Header bar: title, "Sync status" (099), "Errors and retries" (100, with count badge), "API keys and webhooks" (101).

Health strip: Connected 6, Needs attention 1, Not connected 8 (chat apps counted in 061e); failed messages waiting for retry 3; dead letter 1.

Tiles grouped by category (name, logo placeholder, status tag, mode tag, last sync, records in the last 24 hours, one line of attention). Sample statuses are fictional and run against the local mock providers:

- ERP and finance (094): ERPNext Connected, Mock, last sync 09:30; Odoo, Workday Financials, NetSuite Not connected.
- Planning (094a): Adaptive Planning Needs attention ("Credentials expired 3 Nov").
- Corporate cards (096): Ramp Connected, Mock; Brex Not connected.
- Travel, expense and procurement (095): Concur Connected, Mock; Navan, Coupa Not connected.
- HR (093): HR file import (SFTP) Connected; Workday HCM Not connected.
- Calendar (097): Microsoft Outlook Connected, Mock; Google Calendar Not connected.
- Identity (098): SCIM provisioning Connected.
- Chat (061e): Slack, Microsoft Teams (status from 061e).
- Exports (094b) and Developer (101, 101a) as link tiles.

Shared connector detail frame (all connectors):

- Header: connector name, category, status tag, mode tag (Mock, Sandbox, Live), actions Sync now, Pause, Disconnect.
- Tabs: Overview (last and next sync, records in and out, errors in 24 hours, objects synced with direction arrows), Connection (base URL, account or tenant id, client id; secrets are write-only fields with "Replace" and are stored by reference in the server's secret store; Test connection), Mappings (legal entities or company codes, cost centers, GL accounts, categories, event codes, as applicable), Sync (objects, direction, schedule, mode: full or incremental, dedupe key), Push (outbound items such as event codes, card limits, exports, when the connector supports them), Logs (sync runs for this connector; links to 099 and 100).
- Connect wizard: choose connector, mode (Mock for local and test runs, Sandbox, Live), credentials, test, mappings, schedule, review, Connect.

## Data and permissions

New P12 `integrations.ts` contract and `libs/api/integrations` over `integration_connections` (provider, category, mode, status, settings, secret references), `sync_runs` and the outbox; mock provider services run in Compose (`infra/`). `integration.manage` (Integration Admin) to connect and change; `tenant.read` plus a new `integration.read` (integrator adds; FA, AUD) to view. Secrets are accepted once, stored in the server's secret store and never returned by the API; the UI shows only "Set on 2 Nov by Nadia Farouk". Disconnecting stops schedules and pushes; data already imported stays.

## States

| State             | Behaviour                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| Default           | as above                                                                                         |
| Empty             | `sat-empty-state` "No integrations yet" with suggested first connectors (ERP and HR file import) |
| Needs attention   | tile in the error tone with the reason and "Fix" (opens the Connection tab)                      |
| Paused            | neutral tag "Paused by Nadia Farouk, 4 Nov"; no schedules run                                    |
| Connect wizard    | as above; Test connection must pass before Connect                                               |
| Test failed       | inline error with the provider's message ("401 Unauthorized: check the client secret")           |
| Disconnect dialog | effect list (schedules stop, pushes stop, data kept), typed confirmation                         |
| Read-only         | Finance Admin, Auditor: no actions                                                               |
| Loading / error   | `sat-ghost` tiles; error banner with Retry                                                       |

## Budget safety and audit

Integrations move money only by feeding the same imports and commands as the app (actuals import review, commitments, plan import); no connector posts to the ledger directly. Connect, disconnect, pause, credential replacement, mapping and schedule changes are audited (never with secret values).

## Responsive and accessibility

Desktop and tablet; mobile shows the health strip and tiles read-only. Tiles are links with the connector name and status in the accessible name; status tags use icon and text.

## Satori components

`sat-header-bar`, `sat-interactive-card` (tiles), `sat-status-tag` (status and mode), `sat-navigation-tabs` (detail frame), `sat-banner`, `satImportantButton` (Connect), `sat-empty-state`, `sat-ghost`; Angular Material stepper (connect wizard), form fields (write-only secret fields), dialog (disconnect with typed confirmation), menu, snackbar.

## Related screens and navigation

093-098 connector pages, 094a Adaptive Planning, 094b exports, 099 sync status, 99a duplicates, 99b event-code and card-limit push, 100 errors and retry, 101 API keys and webhooks, 101a API docs, 061e chat apps, 012 finance controller dashboard.

## Decisions taken

- Every connector uses one detail frame (Overview, Connection, Mappings, Sync, Push, Logs) and one connect wizard. Recommended so ten adapters do not become ten different screens to learn.
- Each connection has a visible mode (Mock, Sandbox, Live); local and test runs use the mock providers in Compose.
- Secrets are write-only: entered once, stored by reference, never displayed or exported.
- Connectors never post to the ledger directly; they feed the same review and command paths as people.
