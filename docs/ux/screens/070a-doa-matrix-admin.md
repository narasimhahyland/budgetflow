# 070a Delegation-of-authority matrix admin

Status: spec proposed - awaiting user review; design pending. Light theme only. UX Phase 7 batch A. Build phase P7. Rules and policies > Delegation of authority (the editable successor of 104a).

## Design

Not generated yet (Stitch daily screen-generation limit, 2026-11-05; see the review log). Planned exports: `design/stitch/070a-doa-matrix-admin/default--desktop--light.png` (draft version with changes), `compare--desktop--light.png` (v1 versus v2), `publish-dialog--desktop--light.png`.

## Purpose

Maintain who may approve what: limits by role or person, spend type and legal entity, versioned and effective-dated, with every change compared, approved and audited before it applies.

## Roles

Finance Admin (prepares), CEO (approves a new matrix version, assumed), Finance Controller and Auditor (read).

## Entry points

066 tabs; 104a "Edit in Rules and policies" (for Finance Admin); 062 note about long absences.

## Content and actions

Header: "Delegation of authority", version selector (v1 Active since 1 Jan 2026; v2 Draft, effective 1 Dec 2026), "Check a limit" (opens the 104a check panel), Compare versions, "Submit for approval".

Draft table (editable cells, keyboard-first): who (role or named person), spend type (all, events, gifts and entertainment, contributions, over-budget), legal entity (all, IN01, US01, UK01), limit (USD), valid from, valid to, change marker (Added, Changed, Removed). Seeded values: CEO USD 250,000.00; Finance Admin USD 100,000.00; Finance Controller USD 100,000.00; Budget owner, Department head, Regional manager USD 10,000.00; Location manager USD 2,500.00 (all spend types, all entities). Sample draft changes: Regional manager, events, IN01: USD 15,000.00 (changed); Location manager, gifts and entertainment: USD 500.00 (added).

Side panel "Impact of this version": open approval tasks that would change approver (12), delegations whose effective limit changes (2), rules referring to roles (R-07, R-12).

Compare view: two columns v1 and v2 with added (success), changed (warning, old -> new) and removed (important) rows.

## Data and permissions

DoA matrix versions and rows (`authority.ts` schema); one active version per date; `lookupDoa` uses the version effective on the decision date at the locked plan rate. `doa:edit` for Finance Admin; `doa:approve` for the CEO (assumed) to activate. Versions are immutable once approved.

## States

| State               | Behaviour                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft               | as above                                                                                                                                           |
| Validation          | overlapping rows for the same who, spend type and entity; limit must be above zero; a person row above their role's next authority shows a warning |
| Awaiting approval   | read-only draft with "Waiting for Olivia Grant (CEO)"; Withdraw                                                                                    |
| Approved, scheduled | info banner "v2 starts 1 Dec 2026"                                                                                                                 |
| Compare             | as above                                                                                                                                           |
| Read only           | Finance Controller and Auditor                                                                                                                     |

## Budget safety and audit

A matrix change never re-decides past approvals; decisions record the matrix version they used. Submitting, approving and activating are audited with the full row diff.

## Responsive and accessibility

Desktop only for editing; tablet and mobile read-only. Editable cells follow grid keyboard patterns; change markers are text tags.

## Related screens and navigation

104a DoA matrix (read-only), 062, 063, 070, 066, 088 audit log.

## Assumptions and open questions

- Who approves a new DoA version: CEO alone (assumed) or CEO plus Finance Controller?
