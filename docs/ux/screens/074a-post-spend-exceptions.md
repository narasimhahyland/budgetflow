# 074a Post-spend exception queue

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch B. Build phase P7. Rules and policies > Exceptions (also reachable from Finance).

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/074a-post-spend-exceptions/default--desktop--light.png` (queue with detail drawer), `split-duplicate--desktop--light.png`, `resolve-dialog--desktop--light.png`.

## Purpose

Re-check spend against policy after it happens (actuals and matched requests) and work the exceptions: alcohol over cap, blocked vendors, missing receipts, gifts above cap, possible split purchases and duplicates, with a clear resolution for each.

## Roles

Finance Controller and Finance Admin (resolve); budget owners (see and explain exceptions on their budgets); Auditor (read).

## Entry points

066 KPI "Post-spend exceptions"; 080a after posting ("7 exceptions raised"); owner notifications; 017 alerts (P10).

## Content and actions

Filters: type, budget, location, status (Open, Explained, Resolved), age. Export.

Table: raised on, type tag, actual or request, budget, person, amount (transaction currency and USD), rule that raised it (with version), status, age. Samples:

- Alcohol above cap: Westlake summer party, receipt line USD 340.00 for 12 attendees (cap USD 20.00 per attendee = USD 240.00); R-26 v1.
- Blocked vendor: Party Palace Rentals, USD 1,150.00, card spend after the block date; R-03 v2.
- Missing receipt: REQ-2026-0131 online course, due 30 Nov; R-14 v2.
- Possible split: two requests by the same person to Spice Route Caterers on 12 and 13 Oct, INR 2,25,000.00 and INR 2,30,000.00 (USD 2,694.61 and USD 2,754.49), together USD 5,449.10: above the USD 5,000.00 band that adds the Finance Controller, while each alone stays below it; R-28 v1.
- Possible duplicate: card actual and expense claim with the same merchant, amount and date (USD 86.40).

Detail drawer: evidence (receipt image, lines, matched request, facts the rule used), history, comments with @owner. Resolutions: Accept with reason (records an exception approval; Finance Controller only above USD 500.00), Ask for repayment (creates a task for the person), Reclassify (category or GL, posts a reversal and re-post, never an edit), Mark duplicate (excludes the second line through 080b), Not an exception (with reason; feeds rule tuning).

## Data and permissions

Exceptions are produced by the post-spend re-check (same evaluator as pre-spend, on actual facts) and by split and duplicate detection (window 7 days, same requester, vendor or event). `exception:resolve` for FC and FA; owners comment. Resolutions are idempotent.

## States

| State           | Behaviour                                                       |
| --------------- | --------------------------------------------------------------- |
| Default         | as above                                                        |
| Split/duplicate | filtered view with side-by-side comparison of the related items |
| Resolve dialog  | resolution, reason code, typed reason; amount for repayment     |
| Empty           | "No exceptions" success empty state                             |
| Owner view      | only their budgets; resolutions hidden, "Explain" available     |

## Budget safety and audit

Reclassifications are reversals in an open period; repayments create a receivable task, not a ledger edit. Every resolution is audited with the rule version and facts.

## Responsive and accessibility

Tablet: drawer overlays. Mobile: list and full-screen detail; resolutions for finance on desktop or tablet.

## Related screens and navigation

066, 072a, 073a, 071a (split and duplicate template), 080a, 080b, 060, 088.

## Assumptions and open questions

- Who can accept an exception above USD 500.00: Finance Controller only (assumed).
