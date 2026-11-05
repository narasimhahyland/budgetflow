# 094b Finance and payroll exports

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Review-added screen (plan P12: "exports for intercompany recharges, chargeback and reclass journals, accruals and prepaids, payroll benefit data"). Finance > Exports (`/finance/exports`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the finance table language of 053a and 080d. Planned Stitch states, to be generated in a later session:

| State                            | Planned image                                                            |
| -------------------------------- | ------------------------------------------------------------------------ |
| exports list by period           | `design/stitch/094b-finance-payroll-exports/default--desktop--light.png` |
| new export with balanced preview | `new-export--desktop--light.png`                                         |
| re-export warning                | `re-export--desktop--light.png`                                          |
| failed delivery to ERP           | `failed--desktop--light.png`                                             |

## Purpose

Hand the ERP and payroll the entries BudgetFlow creates (intercompany recharges, chargeback and reclass journals, accruals and their reversals, prepaid releases, taxable employee benefits) as balanced, period-stamped exports delivered by connector or file, exactly once, with acknowledgement tracked, so the general ledger and payroll match BudgetFlow without re-keying.

## Roles

Finance Admin (creates and sends exports, marks posted); Finance Controller (reviews, read); Integration Admin (delivery settings, read); Auditor (read).

## Entry points

Finance > Exports; 053a recharge schedule "Export"; 080d accruals "Export"; 080h benefits "Payroll export"; 080e close checklist "Recharges and accruals exported"; 094 ERP connector Push tab.

## Content and actions

Header bar: title, period select (October 2026), "New export".

Exports table: export id, type, period, entity, lines, debit total, credit total, target (ERP connector or file), status (Draft, Sent, Acknowledged, Posted, Failed), created by, sent at; row menu Download (CSV, XLSX), Resend, Mark posted, View lines. Samples:

- EXP-2026-0141 Intercompany recharges, Oct 2026, US01 to IN01, 1 line pair, USD 4,000.00 / USD 4,000.00, ERPNext, Acknowledged.
- EXP-2026-0142 Accruals, Oct 2026, IN01, 3 lines, USD 2,140.00 / USD 2,140.00, ERPNext, Sent (auto-reversal on 1 Nov included as EXP-2026-0143, scheduled).
- EXP-2026-0144 Chargeback and reclass, Oct 2026, IN01, 4 lines, USD 1,180.00 / USD 1,180.00, file, Draft.
- EXP-2026-0145 Payroll benefits, Oct 2026, UK01, 1 person, GBP 168.00 reportable, file, Draft.

New export dialog: type (Intercompany recharges, Chargeback and reclass, Accruals and reversals, Prepaid releases, Payroll benefits), period, legal entity, target (connector from 094 or file format), preview lines (account, cost center, event code, description, debit, credit, transaction currency and amount, rate), balance check "Debits equal credits" (payroll: totals per person instead), "Include items already exported" (off). Create and send.

## Data and permissions

New P12 export batches in `integrations.ts`: type, period, entity, lines (from recharge schedules, chargeback and reclass journals, accruals and prepaids, employee benefit ledger), totals, target, status, acknowledgement reference. Lines are taken from posted BudgetFlow journals and schedules and keep their journal links; an item is exported once (`export_id` recorded per source line); re-export requires a reason and is marked as a duplicate send for the receiving system. Recharge exports require tax approval where policy says so (053a status Approved or Scheduled). `actuals.manage` (Finance Admin) to create and send; `integration.read` to view delivery settings.

## States

| State             | Behaviour                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| List              | as above                                                                                                                  |
| New export        | dialog with preview; Create disabled until balanced                                                                       |
| Not balanced      | error line "Debits USD 1,180.00, credits USD 1,150.00: 1 line has no account mapping" with the line                       |
| Nothing to export | info "No new items for October 2026 in IN01"                                                                              |
| Re-export         | warning dialog "EXP-2026-0141 was acknowledged on 2 Nov. Sending again can create duplicates in the ERP." reason required |
| Failed            | error tag with the connector message and Resend; details in 100                                                           |
| Posted            | success tag with the ERP document number                                                                                  |
| Loading / error   | `sat-ghost`; error banner with Retry                                                                                      |

## Budget safety and audit

Exports never change BudgetFlow balances; they describe journals already posted. Every export balances (debits equal credits) before it can be sent. Creation, sends, resends with reasons, acknowledgements and "Mark posted" are audited.

## Responsive and accessibility

Desktop and tablet; mobile read-only list. Debit and credit columns are right-aligned with totals rows; statuses are text tags.

## Satori components

`sat-header-bar`, `mat-table` with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag`, `sat-banner`, `satImportantButton` (Create and send), `sat-ghost`; Angular Material dialog, select, slide toggle, menu, snackbar; `bf-money`.

## Related screens and navigation

053a intercompany recharge schedule, 080d accruals and prepaids, 080h employee benefit ledger, 074a reclassifications, 080e period close, 094 ERP integration, 100 errors and retry, 088 audit log.

## Decisions taken

- One export screen for all finance and payroll outputs, by type and period, rather than an export button on each source screen only. Recommended so finance can see in one place what the ERP and payroll have received.
- Each source item is exported once; resending needs a reason and is flagged as a duplicate send.
- Exports must balance before sending; payroll exports total per person instead.
- Delivery is by ERP connector when one is connected, otherwise by CSV or XLSX file.
