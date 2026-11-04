# 088a One-click evidence pack

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. "Evidence pack" dialog on event details (046), budget details (021), 053, 054 and 088; list page Insights > Audit > Evidence packs (`/audit/evidence-packs`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the 088 audit log language. Planned Stitch states, to be generated in a later session:

| State                          | Planned image                                                  |
| ------------------------------ | -------------------------------------------------------------- |
| generate dialog                | `design/stitch/088a-evidence-pack/default--desktop--light.png` |
| generating (job progress)      | `generating--desktop--light.png`                               |
| ready with verification result | `ready--desktop--light.png`                                    |
| evidence packs list            | `list--desktop--light.png`                                     |
| audit chain broken warning     | `chain-broken--desktop--light.png`                             |

## Purpose

Give an auditor or controller everything about one event or budget in a single download (figures, approvals with the rules and limits that applied, the audit trail with a verified hash chain, contributions, recharges, commitments, actuals with their receipts, reconciliation and exceptions), instead of reconstructing it from email and screenshots.

## Roles

Auditor, Finance Controller and Finance Admin (generate and download). CEO can download packs others generated for budgets in scope. Owners and organizers do not generate packs.

## Entry points

046 and 021 overflow "Evidence pack"; 053 and 054 "Evidence pack" after close; 088 audit log filtered to one object, "Evidence pack for this event"; list page.

## Content and actions

Generate dialog (sample Offsite 2026, EVT-2026-0087):

- Subject (prefilled, changeable to another event or budget the user can read); period (event lifetime 2 Sep to 5 Nov 2026; for budgets a fiscal year or range).
- Contents (checkboxes, all on except where noted):
  - Summary cover (PDF): figures, lifecycle timeline, funding sources, final cost, surplus returns, FX effect separately.
  - Approvals and decisions: each decision with approver, delegate if any, DoA limit at decision, rule versions and facts, channel (web, email, Slack, Teams, mobile), reason.
  - Audit trail extract with hash-chain verification.
  - Contributions (Inter-Director Budget Contribution Requests) and intercompany recharges with tax approval.
  - Commitments and selected quotes.
  - Actuals with receipts and invoices (documents).
  - Reconciliation and close record.
  - Exceptions and their resolutions (074a, 17a).
  - Comments (off by default).
  - "Include attendee details" (off by default: counts only; on adds names, entities and cost centers, never needs or survey answers).
- Format note: "A ZIP file with a PDF summary, CSV files and the original documents, plus a manifest with a SHA-256 fingerprint for every file."
- Buttons: Cancel, Generate (`satImportantButton`).

Generating: progress card "Collecting 214 audit entries, 46 actuals, 39 receipts" with steps; the user can leave; a notification arrives when ready (123).

Ready: "Evidence pack ready, 38.4 MB"; verification result "Audit chain verified: entries 18,204 to 18,417 intact"; Download (link valid 7 days); manifest preview (file, size, fingerprint).

List page: table of packs (subject, requested by, generated at, size, verification result tag, expires, Download, Regenerate); filter by subject type and requester.

## Data and permissions

Background job in the worker assembling data through existing read APIs: `listAuditEvents` and `verifyAuditChain` (audit contract), ledger and journals, approvals, contributions, recharges, commitments, actuals, documents from `DocumentStore`, exceptions and integrity flags. The pack is stored in `DocumentStore` with a 7-day expiry. New action `evidence.generate` (integrator adds; granted to AUD, FC, FA at tenant scope); downloads require `audit.read`. The pack contains only data the requester may read; attendee details follow the toggle.

## States

| State        | Behaviour                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Dialog       | as above                                                                                                                                 |
| Generating   | as above; Cancel stops the job                                                                                                           |
| Ready        | as above                                                                                                                                 |
| Chain broken | pack still generated; error banner and cover page note "Audit chain verification failed at entry 18,350. See the audit log." linking 088 |
| Too large    | above 2 GB of documents: warning "Split by month?" with options                                                                          |
| Expired      | list row "Expired" with Regenerate                                                                                                       |
| Failed       | error card with the failed step and Retry                                                                                                |
| Empty list   | "No evidence packs yet" with guidance to open an event or budget                                                                         |
| Forbidden    | `sat-403-error-state` for roles without `evidence.generate`                                                                              |

## Budget safety and audit

The pack is read-only evidence; it moves no money. Generation and every download are audited (who, subject, contents chosen, fingerprint of the manifest). The cover page keeps the design-system distinctions in text: pending versus committed versus actual, transaction currency versus USD at the locked plan rate, FX effect separately.

## Responsive and accessibility

Desktop and tablet; mobile can download ready packs from the list. Checkboxes are grouped with a legend; the progress card announces each finished step. The PDF summary is tagged for screen readers.

## Satori components

`sat-header-bar`, `mat-table` with `satTableWithRowStates`, `sat-status-tag` (Verified, Chain broken, Expired), `sat-banner`, `satImportantButton` (Generate), `sat-empty-state`, `sat-ghost`, `sat-403-error-state`; Angular Material dialog, checkboxes, progress bar, snackbar.

## Related screens and navigation

088 audit log, 046 event details, 021 budget details, 053 reconciliation, 054 close event, 090 approval history, 17a exceptions, 053a recharges, 121 documents, 123 notifications.

## Decisions taken

- Packs are generated by Auditor, Finance Controller and Finance Admin only; owners use reports and exports. Recommended because a pack bundles documents and decisions across several owners.
- Attendee details and comments are excluded by default; needs and survey answers are never included.
- A broken audit chain does not stop the pack; it is flagged on the cover and in the result, because the auditor needs to see it.
- Download links expire after 7 days; packs can be regenerated at any time from current data.
