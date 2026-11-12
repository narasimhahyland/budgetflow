# Gap B3 posting design

Tax never adds a ledger bucket or account. A tax split changes **how much** the existing commitment
and actual postings move. The recoverable part never reaches the ledger: it is recorded on the
commitment's or actual's tax lines, which are append-only. The benefit ledger posts nothing.

## Request with GST/VAT (080g)

Example: a UK training course for USD 1,000.00 plus VAT USD 200.00. The seeded rule for HYL-UK,
training, any attendees is VAT-20 at 100% recoverable.

| Business event     | Line | Bucket              | Sign | Transaction (USD) | Budget (USD) | Reporting (USD) | Rate                           | Provenance          |
| ------------------ | ---- | ------------------- | ---- | ----------------: | -----------: | --------------: | ------------------------------ | ------------------- |
| Submitted          | 1    | pre-encumbered (Dr) | +X   |          1,000.00 |     1,000.00 |        1,000.00 | plan (locked FY2026)           | request, commitment |
| Submitted          | 2    | obligations (Cr)    | −X   |          1,000.00 |     1,000.00 |        1,000.00 | plan                           | request, commitment |
| Approved (in full) | 1    | encumbered (Dr)     | +X   |          1,000.00 |     1,000.00 |        1,000.00 | rates stored on the commitment | commitment          |
| Approved (in full) | 2    | pre-encumbered (Cr) | −X   |          1,000.00 |     1,000.00 |        1,000.00 | rates stored on the commitment | commitment          |

- X = net + non-recoverable tax = 1,000.00 + 0.00. The recoverable USD 200.00 is two
  `commitment_tax_lines` rows (200.00 recoverable, 0.00 non-recoverable), with the rule id, the
  share and the implied tax rate.
- India GST at 0% recoverable (team lunch): X = 847.46 + 152.54 = USD 1,000.00. All the GST is
  consumption.
- Mixed attendance (proportional rules): share = employees ÷ (employees + others), half-even in
  basis points. The recoverable part = tax × share, half-even once; the non-recoverable part is the
  rest, so the two always sum exactly to the tax.
- Attendance comes from the request's benefit recipients (employees) and non-employee count.
  Unknown attendance reads as "any attendees", so only rules for any attendees apply, and a
  proportional rule with nobody recorded recovers nothing. Spend whose attendance is unknown never
  gets tax back under a rule that depends on who was there.
- Approval is in net terms. `consumptionForNet` maps the approved net to consumption: the whole net
  gives the recorded consumption exactly; part of it adds the same share of the non-recoverable
  tax, half-even. A counter-offer scales the recorded split onto its new commitment (`scaleSplit`) and
  records its own net on the tax lines (`net_minor`), so later steps never scale it again. A
  resubmitted amount scales the tax with it unless a new tax is given.
- Journals are the existing `postSpendMovement` journals with a different amount, so they balance
  as before. FX is unchanged: budget control converts X at the locked plan rate. The reporting view
  of recoverable tax is shown separately and never folded into consumption.

## Actual with GST/VAT (080g)

Example: a card or ERP line of USD 1,200.00 gross, `tax_amount` 200.00, `tax_category` training,
HYL-UK.

| Step          | What is stored                                                  |        Amount |
| ------------- | --------------------------------------------------------------- | ------------: |
| Import        | `actuals.transaction_amount_minor` (what matching can consume)  |      1,000.00 |
| Import        | `actual_tax_lines`: recoverable / non-recoverable               | 200.00 / 0.00 |
| Match: charge | actual (Dr) / obligations (Cr), triplet at the locked plan rate |      1,000.00 |
| Match: relief | obligations (Dr) / encumbered (Cr) on the commitment            |      1,000.00 |

- The gross is the stored amount plus the recoverable tax; the actual detail shows both.
- Taxed lines split in a first pass. A reversal or refund line without a tax column then takes its
  original's split in proportion, whether the original comes earlier or later in the same file or
  is already stored from the same source
  (`recoverableForPart`). A full reversal of −1,200.00 is therefore stored as −1,000.00 with
  −200.00 recoverable, and it still passes the equal-amount check for reversals.
- Duplicate detection compares the gross as charged, so the same expense from a feed with a tax
  column and one without is still flagged.
- With no tolerance, 1,200.01 gross with 200.00 recoverable gives 1,000.01, one minor unit over the
  commitment, and the line waits in the queue (`MATCH_OVER_TOLERANCE` path) like any over-run.

## Corrections

- Rule versions apply from their effective date forward and never re-post. A wrong split is
  corrected with the existing reversal path in an open period.
- Commitment and actual tax lines, published rule sets, their rules and published thresholds are
  rejected by database triggers on `UPDATE` and `DELETE`.

## Benefit ledger (080h)

`employee_benefit_ledger` rows record each person's share of costs already posted: an event's
final actual cost per attendee at close, an approved request naming recipients, or an entry
recorded by finance. They post no journal and move no budget money. They are append-only; a
reversal is a negating row (`reversal_of_id`, unique), written when finance reverses an entry or
when a request's commitment is released or cancelled before any spend.

## Rebuild check

No new account or bucket, so the nightly rebuild runs unchanged. `runLedgerCheck` is `clean` after
the taxed commitments, actuals, reversal and event close in `apps/api-e2e/src/tax/*.spec.ts`.
