# 017a Exceptions dashboard

Status: spec only - image pending (Stitch quota). Light theme only. UX Phase 10 batch. Build phase P10. Insights > Dashboards > Exceptions (`/dashboards/exceptions`); also linked from Finance.

## Design

Not generated: the Stitch daily screen-generation quota was exhausted on 2026-11-05 (see the review log). Build from this spec with the shared components (000, 000a) and the dashboard layout of 011. Planned Stitch states, to be generated in a later session:

| State                      | Planned image                                                         |
| -------------------------- | --------------------------------------------------------------------- |
| exceptions by type and age | `design/stitch/017a-exceptions-dashboard/default--desktop--light.png` |
| drill into one type        | `by-type--desktop--light.png`                                         |
| auditor view               | `auditor--desktop--light.png`                                         |

## Purpose

Give finance and audit one view of every control exception (policy breaches after spend, possible splits and duplicates, approvals granted over budget or by escalation, late postings, missing recharges, ledger integrity flags), how old they are, how they trend, and where to work each one, so nothing is resolved by email or forgotten.

## Roles

Finance Controller and Finance Admin (work exceptions in their queues); Auditor (read, export); CEO read.

## Entry points

Insights > Dashboards; 012 tiles; 066 rules dashboard "Post-spend exceptions"; finance weekly digest; 88a evidence pack (exceptions section).

## Content and actions

Header bar: title, period (FY2026 to date), as-of time, Schedule delivery, Export (CSV, XLSX, PDF).

KPI cards: open exceptions 21 (plus 10 informational); older than 14 days 4; resolved this month 44; USD at stake in open exceptions USD 13,159.90.

By type (table; each row opens its working queue filtered):

| Type                                                                       | Source                                                   | Open | Oldest  | USD at stake  | Queue       |
| -------------------------------------------------------------------------- | -------------------------------------------------------- | ---- | ------- | ------------- | ----------- |
| Post-spend policy breach (alcohol, gifts, blocked vendor, missing receipt) | post-spend re-check                                      | 7    | 19 days | 2,316.00      | 074a        |
| Possible split request                                                     | integrity flag `split_request`                           | 2    | 6 days  | 5,449.10      | 074a        |
| Possible duplicate                                                         | `duplicate`, `receipt_reuse`                             | 3    | 4 days  | 154.80        | 074a / 080b |
| Approved over budget                                                       | approvals (058)                                          | 4    | -       | informational | 090         |
| Approved after escalation                                                  | approvals (063)                                          | 6    | -       | informational | 090         |
| Late postings into the next period                                         | ledger (late flag)                                       | 5    | 12 days | 1,240.00      | 80e         |
| Cross-entity contribution without recharge                                 | recharges                                                | 1    | 9 days  | 4,000.00      | 053a        |
| Just under an approval threshold                                           | `just_under_threshold`                                   | 3    | 15 days | -             | 074a        |
| Ledger integrity                                                           | `ledger_drift`, `journal_unbalanced`, `triplet_mismatch` | 0    | -       | -             | 012         |

- Aging chart: open exceptions by age band (0-7, 8-30, 31-60, 60+ days) and type; trend line of opened against resolved by week; both with "View as table".
- By location table: open exceptions and USD at stake per location.
- "Informational" rows are counts of allowed-by-policy events for audit sampling, not work items.

## Data and permissions

`reports.ts` exceptions endpoint over post-spend exceptions (P7), `integrity_flags` (kinds `split_request`, `duplicate`, `cross_source_duplicate`, `receipt_reuse`, `just_under_threshold`, `ledger_drift`, `journal_unbalanced`, `negative_bucket`, `over_allocated`, `triplet_mismatch`, `audit_chain_broken`; statuses open, acknowledged, resolved), approvals with over-budget and escalation markers, late-posted ledger lines and recharge statuses. `report.read` at tenant scope plus `integrity.read`; resolution happens only in the linked queues with their own permissions.

## States

| State           | Behaviour                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Default         | as above                                                                                         |
| By type         | row selected: list of the exceptions of that type with age and link to each item                 |
| Integrity flag  | any ledger integrity flag open: error banner at the top "Ledger integrity flag open" with a link |
| Auditor view    | same data; no queue actions; Export and evidence pack links                                      |
| Empty           | success empty state "No open exceptions"                                                         |
| Loading / error | `sat-ghost`; error banner with Retry                                                             |

## Budget safety and audit

Ledger integrity and audit chain flags always appear at the top in the error tone. The dashboard resolves nothing itself. Exports and schedules are audited; each resolution is audited in its queue.

## Responsive and accessibility

Tablet: by-type table with Source hidden behind "Columns". Mobile: KPI scroller and one card per type. Ages and amounts are text; charts have tables.

## Satori components

`sat-header-bar`, `sat-interactive-card` (KPIs), `mat-table` with `satTableWithRowStates` and `satRowPrimaryAction`, `sat-status-tag`, `sat-banner`, `sat-empty-state`, `sat-ghost`; bar and line charts from `libs/web/ui/charts`; Export menu from 000.

## Related screens and navigation

074a post-spend exception queue, 080b unmatched actuals, 053a recharges, 080e period close (late postings), 090 approval history, 012 finance controller dashboard, 99a cross-source duplicates (P12), 17b red-flag analytics (P15), 17c anomaly flags (P13), 088 audit log.

## Decisions taken

- The dashboard aggregates and links; every exception is worked in its existing queue. Recommended to avoid two places where the same exception could be resolved differently.
- Approvals granted over budget or after escalation are listed as informational counts for audit sampling, not as work items.
- Any open ledger integrity flag is pinned at the top in the error tone.
