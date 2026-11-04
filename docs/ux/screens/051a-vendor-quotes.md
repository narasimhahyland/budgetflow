# 051a Vendor quotes: request, compare, select

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 9 batch. Build phase P9. Event details (046) new tab "Quotes" (`/events/:eventId/quotes`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the 046 frame and the commitment language of 051. Planned Stitch states, to be generated in a later session:

| State                            | Planned image                                                  |
| -------------------------------- | -------------------------------------------------------------- |
| compare three quotes             | `design/stitch/051a-vendor-quotes/default--desktop--light.png` |
| request quotes dialog            | `request-dialog--desktop--light.png`                           |
| select quote, commitment preview | `select-dialog--desktop--light.png`                            |
| quote above available (blocked)  | `blocked--desktop--light.png`                                  |
| empty (no quote requests)        | `empty--desktop--light.png`                                    |

## Purpose

Move quotes out of email: ask approved vendors for a price, compare the answers side by side in the transaction currency and in USD at the locked plan rate, and select one to create the commitment in the same step, so spend is committed (and visible to every co-funder) when the decision is made rather than when the invoice arrives.

## Roles

Event Organizer and co-organizers (request, record, compare, select); owning budget owner (approves the resulting commitment when above the organizer's limit); contributing owners and Finance Controller (read).

## Entry points

046 tab "Quotes"; 46b task "Choose caterer"; 043 attention "3 catering quotes are waiting for a decision"; 45a template preferred vendors.

## Content and actions

Sample: Hyderabad townhall (EVT-2026-0105, 5 Dec 2026, Hyderabad), organizer Lakshmi Rao, owning budget Hyderabad Events (Suresh Menon). Funded USD 4,200.00; committed USD 350.00 (AV); "Available under this event's rules" USD 3,850.00.

- Quote requests list (left): "Catering for 150 people" (3 of 3 received, respond by 12 Nov); "Stage and sound" (1 of 2 received). "Request quotes" button.
- Request quotes dialog: what (title, description; "Include dietary counts from Needs" adds the 47b counts), quantity or attendees (150), needed by (5 Dec), respond by (12 Nov), vendors (multi-select from the vendor master: Preferred and Approved listed first; Blocked vendors shown disabled with "Blocked by vendor controls"; "Vendor not listed" opens a request to add the vendor in 106c), "Email the request to the vendors" (on: sends the request with a reply address; vendors never sign in), Send.
- Compare table for "Catering for 150 people" (columns per vendor, rows per attribute):

| Attribute      | Spice Route Caterers                | Deccan Kitchen Co                       | Green Leaf Catering             |
| -------------- | ----------------------------------- | --------------------------------------- | ------------------------------- |
| Vendor status  | Preferred                           | Approved                                | Approved                        |
| Total          | INR 3,00,600.00 = USD 3,600.00      | INR 2,79,000.00 = USD 3,341.32 (lowest) | INR 3,34,000.00 = USD 4,000.00  |
| Per head       | USD 24.00                           | USD 22.28                               | USD 26.67                       |
| Deposit        | 20%, non-refundable within 7 days   | 30%, refundable                         | 25%, non-refundable             |
| Cancellation   | free until 28 Nov                   | free until 25 Nov                       | free until 1 Dec                |
| Valid until    | 20 Nov 2026                         | 15 Nov 2026                             | 30 Nov 2026                     |
| Includes       | GST, service, live counter          | GST, service                            | GST, service, two live counters |
| Policy check   | within the USD 30.00 per-head limit | within limit                            | above available (see below)     |
| Quote document | PDF                                 | PDF                                     | PDF                             |

- Each column: "Select this quote" (`satImportantButton`), Decline, row menu Edit or Replace document. "Add a quote" records a quote received outside BudgetFlow (vendor, amount, currency, validity, terms, document upload).

Select dialog (Spice Route Caterers):

- Commitment to be created: "PO-2026-0251 Catering, Spice Route Caterers, USD 3,600.00 (INR 3,00,600.00 at the FY2026 plan rate), service 5 Dec 2026, deposit INR 60,120.00."
- Funding lines by the current split (049): Hyderabad Events USD 3,600.00 (100%).
- Impact: "Available under this event's rules: USD 3,850.00 now, USD 250.00 after."
- Approval: "Needs approval by Suresh Menon: above your USD 2,500.00 commitment limit. It is held as pending until then."
- Reason (required because this is not the lowest quote): "Preferred vendor; includes the live counter the lowest quote does not."
- "Tell the other vendors they were not selected" (on).
- Buttons: Cancel, "Select and create commitment".

## Data and permissions

New P9 data (`event_quotes` per the phase handoff, `events.ts` extension): quote requests (event, title, details, quantity, needed by, respond by, vendors invited, emailed) and quotes (request, vendor, amount and currency, USD at the locked plan rate, per head, deposit, refundability, cancellation terms, valid until, document id, status Requested, Received, Selected, Declined, Expired). `event.manage` to request, record and select. Selecting calls the P5 commitments API: a pre-encumbrance is posted immediately (held as pending), routed for approval by the rules and DoA when above the organizer's limit, and becomes encumbered on approval; the quote links to the commitment. Vendors must be Approved or Preferred in the vendor master (073a, 106c) to be selected (`VENDOR_NOT_APPROVED`). The API rejects a selection above available (`EXCEEDS_EVENT_AVAILABLE`) and an expired quote (`QUOTE_EXPIRED`).

## States

| State               | Behaviour                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty               | `sat-empty-state` "No quotes yet" with "Request quotes" and the template's preferred vendors as suggestions                                                     |
| Request dialog      | as above                                                                                                                                                        |
| Waiting             | request row "1 of 3 received"; reminder to vendors on the respond-by date                                                                                       |
| Compare             | as above; lowest marked with text "(lowest)", preferred with its tag                                                                                            |
| Select dialog       | as above                                                                                                                                                        |
| Above available     | column flagged in the error tone "Exceeds available by USD 150.00"; Select disabled with links "Request additional funds" (057) and "Request co-funding" (056a) |
| Expired             | column greyed "Expired on 15 Nov"; Select disabled with "Ask the vendor to confirm the price"                                                                   |
| Vendor not approved | "Waiting for finance to approve this vendor" (106c); Select disabled                                                                                            |
| Selected            | success banner "Spice Route Caterers selected. PO-2026-0251 waits for Suresh Menon's approval." Others Declined                                                 |
| Loading / error     | `sat-ghost` table; failed selection leaves nothing committed and shows the API detail                                                                           |

## Budget safety and audit

Quotes never consume budget; only selection posts a pre-encumbrance (pending, hatched warning swatch) that becomes encumbered (solid) on approval. Transaction currency and USD at the locked plan rate are shown side by side; FX never consumes budget. Selection, decline, quote edits and vendor emails are audited; the selection entry records the reason, the quotes compared and the commitment created.

## Responsive and accessibility

Tablet: compare table scrolls horizontally with the attribute column pinned. Mobile: one card per quote with Select at the bottom; request dialog full screen. The compare table has row headers; "lowest" and "preferred" are written, not only highlighted.

## Satori components

`sat-navigation-tabs` (046 tabs incl. Quotes), `mat-table` (compare grid with row headers), `sat-status-tag` (vendor status, quote status), `sat-banner` (selected, above available), `satImportantButton` (Select), `sat-upload-field` (quote document), `sat-rich-tooltip` (USD conversion at the plan rate), `sat-empty-state`, `sat-ghost`; Angular Material dialog, form fields, autocomplete (vendors), datepicker, slide toggle, snackbar; `bf-money`.

## Related screens and navigation

051 event commitments, 046 event details, 049 cost split, 057 additional funds, 056a co-funding request, 073a vendor controls, 106c vendor master, 47b needs (dietary counts), 46b checklist, 121 documents, 45b event planning copilot (P15).

## Decisions taken

- Selecting a quote creates the commitment as a pending pre-encumbrance immediately and routes it for approval when above the organizer's limit. Recommended so co-funders see committed spend at decision time.
- Only Approved or Preferred vendors can be selected; quotes from other vendors can be recorded and compared while finance reviews the vendor.
- Vendors receive quote requests by email and never sign in; organizers record or upload their answers.
- Choosing a quote that is not the lowest requires a written reason, kept in the audit entry.
