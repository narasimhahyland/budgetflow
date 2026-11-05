# 113 Audit and compliance settings

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 14 batch. Build phase P14. Settings > Audit and compliance (`/admin/compliance`).

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the settings layout of 102. Planned Stitch states, to be generated in a later session:

| State                         | Planned image                                                             |
| ----------------------------- | ------------------------------------------------------------------------- |
| integrity checks and schedule | `design/stitch/113-audit-compliance-settings/default--desktop--light.png` |
| segregation-of-duties rules   | `segregation--desktop--light.png`                                         |
| access review campaign        | `access-review--desktop--light.png`                                       |
| check failed                  | `check-failed--desktop--light.png`                                        |

## Purpose

Give auditors and administrators control over the checks that prove BudgetFlow's records are trustworthy (audit hash-chain verification, ledger rebuild check), the segregation-of-duties rules applied when roles are assigned, and periodic access reviews of privileged roles, with the non-negotiable controls shown as fixed.

## Roles

Auditor (runs checks, signs off access reviews, reads everything); Organization Admin (edits segregation rules, starts access reviews); Finance Controller (runs checks, reviews finance roles); Finance Admin (read); Super Admin (job status only).

## Entry points

Settings > Audit and compliance; 088 audit log "Verification settings"; 017a exceptions pinned integrity flag; 103 segregation warning "Rules"; 114 system health nightly jobs.

## Content and actions

Tab Integrity checks:

- Audit hash chain: verified nightly at 01:30 IST; last result "Verified, 184,220 entries, chain intact" (success); "Verify now" (Auditor and Finance Controller; at most once an hour; runs in the background).
- Ledger rebuild check: nightly at 02:00 IST; last result "Clean: cached balances equal the rebuild; no unbalanced journals or negative buckets" (from `integrity_check_runs`); "Run now" (same limits).
- History: last 30 runs with status (Clean, Drift detected, Failed), duration, flags raised (links to 17a).
- Notifications: who is told when a check fails (Finance Controller and Auditor, required; others optional).

Tab Segregation of duties: rules (pair of roles, effect Warn with reason or Block, applies to new assignments): Finance Admin + Auditor (Warn, reason required); Organization Admin + Finance Admin (Warn); Integration Admin + Finance Admin (Warn); Add rule. Existing people who already hold a flagged pair are listed ("2 people hold Finance Admin + Auditor") with links to 103.

Fixed controls (read-only list): no self-approval; an approver cannot be a beneficiary or attendee; delegation capped by the delegator's limit and dates, at most 30 days, no re-delegation; ownership is not approval authority; ledger corrections are reversals; audit entries cannot be changed. Note: "These are built into BudgetFlow and cannot be turned off."

Tab Access reviews: campaigns (name, scope: privileged roles such as CEO, Finance Admin, Finance Controller, Organization Admin, Integration Admin, Auditor; reviewers; due date; progress); sample "Q4 2026 privileged access", 14 assignments, 9 confirmed, 1 removed, 4 open, due 30 Nov. Reviewer view: each assignment with last sign-in and last privileged action; Keep (optional note) or Remove (reason; removal applies through 103 with the usual hand-over of open approvals). Schedule: quarterly (default).

## Data and permissions

Checks use the existing integrity runs (`integrity_check_runs`, `integrity_flags` kinds `audit_chain_broken`, `ledger_drift`, `journal_unbalanced`, `negative_bucket`, `over_allocated`, `triplet_mismatch`) and `integrity.run` (Finance Admin, Finance Controller) plus Auditor run rights (integrator adds `integrity.run` for Auditor); segregation rules and access reviews are new P14 `admin.ts` data. `tenant.settings.manage` to edit segregation rules and start reviews; `audit.read` to read; reviewers act on assignments in their campaign; removals go through `users.manage`. Fixed controls are read from the domain rules, not stored as settings.

## States

| State              | Behaviour                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Default            | integrity checks                                                                                                              |
| Running            | info tag "Verifying: 62%"; Verify now disabled                                                                                |
| Rate limited       | "Verify now" disabled with "Available again at 11:40"                                                                         |
| Check failed       | error banner "Audit chain broken at entry 184,031 (4 Nov 13:02)" with "Open the flag" (17a) and "Open in the audit log" (088) |
| Drift detected     | error banner with the affected budgets count and the flag link; no amounts for Super Admin                                    |
| Rule conflict      | "A rule for this pair already exists"                                                                                         |
| Review in progress | progress bar and reviewer list; overdue reviewers in the warning tone                                                         |
| Review complete    | success tag with sign-off by Hannah Cole (Auditor) and a downloadable summary (PDF, CSV)                                      |
| Read only          | Finance Admin: no controls                                                                                                    |
| Loading / error    | `sat-ghost`; error banner with Retry                                                                                          |

## Budget safety and audit

Checks never repair anything automatically: drift and chain breaks raise flags for people to investigate. Fixed controls cannot be configured away. Running checks, changing segregation rules, starting reviews, and every Keep and Remove decision are audited.

## Responsive and accessibility

Desktop and tablet; mobile read-only, except reviewers can Keep or Remove on mobile. Check results are sentences with numbers, not only tones.

## Satori components

`sat-header-bar`, `sat-navigation-tabs`, `mat-table` with `satTableWithRowStates`, `sat-status-tag` (check status, review status), `sat-banner`, `sat-ghost`, `sat-empty-state` (no reviews); Angular Material dialog (add rule, remove access), progress bar, select, snackbar.

## Related screens and navigation

088 audit log, 088a evidence pack, 017a exceptions, 103 users and roles, 104 permission matrix, 062 delegations, 111 data retention, 112 security, 114 system health.

## Decisions taken

- Auditors and the Finance Controller can run a verification on demand, at most once an hour, in addition to the nightly runs. Recommended to answer the 088 open question while protecting the database.
- Approval hygiene and ledger rules are shown as fixed controls that cannot be turned off.
- Segregation rules warn with a required reason by default; Organization Admin can make a pair Block.
- Privileged access is reviewed quarterly, signed off by an Auditor; removals hand over open approvals as in 103.
