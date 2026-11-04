# 093 HR system integration

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 12 batch. Build phase P12. Admin > Integrations > HR (`/integrations/hr-file`, `/integrations/workday-hcm`), in the connector frame of 092.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the connector frame of 092 and the review step of 22c. Planned Stitch states, to be generated in a later session:

| State                      | Planned image                                                  |
| -------------------------- | -------------------------------------------------------------- |
| HR connector overview      | `design/stitch/093-hr-integration/default--desktop--light.png` |
| field mapping              | `mapping--desktop--light.png`                                  |
| sync preview with changes  | `preview--desktop--light.png`                                  |
| sync blocked by row errors | `blocked--desktop--light.png`                                  |

## Purpose

Keep people, org units, locations, cost centers, employing entities and employment types in BudgetFlow in step with the HR system automatically, so per-head allocations, eligibility, cost splits and approval routing use current headcount without manual imports.

## Roles

Integration Admin (connect, map, schedule); Organization Admin (reviews and approves changes that affect org structure); Finance Admin (read; per-head true-ups follow the refresh).

## Entry points

092 HR tile; 22c HR headcount import ("Automate with the HR connector"); 042 organization import; sync failure notifications.

## Content and actions

Connectors: Workday HCM (API) and HR file import (SFTP, CSV in the 22c format). Frame tabs from 092; HR-specific content:

- Overview (sample HR file import, Connected, daily at 02:00 IST): last sync 4 Nov 02:00, 1,512 workers read, 14 changes applied (6 joiners, 3 leavers, 5 transfers), next sync 5 Nov 02:00; "Headcount snapshot 4 Nov created" with a link to 22c snapshots.
- Mappings: HR fields to BudgetFlow fields (worker id to employee id, legal company to legal entity IN01, US01, UK01; location to office; cost center code to cost center; supervisory org to department or team; worker type to employment type Employee, Contractor, Intern; manager to reporting line; hire and termination dates to effective dates). Unmapped values list ("Location 'Remote - Europe' has no office") with "Map to" select.
- Sync: objects (workers, org units, locations, cost centers), direction inbound only, schedule, effective dating ("Apply changes on their effective date"), "Create headcount snapshot after each sync" (on).
- Preview before apply (first sync and whenever changes exceed 5% of people): table of changes by type with counts and examples; "Per-head budgets affected: Hyderabad Events true-up +USD 180.00 (3 joiners prorated)" linking 022a.
- Apply rule: all-or-nothing, as 22c: any row error blocks the sync with a downloadable error report.

## Data and permissions

Calls the existing org commands and imports (`importOrgUnits`, `importHeadcount`, person and reporting line changes from the P3 `org.ts` contract) so the same validation and effective dating apply; runs record in `sync_runs`. `integration.manage` to configure; applying org-structure changes above the 5% threshold needs `org.manage` (Organization Admin). Personal data is limited to the fields BudgetFlow uses (no salary, no personal contact data).

## States

| State                  | Behaviour                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Not connected          | choose Workday HCM or HR file import; mock available for local runs                              |
| Overview               | as above                                                                                         |
| Mapping gaps           | warning banner "2 values have no mapping; affected workers are held back" with the list          |
| Preview                | as above; Apply or Cancel (Organization Admin)                                                   |
| Blocked                | error banner "Sync stopped: 4 rows have errors. Nothing was applied." with Download error report |
| Leaver with open items | info list "3 leavers own budgets or hold approvals" linking 103 (hand-over follows 103 rules)    |
| Loading / error        | `sat-ghost`; provider errors go to 100                                                           |

## Budget safety and audit

Headcount changes affect money only through per-head true-ups, which follow 022a's approval and posting rules. Each sync run, mapping change and approved preview is audited; changes to people and org units carry the sync run id in their audit entries.

## Responsive and accessibility

Desktop and tablet; mobile read-only overview. Mapping tables have row headers; counts in the preview are text.

## Satori components

Connector frame from 092; `mat-table` with `satTableWithRowStates`, `sat-status-tag`, `sat-banner`, `sat-rich-tooltip`, `sat-ghost`; Angular Material select (map to), slide toggles, time field, dialog (apply preview), snackbar.

## Related screens and navigation

22c HR headcount import, 042 organization import, 022a per-head driver allocation, 033 organization hierarchy, 038 people directory, 103 user and role management, 098 SCIM, 099 sync status, 100 errors.

## Decisions taken

- HR sync is inbound only and all-or-nothing per run, matching the 22c decision, so partial headcount never skews per-head allocations.
- Changes affecting more than 5% of people need an Organization Admin to approve the preview; smaller daily changes apply automatically on their effective dates.
- Only fields BudgetFlow needs are synced; no salary or personal contact data.
