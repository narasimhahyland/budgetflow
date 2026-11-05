# 094 ERP integration

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Admin > Integrations > ERP (`/integrations/erpnext`, `/integrations/odoo`, `/integrations/workday-financials`, `/integrations/netsuite`), in the connector frame of 092.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the connector frame of 092. Planned Stitch states, to be generated in a later session:

| State                                      | Planned image                                                   |
| ------------------------------------------ | --------------------------------------------------------------- |
| ERPNext overview (mock)                    | `design/stitch/094-erp-integration/default--desktop--light.png` |
| mappings (entities, accounts, event codes) | `mappings--desktop--light.png`                                  |
| Workday Financials budget check setting    | `budget-check--desktop--light.png`                              |
| webhook signature failure                  | `webhook-failed--desktop--light.png`                            |

## Purpose

Connect BudgetFlow to the general ledger system: bring in GL actuals, GL balances for tie-out, cost centers, accounts and vendors; send out event codes, recharge, chargeback and accrual journals; and, where the ERP enforces budgets (Workday Financials), check them before approving commitments, so BudgetFlow and the ledger stay in agreement.

## Roles

Integration Admin (connect, map, schedule); Finance Admin (approves mappings that change accounting: entities, GL accounts; reads); Finance Controller (reads; uses tie-out data).

## Entry points

092 ERP tiles; 080a actuals import "From ERP"; 080c tie-out "GL balances source"; 106c vendor master "Synced from ERP"; 094b exports "Send to ERP".

## Content and actions

Connector picker (first connection): ERPNext (recommended first, open REST API and signed webhooks), Odoo, Workday Financials, NetSuite.

What each connector exchanges:

| Connector          | Inbound                                                                     | Outbound                                                       | Event code carried as |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------- |
| ERPNext            | GL lines, purchase invoices, GL balances, cost centers, accounts, suppliers | event codes, recharge, chargeback and accrual journals         | Project               |
| Odoo               | journal items, analytic accounts, vendors, balances                         | event codes, journals                                          | Analytic tag          |
| Workday Financials | journal lines, cost centers, ledger accounts, suppliers, balances           | journals, event codes; budget check before commitment approval | Worktag               |
| NetSuite           | transactions, departments, classes, locations, vendors, balances            | journal entries, event codes                                   | Custom segment        |

Overview (sample ERPNext, Mock): last sync today 09:30; 412 GL lines imported into the actuals review (080a) with 378 matched automatically and 34 sent to the unmatched queue (080b); GL balances for October refreshed for tie-out (080c); 2 new suppliers waiting in vendor review (106c); outbound: 3 event codes pushed (EVT-2026-0119 to EVT-2026-0121), recharge journal RCH-2026-0012 exported.

Mappings: legal entity to ERP company (IN01, US01, UK01 to the ERP's company codes); GL accounts (BudgetFlow GL mapping 106a to ERP accounts, with unmapped accounts listed); cost centers (two-way match by code; new ERP cost centers go to 041 review); event code dimension (as in the table); currencies.

Sync: GL lines daily 06:00 (incremental by posting date, source `erp` or `ap` in the actuals model); balances after each period's ERP close and on demand for tie-out; suppliers weekly into vendor review (never auto-approved); webhooks (ERPNext, Odoo) for near-real-time GL postings, verified by HMAC signature.

Budget check (Workday Financials only): "Check Workday budgets before approving commitments charged to Workday-controlled ledgers" (off by default); behaviour "Warn" (default) or "Block"; the approval card (061, 061a-c) shows "Workday budget check: passed" or the failure reason.

## Data and permissions

Inbound data enters through the same paths as files: actuals as import batches into the 080a review (dedupe by source reference, `actuals_source_ref` unique key), balances into tie-out runs, suppliers into the vendor master review, cost centers into the 041 change flow. Outbound journals come from 094b exports and are idempotent per export id. Webhooks require a valid HMAC signature and timestamp; failures are rejected and logged (100). `integration.manage` to configure; GL account and entity mapping changes need `master_data.manage` approval (Finance Admin).

## States

| State            | Behaviour                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Picker           | four connectors with what they exchange; Mock mode available for each                      |
| Overview         | as above                                                                                   |
| Mapping gaps     | warning banner "5 ERP accounts are not mapped; their lines wait in the actuals review"     |
| Mapping approval | GL or entity mapping change: "Waiting for Finance Admin approval" tag                      |
| Webhook failed   | error banner "3 webhook calls failed signature checks in the last hour" with a link to 100 |
| Budget check on  | approval cards show the check line; failures in Block mode disable Approve with the reason |
| Loading / error  | `sat-ghost`; provider errors go to 100                                                     |

## Budget safety and audit

GL lines become actuals only through the 080a review rules (matched once, cross-source duplicates flagged first, 99a). Local-currency lines convert at the locked plan rate with the currency triplet stored; FX effect is reported separately. Mapping, schedule and budget-check changes are audited; every imported batch and exported journal is traceable to its sync run.

## Responsive and accessibility

Desktop and tablet; mobile read-only overview. Exchange tables have row and column headers; arrows for direction come with words ("Inbound", "Outbound").

## Satori components

Connector frame from 092; `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-rich-tooltip`, `sat-ghost`; Angular Material select, slide toggle, button toggle (Warn, Block), snackbar.

## Related screens and navigation

080a actuals import, 080b unmatched queue, 080c GL tie-out, 041 cost centers, 106a GL mapping, 106c vendor master, 094b exports, 99a duplicates, 99b event-code push, 061 approval decision (budget check line), 100 errors.

## Decisions taken

- ERPNext is the first ERP connector; all four share one frame and differ only in what they exchange.
- ERP data always enters through the existing review paths (actuals review, vendor review, cost center changes); nothing is auto-approved. Recommended so integrations cannot bypass finance controls.
- The Workday Financials budget check is off by default and, when on, warns by default; blocking is an explicit setting.
- GL account and entity mapping changes need Finance Admin approval because they change accounting.
