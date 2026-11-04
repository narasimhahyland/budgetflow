# 052 Event supporting documents

Status: proposed - awaiting user review. Light theme only. UX Phase 4-7 track, batch 2. Build phase P5. "Documents" tab of 046.

## Design

| State                    | Image                                                           | Stitch screen                      |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------- |
| default (preview drawer) | `design/stitch/052-event-documents/default--desktop--light.png` | `3597ebf4acbc4f1a8faaaa1bfc7fa245` |

## Purpose

Keep quotes, contracts, invoices, receipts and attendee lists with the event and link each to the commitment or actual it supports.

## Roles

Organizer and co-organizers upload; approvers, funding owners, Finance Controller and auditors read.

## Entry points

046 tab Documents; 051 row menu "Attach"; 121 upload receipt.

## Content and actions

Upload area (`sat-upload-area`) with allowed types and size. Filter chips by type; search. Table: Document, Type, Linked to (commitment, actual or event; "Not linked" warning), Uploaded by, Date, Checks (scanned, approval evidence, matched to actual). Preview drawer: thumbnail, metadata, Download, Replace, Remove (disabled when linked to an approved commitment, with the reason).

## Data and permissions

Files stored through `DocumentStore` (MinIO) with company-scoped keys; short-lived signed download links; MIME allowlist and size limit checked server-side; content scan before download is allowed.

## States

Uploading (progress per file); scan pending (info tag, download disabled); rejected type or size (inline error on the file row); scan failed (error tag, file quarantined). Empty: upload area only.

## Budget safety and audit

Documents never change amounts. Upload, replace and remove are audited; replacing evidence for an approved commitment keeps the previous version.

## Responsive and accessibility

Mobile: camera upload option; list instead of table. Upload area is keyboard operable with a visible "browse" button.

## Related screens and navigation

046, 051, 060, 121, 088.

## Assumptions and open questions

- Stitch added an "SHA-256 intact" line and a vendor name variant ("Lakeview Banquets"); use the commitment's vendor name, and no hash line.
