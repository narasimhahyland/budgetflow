# 080g Tax-aware consumption (recoverable and non-recoverable GST/VAT)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 11 batch. Build phase P11. Review-added screen (catalog section E: "tax-aware consumption: recoverable vs non-recoverable GST/VAT by entity and category"). Finance > Tax recoverability (`/finance/tax-recoverability`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the matrix layout of 073 and 106a. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                          |
| ------------------------------- | ---------------------------------------------------------------------- |
| rules by entity and category    | `design/stitch/080g-tax-aware-consumption/default--desktop--light.png` |
| rule editor with worked example | `editor--desktop--light.png`                                           |
| draft waiting for tax approval  | `pending-approval--desktop--light.png`                                 |
| preview calculator              | `calculator--desktop--light.png`                                       |

## Purpose

Make budgets show the real cost of spending: tax that the legal entity can recover (input GST or VAT) does not use up budget, while tax it cannot recover does, according to rules by legal entity, spend category and attendee type that finance and the tax approver maintain.

## Roles

Finance Admin (edit drafts); tax approver (publishes; designated per company as in 053a, by default the Finance Controller); Finance Controller, Auditor (read); budget owners see the effect on their commitments and actuals (net, recoverable and non-recoverable lines).

## Entry points

Finance > Tax recoverability; 106a GL mapping "Tax treatment"; 072a gifts and entertainment (client attendees); commitment and actual detail "Tax" lines link here.

## Content and actions

Header bar: title, version tag (v3 Published, effective 1 Apr 2026), "New draft", Export (CSV, XLSX, PDF).

Rules table grouped by legal entity (columns: category, attendee type, tax, recoverable share, effect on budget, effective from):

- IN01 (India GST):
  - Team events, food and catering; employees: GST, 0% recoverable, "Budget uses amount plus GST".
  - Venue hire; any attendees: GST, 100% recoverable, "Budget uses amount without GST".
  - Gifts; employees: GST, 0% recoverable.
  - Training and learning; employees: GST, 100% recoverable.
- UK01 (UK VAT):
  - Staff entertainment; employees only: VAT, 100% recoverable.
  - Client entertainment; clients present: VAT, 0% recoverable (and the entertainment GL from 072a).
  - Mixed attendees: VAT, recoverable in proportion to employees present.
- US01 (sales tax): all categories, 0% recoverable.
- Note under the table: "Defaults are placeholders for review by the tax approver; they are not tax advice."

Rule editor: entity, category (from 106), attendee type (employees, clients, mixed), tax code (from the entity's tax codes), recoverable share (0-100%, or "Proportional to employees"), effective from, notes. Worked example updates live:

- "London team dinner, 10 staff: GBP 600.00 + VAT GBP 120.00. Budget uses GBP 600.00 = USD 762.00 at the FY2026 plan rate (GBP 1 = USD 1.27); VAT USD 152.40 is recoverable and not charged to the budget."
- "Mixed: 8 staff and 2 clients: 80% of the VAT is recoverable (GBP 96.00); GBP 24.00 is added to the budget's cost."
- "Bengaluru catering: INR 1,00,000.00 + GST INR 18,000.00. Budget uses INR 1,18,000.00 = USD 1,413.17."

Preview calculator (side panel): entity, category, attendees, amount, tax amount, currency; result lines: net, recoverable tax, non-recoverable tax, "Uses budget" in transaction currency and USD.

Footer for drafts: "Submit to tax approver"; for the tax approver: Publish (with effective date), Return with comments.

## Data and permissions

Applies to `commitment_tax_lines` (amount, `recoverable`, `withholding`) and `actual_tax_lines` (`tax_code`, amount, `recoverable`): the API splits each tax line into recoverable and non-recoverable parts by the rule in force on the accounting date and posts only net plus non-recoverable tax to the budget buckets; recoverable tax is tracked for reporting and never consumes budget. New P11 `close.ts` data for rule sets with immutable published versions. `master_data.manage` to edit drafts; new action `tax.publish` (integrator adds) for the tax approver. Rules apply from their effective date forward; published versions never re-post past commitments or actuals.

## States

| State            | Behaviour                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Published        | as above; read-only until "New draft"                                                              |
| Draft            | editable with changes highlighted against the published version                                    |
| Pending approval | warning banner "Waiting for Priya Raman (tax approver) since 3 Nov"; edits locked                  |
| Returned         | banner with the approver's comments; draft editable again                                          |
| Validation       | "Two rules cover IN01, Team events, employees from 1 Apr 2026", "Recoverable share must be 0-100%" |
| Future effective | tag "Effective 1 Jan 2027" on the upcoming version, current version still applied                  |
| Loading / error  | `sat-ghost` table; error banner with Retry                                                         |

## Budget safety and audit

Consumption lines on commitments and actuals show net, recoverable tax and non-recoverable tax separately, in transaction currency and USD at the locked plan rate; FX effect stays separate. Rule changes never edit posted amounts; corrections after a wrong rule are reversals in an open period. Draft submissions, returns and publishes are audited with the full rule diff.

## Responsive and accessibility

Desktop and tablet; mobile read-only. The rules table has grouped row headers per entity; the worked example is plain text that updates and is announced politely.

## Satori components

`sat-header-bar`, `mat-table` with grouped rows and `satTableWithRowStates`, `sat-status-tag` (version status), `sat-banner`, `sat-rich-tooltip` (recoverable explanation), `sat-splitter` (rules and calculator), `sat-ghost`; Angular Material dialog (rule editor), form fields, select, slider or number field (share), datepicker, snackbar; `bf-money`.

## Related screens and navigation

106 categories, 106a GL mapping, 072a gifts, entertainment and alcohol, 053a intercompany recharges (tax approver), 051 commitments, 080a actuals import, 080h employee benefit ledger, 16a board pack.

## Decisions taken

- Budgets consume the net amount plus non-recoverable tax; recoverable tax never uses budget. Recommended because owners should see what the spend really costs their entity.
- Mixed staff and client events recover tax in proportion to employees present, using the attendance recorded for the event.
- Rules are versioned with effective dates and need the tax approver to publish; they never change past postings.
- Default rates and shares are placeholders marked for tax review, not built-in tax advice.
