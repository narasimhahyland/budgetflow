# 110 Document and attachment settings

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Settings > Documents and attachments (`/admin/documents`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the settings layout of 102. Planned Stitch states, to be generated in a later session:

| State                  | Planned image                                                                |
| ---------------------- | ---------------------------------------------------------------------------- |
| rules by document kind | `design/stitch/110-document-attachment-settings/default--desktop--light.png` |
| storage usage          | `storage--desktop--light.png`                                                |
| edit kind rules        | `edit--desktop--light.png`                                                   |

## Purpose

Decide which files people may attach to requests, events, commitments and imports, how large they may be, who may view and download them, and see how much evidence BudgetFlow holds, so receipts and quotes are kept consistently and safely without anyone sharing files outside the product.

## Roles

Organization Admin and Finance Admin (edit); Auditor (read); Super Admin (storage health only).

## Entry points

Settings > Documents and attachments; 121 upload error "File type not allowed" (admins see "Change allowed types"); 111 data retention "Documents"; 054a gallery settings; 114 system health "Document store".

## Content and actions

Rules by document kind (table: kind, used on, allowed types, maximum size, who can view, download allowed, changed):

- Receipt: requests, commitments (121, 59b); PDF, PNG, JPEG; 10 MB; requester, approvers, budget owner, finance, auditors; download on.
- Invoice: commitments, actuals; PDF; 10 MB; budget owner, finance, auditors.
- Quotation: events, commitments (51a); PDF, PNG, JPEG; 10 MB; organizers, co-organizers, budget owner, finance.
- Supporting document: requests, events, budgets; PDF, PNG, JPEG, XLSX, CSV; 10 MB; same people as the parent record.
- Event photo: event gallery (54a); PNG, JPEG; 15 MB; event participants, organizers, contributing owners; download off.
- Import file: plan import (20a), actuals import (80a), headcount (22c); CSV, XLSX; 25 MB; the importing role and finance.
- Edit (side sheet per kind): allowed types (from a fixed safe list: PDF, PNG, JPEG, CSV, XLSX), maximum size (1-25 MB), download allowed, inline preview (on).

File checks (read-only): "Every file is checked for size and file signature before it becomes available; files that fail are rejected and never stored." Receipt requirements are policy, not storage: "Receipts are required by category policy (072) and post-spend checks (074a)."

Storage (cards): total 14.6 GB in the document store; by kind (receipts 9,820 files 6.1 GB, quotations 640 files 1.2 GB, photos 3,100 files 5.9 GB, imports 1.4 GB); growth last 90 days; "Retention removes files by the rules in 111"; Export storage report (CSV).

No sharing: "Files are only available inside BudgetFlow to people who can see the record. There are no public links."

## Data and permissions

New P14 `admin.ts` document settings per kind (allowed content types, max bytes, download flag, preview flag); enforced by the documents API (P5 `documents.ts` declare-upload and verify steps) and `DocumentStore` (MinIO locally). Visibility always follows the parent record's `PolicyService` scope; this page can only narrow downloads, never widen who can see. Signed download URLs are short-lived (5 minutes). `tenant.settings.manage` (Organization Admin) or `master_data.manage` (Finance Admin) to change; `tenant.read` to view. Changes apply to new uploads; existing files keep their stored type.

## States

| State           | Behaviour                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Default         | rules table, checks note, storage                                                              |
| Edit            | side sheet; Save                                                                               |
| Narrowing types | warning "PNG receipts will no longer be accepted. 2,140 existing PNG receipts stay available." |
| Validation      | "Choose at least one file type", "Maximum size is 25 MB"                                       |
| Storage warning | warning banner when the document store passes 80% of its configured capacity                   |
| Read only       | Auditor: no edit controls                                                                      |
| Loading / error | `sat-ghost`; error banner with Retry                                                           |

## Budget safety and audit

Documents are evidence and never move money. Rule changes are audited with old and new values. Every document download by a person is logged with the document, record and time, so auditors can see who opened evidence.

## Responsive and accessibility

Desktop and tablet; mobile read-only. Sizes are written in MB with the file count; storage bars carry their numbers as text.

## Satori components

`sat-header-bar`, `mat-table` with `satTableWithRowStates`, `satInlineChip` (types), `sat-interactive-card` (storage), `sat-banner`, `sat-ghost`; Angular Material side sheet, checkboxes, number field, slide toggles, snackbar.

## Related screens and navigation

121 upload receipt, 59b mobile receipts, 051a quotes, 052 event documents, 054a gallery, 020a, 080a and 022c imports, 111 data retention, 072 category policy, 074a post-spend exceptions, 114 system health.

## Decisions taken

- Allowed types come from a fixed safe list (PDF, PNG, JPEG, CSV, XLSX); there is no free-form file type. Recommended because document uploads are a common attack path.
- Who can see a document always follows the record it belongs to; this page can only restrict downloads.
- There are no public or external links to files.
- The maximum size can be raised to 25 MB at most; changes affect new uploads only.
- Downloads are logged for audit; views inside the product are not.
