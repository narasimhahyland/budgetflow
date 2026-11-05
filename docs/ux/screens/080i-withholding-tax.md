# 080i Withholding tax on commitments

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Review-added screen (catalog section E: "withholding tax shown on commitments"; plan Phase 15). Finance > Withholding tax (`/finance/withholding-tax`); withholding lines on commitment and actual details (051, 080b).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the rules layout of 80g. Planned Stitch states, to be generated in a later session:

| State                             | Planned image                                                    |
| --------------------------------- | ---------------------------------------------------------------- |
| rules by entity and vendor type   | `design/stitch/080i-withholding-tax/default--desktop--light.png` |
| commitment with withholding lines | `commitment--desktop--light.png`                                 |
| draft waiting for tax approval    | `pending-approval--desktop--light.png`                           |
| vendor without a tax id           | `no-tax-id--desktop--light.png`                                  |

## Purpose

Show on every commitment how much of the amount is paid to the vendor and how much is withheld for the tax authority, so organizers and owners understand why the vendor receives less than the quote, while the budget correctly bears the full cost and finance exports the withholding with the payable.

## Roles

Finance Admin (edit drafts); tax approver (publishes; by default the Finance Controller, as in 80g); Finance Controller and Auditor (read); organizers and owners see withholding lines on their commitments.

## Entry points

Finance > Withholding tax; 106c vendor master "Tax id and withholding category"; 051 commitment detail "Withholding"; 51a select dialog (shows net payable); 94b finance exports "Withholding lines".

## Content and actions

Header bar: title, version tag (v1 Published, effective 1 Apr 2026), New draft, Export (CSV, XLSX, PDF).

Rules table grouped by legal entity (columns: vendor type, service category, rate, threshold, applies when tax id missing, effective from). Samples (placeholders):

- IN01: Contractors (catering, transport, event services) 2%, threshold INR 30,000.00 per invoice or INR 1,00,000.00 per year per vendor; Professional fees (speakers, facilitators) 10%, threshold INR 30,000.00 per year; any vendor without a tax id on file 20%.
- US01: no withholding by default; "Backup withholding when a vendor's tax id is missing" 24%.
- UK01: no withholding for these categories.
- Note: "Rates are placeholders for review by the tax approver; they are not tax advice."

Rule editor: entity, vendor type (from 106c), service category, rate, thresholds (per invoice, per year per vendor), missing tax id rate, effective from, notes; worked example: "Spice Route Caterers, IN01, catering INR 3,00,600.00: withholding 2% = INR 6,012.00 (USD 72.00); vendor is paid INR 2,94,588.00; budget uses INR 3,00,600.00 = USD 3,600.00."

Commitment detail (051) withholding block: gross amount, withholding (rate, rule version), net payable to vendor, "Budget uses the gross amount", all in transaction currency and USD at the locked plan rate; vendor tax id status (On file, Missing).

## Data and permissions

Uses `commitment_tax_lines` with `withholding` set and the matching actual tax lines; vendor tax id status and withholding category on the vendor master (P3 `vendors`, extended). Rule sets are versioned with immutable published versions (P15 data next to 80g's rule sets); the API computes withholding on commitment creation and on actual matching with the rule in force on the accounting date and cumulative per-vendor totals for yearly thresholds. `master_data.manage` to edit drafts; `tax.publish` (from 80g) to publish. Withholding lines are included in the 94b ERP payable export.

## States

| State             | Behaviour                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Published         | read-only until New draft                                                                                         |
| Draft             | changes highlighted against the published version                                                                 |
| Pending approval  | warning banner "Waiting for Priya Raman (tax approver) since 4 Nov"; edits locked                                 |
| Threshold crossed | commitment note "This commitment takes Spice Route Caterers past INR 1,00,000.00 this year; 2% applies from here" |
| No tax id         | warning on the commitment "Vendor tax id missing: 20% withholding applies" with "Request tax id" (106c)           |
| Validation        | "Rate must be 0-50%", "Two rules cover IN01 contractors from 1 Apr 2026"                                          |
| Loading / error   | `sat-ghost`; error banner with Retry                                                                              |

## Budget safety and audit

The budget consumes the gross amount; withholding is shown as a separate payable to the tax authority and is never treated as a saving. Rule changes apply from their effective date and never re-post past commitments or actuals; corrections are reversals in an open period. Draft submissions, returns and publishes are audited with the full rule diff.

## Responsive and accessibility

Desktop and tablet; mobile read-only. The commitment block is a definition list with "Budget uses" stated in words.

## Satori components

`sat-header-bar`, `mat-table` with grouped rows and `satTableWithRowStates`, `sat-status-tag` (version, tax id status), `sat-banner`, `sat-rich-tooltip` (threshold explanation), `sat-ghost`; Angular Material dialog (rule editor), form fields, datepicker, snackbar; `bf-money`.

## Related screens and navigation

080g tax-aware consumption, 106c vendor master, 051 commitments, 51a vendor quotes, 080b unmatched actuals, 094b finance exports, 053a intercompany recharges.

## Decisions taken

- Budgets consume the gross amount; withholding is a separate payable, not a saving. Recommended because the company bears the full cost whether it pays the vendor or the tax authority.
- Rules are versioned with effective dates and published by the tax approver, like the tax recoverability rules in 80g; they never change past postings.
- A missing vendor tax id triggers the higher rate and a request to the vendor master owner.
- Rates are placeholders marked for tax review, not built-in tax advice.
