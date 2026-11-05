# 092a BI connector (Power BI, Tableau)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 16 batch. Build phase P16. Admin > Integrations > BI connector (`/integrations/bi`), in the shared connector frame of 092; personal connection page for analysts (`/me/bi-connections`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the connector frame of 092. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                 |
| ------------------------------- | ------------------------------------------------------------- |
| connector overview and datasets | `design/stitch/092a-bi-connector/default--desktop--light.png` |
| connect from Power BI (steps)   | `connect--desktop--light.png`                                 |
| my connections                  | `my-connections--desktop--light.png`                          |
| dataset field reference         | `dataset--desktop--light.png`                                 |

## Purpose

Let finance build its own models in Power BI or Tableau on live BudgetFlow figures without spreadsheets in between: curated read-only datasets with the same definitions as the app, each connection acting with the scope of the person who made it, so a BI report never shows more than that person could see in BudgetFlow.

## Roles

Integration Admin (enables the connector, chooses datasets, sees and revokes all connections); Read-only Analyst, Finance Admin, Finance Controller, CEO and owners (create their own connections within their scope); Auditor (read connections list).

## Entry points

092 hub tile "BI connector"; 079 reports "Use in Power BI or Tableau"; user menu "My BI connections" (when enabled); 101a API docs "BI feed".

## Content and actions

Overview (connector frame, Overview tab): status (Enabled), feed address (OData), datasets enabled, connections active 9, refreshes in the last 24 hours 64, "Download starter files" (Power BI template, Tableau data source).

Datasets (Mappings tab, each with on or off and a field reference):

- Budgets: budget, parent, owner, legal entity, cost center, category, status, authorized, allocated out, pending, committed, actual, "Available under this budget's rules", fiscal year; amounts in USD minor units with currency.
- Company roll-up: company-wide Available with child allocations counted once (named "Available, company-wide" to keep the two definitions apart).
- Ledger summary: by budget, period, bucket and dimensions (legal entity, cost center, GL account, event code); drill to single lines opens BudgetFlow.
- Events, requests and approvals (status, amounts, cycle times), actuals (match status, currency triplet), participation (aggregated, groups of 5 or more).

Connect steps: "In Power BI choose Get data > OData feed, paste the address, choose Organizational account and sign in with Hyland single sign-on." Same for Tableau (OData connector). Connections appear under My connections.

My connections: tool (Power BI, Tableau), created, last refresh, datasets used, expires (90 days, renew by signing in again), Revoke.

Sync tab: refresh limit per connection (8 per day), maximum rows per request (100,000 with paging).

## Data and permissions

New P16 read-only OData endpoint in `libs/api/integrations` over reporting read models (P10 `reports.ts`); every request carries the connecting person's OAuth token (BudgetFlow as the authorisation server through Keycloak), so `PolicyService` scope and RLS apply exactly as in the app. No write operations exist. People are referenced by id and display name only (no emails); participation data is aggregated with suppression. `integration.manage` to enable and revoke; `report.read` to connect. Each refresh is logged with the connection and person.

## States

| State           | Behaviour                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------- |
| Enabled         | as above                                                                                     |
| Disabled        | tile "Not connected"; user menu entry hidden                                                 |
| Expiring        | warning tag 7 days before a connection expires; owner notified                               |
| Refresh limited | the BI tool receives "Refresh limit reached (8 per day)"; the connection shows the limit hit |
| Revoked         | neutral tag; the next refresh fails with "Access revoked"                                    |
| No scope        | a person without report access sees "BI connections need report access" instead of Connect   |
| Loading / error | `sat-ghost`; error banner with Retry                                                         |

## Budget safety and audit

Datasets carry both Available definitions under different names and keep pending, committed and actual separate; FX effects are separate fields. The feed is read-only. Enabling, dataset changes, connection creation and revocation are audited; refreshes are logged.

## Responsive and accessibility

Desktop and tablet; mobile read-only. Steps are numbered text with copy buttons that announce "Copied".

## Satori components

`sat-header-bar`, `sat-navigation-tabs` (connector frame), `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material slide toggles (datasets), dialog (revoke), snackbar.

## Related screens and navigation

092 integrations hub, 079 reports, 101 API keys, 101a API docs, 016a board pack, 15b participation, 088 audit log.

## Decisions taken

- The BI feed is read-only OData and each connection acts as the person who created it, with their scope. Recommended so a BI report can never show more than its author may see in BudgetFlow.
- Datasets use the app's definitions and name the two Available figures differently.
- Connections expire after 90 days and can be revoked by the person or the Integration Admin.
- Line-level ledger detail stays in BudgetFlow (drill-through link); the feed offers a dimensional summary.
