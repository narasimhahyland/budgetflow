# 100 Integration error and retry screen

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Admin > Integrations > Errors and retries (`/integrations/errors`, tabs Retrying and Dead letter).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the table language of 099. Planned Stitch states, to be generated in a later session:

| State                           | Planned image                                                            |
| ------------------------------- | ------------------------------------------------------------------------ |
| retrying queue                  | `design/stitch/100-integration-errors-retry/default--desktop--light.png` |
| dead letter with payload drawer | `dead-letter--desktop--light.png`                                        |
| discard dialog                  | `discard-dialog--desktop--light.png`                                     |
| empty (nothing failing)         | `empty--desktop--light.png`                                              |

## Purpose

Make integration failures visible and fixable: every message or record that failed (inbound or outbound) with the reason, how many times it was retried and when it retries next, and, once retries are exhausted, a dead letter where an admin can fix the cause and retry, or discard with a reason, without losing or duplicating data.

## Roles

Integration Admin (retry, edit mapping and retry, discard); Finance Admin and Auditor (read).

## Entry points

092 header badge; 099 failed runs; 99b failed pushes; connector Logs tab; notifications "3 messages moved to the dead letter".

## Content and actions

Header bar: title, counts (Retrying 3, Dead letter 1), Export (CSV, XLSX, PDF). Filter chips: connector, direction, error class (Authentication, Validation, Mapping, Rate limit, Provider unavailable, Signature), age.

Retrying tab (table): first failed, connector, item (for example "GL line 9001-332", "Event code EVT-2026-0105 to Ramp", "Webhook from ERPNext"), direction, error class tag, last error message, attempts (3 of 8), next retry (in 12 minutes, backoff), actions Retry now, Pause retries.

Dead letter tab (attempts exhausted): same columns plus "Moved on"; actions:

- Retry (after fixing the cause; uses the same idempotency key, so a success never duplicates).
- Fix mapping and retry (for Mapping errors, opens the connector's Mappings tab with the missing value highlighted, then retries).
- Discard (reason code and typed reason; the item is marked discarded and kept for audit).
- Bulk: Retry selected, Discard selected.

Payload drawer: request and response summary with secrets and personal fields redacted (tokens, signatures, card numbers masked), headers, status code, provider error body, correlation id, the record it would create or update in BudgetFlow.

Sample items:

- Adaptive Planning, actuals export, Authentication "401 Unauthorized", attempts 8 of 8, Dead letter, "Replace credentials" link.
- Ramp, event code EVT-2026-0105, Validation "duplicate external id", attempts 3 of 8, next retry 10:42.
- ERPNext, webhook, Signature "HMAC signature does not match", rejected (signature failures are not retried; they are listed for investigation).
- Concur, expense line 77-1042, Mapping "Expense type 'Wellness - other' has no category", attempts 2 of 8.

## Data and permissions

Failed outbox messages and inbound records with attempt counts, next retry times, error class and redacted payload snapshots, in `integrations.ts`. Retries follow exponential backoff (1, 2, 4, 8 minutes up to 1 hour; 8 attempts) and then move to the dead letter; signature failures are rejected immediately and never retried. `integration.manage` to act; `integration.read` to view. Retrying reuses the original idempotency key; discarding is a soft state with reason.

## States

| State           | Behaviour                                                                             |
| --------------- | ------------------------------------------------------------------------------------- |
| Retrying        | as above                                                                              |
| Dead letter     | as above                                                                              |
| Payload drawer  | as above                                                                              |
| Discard dialog  | reason code, typed reason, "The item will not be retried. It stays in the audit log." |
| Retry succeeded | snackbar "Retried: applied to the actuals review"; row leaves the list                |
| Retry failed    | row stays with the new error and attempt count                                        |
| Empty           | success empty state "Nothing is failing"                                              |
| Loading / error | `sat-ghost`; error banner with Retry                                                  |

## Budget safety and audit

Retries are idempotent, so a retried inbound line enters the review once and a retried push never doubles a card limit. Discards, bulk actions and manual retries are audited; payloads in the UI and audit are redacted.

## Responsive and accessibility

Desktop and tablet; mobile read-only list. Error classes are tags with text; the payload drawer uses a monospace block with a Copy button.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `satInteractiveTag` (filters), `mat-table` with `satTableWithRowStates` and `sat-selection-bar`, `sat-status-tag` (error class), `sat-empty-state`, `sat-ghost`; Angular Material side sheet (payload), dialog (discard with reason code and typed reason), snackbar.

## Related screens and navigation

092 hub, 099 sync status, 99b pushes, 101 webhooks (delivery failures to customer endpoints live there), connector pages 093-098, 094a, 094b, 088 audit log.

## Decisions taken

- Eight retries with exponential backoff up to one hour, then the dead letter. Recommended as enough to ride out provider outages without hiding real failures for long.
- Signature failures on inbound webhooks are never retried; they are listed for investigation because they may be forged.
- Discarding needs a reason code and typed reason and keeps the item for audit.
- Payloads are always shown redacted: tokens, signatures and card numbers never appear in the UI.
