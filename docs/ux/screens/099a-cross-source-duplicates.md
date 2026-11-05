# 099a Cross-source duplicate review

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Finance > Actuals and matching > Duplicates (`/finance/actuals/duplicates`); also linked from Integrations.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the queue and drawer of 080b. Planned Stitch states, to be generated in a later session:

| State                                 | Planned image                                                            |
| ------------------------------------- | ------------------------------------------------------------------------ |
| duplicate groups queue                | `design/stitch/099a-cross-source-duplicates/default--desktop--light.png` |
| side-by-side comparison drawer        | `compare--desktop--light.png`                                            |
| keep one, exclude the other (confirm) | `keep-one-dialog--desktop--light.png`                                    |
| empty queue                           | `empty--desktop--light.png`                                              |

## Purpose

Stop the same spend being counted twice when it arrives from more than one source (a card transaction and the expense report that itemizes it, a deposit paid by card and invoiced in accounts payable, a hotel booked in the travel tool and claimed again), by holding likely duplicates before they are matched and letting finance decide which line is the record.

## Roles

Finance Controller and Finance Admin (resolve); Integration Admin (reads, tunes auto-resolution rules with finance); budget owners see a "held as possible duplicate" note on affected lines.

## Entry points

Finance > Actuals and matching; 099 run detail "6 held as possible duplicates"; 080a import review counts; 012 and 017a exceptions tiles; 095 and 096 connector overviews.

## Content and actions

Header bar: title, Export (CSV, XLSX, PDF), "Auto-resolution rules". Filter chips: confidence (High, Medium), sources, legal entity, age, status (Open, Resolved).

Queue (one row per group): detected, confidence tag, pattern, sources, person, amount (transaction currency and USD), dates, status. Samples:

- High, "Card-paid expense itemization": Ramp card USD 86.40, Cafe Mocha, 12 Oct, Tom Reilly; Concur expense line USD 86.40, "Team coffee", 12 Oct, Tom Reilly, receipt attached.
- Medium, "Deposit paid by card and invoiced": ERPNext supplier invoice INR 60,120.00 Spice Route Caterers, 14 Nov; Ramp card INR 60,120.00 Spice Route, 14 Nov (USD 720.00 at the FY2026 plan rate).
- High, "Booked and claimed": Navan hotel GBP 220.00, London, 3 Nov, Emma Clarke; expense claim GBP 220.00, same hotel and date.

Comparison drawer: the lines side by side (source, source reference, accounting date, amount in transaction currency and USD at the locked plan rate, merchant, person, event code, cost center, receipt thumbnail, status in the source system) and the matching facts ("same amount, same person, 0 days apart, merchant names 92% similar").

Actions:

- Keep one (default suggestion follows the record precedence: ERP or AP line, then card, then expense or travel): the other line is excluded from consumption and linked to the kept one; "Move the receipt to the kept line" (on).
- Keep both: not duplicates, reason required (feeds detection tuning).
- Bulk: for High groups of the same pattern, "Resolve 12 like this".

Auto-resolution rules (Finance Admin and Integration Admin): "Expense lines that carry the card transaction id are itemizations of the card line" (on); "Travel bookings later claimed as expenses: keep the booking" (off until reviewed).

## Data and permissions

Detection runs on import across sources using the actuals duplicate key (amount, person or card, merchant, date window of 3 days) and raises `integrity_flags` of kind `cross_source_duplicate` (statuses open, acknowledged, resolved). Lines in an open group are held from auto-match; resolving sets the excluded line's match status to `excluded` with a link, never deleting it. `actuals.manage` (Finance Admin) or `ledger.reverse` scope (Finance Controller) to resolve; owners see only the hold note. If one line was already matched before detection, the other is held and the group asks whether a reversal is needed (posted as a reversal, never an edit).

## States

| State           | Behaviour                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Queue           | as above                                                                                                   |
| Compare         | drawer as above                                                                                            |
| Keep one dialog | which line stays, which is excluded, receipt move, reason code                                             |
| Already matched | warning "The card line is already matched to PO-2026-0251. Excluding it posts a reversal." with the amount |
| Resolved        | row tagged "Kept card line" or "Not duplicates" with who and when                                          |
| Empty           | success empty state "No possible duplicates"                                                               |
| Loading / error | `sat-ghost`; error banner with Retry                                                                       |

## Budget safety and audit

Held lines do not consume budget until resolved; an actual is matched once. Excluding a line that was already matched posts a reversal in an open period. Every resolution, bulk resolution and rule change is audited with the lines and facts.

## Responsive and accessibility

Desktop and tablet; mobile read-only queue. The comparison is a two-column table with row headers; confidence is a word, not a colour.

## Satori components

`sat-header-bar`, `satInteractiveTag` (filters), `mat-table` with `satTableWithRowStates` and `sat-selection-bar`, `sat-status-tag` (confidence, status), `sat-banner`, `sat-empty-state`, `sat-ghost`; Angular Material side sheet (compare), dialog (keep one, keep both), slide toggles (rules), snackbar; `bf-money`.

## Related screens and navigation

080a actuals import, 080b unmatched queue, 074a post-spend exceptions (duplicates within requests), 17a exceptions dashboard, 095 expense, 096 card, 094 ERP, 099 sync status, 088 audit log.

## Decisions taken

- Possible duplicates are held before matching and resolved by finance; nothing is merged automatically except the explicit itemization rule. Recommended because a wrong automatic merge hides real spend.
- The line closest to the general ledger is the default record (ERP or AP, then card, then expense or travel); the other is excluded and linked, never deleted.
- "Keep both" requires a reason so detection can be tuned.
- The card-paid itemization rule (expense line referencing the card transaction id) is on by default; other auto-rules start off.
