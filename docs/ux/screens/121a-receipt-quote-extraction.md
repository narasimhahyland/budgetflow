# 121a Receipt and quote extraction

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 13 batch. Build phase P13. Extends the details step of 121 upload receipt, the 59b mobile receipt review and the 51a "Add a quote" dialog; finance sees extracted values in the 080b match drawer.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a), the 121 upload steps and the AI output pattern of 11a. Planned Stitch states, to be generated in a later session:

| State                                    | Planned image                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| receipt fields filled, checked by person | `design/stitch/121a-receipt-quote-extraction/default--desktop--light.png` |
| low-confidence fields to check           | `check-fields--desktop--light.png`                                        |
| unreadable receipt                       | `unreadable--desktop--light.png`                                          |
| quote extraction in 51a                  | `quote--desktop--light.png`                                               |
| mobile receipt review (59b)              | `default--mobile--light.png`                                              |

## Purpose

Remove typing from receipts and quotes: after a file is uploaded and verified, read the merchant or vendor, date, total, currency, tax lines and, for quotes, validity, deposit and cancellation terms, prefill the form for the person to check, and compare the result with what was approved, while the person stays responsible for the values saved.

## Roles

Employees and Event Organizers uploading receipts for their own requests and events (121, 59b); organizers recording quotes (51a); Finance Admin and Finance Controller see extracted values next to actuals (080b); approvers see the confirmed receipt values (060).

## Entry points

121 after the file is verified; 59b receipt capture after the photo is taken; 51a "Add a quote" after the quote document is uploaded; 052 event documents "Read details from file" on an existing receipt or invoice.

## Content and actions

Receipt (121 details step, sample Kavya Shah, REQ-2026-0145 Team lunch Q4, approved USD 57.49):

- Banner: "We read these details from your receipt. Check them before you upload." with AI tag.
- Fields, each with an "AI-filled" marker until the person edits or confirms it: merchant "Cafe Mocha, Indiranagar"; receipt date 18 Oct 2026; total INR 4,560.00 (= USD 54.61 at the FY2026 plan rate); tax "GST INR 217.14 included"; payment method "Card payment" (card digits are dropped, never shown or stored).
- Comparison line from 121: "USD 2.88 less than approved. The rest returns to the budget when finance matches the receipt."
- Preview of the receipt beside the fields with the read areas outlined (merchant, date, total); clicking a field highlights its area.
- Checkbox "I've checked these details" (required when any field is AI-filled); Upload receipt.

Low-confidence fields are left empty and marked "Please check: we couldn't read this clearly", never guessed.

Quote (51a "Add a quote", sample Deccan Kitchen Co quote PDF for Hyderabad townhall catering):

- Fields: vendor "Deccan Kitchen Co" matched to the vendor master (Approved); total INR 2,79,000.00 (USD 3,341.32); per head USD 22.28 for 150; includes "GST, service"; deposit 30%, refundable; cancellation "free until 25 Nov"; valid until 15 Nov 2026.
- Unmatched vendor: "Vendor not in the vendor master" with "Request to add vendor" (106c), as in 51a.
- In the compare table, AI-filled cells keep a small marker until the organizer confirms the quote with "Confirm details".

Finance (080b match drawer): "Receipt says INR 4,560.00 on 18 Oct (confirmed by Kavya Shah)" next to the card line, with a mismatch warning when the receipt and the actual differ by more than 1%.

## Data and permissions

After the 121 upload is verified (size and file signature), `libs/api/ai` sends the document to the provider through `AiProvider` with the extraction schema; output is parsed against a zod schema, values outside it are dropped, and each field carries a confidence; card numbers, signatures and contact details are discarded and never stored. Extraction results are kept as document metadata (`ai.ts`: field, value, confidence, model id and version); the values saved on the receipt or quote are always the ones the person confirmed. Only the uploader (and finance for receipts in their scope) sees extracted values. Each extraction writes an `ai_query_log` row. Evaluation threshold: field accuracy at least 0.95 for totals and dates (113a Accuracy).

## States

| State            | Behaviour                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Reading          | "Reading your receipt..." up to 10 seconds with Skip ("Enter details yourself")                                      |
| Filled           | fields as above, AI-filled markers, check box required                                                               |
| Check fields     | warning banner "2 fields need checking" with the empty fields focused in order                                       |
| Unreadable       | info banner "We couldn't read this receipt. Enter the details yourself." (blurred, handwritten or non-receipt files) |
| Several receipts | "This file looks like more than one receipt. Upload one receipt at a time." (multi-page single receipts are fine)    |
| Currency         | receipts in GBP, EUR or INR show the USD amount at the locked plan rate below the total                              |
| Above approved   | 121's soft warning "Receipt is USD 6.20 more than approved..." based on the confirmed total                          |
| Edited           | marker removed from fields the person changed; the audit records which fields were edited                            |
| AI off           | 121, 59b and 51a work as before with manual entry                                                                    |
| Unavailable      | shared AI banner; manual entry immediately                                                                           |

## Budget safety and audit

Extracted values never post money: receipts are evidence, and finance matching (080b, 80f) turns actuals into consumption; quotes create commitments only through 51a's "Select this quote" with its own checks. The upload's audit entry records that extraction was used (model id and version) and which fields the person confirmed or edited, never the file content.

## Responsive and accessibility

Mobile (59b): the photo preview above the fields; fields stack; the check box sits above the sticky Upload button. Markers are text ("AI-filled"), not colour; outlined read areas have a text equivalent in the field label ("Read from the top of the receipt").

## Satori components

`sat-banner`, `sat-tag` (AI, "AI-filled" marker), `sat-upload-area` (from 121), `sat-ghost` (reading), `sat-status-tag` (vendor status); Angular Material form fields, checkbox, datepicker, dialog (51a), snackbar; `bf-money`.

## Related screens and navigation

121 upload receipt, 59b mobile receipts, 51a vendor quotes, 052 event documents, 080b unmatched queue, 80f matching suggestions, 17c anomaly flags (receipt reused), 106c vendor master, 113a AI settings.

## Decisions taken

- Extraction fills fields; the person checks and confirms them, and only confirmed values are saved. Recommended because the uploader is accountable for the receipt they submit.
- Fields the model is unsure about are left empty and marked for checking instead of guessed.
- One receipt per upload; multi-page receipts are allowed, several receipts in one photo are not.
- Card numbers, signatures and contact details read from receipts are discarded and never stored.
- Finance sees the confirmed receipt values next to the card line, with a mismatch warning above 1%.
