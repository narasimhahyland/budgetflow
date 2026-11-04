# 121 Upload receipt or document

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 5 employee batch. Build phase P5. Employee shell; also opens as a dialog from 119 and 120.

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/121-upload-receipt/default--desktop--light.png` (file chosen, details filled), `failed--desktop--light.png` (verification failed), `success--desktop--light.png`.

## Purpose

Attach a receipt, invoice, quotation or supporting file to a request (or an event or commitment the user organizes) safely, with the amount on the receipt compared to what was approved.

## Roles

Employee and Event Organizer for their own requests and events; approvers and finance read the files.

## Entry points

115 "Upload receipt" and task card; 119 "Upload receipt"; 120 row action; 052 event documents (organizers).

## Content and actions

- Step 1, choose what it is for: request select (prefilled "REQ-2026-0145 Team lunch Q4, approved USD 57.49"); document kind (Receipt, Invoice, Quotation, Supporting document).
- Step 2, file: `sat-upload-area` "Drop a file or browse" with the allowed types and size ("PDF, PNG, JPEG, CSV or XLSX, up to 10 MB"); after choosing: file chip with name, size, thumbnail preview, progress bar, Remove.
- Step 3, details (receipts and invoices): amount on the receipt with currency (INR 4,560.00 = USD 54.61 at the FY2026 plan rate), receipt date, merchant. Comparison line: "USD 2.88 less than approved. The rest returns to the budget when finance matches the receipt."
- Footer: Cancel, "Upload receipt".

## Data and permissions

Declare the upload (`POST` documents: owner type and id, kind, content type, size), upload to the signed URL, then verify (size and file signature checked server-side) before the document becomes available. Allowed types: PDF, PNG, JPEG, CSV, XLSX; maximum 10 MB. Uploaders must own or organize the request or event. Files are stored through `DocumentStore` (MinIO locally).

## States

| State                 | Behaviour                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Default               | as above                                                                                                     |
| Uploading             | progress bar with percentage and Cancel                                                                      |
| Verifying             | "Checking the file" with a spinner; the button is disabled                                                   |
| Failed                | error container "This file is not a valid PDF" or "File is larger than 10 MB"; choose another file           |
| Amount above approved | soft warning "Receipt is USD 6.20 more than approved. Your approver will be asked to accept the difference." |
| Success               | snackbar "Receipt added to REQ-2026-0145"; the task on 115 disappears; 119 shows the receipt                 |

## Budget safety and audit

Receipt amounts never post money; finance matching (080b) turns them into actuals. Transaction currency and USD at the plan rate side by side. One audit entry per verified upload (no file content in the audit).

## Responsive and accessibility

Mobile: camera capture offered by the file input; steps stack; sticky footer. The upload area is a labelled button reachable by keyboard; progress is announced.

## Related screens and navigation

115, 119, 120, 052 event documents, 080b unmatched queue.

## Assumptions and open questions

- Should employees enter the receipt amount, or should finance read it (receipt extraction is Phase 13, 121a)? Designed with an optional amount field.
