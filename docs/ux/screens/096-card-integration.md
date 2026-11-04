# 096 Corporate-card integration

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Admin > Integrations > Corporate cards (`/integrations/brex`, `/integrations/ramp`), in the connector frame of 092.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the connector frame of 092. Planned Stitch states, to be generated in a later session:

| State                                  | Planned image                                                    |
| -------------------------------------- | ---------------------------------------------------------------- |
| Ramp overview (mock)                   | `design/stitch/096-card-integration/default--desktop--light.png` |
| card program to budget mapping         | `mapping--desktop--light.png`                                    |
| card-limit push settings               | `limit-push--desktop--light.png`                                 |
| turn on card-limit push (confirmation) | `limit-push-dialog--desktop--light.png`                          |

## Purpose

Import card transactions so card spend reaches budgets the same day, and optionally push approved commitments into card limits, so a BudgetFlow approval becomes spending power on the organizer's card for exactly the approved amount and period, and controls are not only advisory.

## Roles

Integration Admin (connect, map, settings); Finance Admin (turns card-limit push on or off, approves mappings); Finance Controller (read).

## Entry points

092 card tiles; 080a actuals import "From card feed"; 051 commitment detail "Card limit"; 99b push status.

## Content and actions

Connectors: Brex (transactions; spend limits) and Ramp (transactions; funds with limits, can be suspended).

Overview (sample Ramp, Mock): transactions every hour; last sync 10:00, 58 transactions imported into the actuals review, 51 matched by event code or card program; card-limit push: Off.

Mappings: card programs or spend programs to budgets or event types (for example "Team events - India" to Bengaluru Events and Hyderabad Events by cardholder location); cardholders to people; merchant category codes to categories; the event code field on transactions.

Card-limit push (company setting, Off by default; Finance Admin):

- When on: approving a commitment marked "Paid by card" creates a limit on the organizer's card for the approved amount, valid from the approval to the service end plus 7 days, tagged with the event code and commitment id.
- Changes follow the commitment: amount changes update the limit; release or cancellation closes it; consumption is tracked from matched transactions.
- Controls (freeze, reduce, set to zero) block new requests and therefore new limits; limits for commitments that were already approved continue, matching the rule that existing commitments can complete.
- Provider differences listed: Ramp supports suspend and close; Brex limits are lowered to the amount spent instead of suspended.
- Turning on opens a confirmation: "From now on, approved card commitments create card limits. 14 open card commitments can get limits now (USD 6,850.00 in total): Create now or Only new ones."

## Data and permissions

Transactions enter as import batches into the 080a review (source `card`, unique source reference, currency triplet at the locked plan rate). Limit pushes are outbox messages per commitment with idempotency keys; their status appears in 99b; failures retry with backoff and land in 100. `integration.manage` to configure mappings; the card-limit push setting needs `tenant.settings.manage` or `master_data.manage` (Finance Admin). Pushed limits never exceed the approved commitment amount converted at the locked plan rate into the card currency.

## States

| State            | Behaviour                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Picker           | Brex, Ramp with what they support; Mock available                                           |
| Overview         | as above                                                                                    |
| Push off         | info "Card limits are not changed by BudgetFlow"                                            |
| Push on          | success tag "Card-limit push on since 4 Nov" with counts of live limits                     |
| Turn-on dialog   | as above                                                                                    |
| Unmapped program | warning "Program 'Offsite cards' has no budget; its transactions go to the unmatched queue" |
| Loading / error  | `sat-ghost`; provider errors go to 100                                                      |

## Budget safety and audit

Card limits follow approved commitments only; nothing in BudgetFlow raises a limit above an approval. Transactions become actuals through the 080a review, matched once, with cross-source duplicates (card versus expense report) flagged first (99a). Setting changes, mapping changes and every limit push (create, update, close) are audited.

## Responsive and accessibility

Desktop and tablet; mobile read-only overview. Settings use switches with visible labels and descriptions.

## Satori components

Connector frame from 092; `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-rich-tooltip` (provider differences), `sat-ghost`; Angular Material slide toggle, dialog (turn on), select, snackbar.

## Related screens and navigation

99b event-code and card-limit push, 051 commitments, 085a commitment hygiene, 080a actuals import, 99a duplicates, 027 freeze, 028 set to zero, 100 errors.

## Decisions taken

- Card-limit push is a company setting, off by default; Finance Admin turns it on. Recommended because it changes spending power outside BudgetFlow.
- Limits equal the approved commitment and expire 7 days after the service end; release or cancellation closes them.
- Freeze, reduce and set to zero stop new limits but do not cut limits of commitments already approved, consistent with the rule that existing commitments complete.
- Turning push on asks whether to create limits for existing open card commitments or only new ones.
