# 047d Remote and hybrid participation

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 15 batch. Build phase P15. Event details (046) tab "People", sub-tab Remote (`/events/:eventId/people/remote`); employee choice page from the invitation (`/invitations/:invitationId/remote`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), 047a invitations and 049 cost split. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                                |
| ------------------------------- | ---------------------------------------------------------------------------- |
| remote options and participants | `design/stitch/047d-remote-hybrid-participation/default--desktop--light.png` |
| employee chooses an option      | `choose--mobile--light.png`                                                  |
| kit orders and delivery status  | `kits--desktop--light.png`                                                   |
| over the per-person cap         | `cap-warning--desktop--light.png`                                            |

## Purpose

Include people who cannot be in the room (remote staff and colleagues at other offices) with an equivalent experience funded from the same event: an online link, a kit or gift delivered through a partner, or a meal allowance, with costs split to each remote person's employing entity and per-person caps respected.

## Roles

Event Organizers and co-organizers (set options, order kits); remote employees (choose an option, give a delivery address when needed); contributing owners and finance see the cost split (049).

## Entry points

046 People tab "Remote"; 045 wizard "Hybrid event"; 47a invitation "Can't come in person? Join remotely"; 92d marketplace "Kits and gifts"; 115 employee home invitation card.

## Content and actions

Options (organizer, sample Year-end celebration, EVT-2026-0140, Bengaluru and Hyderabad, 11 Dec 2026, hybrid):

- Join online: meeting link added to the calendar invite (097), no cost.
- Celebration kit via partner: "Kindly Gifts - snack and team kit", USD 35.00 per person including delivery, order by 1 Dec, delivery in India, United States and United Kingdom.
- Meal allowance: USD 20.00 per person, claimed with a receipt through the expense hand-off (117a) or the wallet (120b), within 3 days of the event.
- Each option: cost per person in USD (local currency shown), deadline, countries, "Counts toward the per-person yearly cap" note.

Remote participants table: person, location or "Remote", employing entity and cost center, choice, status (Not chosen, Online, Kit ordered, Shipped, Delivered, Allowance claimed), cost. Samples: Emma Clarke, London, UK01, Kit, Delivered, USD 35.00; Tom Reilly, Westlake, US01, Allowance, Claimed USD 18.40.

Kit orders: "Order kits for 14 people" sends one order through the partner (92d) and creates a commitment for USD 490.00 through the normal path (pending until approved if above the organizer's limit); delivery statuses come back from the partner.

Employee choice page: options as cards with what is included and deadlines; kit choice asks for a delivery address (with "Used only for this delivery and deleted 30 days after delivery"); Submit.

Cost summary: remote cost USD 1,120.00 of the event's USD 12,000.00 cap; split by employing entity (IN01 USD 420.00, US01 USD 380.00, UK01 USD 320.00) feeding 049.

## Data and permissions

Extends P5 `event_participants` with participation mode (in person, online, kit, allowance) and P9 invitations; kit orders go through the marketplace partner adapter (92d) and create commitments with one funding line per contributor (049 split by the remote person's employing entity and cost center); allowances become actuals through 117a or 120b claims. Delivery addresses are stored encrypted, visible only to the organizer and the partner, and deleted 30 days after delivery. Gifts and kits count toward per-person caps and benefit-in-kind thresholds (80h) and follow the gifts policy (072a). `event.manage` scope for organizers; employees act on their own choice.

## States

| State              | Behaviour                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default            | options and table                                                                                                                                       |
| Not chosen         | reminder "6 remote people haven't chosen" with Remind                                                                                                   |
| Past deadline      | kit option closed: "Kit orders closed on 1 Dec; online and allowance still open"                                                                        |
| Cap warning        | warning "Emma Clarke would pass the UK01 GBP 150.00 yearly gift threshold (80h)" with "Offer online only" or "Continue (reported as a taxable benefit)" |
| Country not served | "Kits can't be delivered to Germany by this partner" with the allowance offered instead                                                                 |
| Order pending      | warning tag "Commitment waiting for Anand Kumar's approval"                                                                                             |
| Delivered          | success tag per person; delivery date                                                                                                                   |
| Loading / error    | `sat-ghost`; error banner with Retry                                                                                                                    |

## Budget safety and audit

Remote costs are commitments and actuals like any other event cost: kit orders are committed through the normal approval path; allowances become actuals only when matched. Costs split by each remote person's employing entity, and cross-entity shares follow the intercompany policy. Options, orders and choices are audited; addresses never appear in audit entries.

## Responsive and accessibility

The employee choice page is mobile first. Statuses are words with icons; the address form has autocomplete hints and clear labels.

## Satori components

`sat-interactive-card` (options), `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-empty-state`, `sat-ghost`, `satImportantButton` (Order kits); Angular Material form fields, radio group, dialog, snackbar; `bf-money`.

## Related screens and navigation

047 participants, 047a invitations, 049 cost split, 051 commitments, 92d partner marketplace, 117a expense hand-off, 120b wallets, 072a gifts policy, 080h benefit ledger, 097 calendar integration.

## Decisions taken

- Remote people choose from options the organizer sets: online, a partner kit, or a meal allowance claimed with a receipt; there is no cash. Recommended so remote staff are included with the same controls as in-person spend.
- Remote costs split by the remote person's employing entity and cost center, like in-person attendees.
- Delivery addresses are used only for the delivery and deleted 30 days after it, matching the attendee-needs rule.
- Kits and gifts count toward per-person caps and taxable-benefit thresholds, with a warning before an order passes them.
