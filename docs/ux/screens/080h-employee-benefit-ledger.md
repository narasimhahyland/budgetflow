# 080h Employee benefit ledger and benefit-in-kind thresholds

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 11 batch. Build phase P11. Review-added screen (catalog section E: "per-employee benefit-in-kind thresholds with payroll export, for example UK and Germany staff-event rules"). Finance > Employee benefits (`/finance/employee-benefits`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the table language of 080b. Planned Stitch states, to be generated in a later session:

| State                                  | Planned image                                                            |
| -------------------------------------- | ------------------------------------------------------------------------ |
| ledger with approaching and over flags | `design/stitch/080h-employee-benefit-ledger/default--desktop--light.png` |
| person detail drawer                   | `person-drawer--desktop--light.png`                                      |
| thresholds by jurisdiction             | `thresholds--desktop--light.png`                                         |
| payroll export dialog                  | `payroll-export--desktop--light.png`                                     |

## Purpose

Keep a per-employee record of the benefits people receive through BudgetFlow (their share of event costs, gifts, recognition), compare it with the tax thresholds of their country (for example the UK annual staff function limit and Germany's per-event company event allowance) and the company's per-employee annual cap, and hand payroll the taxable amounts, so taxable benefits are reported instead of discovered in an audit.

## Roles

Finance Admin and Finance Controller (view, export, maintain drafts of thresholds); tax approver (publishes thresholds, as in 080g); Auditor (read). Employees see their own year-to-date benefits in personal activity history (122, P14); organizers see a warning when attendees approach a threshold.

## Entry points

Finance > Employee benefits; 47e after attendance is applied ("3 attendees are close to the UK annual function limit"); 071 per-employee annual cap; 072a gifts; payroll month-end task in 123.

## Content and actions

Tabs: Ledger, Thresholds, Payroll exports.

Ledger (filters: legal entity, location, benefit type, status Under, Approaching, Over; period shows each threshold's own tax year):

| Person      | Entity | Location  | Rule (tax year)                                   | Counted    | Limit               | Status      | Reportable                |
| ----------- | ------ | --------- | ------------------------------------------------- | ---------- | ------------------- | ----------- | ------------------------- |
| Emma Clarke | UK01   | London    | UK annual staff functions (6 Apr 2026-5 Apr 2027) | GBP 142.50 | GBP 150.00 per head | Approaching | GBP 0.00                  |
| James Patel | UK01   | London    | UK annual staff functions                         | GBP 168.00 | GBP 150.00 per head | Over        | GBP 168.00 (whole amount) |
| Kavya Shah  | IN01   | Bengaluru | Per-employee annual cap (071, FY2026)             | USD 212.40 | USD 300.00          | Under       | -                         |
| Tom Reilly  | US01   | Westlake  | Per-employee annual cap (071, FY2026)             | USD 288.00 | USD 300.00          | Approaching | -                         |

- Status tags: Under (neutral), Approaching at 80% or more (warning), Over (important) with the reportable amount.
- Person drawer: entries (date, event or item, benefit type, amount in local currency and USD at the locked plan rate, counted toward which rules, source link to 046 or the gift request); totals per rule; note when a rule counts the whole amount once exceeded.
- Germany row group shows "Germany company events (EUR 110.00 per employee per event, 2 events a year): template, no legal entity in scope yet."

Thresholds (per jurisdiction): name, legal entities, benefit types counted, limit (local currency), basis (per year or per event), maximum occasions, period start (tax year start, for example 6 April for the UK), when exceeded ("Whole amount becomes reportable" for the UK annual function rule; "Only the excess is reportable" for the Germany per-event allowance), status (Published, Draft, Template), effective dates. Editing works as in 080g (draft, submit to tax approver, publish).

Payroll exports: month, entity, people with reportable amounts, total, status (Draft, Exported), file (CSV, XLSX) or "Send to payroll connector" (from P12, 94b). Export dialog lists people and amounts in the entity's currency, needs a confirmation, and marks entries as exported (re-export asks for a reason).

## Data and permissions

Uses `employee_benefit_ledger` (person, event, fiscal year, `benefit_type`, amount, currency, `taxable`). Entries are written when an event closes (each attendee marked Attended or Walk-in in 47e gets the event's final cost per attendee), when a gift or recognition is approved, and reversed if the source is reversed. New P11 `close.ts` data for thresholds (versions, jurisdiction, rule basis and exceeded behaviour) and payroll export batches. Rules evaluate on the threshold's own tax-year window using entry dates. `actuals.manage` or new `benefits.read` (integrator adds; FA, FC, AUD) to view; `tax.publish` to publish thresholds; exports need Finance Admin. Personal data: visible only to these roles and the employee themself.

## States

| State              | Behaviour                                                     |
| ------------------ | ------------------------------------------------------------- |
| Ledger             | as above                                                      |
| Person drawer      | as above                                                      |
| No people in scope | threshold row "Template: no legal entity in scope yet"        |
| Thresholds draft   | as 080g: highlighted changes, Submit to tax approver          |
| Export dialog      | as above; Export disabled when there is nothing reportable    |
| Already exported   | entries tagged "Exported 31 Oct"; re-export needs a reason    |
| Empty              | "No benefits recorded yet. Entries appear when events close." |
| Loading / error    | `sat-ghost`; error banner with Retry                          |
| Forbidden          | `sat-403-error-state`                                         |

## Budget safety and audit

The benefit ledger never moves budget money; it records each person's share of costs already posted. Local currency and USD at the locked plan rate are shown side by side. Entries, threshold publishes and payroll exports are audited (exports include who, entity, month and totals, not the file content).

## Responsive and accessibility

Desktop and tablet; mobile read-only. Status tags use icon and words; tables have captions with entity and tax year.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `mat-table` with `satTableWithRowStates`, `sat-status-tag` (Under, Approaching, Over, Template, Exported), `sat-banner`, `sat-rich-tooltip` (rule basis), `sat-empty-state`, `sat-ghost`, `sat-403-error-state`; Angular Material side sheet (person), dialog (export, threshold editor), form fields, snackbar; `bf-money`.

## Related screens and navigation

47e attendance (source of event shares), 071 per-employee annual cap, 072a gifts, entertainment and alcohol, 080g tax-aware consumption, 94b finance and payroll exports (P12), 122 personal activity history (P14), 054 close event.

## Decisions taken

- Event benefits are recorded at event close using the final cost per attendee for people marked Attended or Walk-in, not at RSVP or approval. Recommended because only final, attended costs are reportable.
- Each threshold evaluates on its own tax-year window (for example 6 April for the UK), not the company fiscal year.
- Thresholds define what happens when exceeded: the whole amount (UK annual function rule) or only the excess (Germany per-event allowance); defaults are placeholders for tax review.
- The same ledger feeds the company's per-employee annual cap (071) so caps and tax thresholds use one record.
- Only Finance Admin, Finance Controller, Auditor and the employee see individual entries.
