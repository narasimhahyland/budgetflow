# 080a Actuals import

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P6.

## Design

| State                                        | Image                                                           | Stitch screen                                      |
| -------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| review step (auto-match results by currency) | `design/stitch/080a-actuals-import/default--desktop--light.png` | `a87718de9fa74e5f939189b730d8c344`                 |
| refunds and credit notes (Phase 6 batch)     | planned `refunds-credit-notes--desktop--light.png`              | not generated yet (Stitch daily limit, 2026-11-05) |

## Purpose

Bring spend from ERP, card or expense exports into BudgetFlow, auto-match it to commitments and budgets, convert local currency to the USD budget at the locked plan rate, and post only what matched.

## Roles

Finance Controller, Finance Admin.

## Entry points

Finance > Actuals and matching (Import tab); integrations (P12) feed the same review.

## Content and actions

Tabs: Import, Unmatched queue (count), Matched, Mapping rules. Stepper Upload, Map columns, Review, Post. File chip with line count and source. KPI cards: lines read, auto-matched, partially matched, unmatched (link to queue), duplicates skipped. Table by transaction currency: lines, transaction amount (INR with lakh grouping), locked plan rate per USD, USD at plan rate, total. FX note. Matching rules applied with counts. Footer: Back, "Send 38 to unmatched queue", "Post 804 matched lines".

## Data and permissions

`actuals:import` and `actuals:post`; posting writes actual journals into the open period (Oct 2026) storing the currency triplet (transaction, budget USD, reporting USD); idempotent per file hash and line key; duplicates detected across sources.

## States

| State                       | Behaviour                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Upload / map (not exported) | `sat-upload-area`, saved column mappings per source                                                            |
| Period closed               | error banner; lines dated in a closed period go to the next open period as reversals or are blocked per policy |
| Posting                     | progress with counts; page stays usable                                                                        |
| Success                     | snackbar "804 lines posted to Oct 2026"; KPI cards update                                                      |

## Refunds and credit notes (state added in the Phase 6 batch)

Same review step for a batch that contains negative lines (sample: `card-actuals-2026-10.csv`, 312 lines).

- KPI card "Refunds and credit notes": 6 lines, -USD 1,214.60, added as a sixth card after duplicates skipped (the row wraps on tablet).
- Panel "By kind" next to the currency table: Charges 306 lines USD 41,882.30; Refunds 4 lines -USD 842.10; Credit notes 2 lines -USD 372.50; Reversals 0. Negative amounts show a leading minus and the ISO code (`-INR 12,450.00`), never colour alone.
- Table "Refunds and credit notes" (one row per line; sample rows below): kind tag (Refund, Credit note), vendor or merchant, original reference, transaction amount, USD at the plan rate of the original line, match result:
  - Refund, Spice Route Caterers, original INV-SRC-0412, -INR 12,450.00 = -USD 149.10, "Matched to the original: reduces actual on PO-2026-0201 (India Annual Day 2026)".
  - Credit note, Lakeview Banquets, original PO-2026-0193, -INR 20,000.00 = -USD 239.52, "Matched: reduces actual on Bengaluru Events".
  - Refund, City Cabs, no original reference, -INR 1,880.00 = -USD 22.51, "To the unmatched queue: no original reference".
  - Refund for a closed event (EVT-2026-0087 Offsite 2026), -USD 94.00, "To the unmatched queue: event closed; posts to the owning budget".
- Info line: "Refunds and credit notes post negative actuals linked to the original line; nothing is edited. The money returns to the budget's available; the commitment is not reopened."
- Footer counts include the negative lines ("Post 298 matched lines", "Send 14 to unmatched queue").

Data: `ActualKind` charge, refund, credit_note, reversal; refunds and credit notes match by original reference (rule `original_reference`) at the plan rate of the original line, and the FX effect is reported separately like any actual.

## Budget safety and audit

Budget consumption uses the locked plan rate; FX effect against the month-end rate is reported separately and never consumes budget. Matching moves amounts from encumbered to actual. One audit entry per batch.

## Responsive and accessibility

Desktop and tablet; mobile shows a read-only summary. Currency amounts always carry the ISO code.

## Related screens and navigation

080b, 080c, 107 exchange rates, 108 fiscal calendar, 085a commitment hygiene.

## Assumptions and open questions

- Partial matches (23) post as matched with the difference released; confirm or route them to the queue.
- Refunds for a closed event: post to the owning budget through the queue (assumed) rather than reopening the event or splitting back to contributors.
