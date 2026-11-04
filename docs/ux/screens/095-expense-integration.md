# 095 Expense-management integration (travel, expense and procurement)

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Admin > Integrations > Travel, expense and procurement (`/integrations/navan`, `/integrations/concur`, `/integrations/coupa`), in the connector frame of 092.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the connector frame of 092. Planned Stitch states, to be generated in a later session:

| State                                      | Planned image                                                       |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Concur overview (mock)                     | `design/stitch/095-expense-integration/default--desktop--light.png` |
| expense type to category mapping           | `mapping--desktop--light.png`                                       |
| expense hand-off settings                  | `hand-off--desktop--light.png`                                      |
| Coupa purchase orders waiting for a budget | `po-review--desktop--light.png`                                     |

## Purpose

Bring travel, expense and procurement spend into BudgetFlow (expense lines, travel bookings, purchase orders and supplier invoices), tagged with the event codes BudgetFlow pushes out, and let employees turn an approved request into a prefilled expense in the expense tool (117a), so spend is matched to budgets without double entry or wrong codes.

## Roles

Integration Admin (connect, map, schedule); Finance Admin (approves category mappings, reads); Finance Controller (reads; works duplicates and unmatched lines).

## Entry points

092 tiles; 080a actuals import "From expense tools"; 117a hand-off settings link; 99a duplicates "Source: expense".

## Content and actions

Connectors and what they exchange:

| Connector | Inbound                                            | Outbound                                              |
| --------- | -------------------------------------------------- | ----------------------------------------------------- |
| Navan     | expense lines and travel bookings with event codes | event codes, prefilled expenses (117a)                |
| Concur    | expense entries with event codes and attendees     | event codes as list values, prefilled expenses (117a) |
| Coupa     | purchase orders and supplier invoices              | event codes, approved commitments as reference ids    |

Overview (sample Concur, Mock): last sync 08:00; 126 expense lines imported into the actuals review (080a), 98 matched automatically by event code and cost center, 22 sent to the unmatched queue, 6 flagged as possible duplicates of card transactions (99a); event codes pushed today 3; prefilled expenses created this week 14 (submitted 11, approved 9).

Mappings: expense types to BudgetFlow categories (Meals - team to Team lunch; Entertainment - client to Entertainment with client attendees, 072a); attendee fields to employee or client counts (used by 080g and 072a); employee ids to people; event code field.

Sync: expense lines every 2 hours (source `expense` or `travel`); Coupa purchase orders hourly; supplier invoices daily (source `ap`).

Coupa purchase orders: orders that carry a BudgetFlow commitment or request id link to that commitment (no new encumbrance); orders without one wait in a "Purchase orders to assign" list (budget, event, amount) and create a commitment only when finance assigns them, through the normal rules.

Expense hand-off (117a) settings: on or off; target tool (Concur or Navan); fields sent (request id, event code, cost center, expense type from the category mapping, amount and currency, merchant if known); status sync back (Submitted, Approved, Paid).

## Data and permissions

Lines enter as import batches into the 080a review with source references (unique per source), currency triplet at the locked plan rate, attendees and tax lines; cross-source duplicates are flagged before matching (99a). Purchase orders link or create commitments through the P5 commitments API. `integration.manage` to configure; category mapping changes need `master_data.manage` (Finance Admin). Prefilled expenses are created with the employee's linked identity in the expense tool; BudgetFlow never submits an expense on someone's behalf.

## States

| State           | Behaviour                                                                         |
| --------------- | --------------------------------------------------------------------------------- |
| Picker          | three connectors with what they exchange; Mock available                          |
| Overview        | as above                                                                          |
| Mapping gaps    | warning "3 expense types have no category; their lines go to the unmatched queue" |
| POs to assign   | list with Assign (budget, event) and Ignore with reason                           |
| Hand-off off    | 117a shows "Copy details" instead of "Create expense"                             |
| Loading / error | `sat-ghost`; provider errors go to 100                                            |

## Budget safety and audit

Expense and invoice lines become actuals only through the 080a review (matched once, duplicates flagged first); purchase orders never double-encumber a commitment that already exists. Mapping and setting changes are audited; every imported line keeps its source reference and sync run.

## Responsive and accessibility

Desktop and tablet; mobile read-only overview. Tables have headers; direction is written as Inbound or Outbound.

## Satori components

Connector frame from 092; `mat-table` with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag`, `sat-banner`, `sat-ghost`; Angular Material select, slide toggles, dialog (assign purchase order), snackbar.

## Related screens and navigation

117a expense hand-off, 080a actuals import, 080b unmatched queue, 99a cross-source duplicates, 99b event-code push, 072a gifts and entertainment, 080g tax-aware consumption, 051 commitments, 100 errors.

## Decisions taken

- Purchase orders from procurement link to existing BudgetFlow commitments by reference; orders without a reference wait for finance to assign them, so nothing is encumbered twice. Recommended because double encumbrance would understate available budget.
- Expense hand-off creates a draft expense for the employee to submit in their tool; BudgetFlow never submits expenses for people.
- Client attendee information from expense tools feeds the entertainment and tax rules (072a, 080g).
