# 085a Commitment hygiene

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 6 batch. Build phase P6. Route in the Phase 6 build: Finance > Actuals and matching > Commitment hygiene (`/finance/actuals/commitments`).

## Design

Not generated yet: the Stitch daily screen-generation limit was reached on 2026-11-05 (see the review log). Build from this spec with the 080a-080c tab layout and the financial dialog pattern. Planned exports:

| State                      | Planned image                                                       |
| -------------------------- | ------------------------------------------------------------------- |
| aging overview (default)   | `design/stitch/085a-commitment-hygiene/default--desktop--light.png` |
| release remaining (dialog) | `release-dialog--desktop--light.png`                                |
| cancel with fee (dialog)   | `cancel-dialog--desktop--light.png`                                 |

## Purpose

Keep encumbrances honest: show open commitments by age past their service end, prompt owners to release money that will never be invoiced, record cancellation fees and non-refundable deposits, and hand off to accruals when an invoice is still expected.

## Roles

Budget owners (their commitments only), Finance Controller and Finance Admin (all). Event organizers see their event's commitments.

## Entry points

Finance > Actuals and matching > Commitment hygiene; 053 open-commitment blocker; 051 row menu; owner digest "3 commitments ready to release".

## Content and actions

As of 4 Nov 2026. Filters: budget, event code, vendor, aging bucket, "Release prompts only" toggle. Export (CSV, XLSX, PDF).

- Aging strip (one card per bucket, count and USD encumbered): Current 41 (USD 61,200.00); 1-30 days 14 (USD 17,830.00); 31-60 days 6 (USD 5,190.00); 61-90 days 2 (USD 1,420.00); 90+ days 1 (USD 780.00). Total open 64, USD 86,420.00; release prompts 9.
- Table: reference and description, budget, event code, vendor, service end, days past, amount, consumed, encumbered left, non-refundable deposit, accrued, last actual, prompt tag ("Release suggested" warning, "Accrual proposed" info), row actions Release remaining, Cancel with fee, Propose accrual.
  - PO-2026-0244 AV equipment rental, Bengaluru Events, EVT-2026-0087, Brightline AV, ended 24 Oct (11 days), amount USD 2,400.00, consumed USD 2,020.00, left USD 380.00, last actual 26 Oct, Release suggested.
  - PO-2026-0218 Team offsite transport, Hyderabad Events, City Cabs, ended 20 Oct (15 days), left USD 1,250.00, Accrual proposed.
  - PO-2026-0172 Team lunch vouchers, Westlake Team Activities, ended 15 Aug (81 days), left USD 640.00, Release suggested.
  - PO-2026-0109 Summer picnic venue, Westlake Team Activities, Lakeside Pavilion, ended 30 Jun (127 days), left USD 780.00, non-refundable deposit USD 300.00, Release suggested.
  - PO-2026-0233 Diwali decor, Bengaluru Events, Festive Lights Co, service end 14 Nov (current).

Release remaining dialog: commitment summary, "Release USD 380.00 to Bengaluru Events" with before/after available, reason code and typed reason, note "The commitment closes as Released; later invoices go to the unmatched queue". Footer: Cancel, "Release USD 380.00".

Cancel with fee dialog: commitment summary, fee field (USD, at least the non-refundable deposit USD 300.00; field error below it), split preview "Fee USD 300.00 becomes actual; USD 480.00 returns to available", reason code and typed reason. Footer: Cancel, "Cancel commitment".

## Data and permissions

`GET /api/actuals/commitments` (open or all, by budget, event code, as-of date) with totals by aging bucket and `releasePrompt`; `POST .../release` and `POST .../cancellation` (fee in minor units, reason code, reason, idempotency key). Owners act on their budgets; finance on all. Days past are computed server-side from the service end.

## States

| State             | Behaviour                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Default           | as above                                                                                             |
| Empty             | "No open commitments" success empty state                                                            |
| Fee below deposit | field error "The fee cannot be less than the non-refundable deposit of USD 300.00"; primary disabled |
| Already invoiced  | the commitment was consumed meanwhile: dialog shows "Nothing left to release" and closes             |
| Period closed     | release posts to the next open period; info line says so                                             |
| Loading / error   | skeleton cards and rows; `sat-500-error-state` with Retry                                            |
| Success           | snackbar "USD 380.00 released to Bengaluru Events"; row leaves the open list                         |

## Budget safety and audit

Encumbered, consumed, accrued and deposits keep their swatches; releasing moves encumbered back to available, cancelling consumes the fee as actual and releases the rest; nothing is edited. One audit entry per release or cancellation with reason code and text; owners notified.

## Responsive and accessibility

Tablet: aging strip scrolls horizontally; table keeps reference, left and actions pinned. Mobile: list of cards per commitment with the prompt tag first. Aging cards are buttons that filter the table and announce the filter.

## Related screens and navigation

051 event commitments, 053 event reconciliation, 080d accruals and prepaids, 080b unmatched queue, 021 budget details, 088 audit log.

## Assumptions and open questions

- Prompt window: suggest release 7 days after the service end with no accrual (assumed, tenant setting later in 075/076).
- Should owners be able to cancel with a fee, or only finance? Assumed owners within their DoA.
