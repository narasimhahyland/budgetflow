# 080a Actuals import

Status: proposed - awaiting user review. Light theme only. UX core set part 2 (todo `ux-core-screens`). Build phase P6.

## Design

| State                                        | Image                                                           | Stitch screen                      |
| -------------------------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| review step (auto-match results by currency) | `design/stitch/080a-actuals-import/default--desktop--light.png` | `a87718de9fa74e5f939189b730d8c344` |

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

## Budget safety and audit

Budget consumption uses the locked plan rate; FX effect against the month-end rate is reported separately and never consumes budget. Matching moves amounts from encumbered to actual. One audit entry per batch.

## Responsive and accessibility

Desktop and tablet; mobile shows a read-only summary. Currency amounts always carry the ISO code.

## Related screens and navigation

080b, 080c, 107 exchange rates, 108 fiscal calendar, 085a commitment hygiene.

## Assumptions and open questions

- Partial matches (23) post as matched with the difference released; confirm or route them to the queue.
