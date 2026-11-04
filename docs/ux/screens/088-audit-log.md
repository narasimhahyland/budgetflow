# 088 Audit log

Status: proposed - awaiting user review. Light theme only. Start screen 9 (todo `ux-s09-audit-log`). New screen (no original).

Revised 2026-11-04 to the single-company decisions: Hyland only (static label, no tenant or organization switcher, no reporting-currency chip), budgets in USD (transactions may show INR or EUR with the USD amount), Export instead of Share.

## Design

| State                       | Image                                                     | Stitch screen                      |
| --------------------------- | --------------------------------------------------------- | ---------------------------------- |
| default (entry drawer open) | `design/stitch/088-audit-log/default--desktop--light.png` | `ed6898782feb499cba797ad67db002cb` |
| chain broken                | `chain-broken--desktop--light.png`                        | `99974293d1bc442fb605af8466a831bc` |

## Purpose

Let auditors and finance see every change (who, what, when, previous and new values, reason) in an append-only, hash-chained log, verify the chain, and export evidence.

## Roles

- Primary: Auditor, Finance Controller.
- Secondary: Organization Admin, Finance Admin; budget owners see entries for their own budgets from 021 budget details.

## Entry points

Sidebar Insights > Audit log; "View audit entry" links from snackbars, dialogs and budget details.

## Content and actions

- Header: Verify chain, Export, Schedule export.
- Integrity card: verified entry count, last verification, head hash.
- Filters: date range, actor, action, object type, budget, legal entity; saved filters.
- Dense table: time (user timezone), actor with role, action tag, object, change (previous to new, tabular), reason, entry hash.
- Entry drawer (480px): actor, role, delegation used, masked IP, request id, before and after diff, reason code and typed reason, linked balanced journal, previous hash and entry hash with Verified tag, Copy link, View object.

## Data

Audit entries (append-only), hash chain metadata, verification runs, export jobs.

## Permissions

`audit:read` with scope; Super Admin needs an audited break-glass grant for tenant data. Exports are themselves audited. Nobody can edit or delete entries.

## States

| State        | Treatment                                                                                                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading      | `sat-ghost` rows                                                                                                                                                                                                                                                                         |
| Empty        | No entries for the filters: empty state with Clear filters                                                                                                                                                                                                                               |
| Chain broken | Error integrity card naming the first bad entry and time, View break, Download verification report, note that security and the tenant admin were notified; affected row with error stripe and "Hash mismatch" tag, later rows "Unverified"; Schedule export disabled with reason (image) |
| Error        | Load failed: `sat-500-error-state` with Retry                                                                                                                                                                                                                                            |
| Success      | Export queued snackbar; scheduled export confirmation                                                                                                                                                                                                                                    |

## Audit

The page is the audit view; exports and verification runs are recorded as entries.

## Responsive

Tablet: drawer becomes full-height overlay. Mobile: entries as cards with action, object and time; drawer full screen.

## Accessibility

Diff uses text markers (Before, After) in addition to color; hashes have copy buttons with labels.

## Related screens

089 allocation history, 090 approval history, 091 export and scheduled reports, 113 audit and compliance settings.

## Navigation

Breadcrumb Home / Insights / Audit log; selected entry and filters in the URL.

## Open questions

- Who can trigger a manual chain verification, and how often?
- Stitch render notes: the default's IP and request-id formats are illustrative.
