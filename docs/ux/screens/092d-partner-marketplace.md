# 092d Partner marketplace

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 16 batch. Build phase P16. Events > Marketplace (`/marketplace`, offer `/marketplace/:offerId`); partner management in Admin > Integrations > Partners (`/integrations/partners`, connector frame of 092).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the quotes of 51a and the connector frame of 092. Planned Stitch states, to be generated in a later session:

| State                            | Planned image                                                        |
| -------------------------------- | -------------------------------------------------------------------- |
| marketplace browse               | `design/stitch/092d-partner-marketplace/default--desktop--light.png` |
| offer detail and booking request | `offer--desktop--light.png`                                          |
| booking confirmed by the partner | `confirmed--desktop--light.png`                                      |
| partner management (admin)       | `partners--desktop--light.png`                                       |
| mobile browse                    | `default--mobile--light.png`                                         |

## Purpose

Bring bookings that would otherwise happen outside BudgetFlow (team experiences, catering, gifts and kits) into it: organizers browse offers from approved partners with prices per head in their city, request a booking that becomes a quote and then a commitment through the normal approval path, and partners send confirmations and invoices straight into BudgetFlow's review queues.

## Roles

Event Organizers and Location Managers (browse, request bookings); approvers (the resulting commitments follow normal routing); Finance Admin and Integration Admin (enable partners, link them to the vendor master, review partner feeds); managers and employees for gifts through 120a and 47d.

## Entry points

Events > Marketplace; 045b copilot "See partner offers"; 51a quotes "Request from a marketplace partner"; 47d remote kits; 120a reward choice "Partner catalogue"; 120b wallets "Book through a partner".

## Content and actions

Browse: filters (city: Bengaluru, Hyderabad, Westlake, London; category: experiences, catering, gifts and kits; people; price per head; date), offer cards (partner, title, price per head in local currency and USD at the FY2026 plan rate, capacity, rating from past Hyland events, vendor status Approved or Preferred). Samples (fictional partners):

- CityQuest Experiences, "Team treasure hunt, Bengaluru", INR 1,850.00 per head (USD 22.16), 20-120 people, rated 4.5 (4 events), Preferred.
- Fresh Plate Catering, "Festival buffet, Hyderabad", INR 1,400.00 per head (USD 16.77), 50-400 people, Approved.
- Kindly Gifts, "Snack and team kit", USD 35.00 per person including delivery (India, United States, United Kingdom), Approved.

Offer detail: what is included, cancellation and deposit terms, dietary options, delivery countries (gifts), photos, "Request booking" (event, date, people, notes; dietary counts from 47b added as totals).

Request booking: sends the request to the partner and creates a quote on the event (51a) with status "Waiting for partner"; when the partner responds with a price and availability, the organizer selects it in 51a, which creates the commitment (pending until approved by the usual route); the partner receives the confirmation only after approval.

Partner management (admin): partners list (name, categories, cities, linked vendor in 106c, contract status, connection status, mode Mock, Sandbox or Live), enable or pause, data shared ("Event date, city, number of people, dietary totals; delivery addresses only for gifts the recipient agreed to"), feeds (confirmations, changes, invoices) with links to the review queues (51a, 080a).

## Data and permissions

New P16 partner adapter on the P12 connector framework (`integration_connections`, mock partner services in Compose); offers cached from partner catalogues; booking requests and responses stored as 51a quotes; selection creates commitments through the P5 commitment path with funding lines from the event split (049). Partner invoices arrive as actuals in the 080a import review; changes and cancellations come in as notifications on the quote or commitment for the organizer to accept. Partners must be linked to an Approved or Preferred vendor in 106c. Organizers act with `event.manage`; partner setup needs `integration.manage` and Finance Admin's vendor link. No payments are processed in BudgetFlow.

## States

| State               | Behaviour                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Browse              | as above                                                                                              |
| No offers           | "No partner offers in Hyderabad for 400 people" with "Request quotes from vendors" (51a)              |
| Waiting for partner | info tag on the quote "Waiting for CityQuest Experiences (usually 1 business day)"                    |
| Partner declined    | quote marked "Not available on 13 Nov" with alternatives                                              |
| Pending approval    | commitment "Waiting for Anand Kumar"; the partner sees "Provisional"                                  |
| Confirmed           | success tag "Confirmed by partner"; booking reference                                                 |
| Partner change      | warning on the commitment "Partner changed the price to INR 1,950.00 per head" with Accept or Decline |
| Partner paused      | offers hidden; existing bookings continue                                                             |
| Loading / error     | `sat-ghost`; error banner with Retry                                                                  |

## Budget safety and audit

Every booking becomes a commitment only through 51a selection and normal approval, checked against "Available under this event's rules", per-head limits and vendor controls; partner feeds never post to the ledger directly and invoices go through the actuals review. Only aggregated attendee information is shared, and delivery addresses only with the recipient's consent. Partner enablement, booking requests, selections and partner changes are audited.

## Responsive and accessibility

Mobile browse with filter sheet; booking request works on mobile. Offer cards have the partner, title and price per head in their accessible name; ratings are numbers with counts.

## Satori components

`sat-interactive-card` (offers, partners), `satInteractiveTag` (filters), `sat-status-tag` (vendor status, booking status), `sat-banner`, `sat-empty-state`, `sat-ghost`, `satImportantButton` (Request booking), `sat-navigation-tabs` (admin connector frame); Angular Material dialog (booking request), side sheet (filters on mobile), snackbar; `bf-money`.

## Related screens and navigation

051a vendor quotes, 051 commitments, 049 cost split, 047b attendee needs, 047d remote participation, 120a recognition awards, 120b wallets, 45b planning copilot, 106c vendor master, 073a vendor controls, 080a actuals import, 092 integrations hub.

## Decisions taken

- Bookings follow the same path as any quote: request, partner response, selection in 51a, commitment and approval; the partner is confirmed only after approval. Recommended so marketplace spend has exactly the same controls as other spend.
- Partners must be linked to approved vendors in the vendor master.
- Partner confirmations, changes and invoices feed review queues; nothing posts to the ledger directly.
- Partners receive only aggregated attendee information; delivery addresses are shared only for gifts the recipient agreed to.
- BudgetFlow does not process payments; invoices are paid through the company's existing accounts payable.
