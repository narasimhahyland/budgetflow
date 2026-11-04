# 080d Accrual proposals and prepaids

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 6 batch. Build phase P6. Route in the Phase 6 build: Finance > Actuals and matching > Accruals and prepaids (`/finance/actuals/accruals`).

## Design

Not generated yet: the Stitch daily screen-generation limit was reached on 2026-11-05 (see the review log). Build from this spec with the 080a-080c tab layout. Planned exports:

| State                       | Planned image                                                      |
| --------------------------- | ------------------------------------------------------------------ |
| accrual proposals (default) | `design/stitch/080d-accruals-prepaids/default--desktop--light.png` |
| prepaids and deposits       | `prepaids--desktop--light.png`                                     |
| reject accrual (dialog)     | `reject-dialog--desktop--light.png`                                |

## Purpose

At month end, propose accruals for commitments whose service has ended but whose invoice has not arrived, let finance approve or reject them, reverse them automatically, and recognize prepaids and deposits over their service period, without ever consuming budget twice.

## Roles

Finance Controller (runs proposals, approves), Finance Admin (approves, exports). Budget owners read accruals on their budgets (021). Auditors read.

## Entry points

Finance > Actuals and matching > Accruals and prepaids; month-end checklist; 085a "Propose accrual"; 080c tie-out notes.

## Content and actions

Tabs inside the page: Accrual proposals (count), Posted accruals, Prepaids and deposits. Header: period Oct 2026 (open), "As of 31 Oct 2026" date field, "Run proposals" (outlined), Export accrual journal (CSV for the ERP).

Accrual proposals tab:

- Info banner: "Accruals record cost already incurred. They never consume budget and reverse automatically when the invoice arrives or at the start of Nov 2026."
- KPIs: proposed 4 (USD 5,914.00), approved this period, rejected this period.
- Table: commitment, description, budget, vendor, service end, encumbered left, proposed accrual (transaction currency and USD at the locked plan rate), accrual period, auto-reverse period, status tag (Proposed warning, Approved success, Posted, Reversed neutral, Rejected important), actions Approve, Reject.
  - PO-2026-0218 Team offsite transport, City Cabs, Hyderabad Events, ended 20 Oct, USD 1,250.00.
  - PO-2026-0226 Wellbeing workshop, Mindful Desk, Europe Wellbeing (set to zero; existing commitments still complete), ended 28 Oct, EUR 2,800.00 = USD 3,024.00.
  - PO-2026-0229 Volunteer day supplies, Northside Print, Westlake Team Activities, ended 30 Oct, USD 640.00.
  - PO-2026-0230 Team photo session, Snapshot Booths, Bengaluru Events, ended 29 Oct, INR 83,500.00 = USD 1,000.00.
- `sat-selection-bar` for bulk Approve (each row still checked individually).

Posted accruals tab: posted and reversed accruals with journal links, reversal trigger ("Invoice matched" or "Period start"), exported date.

Prepaids and deposits tab:

- Table: commitment, vendor, budget, amount, service period, recognized so far, remaining, non-refundable tag, recognized through.
  - PO-2026-0150 Wellbeing app subscription, Calmwave, Employee Experience, USD 3,600.00, 1 Jan-31 Dec 2026, recognized USD 3,000.00 through 31 Oct, remaining USD 600.00.
  - PO-2026-0193 Venue deposit, Lakeview Convention Centre, India Annual Day 2026, USD 2,400.00, service 12 Dec 2026, non-refundable, recognized USD 0.00.
- "Recognize through 31 Oct 2026" (outlined): consumes the elapsed share of each prepaid; result snackbar with the count and USD recognized.

Reject dialog: commitment summary, required reason, Cancel, Reject accrual.

## Data and permissions

Endpoints: list accruals (by status), run proposals (as-of date, optional budget), approve (posts the accrual journal `accrued` / `obligations` and schedules the auto-reversal), reject (reason), auto-reversals, export (CSV), list prepaids, run recognitions. `accruals:approve` for Finance Controller and Finance Admin; the preparer of a run may approve (no segregation required for accruals; assumption). All money from the ledger; idempotency keys on approve, reject and runs.

## States

| State               | Behaviour                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Proposals (default) | as above                                                                                            |
| Empty               | "No accruals to propose for Oct 2026" success empty state with the as-of date                       |
| Period closed       | error banner "Oct 2026 is closed"; Run proposals and Approve disabled with the reason               |
| Already invoiced    | a proposal whose invoice arrived since the run shows "Invoice matched: proposal withdrawn"          |
| Prepaids empty      | "No prepaids or deposits"                                                                           |
| Loading / error     | skeleton rows; `sat-500-error-state` with Retry                                                     |
| Success             | snackbars "Accrual posted to Oct 2026; reverses 1 Nov 2026" and "2 prepaids recognized, USD 300.00" |

## Budget safety and audit

Accrued has its own swatch and never reduces Available (design-system section 10); the encumbrance stays until the invoice matches. Prepaids consume budget only for the elapsed service period; non-refundable deposits are tagged because cancellation consumes them (085a). One audit entry per approval, rejection, run and export.

## Responsive and accessibility

Desktop and tablet; mobile shows read-only lists. Status tags carry icon and text; amounts keep their ISO codes.

## Related screens and navigation

080a import, 080b unmatched queue, 080c GL tie-out, 085a commitment hygiene, 021 budget details (accrued line), 088 audit log.

## Assumptions and open questions

- Should approving an accrual require a second person when it exceeds a threshold (for example USD 10,000.00)? Assumed no for P6.
